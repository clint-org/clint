import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { TimelineColumn } from '../../../core/services/timeline.service';

@Component({
  selector: 'app-grid-header',
  standalone: true,
  template: `
    <div class="relative" [style.width.px]="totalWidth()">
      <!-- Primary row (years) -->
      <div class="grid-header-row flex items-center" role="row">
        @for (col of columns(); track col.label) {
          <div
            class="grid-header-cell flex-none border-r border-slate-200"
            [style.width.px]="col.width"
            role="columnheader"
          >
            {{ col.label }}
          </div>
        }
      </div>

      <!-- Sub-column row (quarters/months) if present -->
      @if (hasSubColumns()) {
        <div class="grid-header-sub-row flex" role="row">
          @for (col of columns(); track col.label) {
            @if (col.subColumns) {
              @for (sub of col.subColumns; track sub.label) {
                <div
                  class="grid-header-sub-cell flex-none border-r border-slate-200"
                  [style.width.px]="sub.width"
                  role="columnheader"
                >
                  {{ sub.label }}
                </div>
              }
            }
          }
        </div>
      }

      <!-- Vertical grid lines -->
      <div class="pointer-events-none absolute inset-0">
        @for (col of columns(); track col.label) {
          <div
            class="absolute top-0 bottom-0 border-l border-slate-200"
            [style.left.px]="col.startX"
          ></div>
          @if (col.subColumns) {
            @for (sub of col.subColumns; track sub.label) {
              <div
                class="absolute top-0 bottom-0 border-l border-slate-100"
                [style.left.px]="sub.startX"
              ></div>
            }
          }
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GridHeaderComponent {
  readonly columns = input.required<TimelineColumn[]>();
  readonly totalWidth = input.required<number>();

  hasSubColumns(): boolean {
    return this.columns().some((c) => c.subColumns && c.subColumns.length > 0);
  }
}
