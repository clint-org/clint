import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { CLINT_MARK_POINTS, CLINT_MARK_VIEWBOX, clintMarkStrokes } from './clint-mark';

/**
 * Triple C logo mark for Clint. Three nested open squares forming the letter C
 * with progressive stroke weight. Automatically adapts stroke widths to rendered size.
 */
@Component({
  selector: 'app-clint-logo',
  standalone: true,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.viewBox]="viewBox"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <polyline
        [attr.points]="points.outer"
        [attr.stroke]="outerColor()"
        [attr.stroke-width]="strokes().outer"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        [attr.points]="points.middle"
        [attr.stroke]="middleColor()"
        [attr.stroke-width]="strokes().middle"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        [attr.points]="points.inner"
        [attr.stroke]="innerColor()"
        [attr.stroke-width]="strokes().inner"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClintLogoComponent {
  readonly size = input<number>(28);
  readonly dark = input<boolean>(false);

  protected readonly viewBox = CLINT_MARK_VIEWBOX;
  protected readonly points = CLINT_MARK_POINTS;

  readonly outerColor = computed(() => (this.dark() ? '#475569' : '#cbd5e1'));
  readonly middleColor = computed(() => (this.dark() ? '#64748b' : '#94a3b8'));
  readonly innerColor = computed(() => (this.dark() ? '#14b8a6' : '#0d9488'));

  readonly strokes = computed(() => clintMarkStrokes(this.size()));
}
