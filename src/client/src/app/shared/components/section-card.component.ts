import { Component, input } from '@angular/core';

@Component({
  selector: 'app-section-card',
  standalone: true,
  template: `
    <section class="mb-4 border border-slate-200 bg-white">
      <header
        class="flex items-center justify-between border-b border-slate-200 bg-slate-50/60 px-4 py-2"
      >
        <h2 class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          {{ title() }}
        </h2>
        <ng-content select="[actions]" />
      </header>
      <div class="px-4 pb-4 pt-3">
        <ng-content />
      </div>
    </section>
  `,
})
export class SectionCardComponent {
  readonly title = input.required<string>();
}
