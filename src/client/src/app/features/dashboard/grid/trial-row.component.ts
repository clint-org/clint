import { Component, input } from '@angular/core';

import { Trial } from '../../../core/models/trial.model';

@Component({
  selector: 'app-trial-row',
  standalone: true,
  template: `
    <div
      class="flex border-b border-slate-200"
      [class.bg-white]="even()"
      [class.bg-slate-50]="!even()"
    >
      <!-- Trial name label -->
      <div
        class="w-48 flex-none border-r border-slate-200 px-3 py-2 text-sm text-slate-700 truncate"
        [title]="trial().name"
      >
        {{ trial().name }}
      </div>

      <!-- Timeline area -->
      <div class="relative flex-1 py-1" [style.width.px]="totalWidth()">
        <ng-content />
      </div>
    </div>
  `,
})
export class TrialRowComponent {
  trial = input.required<Trial>();
  startYear = input.required<number>();
  endYear = input.required<number>();
  totalWidth = input.required<number>();
  even = input<boolean>(false);
}
