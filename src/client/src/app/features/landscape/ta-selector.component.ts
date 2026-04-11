import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Select } from 'primeng/select';

import { TherapeuticArea } from '../../core/models/trial.model';

@Component({
  selector: 'app-ta-selector',
  standalone: true,
  imports: [FormsModule, Select],
  template: `
    <p-select
      inputId="landscape-ta-selector"
      [options]="therapeuticAreas()"
      [ngModel]="selectedId()"
      (ngModelChange)="onChange($event)"
      optionLabel="name"
      optionValue="id"
      placeholder="Select a therapeutic area"
      [style]="{ minWidth: '280px' }"
      appendTo="body"
    />
  `,
})
export class TaSelectorComponent {
  readonly therapeuticAreas = input.required<TherapeuticArea[]>();
  readonly selectedId = input<string | null>(null);

  readonly selectionChange = output<string>();

  protected onChange(value: string | null): void {
    if (value) this.selectionChange.emit(value);
  }
}
