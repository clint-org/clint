import { Component, input, output, signal, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MarkerType } from '../../../core/models/marker.model';
import { MarkerTypeService } from '../../../core/services/marker-type.service';

@Component({
  selector: 'app-marker-type-form',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './marker-type-form.component.html',
})
export class MarkerTypeFormComponent implements OnInit {
  readonly markerType = input<MarkerType | null>(null);
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  private markerTypeService = inject(MarkerTypeService);

  readonly shapes: MarkerType['shape'][] = ['circle', 'diamond', 'flag', 'arrow', 'x', 'bar'];
  readonly fillStyles: MarkerType['fill_style'][] = ['outline', 'filled', 'striped', 'gradient'];

  name = '';
  shape: MarkerType['shape'] = 'circle';
  fillStyle: MarkerType['fill_style'] = 'filled';
  color = '#3b82f6';
  icon = '';
  displayOrder = 0;
  saving = signal(false);
  error = signal<string | null>(null);

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
        display_order: this.displayOrder,
      };

      const existing = this.markerType();
      if (existing) {
        await this.markerTypeService.update(existing.id, payload);
      } else {
        await this.markerTypeService.create(payload);
      }
      this.saved.emit();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to save marker type');
    } finally {
      this.saving.set(false);
    }
  }
}
