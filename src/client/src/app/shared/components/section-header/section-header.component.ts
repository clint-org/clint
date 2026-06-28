import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Compact, consistent page-section header shared across the Intelligence-area
 * tabs and the Profiles area (companies / assets / trials).
 *
 * Two shapes from one shell:
 *  - list (default): an uppercase tracked structural label, an optional muted
 *    detail/count on the same baseline, and a right-aligned action slot.
 *  - detail: a projected eyebrow row (the parent-hierarchy crumb) on top, a
 *    projected title row (the large entity name + any inline adornments) below,
 *    and the same right-aligned action slot, bottom-anchored.
 *
 * The eyebrow and title are PROJECTION SLOTS, not string inputs, because each
 * page supplies per-page markup there (links, brand logos, MoA/route chips,
 * trial identifiers).
 *
 * List usage:
 *   <app-section-header label="Companies" detail="42">
 *     <p-button actions label="Add company" ... />
 *   </app-section-header>
 *
 * Detail usage (note: wrap any @if inside a static slotted element):
 *   <app-section-header variant="detail">
 *     <div eyebrow> ...crumb markup... </div>
 *     <div title> <h1>Eli Lilly</h1> </div>
 *     <div actions> @if (canEdit) { <p-button ... /> } </div>
 *   </app-section-header>
 */
@Component({
  selector: 'app-section-header',
  standalone: true,
  host: { class: 'block' },
  template: `
    <header
      class="flex justify-between gap-3"
      [class.items-center]="variant() === 'list'"
      [class.items-end]="variant() === 'detail'"
      [class.mb-4]="bordered()"
      [class.border-b]="bordered()"
      [class.border-slate-200]="bordered()"
      [class.pb-2.5]="bordered()"
    >
      <div class="min-w-0">
        @if (variant() === 'detail') {
          <div class="mb-1.5 flex min-w-0 items-center gap-2">
            <ng-content select="[eyebrow]" />
          </div>
          <div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <ng-content select="[title]" />
          </div>
        } @else {
          <div class="flex min-w-0 items-baseline gap-2.5">
            <h1
              class="shrink-0 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-slate-700"
            >
              {{ label() }}
            </h1>
            @if (detail()) {
              <span class="truncate text-xs text-slate-500">{{ detail() }}</span>
            }
          </div>
        }
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <ng-content select="[actions]" />
      </div>
    </header>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SectionHeaderComponent {
  /** List-shape structural label (e.g. "Companies"). Ignored in detail variant. */
  readonly label = input<string>('');
  /** List-shape muted detail/count beside the label. Ignored in detail variant. */
  readonly detail = input<string>('');
  /** Layout selector. 'list' = single baseline row; 'detail' = eyebrow + title. */
  readonly variant = input<'list' | 'detail'>('list');
  /**
   * Whether the header draws its own bottom border + spacing. Default true.
   * Hosts that already sit inside a bordered stripe set this false.
   */
  readonly bordered = input<boolean>(true);
}
