import { Component, input, output, signal, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Trial } from '../../../core/models/trial.model';
import { Product } from '../../../core/models/product.model';
import { TherapeuticArea } from '../../../core/models/trial.model';
import { TrialService } from '../../../core/services/trial.service';
import { ProductService } from '../../../core/services/product.service';
import { TherapeuticAreaService } from '../../../core/services/therapeutic-area.service';

@Component({
  selector: 'app-trial-form',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './trial-form.component.html',
})
export class TrialFormComponent implements OnInit {
  readonly trial = input<Trial | null>(null);
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  private trialService = inject(TrialService);
  private productService = inject(ProductService);
  private therapeuticAreaService = inject(TherapeuticAreaService);

  readonly statuses = ['Active', 'Completed', 'Terminated', 'Suspended', 'Withdrawn'];

  products = signal<Product[]>([]);
  therapeuticAreas = signal<TherapeuticArea[]>([]);
  saving = signal(false);
  error = signal<string | null>(null);

  name = '';
  identifier = '';
  productId = '';
  therapeuticAreaId = '';
  sampleSize: number | null = null;
  status = '';
  notes = '';
  displayOrder = 0;

  ngOnInit(): void {
    this.loadDropdowns();

    const existing = this.trial();
    if (existing) {
      this.name = existing.name;
      this.identifier = existing.identifier ?? '';
      this.productId = existing.product_id;
      this.therapeuticAreaId = existing.therapeutic_area_id;
      this.sampleSize = existing.sample_size;
      this.status = existing.status ?? '';
      this.notes = existing.notes ?? '';
      this.displayOrder = existing.display_order;
    }
  }

  private async loadDropdowns(): Promise<void> {
    try {
      const [products, areas] = await Promise.all([
        this.productService.list(),
        this.therapeuticAreaService.list(),
      ]);
      this.products.set(products);
      this.therapeuticAreas.set(areas);
    } catch {
      this.error.set('Failed to load dropdown data');
    }
  }

  async onSubmit(): Promise<void> {
    if (!this.name.trim()) return;

    this.saving.set(true);
    this.error.set(null);

    try {
      const payload: Partial<Trial> = {
        name: this.name,
        identifier: this.identifier || null,
        product_id: this.productId || undefined,
        therapeutic_area_id: this.therapeuticAreaId || undefined,
        sample_size: this.sampleSize,
        status: this.status || null,
        notes: this.notes || null,
        display_order: this.displayOrder,
      };

      const existing = this.trial();
      if (existing) {
        await this.trialService.update(existing.id, payload);
      } else {
        await this.trialService.create(payload);
      }
      this.saved.emit();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to save trial');
    } finally {
      this.saving.set(false);
    }
  }
}
