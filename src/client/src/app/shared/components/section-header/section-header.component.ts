import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Compact, consistent page-section header shared across the Intelligence-area
 * tabs (Engagement, Intelligence Feed, Materials, Events). One pattern:
 * an uppercase tracked structural label, an optional muted detail/count on the
 * same baseline, and a right-aligned primary action projected via
 * `[actions]`. Keeps headers quiet and uniform instead of each tab inventing
 * its own title treatment.
 *
 * Usage:
 *   <app-section-header label="Materials" detail="74">
 *     <p-button actions label="Upload material" ... />
 *   </app-section-header>
 */
@Component({
  selector: 'app-section-header',
  standalone: true,
  host: { class: 'block' },
  template: `
    <header
      class="flex items-center justify-between gap-3"
      [class.mb-4]="bordered()"
      [class.border-b]="bordered()"
      [class.border-slate-200]="bordered()"
      [class.pb-2.5]="bordered()"
    >
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
      <div class="flex shrink-0 items-center gap-2">
        <ng-content select="[actions]" />
      </div>
    </header>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SectionHeaderComponent {
  readonly label = input.required<string>();
  readonly detail = input<string>('');
  /**
   * Whether the header draws its own bottom border + spacing. Default true.
   * Hosts that already sit inside a bordered stripe (e.g. the materials
   * browse filter strip) set this false to avoid a double rule.
   */
  readonly bordered = input<boolean>(true);
}
