import { Component, input, output, signal, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { InputNumber } from 'primeng/inputnumber';
import { Select } from 'primeng/select';
import { ColorPicker } from 'primeng/colorpicker';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { MarkerType, MarkerCategory } from '../../../core/models/marker.model';
import { MarkerTypeService } from '../../../core/services/marker-type.service';
import { MarkerCategoryService } from '../../../core/services/marker-category.service';
import { FormFieldComponent } from '../../../shared/components/form-field.component';
import { FormActionsComponent } from '../../../shared/components/form-actions.component';

@Component({
  selector: 'app-marker-type-form',
  standalone: true,
  imports: [
    FormsModule,
    InputText,
    InputNumber,
    Select,
    ColorPicker,
    ButtonModule,
    MessageModule,
    FormFieldComponent,
    FormActionsComponent,
  ],
  templateUrl: './marker-type-form.component.html',
})
export class MarkerTypeFormComponent implements OnInit {
  readonly markerType = input<MarkerType | null>(null);
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  private markerTypeService = inject(MarkerTypeService);
  private categoryService = inject(MarkerCategoryService);
  private route = inject(ActivatedRoute);

  categories = signal<MarkerCategory[]>([]);

  readonly shapeOptions = [
    { label: 'Circle', value: 'circle' },
    { label: 'Diamond', value: 'diamond' },
    { label: 'Flag', value: 'flag' },
    { label: 'Triangle', value: 'triangle' },
    { label: 'Square', value: 'square' },
    { label: 'Dashed Line', value: 'dashed-line' },
  ];

  readonly fillStyleOptions = [
    { label: 'Filled', value: 'filled' },
    { label: 'Outline', value: 'outline' },
  ];

  categoryId = '';
  name = '';
  shape: MarkerType['shape'] = 'circle';
  fillStyle: MarkerType['fill_style'] = 'filled';
  color = '#14b8a6';
  icon = '';
  displayOrder: number | null = 0;
  saving = signal(false);
  error = signal<string | null>(null);
  nameBlurred = signal(false);

  get nameInvalid(): boolean {
    return this.nameBlurred() && !this.name.trim();
  }

  async ngOnInit(): Promise<void> {
    const spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    try {
      this.categories.set(await this.categoryService.list(spaceId));
    } catch { /* categories will be empty */ }

    const existing = this.markerType();
    if (existing) {
      this.name = existing.name;
      this.shape = existing.shape;
      this.fillStyle = existing.fill_style;
      this.color = existing.color;
      this.icon = existing.icon ?? '';
      this.displayOrder = existing.display_order;
      this.categoryId = existing.category_id;
    }
  }

  async onSubmit(): Promise<void> {
    if (!this.name.trim()) return;
    if (!this.categoryId) return;

    this.saving.set(true);
    this.error.set(null);

    try {
      const payload: Partial<MarkerType> = {
        name: this.name,
        shape: this.shape,
        fill_style: this.fillStyle,
        color: this.color,
        icon: this.icon || null,
        display_order: this.displayOrder ?? 0,
        category_id: this.categoryId,
      };

      const existing = this.markerType();
      if (existing) {
        await this.markerTypeService.update(existing.id, payload);
      } else {
        const spaceId = this.route.snapshot.paramMap.get('spaceId')!;
        await this.markerTypeService.create(spaceId, payload);
      }
      this.saved.emit();
    } catch (e) {
      const message =
        e && typeof e === 'object' && 'message' in e && typeof e.message === 'string'
          ? e.message
          : 'Could not save marker type. Check your connection and try again.';
      this.error.set(message);
    } finally {
      this.saving.set(false);
    }
  }
}
