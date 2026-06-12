import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { CLINT_MARK_POINTS, CLINT_MARK_VIEWBOX, clintMarkStrokes } from '../clint-mark';

/**
 * Branded loading indicator: the Clint mark drawing itself in and releasing
 * over a faint static track. Callers mount it only while loading; the mark
 * never animates at rest. Draw classes live in shared/styles/animations.css
 * and degrade to a static mark under prefers-reduced-motion.
 *
 * The mark renders in the Clint logo colors (slate-300/400 tracks, inner ring
 * Clint teal #0d9488) on every host, including whitelabel ones -- it is the
 * Clint loading signature, so it never tints to the host brand. Keep the inner
 * ring in sync with ClintLogoComponent and IntelligenceBadgeComponent.
 *
 * Replaces p-progressspinner, whose unlayered CSS ignores Tailwind sizing
 * and whose keyframes ignore stroke overrides (see spec, Known issues).
 */
@Component({
  selector: 'app-loader',
  host: {
    role: 'status',
    '[attr.aria-label]': 'resolvedLabel()',
  },
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.viewBox]="viewBox"
      fill="none"
      aria-hidden="true"
    >
      <polyline
        class="clint-mark-track"
        [attr.points]="points.outer"
        stroke="#cbd5e1"
        [attr.stroke-width]="strokes().outer"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        class="clint-mark-track"
        [attr.points]="points.middle"
        stroke="#94a3b8"
        [attr.stroke-width]="strokes().middle"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        class="clint-mark-track"
        [attr.points]="points.inner"
        stroke="#0d9488"
        [attr.stroke-width]="strokes().inner"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        class="clint-mark-draw"
        pathLength="1"
        [attr.points]="points.outer"
        stroke="#cbd5e1"
        [attr.stroke-width]="strokes().outer"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        class="clint-mark-draw clint-mark-draw--m"
        pathLength="1"
        [attr.points]="points.middle"
        stroke="#94a3b8"
        [attr.stroke-width]="strokes().middle"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        class="clint-mark-draw clint-mark-draw--i"
        pathLength="1"
        [attr.points]="points.inner"
        stroke="#0d9488"
        [attr.stroke-width]="strokes().inner"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    @if (label()) {
      <span class="text-[11px] uppercase tracking-wider text-slate-400">{{ label() }}</span>
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoaderComponent {
  /** Rendered square size in px. 20 inline, 28 dialogs, 36 panels. */
  readonly size = input<number>(28);
  /** Optional caption, rendered uppercase tracked beside the mark. */
  readonly label = input<string>('');

  protected readonly viewBox = CLINT_MARK_VIEWBOX;
  protected readonly points = CLINT_MARK_POINTS;
  protected readonly strokes = computed(() => clintMarkStrokes(this.size()));
  protected readonly resolvedLabel = computed(() => this.label() || 'Loading');
}
