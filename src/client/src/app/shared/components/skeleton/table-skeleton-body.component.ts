import { Component, computed, input } from '@angular/core';

import { SkeletonComponent } from './skeleton.component';

export interface SkeletonCell {
  /** Width of the skeleton bar — any CSS length (e.g. "62%", "80px"). */
  w: string;
  /** Optional class for the host `<td>` (e.g. "col-num", "col-actions"). */
  class?: string;
  /** Override the bar height. Defaults to 13px to match data-table row text. */
  h?: string;
}

/**
 * Drop-in body for `p-table` `#loadingbody` templates. Renders N rows of
 * `<tr><td>`s with a single `<app-skeleton>` bar per cell. Width and
 * optional class come from the `cells` input so each table can match its
 * own column shape without re-stating the loop boilerplate.
 *
 * Uses `display: contents` so the host element does not break PrimeNG's
 * `<tbody>` layout — the rendered `<tr>`s become direct children of the
 * table body for styling purposes.
 */
@Component({
  selector: 'app-table-skeleton-body',
  standalone: true,
  imports: [SkeletonComponent],
  template: `
    @for (_ of rowsArray(); track $index) {
      <tr aria-hidden="true">
        @for (c of cells(); track $index) {
          <td [class]="c.class ?? ''"><app-skeleton [w]="c.w" [h]="c.h ?? '13px'" /></td>
        }
      </tr>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }
    `,
  ],
})
export class TableSkeletonBodyComponent {
  readonly cells = input.required<SkeletonCell[]>();
  readonly rows = input<number>(5);
  protected readonly rowsArray = computed(() => Array.from({ length: this.rows() }));
}
