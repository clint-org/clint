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
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { Tooltip } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { FormsModule } from '@angular/forms';

import { TrialService } from '../../../core/services/trial.service';
import { AssetService } from '../../../core/services/asset.service';
import { IndicationService } from '../../../core/services/indication.service';
import { ChangeEventService } from '../../../core/services/change-event.service';
import { Trial } from '../../../core/models/trial.model';

interface SelectOption {
  id: string;
  name: string;
}

@Component({
  selector: 'app-trial-create-dialog',
  standalone: true,
  imports: [Dialog, ButtonModule, InputTextModule, Select, Tooltip, FormsModule],
  templateUrl: './trial-create-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrialCreateDialogComponent {
  private trialService = inject(TrialService);
  private assetService = inject(AssetService);
  private indicationService = inject(IndicationService);
  private changeEventService = inject(ChangeEventService);
  private messageService = inject(MessageService);

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

  protected readonly PHASE_OPTIONS: { id: string; name: string }[] = [
    { id: 'PRECLIN', name: 'Preclinical' },
    { id: 'P1', name: 'Phase 1' },
    { id: 'P2', name: 'Phase 2' },
    { id: 'P3', name: 'Phase 3' },
    { id: 'P4', name: 'Phase 4' },
    { id: 'OBS', name: 'Observational' },
  ];

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

  constructor() {
    // Load product + therapeutic-area options whenever spaceId changes.
    effect(() => {
      const sid = this.spaceId();
      if (!sid) return;
      void this.loadOptions(sid);
    });

    // Reset form when the dialog is closed.
    effect(() => {
      if (!this.visible()) {
        this.name.set('');
        this.identifier.set(null);
        this.assetId.set(null);
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

  protected setPhaseStart(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.phaseStart.set(value || null);
  }

  protected setPhaseEnd(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.phaseEnd.set(value || null);
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
