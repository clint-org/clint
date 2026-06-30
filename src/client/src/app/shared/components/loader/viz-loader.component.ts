import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { LoaderComponent } from './loader.component';

/**
 * Full-area, centered loading state for the major visualization pages
 * (timeline, bullseye, heatmap). Renders the branded Clint mark large and
 * centered with an optional caption below, replacing the off-brand grey
 * skeletons those pages used before.
 *
 * Pure presentation: callers gate it with a `showLoader` flag derived via
 * minDisplayFlag(), which owns the min-display timing. Composes app-loader so
 * the mark geometry, colors, draw animation, and reduced-motion / role="status"
 * handling stay single-sourced.
 */
@Component({
  selector: 'app-viz-loader',
  imports: [LoaderComponent],
  template: `
    <div class="flex h-full w-full flex-col items-center justify-center gap-4 py-20">
      <app-loader [size]="96" />
      @if (label()) {
        <span class="text-xs uppercase tracking-[0.1em] text-slate-400">{{ label() }}</span>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VizLoaderComponent {
  /** Caption rendered below the mark, e.g. "Loading timeline". */
  readonly label = input<string>('');
}
