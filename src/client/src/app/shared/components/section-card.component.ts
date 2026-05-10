import { ChangeDetectionStrategy, Component, input } from '@angular/core';

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
  styles: [
    `
      :host ::ng-deep header .p-button {
        font-size: 11px;
        padding: 4px 10px;
        height: 26px;
      }
      :host ::ng-deep header .p-button .p-button-icon {
        font-size: 11px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SectionCardComponent {
  readonly title = input.required<string>();
}
