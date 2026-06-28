import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { formatCountLabel } from '../utils/format-count-label';

/**
 * Standard sidebar/detail card shell. Owns the card chrome (border, header,
 * body) so every card on the profile/detail pages reads identically: a mono
 * uppercase title, an optional leading icon, an optional right-aligned count
 * badge, an optional one-line description, and a body that can run flush
 * (list rows own their padding) and/or cap its height with an internal scroll.
 *
 * Slots: `[icon]` (leading glyph in the header, e.g. the PI mark),
 * `[actions]` (header right, after the count badge — e.g. a "See all" link or
 * an Add button), and the default slot (body).
 */
@Component({
  selector: 'app-section-card',
  standalone: true,
  template: `
    <section class="mb-4 border border-slate-200 bg-white">
      <header class="border-b border-slate-200 bg-slate-50/60 px-4 py-2">
        <div class="flex items-center justify-between gap-3">
          <h2
            class="flex min-w-0 items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500"
          >
            <ng-content select="[icon]" />
            {{ title() }}
          </h2>
          <div class="flex flex-none items-center gap-2 whitespace-nowrap">
            @if (count() !== null) {
              <span class="font-mono text-[10px] tabular-nums text-slate-400">
                {{ countLabel() }}
              </span>
            }
            <ng-content select="[actions]" />
          </div>
        </div>
        @if (description()) {
          <p class="mt-0.5 text-[11px] leading-snug text-slate-500">{{ description() }}</p>
        }
      </header>
      <div [class]="bodyClass()">
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
  /** One-line description shown under the title. */
  readonly description = input<string>('');
  /** Right-aligned count badge. Null (default) hides the badge entirely. */
  readonly count = input<number | null>(null);
  /** Singular noun for the count badge (e.g. "event"); empty renders a bare number. */
  readonly countNoun = input<string>('');
  /** Irregular plural override for the count noun (e.g. "entries"). */
  readonly countNounPlural = input<string>('');
  /** When true, the body runs flush so list rows own their own padding. */
  readonly flush = input<boolean>(false);
  /** When true, the body caps its height and scrolls internally. */
  readonly scrollBody = input<boolean>(false);

  protected readonly countLabel = computed(() =>
    formatCountLabel(this.count() ?? 0, this.countNoun(), this.countNounPlural())
  );

  protected readonly bodyClass = computed(() => {
    const pad = this.flush() ? '' : 'px-4 pb-4 pt-3';
    const scroll = this.scrollBody() ? 'max-h-64 overflow-y-auto' : '';
    return `${pad} ${scroll}`.trim();
  });
}
