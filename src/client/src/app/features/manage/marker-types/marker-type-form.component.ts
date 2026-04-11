import { Component, input, output, signal, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { InputNumber } from 'primeng/inputnumber';
import { Select } from 'primeng/select';
import { ColorPicker } from 'primeng/colorpicker';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { MarkerType } from '../../../core/models/marker.model';
import { MarkerTypeService } from '../../../core/services/marker-type.service';
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
  private route = inject(ActivatedRoute);

  readonly shapeOptions = [
    { label: 'Circle', value: 'circle' },
    { label: 'Diamond', value: 'diamond' },
    { label: 'Flag', value: 'flag' },
    { label: 'Arrow', value: 'arrow' },
    { label: 'X', value: 'x' },
    { label: 'Bar', value: 'bar' },
  ];

  readonly fillStyleOptions = [
    { label: 'Outline', value: 'outline' },
    { label: 'Filled', value: 'filled' },
    { label: 'Striped', value: 'striped' },
    { label: 'Gradient', value: 'gradient' },
  ];

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

  ngOnInit(): void {
    const existing = this.markerType();
    if (existing) {
      this.name = existing.name;
      this.shape = existing.shape;
      this.fillStyle = existing.fill_style;
      this.color = existing.color;
      this.icon = existing.icon ?? '';
      this.displayOrder = existing.display_order;
    }
  }

  async onSubmit(): Promise<void> {
    if (!this.name.trim()) return;

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
