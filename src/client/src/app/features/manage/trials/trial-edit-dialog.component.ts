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
import { MessageService } from 'primeng/api';
import { FormsModule } from '@angular/forms';

import { TrialService } from '../../../core/services/trial.service';
import { MarkerService } from '../../../core/services/marker.service';
import { AssetService } from '../../../core/services/asset.service';
import { IndicationService } from '../../../core/services/indication.service';
import { SpaceSettingsService } from '../../../core/services/space-settings.service';
import { Trial } from '../../../core/models/trial.model';
import { Marker } from '../../../core/models/marker.model';
import {
  TRIAL_END_TITLE,
  TRIAL_START_TITLE,
  approxDateLabel,
  isCtgovOwnedMarker,
  planTrialDateMarker,
  selectTrialEndMarker,
  selectTrialStartMarker,
} from '../../../core/models/trial-date-marker';
import { TRIAL_END_MARKER_TYPE_ID, TRIAL_START_MARKER_TYPE_ID } from '../../../core/models/trial-phase-span';
import { FormActionsComponent } from '../../../shared/components/form-actions.component';
import { TrialEditFormComponent } from './trial-edit-form.component';
import type { CreateFn } from '../shared/taxonomy-multiselect/taxonomy-create-controller';

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
 *
 * Trial dates are no longer columns: the Phase start / Phase end fields edit
 * the trial's Trial Start / Trial End markers (core/models/trial-date-marker.ts).
 * A date field is locked when its marker is ct.gov-owned
 * (metadata.source === 'ctgov'); the DB BEFORE UPDATE trigger on markers
 * enforces the same lock server-side.
 */
@Component({
  selector: 'app-trial-edit-dialog',
  imports: [Dialog, FormsModule, FormActionsComponent, TrialEditFormComponent],
  templateUrl: './trial-edit-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrialEditDialogComponent {
  private trialService = inject(TrialService);
  private markerService = inject(MarkerService);
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

  // The Trial Start / Trial End markers that drive the phase bar (earliest
  // start, latest end). The dialog prefills, locks, and writes against these.
  private readonly startMarker = computed<Marker | null>(() =>
    selectTrialStartMarker(this.trial().markers ?? []),
  );
  private readonly endMarker = computed<Marker | null>(() =>
    selectTrialEndMarker(this.trial().markers ?? []),
  );

  readonly phaseTypeLocked = computed(() => this.trial().phase_type_source === 'ctgov');
  // A date field is locked when its marker is ct.gov-owned. Analyst / un-owned
  // (or absent) markers are editable.
  readonly phaseStartLocked = computed(() => isCtgovOwnedMarker(this.startMarker()));
  readonly phaseEndLocked = computed(() => isCtgovOwnedMarker(this.endMarker()));

  // When the underlying marker is approximate (month/quarter/half/year) we cannot
  // honestly show its midpoint date in a day-precise picker, so the field renders
  // the period caption read-only (e.g. "~Q3 '26"). Precision is edited in the
  // marker editor, which has the period controls. Null for exact / no marker.
  readonly phaseStartApproxLabel = computed(() => approxDateLabel(this.startMarker()));
  readonly phaseEndApproxLabel = computed(() => approxDateLabel(this.endMarker()));

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

  readonly isValid = computed(() => {
    const id = this.identifier();
    const idValid = !id || id.trim() === '' || /^NCT\d{8}$/i.test(id.trim());
    const ids = this.assetIds();
    const primary = this.primaryAssetId();
    const assetsValid = ids.length > 0 && !!primary && ids.includes(primary);
    return this.name().trim().length > 0 && assetsValid && idValid;
  });

  protected readonly showNoIndicationNote = computed(() => this.indicationIds().length === 0);

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
        // Prefill the date fields from the Trial Start / Trial End markers.
        this.phaseStart.set(this.startMarker()?.event_date ?? null);
        this.phaseEnd.set(this.endMarker()?.event_date ?? null);
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

  // Inline-create handler for indications: persist a name-only indication,
  // register it in the option list, and surface failures as a toast. Re-throws
  // so the multiselect keeps the typed text for retry.
  protected readonly createIndication: CreateFn = async (name) => {
    try {
      const created = await this.indicationService.create(this.trial().space_id, { name });
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

  /**
   * Translate a single Phase start / Phase end field edit into marker CRUD.
   * Mirrors the analyst-marker semantics of the create_trial server helper:
   * title, exact precision, and an actual/company projection recomputed from
   * the date. A ct.gov-owned (locked) marker is never written -- the field was
   * disabled and the DB trigger would reject it anyway.
   */
  private async applyDateMarker(
    trial: Trial,
    markerTypeId: string,
    title: string,
    existing: Marker | null,
    locked: boolean,
    newDate: string | null,
  ): Promise<void> {
    const plan = planTrialDateMarker({
      markerTypeId,
      title,
      existing,
      locked,
      oldDate: existing?.event_date ?? null,
      newDate,
      today: this.todayIso(),
    });
    switch (plan.action) {
      case 'create':
        await this.markerService.create(
          trial.space_id,
          {
            marker_type_id: plan.create!.marker_type_id,
            title: plan.create!.title,
            projection: plan.create!.projection,
            event_date: plan.create!.event_date,
            date_precision: plan.create!.date_precision,
            metadata: plan.create!.metadata,
          },
          [trial.id],
        );
        break;
      case 'update':
        await this.markerService.update(plan.markerId!, {
          event_date: plan.update!.event_date,
          projection: plan.update!.projection,
        });
        break;
      case 'delete':
        await this.markerService.delete(plan.markerId!);
        break;
      case 'none':
        break;
    }
  }

  /** UTC today as YYYY-MM-DD, for the marker projection rule. Matches the DB's UTC session. */
  private todayIso(): string {
    return new Date().toISOString().slice(0, 10);
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
      // phase_type stays a trial column. Only send it when unlocked; the
      // server trigger also enforces this.
      if (!this.phaseTypeLocked()) {
        updates.phase_type = this.phaseType();
      }
      const updated = await this.trialService.update(t.id, updates);
      // Trial dates are markers: translate the date-field edits into marker
      // CRUD. Run after the trial update so a marker failure leaves the trial
      // fields coherent; the catch surfaces a single error toast.
      await this.applyDateMarker(
        t,
        TRIAL_START_MARKER_TYPE_ID,
        TRIAL_START_TITLE,
        this.startMarker(),
        this.phaseStartLocked(),
        this.phaseStart(),
      );
      await this.applyDateMarker(
        t,
        TRIAL_END_MARKER_TYPE_ID,
        TRIAL_END_TITLE,
        this.endMarker(),
        this.phaseEndLocked(),
        this.phaseEnd(),
      );
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
