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
import { MessageService } from 'primeng/api';
import { FormsModule } from '@angular/forms';

import { TrialService } from '../../../core/services/trial.service';
import { ProductService } from '../../../core/services/product.service';
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
  imports: [Dialog, ButtonModule, InputTextModule, Select, FormsModule],
  templateUrl: './trial-edit-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrialEditDialogComponent {
  private trialService = inject(TrialService);
  private productService = inject(ProductService);
  private taService = inject(TherapeuticAreaService);
  private messageService = inject(MessageService);

  readonly visible = input<boolean>(false);
  visibleChange = output<boolean>();
  readonly trial = input.required<Trial>();
  saved = output<Trial>();

  readonly name = signal('');
  readonly identifier = signal<string | null>(null);
  readonly productId = signal<string | null>(null);
  readonly therapeuticAreaId = signal<string | null>(null);

  readonly products = signal<SelectOption[]>([]);
  readonly therapeuticAreas = signal<SelectOption[]>([]);
  readonly saving = signal(false);

  readonly isValid = computed(() => {
    const id = this.identifier();
    const idValid = !id || id.trim() === '' || /^NCT\d{8}$/i.test(id.trim());
    return (
      this.name().trim().length > 0 && !!this.productId() && !!this.therapeuticAreaId() && idValid
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
        this.productId.set(t.product_id ?? null);
        this.therapeuticAreaId.set(t.therapeutic_area_id ?? null);
        void this.loadOptions(t.space_id);
      }
    });
  }

  private async loadOptions(spaceId: string): Promise<void> {
    const [products, tas] = await Promise.all([
      this.productService.list(spaceId),
      this.taService.list(spaceId),
    ]);
    this.products.set(products.map((p) => ({ id: p.id, name: p.name })));
    this.therapeuticAreas.set(tas.map((t) => ({ id: t.id, name: t.name })));
  }

  close(): void {
    this.visibleChange.emit(false);
  }

  async save(): Promise<void> {
    if (!this.isValid()) return;
    this.saving.set(true);
    try {
      const updated = await this.trialService.update(this.trial().id, {
        name: this.name().trim(),
        identifier: this.identifier()?.trim() || null,
        product_id: this.productId()!,
        therapeutic_area_id: this.therapeuticAreaId()!,
      });
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
