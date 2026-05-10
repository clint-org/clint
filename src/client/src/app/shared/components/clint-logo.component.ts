import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

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
      viewBox="0 0 140 140"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <polyline
        points="112,24 24,24 24,116 112,116"
        [attr.stroke]="outerColor()"
        [attr.stroke-width]="strokes().outer"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        points="96,40 40,40 40,100 96,100"
        [attr.stroke]="middleColor()"
        [attr.stroke-width]="strokes().middle"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        points="80,56 56,56 56,84 80,84"
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

  readonly outerColor = computed(() => (this.dark() ? '#475569' : '#cbd5e1'));
  readonly middleColor = computed(() => (this.dark() ? '#64748b' : '#94a3b8'));
  readonly innerColor = computed(() => (this.dark() ? '#14b8a6' : '#0d9488'));

  readonly strokes = computed(() => {
    const s = this.size();
    if (s <= 16) return { outer: 7, middle: 9, inner: 11 };
    if (s <= 24) return { outer: 5, middle: 7, inner: 9 };
    if (s <= 32) return { outer: 4, middle: 5.5, inner: 7.5 };
    if (s <= 48) return { outer: 2.5, middle: 3.5, inner: 5 };
    return { outer: 1.5, middle: 2.2, inner: 3 };
  });
}
