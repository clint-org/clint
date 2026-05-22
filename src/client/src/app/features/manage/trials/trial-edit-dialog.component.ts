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
import { TherapeuticAreaService } from '../../../core/services/therapeutic-area.service';
import { Trial } from '../../../core/models/trial.model';

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
  standalone: true,
  imports: [Dialog, ButtonModule, InputTextModule, Select, Tooltip, FormsModule],
  templateUrl: './trial-edit-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrialEditDialogComponent {
  private trialService = inject(TrialService);
  private assetService = inject(AssetService);
  private taService = inject(TherapeuticAreaService);
  private messageService = inject(MessageService);

  readonly visible = input<boolean>(false);
  readonly visibleChange = output<boolean>();
  readonly trial = input.required<Trial>();
  readonly saved = output<Trial>();

  readonly name = signal('');
  readonly identifier = signal<string | null>(null);
  readonly assetId = signal<string | null>(null);
  readonly therapeuticAreaId = signal<string | null>(null);
  readonly phaseType = signal<string | null>(null);
  readonly phaseStart = signal<string | null>(null);
  readonly phaseEnd = signal<string | null>(null);

  readonly products = signal<SelectOption[]>([]);
  readonly therapeuticAreas = signal<SelectOption[]>([]);
  readonly saving = signal(false);

  readonly phaseTypeLocked = computed(() => this.trial().phase_type_source === 'ctgov');
  readonly phaseStartLocked = computed(() => this.trial().phase_start_date_source === 'ctgov');
  readonly phaseEndLocked = computed(() => this.trial().phase_end_date_source === 'ctgov');

  protected readonly PHASE_OPTIONS: { id: string; name: string }[] = [
    { id: 'PRECLIN', name: 'Preclinical' },
    { id: 'P1', name: 'Phase 1' },
    { id: 'P2', name: 'Phase 2' },
    { id: 'P3', name: 'Phase 3' },
    { id: 'P4', name: 'Phase 4' },
    { id: 'APPROVED', name: 'Approved' },
    { id: 'LAUNCHED', name: 'Launched' },
    { id: 'OBS', name: 'Observational' },
  ];

  readonly isValid = computed(() => {
    const id = this.identifier();
    const idValid = !id || id.trim() === '' || /^NCT\d{8}$/i.test(id.trim());
    return (
      this.name().trim().length > 0 && !!this.assetId() && !!this.therapeuticAreaId() && idValid
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
        this.assetId.set(t.product_id ?? null);
        this.therapeuticAreaId.set(t.therapeutic_area_id ?? null);
        this.phaseType.set(t.phase_type ?? null);
        this.phaseStart.set(t.phase_start_date ?? null);
        this.phaseEnd.set(t.phase_end_date ?? null);
        void this.loadOptions(t.space_id);
      }
    });
  }

  private async loadOptions(spaceId: string): Promise<void> {
    const [products, tas] = await Promise.all([
      this.assetService.list(spaceId),
      this.taService.list(spaceId),
    ]);
    this.products.set(products.map((p) => ({ id: p.id, name: p.name })));
    this.therapeuticAreas.set(tas.map((t) => ({ id: t.id, name: t.name })));
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
      const updates: Partial<Trial> = {
        name: this.name().trim(),
        identifier: this.identifier()?.trim() || null,
        product_id: this.assetId()!,
        therapeutic_area_id: this.therapeuticAreaId()!,
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
