import { Component, input } from '@angular/core';

@Component({
  selector: 'app-row-label',
  standalone: true,
  template: `
    <div
      class="border-b border-r border-slate-200 px-3 py-2 text-left text-sm font-medium text-slate-800"
      [style.grid-row]="'span ' + rowSpan()"
    >
      {{ label() }}
    </div>
  `,
})
export class RowLabelComponent {
  label = input.required<string>();
  rowSpan = input<number>(1);
}
