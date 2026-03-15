import { Component, input, output } from '@angular/core';

import { ZoomLevel } from '../../../core/models/dashboard.model';

@Component({
  selector: 'app-zoom-control',
  standalone: true,
  template: `
    <div class="inline-flex rounded-md border border-gray-300 bg-white" role="group" aria-label="Zoom level">
      @for (option of zoomOptions; track option.value) {
        <button
          type="button"
          class="px-3 py-1.5 text-sm font-medium transition-colors first:rounded-l-md last:rounded-r-md"
          [class.bg-indigo-600]="zoomLevel() === option.value"
          [class.text-white]="zoomLevel() === option.value"
          [class.text-gray-700]="zoomLevel() !== option.value"
          [class.hover:bg-gray-100]="zoomLevel() !== option.value"
          [attr.aria-pressed]="zoomLevel() === option.value"
          (click)="zoomChange.emit(option.value)"
        >
          {{ option.label }}
        </button>
      }
    </div>
  `,
})
export class ZoomControlComponent {
  zoomLevel = input.required<ZoomLevel>();
  zoomChange = output<ZoomLevel>();

  readonly zoomOptions: { value: ZoomLevel; label: string }[] = [
    { value: 'yearly', label: 'Year' },
    { value: 'quarterly', label: 'Quarter' },
    { value: 'monthly', label: 'Month' },
    { value: 'daily', label: 'Day' },
  ];
}
