import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Dialog } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { DatePicker } from 'primeng/datepicker';
import { Tooltip } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { FormsModule } from '@angular/forms';

import { TaxonomyMultiselectComponent } from '../shared/taxonomy-multiselect/taxonomy-multiselect.component';
import type { CreateFn } from '../shared/taxonomy-multiselect/taxonomy-create-controller';

import { TrialService } from '../../../core/services/trial.service';
import { AssetService } from '../../../core/services/asset.service';
import { IndicationService } from '../../../core/services/indication.service';
import { ChangeEventService } from '../../../core/services/change-event.service';
import { SpaceSettingsService } from '../../../core/services/space-settings.service';
import { Trial } from '../../../core/models/trial.model';
import { FormFieldComponent } from '../../../shared/components/form-field.component';
import { FormActionsComponent } from '../../../shared/components/form-actions.component';

interface SelectOption {
  id: string;
  name: string;
}

@Component({
  selector: 'app-trial-create-dialog',
  standalone: true,
  imports: [
    Dialog,
    InputTextModule,
    Select,
    TaxonomyMultiselectComponent,
    DatePicker,
    Tooltip,
    FormsModule,
    FormFieldComponent,
    FormActionsComponent,
  ],
  templateUrl: './trial-create-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrialCreateDialogComponent {
  private trialService = inject(TrialService);
  private assetService = inject(AssetService);
  private indicationService = inject(IndicationService);
  private changeEventService = inject(ChangeEventService);
  private messageService = inject(MessageService);
  private spaceSettings = inject(SpaceSettingsService);

  readonly visible = input<boolean>(false);
  readonly visibleChange = output<boolean>();
  readonly spaceId = input.required<string>();
  readonly saved = output<{ trialId: string }>();

  // Form fields are signals because they participate in the isValid() computed
  // and are bound via one-way [ngModel] + (ngModelChange) instead of the
  // two-way banana-box form, which is invisible to signal reactivity.
  readonly name = signal('');
  readonly identifier = signal<string | null>(null);
  readonly assetId = signal<string | null>(null);
  readonly indicationIds = signal<string[]>([]);

  // form fields for the three new phase columns
  readonly phaseType = signal<string | null>(null);
  readonly phaseStart = signal<string | null>(null);
  readonly phaseEnd = signal<string | null>(null);

  // tracks whether each value was pre-filled by the ct.gov lookup. when true,
  // the field renders disabled and saves with source='ctgov'. when false, the
  // analyst typed it and the save uses source='analyst'.
  protected readonly phaseTypeFromCtgov = signal(false);
  protected readonly phaseStartFromCtgov = signal(false);
  protected readonly phaseEndFromCtgov = signal(false);

  // p-datepicker binds Date objects; the phaseStart/phaseEnd signals stay
  // YYYY-MM-DD strings (the save payload + ct.gov prefill use strings).
  readonly phaseStartDate = computed(() => this.parseDate(this.phaseStart()));
  readonly phaseEndDate = computed(() => this.parseDate(this.phaseEnd()));

  private readonly ALL_PHASE_OPTIONS: { id: string; name: string }[] = [
    { id: 'PRECLIN', name: 'Preclinical' },
    { id: 'P1', name: 'Phase 1' },
    { id: 'P2', name: 'Phase 2' },
    { id: 'P3', name: 'Phase 3' },
    { id: 'P4', name: 'Phase 4' },
    { id: 'OBS', name: 'Observational' },
  ];

  /** True when the space tracks preclinical (default false: option hidden). */
  protected readonly showPreclinical = signal(false);

  /** Phase options, dropping Preclinical when the space does not track it. */
  protected readonly phaseOptions = computed(() =>
    this.showPreclinical()
      ? this.ALL_PHASE_OPTIONS
      : this.ALL_PHASE_OPTIONS.filter((o) => o.id !== 'PRECLIN')
  );

  readonly products = signal<SelectOption[]>([]);
  readonly indications = signal<SelectOption[]>([]);

  readonly saving = signal(false);

  // map of ct.gov phase enum value to our analyst-facing enum. matches
  // _derive_phase_type() in supabase/migrations/20260503050000_derive_phase_type_from_ctgov.sql.
  private mapCtgovPhase(phases: string[] | undefined, studyType: string | undefined): string | null {
    if (!phases || phases.length === 0) return studyType === 'OBSERVATIONAL' ? 'OBS' : null;
    if (phases.length > 1) {
      // multi-phase trials collapse to max (e.g. PHASE2/PHASE3 -> P3) per the
      // sql function's documented behavior.
      const ranked = ['EARLY_PHASE1', 'PHASE1', 'PHASE2', 'PHASE3', 'PHASE4'];
      const max = phases
        .map((p) => ranked.indexOf(p))
        .filter((i) => i >= 0)
        .sort((a, b) => b - a)[0];
      if (max === undefined) return null;
      return { 0: 'P1', 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' }[max] ?? null;
    }
    const single = phases[0];
    if (single === 'EARLY_PHASE1' || single === 'PHASE1') return 'P1';
    if (single === 'PHASE2') return 'P2';
    if (single === 'PHASE3') return 'P3';
    if (single === 'PHASE4') return 'P4';
    if (single === 'NA' && studyType === 'OBSERVATIONAL') return 'OBS';
    return null;
  }

  // Autopopulate state for the NCT-first flow. The dialog opens with focus on
  // the NCT input; on a valid NCT format (NCT + 8 digits) we hit
  // CT.gov v2 and seed the Name field with the official acronym (or briefTitle
  // as fallback). The user can overwrite. nctLookupError surfaces 404s
  // inline so users know to fix the NCT before saving instead of finding out
  // when Sync fails post-create.
  protected readonly nctLookupState = signal<'idle' | 'looking_up' | 'ok' | 'not_found' | 'error'>(
    'idle'
  );
  protected readonly nctLookupAcronym = signal<string | null>(null);
  // Toggled true once the user types into the Name field manually so the
  // autopopulate doesn't clobber their input on a subsequent NCT change.
  private readonly nameWasManuallyEdited = signal(false);

  protected readonly nctFormatValid = computed(() => {
    const id = this.identifier();
    if (!id) return true;
    return /^NCT\d{8}$/i.test(id.trim());
  });

  readonly isValid = computed(() => {
    return (
      this.name().trim().length > 0 &&
      !!this.assetId() &&
      this.nctFormatValid() &&
      this.nctLookupState() !== 'looking_up' &&
      this.nctLookupState() !== 'not_found'
    );
  });

  protected readonly showNoIndicationNote = computed(() => this.indicationIds().length === 0);

  constructor() {
    // Load product + therapeutic-area options whenever spaceId changes.
    effect(() => {
      const sid = this.spaceId();
      if (!sid) return;
      void this.loadOptions(sid);
      void this.spaceSettings
        .getShowPreclinical(sid)
        .then((show) => this.showPreclinical.set(show))
        .catch(() => this.showPreclinical.set(false));
    });

    // Reset form when the dialog is closed.
    effect(() => {
      if (!this.visible()) {
        this.name.set('');
        this.identifier.set(null);
        this.assetId.set(null);
        this.indicationIds.set([]);
        this.nctLookupState.set('idle');
        this.nctLookupAcronym.set(null);
        this.nameWasManuallyEdited.set(false);
        this.phaseType.set(null);
        this.phaseStart.set(null);
        this.phaseEnd.set(null);
        this.phaseTypeFromCtgov.set(false);
        this.phaseStartFromCtgov.set(false);
        this.phaseEndFromCtgov.set(false);
      }
    });
  }

  /**
   * Called from (ngModelChange) on the NCT input. When the value parses as a
   * valid NCT, hit CT.gov for the acronym and seed Name. Aborts in-flight
   * lookups on subsequent changes so we don't race results out of order.
   */
  private lookupController: AbortController | null = null;
  protected onIdentifierChanged(value: string | null): void {
    this.identifier.set(value);
    this.nctLookupState.set('idle');
    this.nctLookupAcronym.set(null);
    if (this.lookupController) {
      this.lookupController.abort();
      this.lookupController = null;
    }
    if (!value) {
      this.phaseTypeFromCtgov.set(false);
      this.phaseStartFromCtgov.set(false);
      this.phaseEndFromCtgov.set(false);
      return;
    }
    const trimmed = value.trim();
    if (!/^NCT\d{8}$/i.test(trimmed)) {
      this.phaseTypeFromCtgov.set(false);
      this.phaseStartFromCtgov.set(false);
      this.phaseEndFromCtgov.set(false);
      return;
    }

    this.nctLookupState.set('looking_up');
    const controller = new AbortController();
    this.lookupController = controller;

    void (async () => {
      try {
        const res = await fetch(
          `https://clinicaltrials.gov/api/v2/studies/${encodeURIComponent(trimmed)}`,
          { signal: controller.signal }
        );
        if (controller.signal.aborted) return;
        if (res.status === 404) {
          this.nctLookupState.set('not_found');
          return;
        }
        if (!res.ok) {
          this.nctLookupState.set('error');
          return;
        }
        const study = (await res.json()) as {
          protocolSection?: {
            identificationModule?: { acronym?: string; briefTitle?: string };
            designModule?: { phases?: string[]; studyType?: string };
            statusModule?: {
              startDateStruct?: { date?: string };
              primaryCompletionDateStruct?: { date?: string };
              completionDateStruct?: { date?: string };
            };
          };
        };
        const acronym = study.protocolSection?.identificationModule?.acronym?.trim() ?? null;
        const briefTitle = study.protocolSection?.identificationModule?.briefTitle?.trim() ?? null;
        const display = acronym || briefTitle;
        this.nctLookupAcronym.set(acronym);
        this.nctLookupState.set('ok');
        if (display && !this.nameWasManuallyEdited()) {
          this.name.set(display);
        }

        // pre-fill phase + dates
        const derivedPhase = this.mapCtgovPhase(
          study.protocolSection?.designModule?.phases,
          study.protocolSection?.designModule?.studyType,
        );
        if (derivedPhase) {
          this.phaseType.set(derivedPhase);
          this.phaseTypeFromCtgov.set(true);
        }
        const startDate = study.protocolSection?.statusModule?.startDateStruct?.date;
        if (startDate) {
          // ct.gov returns YYYY-MM or YYYY-MM-DD; normalize to YYYY-MM-DD
          const normalized = /^\d{4}-\d{2}$/.test(startDate) ? `${startDate}-01` : startDate;
          this.phaseStart.set(normalized);
          this.phaseStartFromCtgov.set(true);
        }
        const endDate =
          study.protocolSection?.statusModule?.primaryCompletionDateStruct?.date ??
          study.protocolSection?.statusModule?.completionDateStruct?.date;
        if (endDate) {
          const normalized = /^\d{4}-\d{2}$/.test(endDate) ? `${endDate}-01` : endDate;
          this.phaseEnd.set(normalized);
          this.phaseEndFromCtgov.set(true);
        }
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return;
        this.nctLookupState.set('error');
      }
    })();
  }

  protected onNameChanged(value: string): void {
    this.name.set(value);
    this.nameWasManuallyEdited.set(true);
  }

  // MultiSelect with showClear can emit null; coalesce to [].
  protected onIndicationsChange(ids: string[] | null): void {
    this.indicationIds.set(ids ?? []);
  }

  // Inline-create handler for the Indication multiselect: persist a name-only
  // indication, register it in the option list, and surface failures as a toast.
  // Re-throws so the multiselect keeps the typed text for retry.
  protected readonly createIndication: CreateFn = async (name) => {
    try {
      const created = await this.indicationService.create(this.spaceId(), { name });
      this.indications.update((list) => [...list, { id: created.id, name: created.name }]);
      return created;
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not add indication',
        detail: e instanceof Error ? e.message : 'Check your connection and try again.',
        life: 4000,
      });
      throw e;
    }
  };

  private async loadOptions(spaceId: string): Promise<void> {
    const [products, indications] = await Promise.all([
      this.assetService.list(spaceId),
      this.indicationService.list(spaceId),
    ]);
    this.products.set(products.map((p) => ({ id: p.id, name: p.name })));
    this.indications.set(indications.map((i) => ({ id: i.id, name: i.name })));
  }

  close(): void {
    this.visibleChange.emit(false);
  }

  protected setPhaseStartDate(date: Date | null): void {
    this.phaseStart.set(date ? this.formatDate(date) : null);
  }

  protected setPhaseEndDate(date: Date | null): void {
    this.phaseEnd.set(date ? this.formatDate(date) : null);
  }

  private parseDate(value: string | null): Date | null {
    if (!value) return null;
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  async save(): Promise<void> {
    if (!this.isValid()) return;
    this.saving.set(true);
    try {
      const payload: Partial<Trial> = {
        name: this.name().trim(),
        identifier: this.identifier()?.trim() || null,
        asset_id: this.assetId()!,
      };
      if (this.phaseType()) {
        payload.phase_type = this.phaseType();
        payload.phase_type_source = this.phaseTypeFromCtgov() ? 'ctgov' : 'analyst';
      }
      if (this.phaseStart()) {
        payload.phase_start_date = this.phaseStart();
        payload.phase_start_date_source = this.phaseStartFromCtgov() ? 'ctgov' : 'analyst';
      }
      if (this.phaseEnd()) {
        payload.phase_end_date = this.phaseEnd();
        payload.phase_end_date_source = this.phaseEndFromCtgov() ? 'ctgov' : 'analyst';
      }
      const trial = await this.trialService.create(this.spaceId(), payload);
      if (this.indicationIds().length) {
        await this.trialService.setIndications(trial.id, this.indicationIds(), this.spaceId());
      }
      // Best-effort: kick off CT.gov sync if NCT was provided. Don't block the
      // save path on the sync result.
      if (trial.identifier) {
        this.changeEventService.triggerSingleTrialSync(trial.id).catch(() => undefined);
      }
      this.saved.emit({ trialId: trial.id });
      this.close();
      this.messageService.add({ severity: 'success', summary: 'Trial created.', life: 3000 });
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not create trial',
        detail: e instanceof Error ? e.message : 'Check your connection and try again.',
        life: 4000,
      });
    } finally {
      this.saving.set(false);
    }
  }
}
