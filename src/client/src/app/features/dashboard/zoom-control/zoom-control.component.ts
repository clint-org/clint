import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectButton } from 'primeng/selectbutton';

import { ZoomLevel } from '../../../core/models/dashboard.model';

@Component({
  selector: 'app-zoom-control',
  standalone: true,
  imports: [SelectButton, FormsModule],
  template: `
    <p-selectbutton
      [options]="zoomOptions"
      [ngModel]="zoomLevel()"
      (ngModelChange)="zoomChange.emit($event)"
      optionLabel="label"
      optionValue="value"
      [allowEmpty]="false"
      size="small"
    />
  `,
})
export class ZoomControlComponent {
  readonly zoomLevel = input.required<ZoomLevel>();
  zoomChange = output<ZoomLevel>();

  readonly zoomOptions: { value: ZoomLevel; label: string }[] = [
    { value: 'yearly', label: 'Year' },
    { value: 'quarterly', label: 'Quarter' },
    { value: 'monthly', label: 'Month' },
    { value: 'daily', label: 'Day' },
  ];
}
