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

import { TrialService } from '../../../core/services/trial.service';
import { AssetService } from '../../../core/services/asset.service';
import { IndicationService } from '../../../core/services/indication.service';
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

  readonly visible = input<boolean>(false);
  readonly visibleChange = output<boolean>();
  readonly trial = input.required<Trial>();
  readonly saved = output<Trial>();

  readonly name = signal('');
  readonly identifier = signal<string | null>(null);
  readonly assetId = signal<string | null>(null);
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

  protected readonly PHASE_OPTIONS: { id: string; name: string }[] = [
    { id: 'PRECLIN', name: 'Preclinical' },
    { id: 'P1', name: 'Phase 1' },
    { id: 'P2', name: 'Phase 2' },
    { id: 'P3', name: 'Phase 3' },
    { id: 'P4', name: 'Phase 4' },
    { id: 'OBS', name: 'Observational' },
  ];

  readonly isValid = computed(() => {
    const id = this.identifier();
    const idValid = !id || id.trim() === '' || /^NCT\d{8}$/i.test(id.trim());
    return (
      this.name().trim().length > 0 && !!this.assetId() && idValid
    );
  });

  constructor() {
    // Seed form from the input trial when the dialog opens. Re-seeds on every
    // open so any in-flight edits from a previous open are discarded.
    effect(() => {
      if (this.visible()) {
        const t = this.trial();
        this.name.set(t.name ?? '');
        this.identifier.set(t.identifier ?? null);
        this.assetId.set(t.asset_id ?? null);
        this.phaseType.set(t.phase_type ?? null);
        this.phaseStart.set(t.phase_start_date ?? null);
        this.phaseEnd.set(t.phase_end_date ?? null);
        void this.loadOptions(t.space_id);
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
      const updates: Partial<Trial> = {
        name: this.name().trim(),
        identifier: this.identifier()?.trim() || null,
        asset_id: this.assetId()!,
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
      const updated = await this.trialService.update(this.trial().id, updates);
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
