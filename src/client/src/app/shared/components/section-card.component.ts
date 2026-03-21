import { Component, input } from '@angular/core';

@Component({
  selector: 'app-section-card',
  standalone: true,
  template: `
    <section class="mb-8 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-lg font-semibold text-slate-900">{{ title() }}</h2>
        <ng-content select="[actions]" />
      </div>
      <ng-content />
    </section>
  `,
})
export class SectionCardComponent {
  readonly title = input.required<string>();
}
