import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Quiet skeleton block used as first-paint chrome while content loads.
 * Single rectangular slate bar with a subtle opacity pulse (no shimmer
 * sweep). Sized via `w`/`h` inputs that accept any CSS length. Animation
 * is disabled under `prefers-reduced-motion`.
 *
 * Use a stack of these shaped to the eventual row to keep layout stable
 * between loading and loaded states; do not use for sub-200ms operations
 * or for in-place refreshes where a row already exists.
 */
@Component({
  selector: 'app-skeleton',
  standalone: true,
  template: `
    <span
      class="skel"
      [class.skel--block]="block()"
      [style.width]="w()"
      [style.height]="h()"
      aria-hidden="true"
    ></span>
  `,
  styles: [
    `
      :host {
        display: inline-block;
        line-height: 0;
      }
      :host(.block) {
        display: block;
      }
      .skel {
        display: inline-block;
        background: #e2e8f0;
        animation: skel-pulse 1400ms ease-in-out infinite;
      }
      .skel--block {
        display: block;
      }
      @keyframes skel-pulse {
        0%,
        100% {
          opacity: 0.55;
        }
        50% {
          opacity: 0.9;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .skel {
          animation: none;
          opacity: 0.7;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkeletonComponent {
  readonly w = input<string>('100%');
  readonly h = input<string>('12px');
  readonly block = input<boolean>(false);
}
