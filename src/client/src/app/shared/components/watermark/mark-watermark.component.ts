import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { CLINT_MARK_POINTS, CLINT_MARK_VIEWBOX, clintMarkStrokes } from '../clint-mark';

/**
 * Faded Clint mark behind empty states. Purely decorative: aria-hidden,
 * click-through, never animated. The parent container must be positioned
 * (add Tailwind "relative") and the visible empty-state content must also
 * be positioned (add "relative") so it paints above the watermark.
 */
@Component({
  selector: 'app-mark-watermark',
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.viewBox]="viewBox"
      fill="none"
      aria-hidden="true"
    >
      <polyline
        [attr.points]="points.outer"
        stroke="#0f172a"
        [attr.stroke-width]="strokes().outer"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        [attr.points]="points.middle"
        stroke="#0f172a"
        [attr.stroke-width]="strokes().middle"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        [attr.points]="points.inner"
        stroke="#0f172a"
        [attr.stroke-width]="strokes().inner"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  `,
  styles: [
    `
      :host {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.07;
        pointer-events: none;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkWatermarkComponent {
  readonly size = input<number>(100);

  protected readonly viewBox = CLINT_MARK_VIEWBOX;
  protected readonly points = CLINT_MARK_POINTS;
  protected readonly strokes = computed(() => clintMarkStrokes(this.size()));
}
