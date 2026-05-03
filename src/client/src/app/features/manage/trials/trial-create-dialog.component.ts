import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { Dialog } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { MessageService } from 'primeng/api';
import { FormsModule } from '@angular/forms';

import { TrialService } from '../../../core/services/trial.service';
import { ProductService } from '../../../core/services/product.service';
import { TherapeuticAreaService } from '../../../core/services/therapeutic-area.service';
import { ChangeEventService } from '../../../core/services/change-event.service';

interface SelectOption {
  id: string;
  name: string;
}

@Component({
  selector: 'app-trial-create-dialog',
  standalone: true,
  imports: [Dialog, ButtonModule, InputTextModule, Select, FormsModule],
  templateUrl: './trial-create-dialog.component.html',
})
export class TrialCreateDialogComponent {
  private trialService = inject(TrialService);
  private productService = inject(ProductService);
  private taService = inject(TherapeuticAreaService);
  private changeEventService = inject(ChangeEventService);
  private messageService = inject(MessageService);

  visible = input<boolean>(false);
  visibleChange = output<boolean>();
  spaceId = input.required<string>();
  saved = output<{ trialId: string }>();

  // Form fields are signals because they participate in the isValid() computed
  // and are bound via [ngModel]+(ngModelChange) instead of [(ngModel)] for the
  // signal-friendly one-way pattern.
  name = signal('');
  identifier = signal<string | null>(null);
  productId = signal<string | null>(null);
  therapeuticAreaId = signal<string | null>(null);

  products = signal<SelectOption[]>([]);
  therapeuticAreas = signal<SelectOption[]>([]);

  saving = signal(false);

  isValid = computed(() => {
    const id = this.identifier();
    const idValid = !id || /^NCT\d{8}$/i.test(id.trim());
    return (
      this.name().trim().length > 0 && !!this.productId() && !!this.therapeuticAreaId() && idValid
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
        this.productId.set(null);
        this.therapeuticAreaId.set(null);
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
      const trial = await this.trialService.create(this.spaceId(), {
        name: this.name().trim(),
        identifier: this.identifier()?.trim() || null,
        product_id: this.productId()!,
        therapeutic_area_id: this.therapeuticAreaId()!,
      });
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
