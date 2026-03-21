import { Component, input } from '@angular/core';

@Component({
  selector: 'app-section-card',
  standalone: true,
  template: `
    <section class="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-500">{{ title() }}</h2>
        <ng-content select="[actions]" />
      </div>
      <ng-content />
    </section>
  `,
})
export class SectionCardComponent {
  readonly title = input.required<string>();
}
