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
import { MultiSelect } from 'primeng/multiselect';
import { DatePicker } from 'primeng/datepicker';
import { Tooltip } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { FormsModule } from '@angular/forms';

import { TrialService } from '../../../core/services/trial.service';
import { AssetService } from '../../../core/services/asset.service';
import { IndicationService } from '../../../core/services/indication.service';
import { SpaceSettingsService } from '../../../core/services/space-settings.service';
import { Trial } from '../../../core/models/trial.model';
import { FormFieldComponent } from '../../../shared/components/form-field.component';
import { FormActionsComponent } from '../../../shared/components/form-actions.component';

interface SelectOption {
  id: string;
  name: string;
}

/**
 * Lightweight edit dialog for the four user-owned trial fields:
 * name, identifier (NCT), product, therapeutic_area.
 *
 * The legacy trial-form was retired with the change-feed branch; the
 * planned inline-per-field editing is the future state. This dialog is the
 * interim path so users can fix typos / backfill an NCT they didn't enter
 * at creation time without going through delete-and-recreate.
 *
 * CT.gov-owned columns (phase, recruitment_status, study_type, etc.) are
 * NOT editable here -- they materialize from snapshots.
 */
@Component({
  selector: 'app-trial-edit-dialog',
  imports: [
    Dialog,
    InputTextModule,
    Select,
    MultiSelect,
    DatePicker,
    Tooltip,
    FormsModule,
    FormFieldComponent,
    FormActionsComponent,
  ],
  templateUrl: './trial-edit-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrialEditDialogComponent {
  private trialService = inject(TrialService);
  private assetService = inject(AssetService);
  private indicationService = inject(IndicationService);
  private messageService = inject(MessageService);
  private spaceSettings = inject(SpaceSettingsService);

  readonly visible = input<boolean>(false);
  readonly visibleChange = output<boolean>();
  readonly trial = input.required<Trial>();
  readonly saved = output<Trial>();

  readonly name = signal('');
  readonly identifier = signal<string | null>(null);
  // A trial can test multiple assets; assetIds is the membership and
  // primaryAssetId (one of assetIds) is the headline asset.
  readonly assetIds = signal<string[]>([]);
  readonly indicationIds = signal<string[]>([]);
  readonly primaryAssetId = signal<string | null>(null);
  readonly phaseType = signal<string | null>(null);
  readonly phaseStart = signal<string | null>(null);
  readonly phaseEnd = signal<string | null>(null);

  readonly products = signal<SelectOption[]>([]);
  readonly indications = signal<SelectOption[]>([]);
  readonly saving = signal(false);

  readonly phaseTypeLocked = computed(() => this.trial().phase_type_source === 'ctgov');
  readonly phaseStartLocked = computed(() => this.trial().phase_start_date_source === 'ctgov');
  readonly phaseEndLocked = computed(() => this.trial().phase_end_date_source === 'ctgov');

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

  /**
   * Phase options for this trial. Drops Preclinical when the space does not track
   * it, but keeps it if THIS trial is already preclinical so editing a legacy
   * preclinical record does not silently blank out its phase.
   */
  protected readonly phaseOptions = computed(() => {
    const keepPreclin = this.showPreclinical() || this.trial().phase_type === 'PRECLIN';
    return keepPreclin
      ? this.ALL_PHASE_OPTIONS
      : this.ALL_PHASE_OPTIONS.filter((o) => o.id !== 'PRECLIN');
  });

  // Primary-asset choices are the currently selected assets.
  protected readonly primaryOptions = computed(() => {
    const sel = new Set(this.assetIds());
    return this.products().filter((p) => sel.has(p.id));
  });

  readonly isValid = computed(() => {
    const id = this.identifier();
    const idValid = !id || id.trim() === '' || /^NCT\d{8}$/i.test(id.trim());
    const ids = this.assetIds();
    const primary = this.primaryAssetId();
    const assetsValid = ids.length > 0 && !!primary && ids.includes(primary);
    return this.name().trim().length > 0 && assetsValid && idValid;
  });

  // MultiSelect with showClear can emit null; coalesce to [].
  protected onIndicationsChange(ids: string[] | null): void {
    this.indicationIds.set(ids ?? []);
  }

  // MultiSelect with showClear can emit null; coalesce to []. Keep the primary in
  // sync: default to the first member, clear when no assets remain.
  protected onAssetsChange(ids: string[] | null): void {
    const next = ids ?? [];
    this.assetIds.set(next);
    const primary = this.primaryAssetId();
    if (next.length === 0) {
      this.primaryAssetId.set(null);
    } else if (primary === null || !next.includes(primary)) {
      this.primaryAssetId.set(next[0]);
    }
  }

  constructor() {
    // Seed form from the input trial when the dialog opens. Re-seeds on every
    // open so any in-flight edits from a previous open are discarded.
    effect(() => {
      if (this.visible()) {
        const t = this.trial();
        this.name.set(t.name ?? '');
        this.identifier.set(t.identifier ?? null);
        // Seed asset membership from trial_assets; fall back to the cached
        // primary if no membership rows exist (legacy data).
        this.assetIds.set(t.asset_id ? [t.asset_id] : []);
        this.primaryAssetId.set(t.asset_id ?? null);
        void this.trialService
          .listAssets(t.id)
          .then((members) => {
            if (members.length > 0) {
              this.assetIds.set(members.map((m) => m.asset_id));
              this.primaryAssetId.set(
                members.find((m) => m.is_primary)?.asset_id ?? members[0].asset_id,
              );
            }
          })
          .catch(() => undefined);
        this.phaseType.set(t.phase_type ?? null);
        this.phaseStart.set(t.phase_start_date ?? null);
        this.phaseEnd.set(t.phase_end_date ?? null);
        this.indicationIds.set([]);
        void this.trialService
          .listIndications(t.id)
          .then((rows) => this.indicationIds.set(rows.map((r) => r.id)))
          .catch(() => this.indicationIds.set([]));
        void this.loadOptions(t.space_id);
        void this.spaceSettings
          .getShowPreclinical(t.space_id)
          .then((show) => this.showPreclinical.set(show))
          .catch(() => this.showPreclinical.set(false));
      }
    });
  }

  private async loadOptions(spaceId: string): Promise<void> {
    const [products, indicationList] = await Promise.all([
      this.assetService.list(spaceId),
      this.indicationService.list(spaceId),
    ]);
    this.products.set(products.map((p) => ({ id: p.id, name: p.name })));
    this.indications.set(indicationList.map((i) => ({ id: i.id, name: i.name })));
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
      const t = this.trial();
      // Asset and indication membership go through their respective RPCs.
      // The asset sync trigger also updates trials.asset_id, so the field
      // update below omits asset_id.
      await this.trialService.setAssets(
        t.id,
        this.assetIds(),
        this.primaryAssetId()!,
        t.space_id,
      );
      await this.trialService.setIndications(t.id, this.indicationIds(), t.space_id);
      const updates: Partial<Trial> = {
        name: this.name().trim(),
        identifier: this.identifier()?.trim() || null,
      };
      // Only send phase fields the user is allowed to edit. The server-side
      // trigger also enforces this; the UI lock is the user-facing constraint.
      if (!this.phaseTypeLocked()) {
        updates.phase_type = this.phaseType();
      }
      if (!this.phaseStartLocked()) {
        updates.phase_start_date = this.phaseStart();
      }
      if (!this.phaseEndLocked()) {
        updates.phase_end_date = this.phaseEnd();
      }
      const updated = await this.trialService.update(t.id, updates);
      this.saved.emit(updated);
      this.close();
      this.messageService.add({ severity: 'success', summary: 'Trial updated.', life: 3000 });
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not update trial',
        detail: e instanceof Error ? e.message : 'Check your connection and try again.',
        life: 4000,
      });
    } finally {
      this.saving.set(false);
    }
  }
}
