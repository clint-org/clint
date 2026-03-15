import { Component, input, output, signal, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { InputNumber } from 'primeng/inputnumber';
import { Select } from 'primeng/select';
import { Textarea } from 'primeng/textarea';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { Trial } from '../../../core/models/trial.model';
import { Product } from '../../../core/models/product.model';
import { TherapeuticArea } from '../../../core/models/trial.model';
import { TrialService } from '../../../core/services/trial.service';
import { ProductService } from '../../../core/services/product.service';
import { TherapeuticAreaService } from '../../../core/services/therapeutic-area.service';

@Component({
  selector: 'app-trial-form',
  standalone: true,
  imports: [FormsModule, InputText, InputNumber, Select, Textarea, ButtonModule, MessageModule],
  templateUrl: './trial-form.component.html',
})
export class TrialFormComponent implements OnInit {
  readonly trial = input<Trial | null>(null);
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  private trialService = inject(TrialService);
  private productService = inject(ProductService);
  private therapeuticAreaService = inject(TherapeuticAreaService);
  private route = inject(ActivatedRoute);

  readonly statusOptions = [
    { label: 'Active', value: 'Active' },
    { label: 'Completed', value: 'Completed' },
    { label: 'Terminated', value: 'Terminated' },
    { label: 'Suspended', value: 'Suspended' },
    { label: 'Withdrawn', value: 'Withdrawn' },
  ];

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
        this.productService.list(this.route.snapshot.paramMap.get('spaceId')!),
        this.therapeuticAreaService.list(this.route.snapshot.paramMap.get('spaceId')!),
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
        const spaceId = this.route.snapshot.paramMap.get('spaceId')!;
        await this.trialService.create(spaceId, payload);
      }
      this.saved.emit();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to save trial');
    } finally {
      this.saving.set(false);
    }
  }
}
