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

      <!-- Today reference line + cap label -->
      @if (todayX() !== null) {
        <div class="pointer-events-none absolute inset-0" aria-hidden="true">
          <div
            class="absolute top-0 bottom-0 border-l border-dashed border-slate-300"
            [style.left.px]="todayX()"
          ></div>
          <span
            class="absolute bottom-0 -translate-x-1/2 rounded-t bg-slate-100 px-1 font-mono text-[9px] font-semibold uppercase tracking-widest text-slate-500"
            [style.left.px]="todayX()"
            >Today</span
          >
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GridHeaderComponent {
  readonly columns = input.required<TimelineColumn[]>();
  readonly totalWidth = input.required<number>();
  readonly todayX = input<number | null>(null);

  hasSubColumns(): boolean {
    return this.columns().some((c) => c.subColumns && c.subColumns.length > 0);
  }
}
