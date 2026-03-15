import { Component, input } from '@angular/core';

import { TimelineColumn } from '../../../core/services/timeline.service';

@Component({
  selector: 'app-grid-header',
  standalone: true,
  template: `
    <div class="relative" [style.width.px]="totalWidth()">
      <!-- Primary row (years) -->
      <div class="flex border-b border-gray-300 bg-gray-100">
        @for (col of columns(); track col.label) {
          <div
            class="flex-none border-r border-gray-300 px-2 py-1 text-center text-sm font-semibold text-gray-700"
            [style.width.px]="col.width"
          >
            {{ col.label }}
          </div>
        }
      </div>

      <!-- Sub-column row (quarters/months) if present -->
      @if (hasSubColumns()) {
        <div class="flex border-b border-gray-200 bg-gray-50">
          @for (col of columns(); track col.label) {
            @if (col.subColumns) {
              @for (sub of col.subColumns; track sub.label) {
                <div
                  class="flex-none border-r border-gray-200 px-1 py-0.5 text-center text-xs text-gray-500 truncate"
                  [style.width.px]="sub.width"
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
            class="absolute top-0 bottom-0 border-l border-gray-200"
            [style.left.px]="col.startX"
          ></div>
          @if (col.subColumns) {
            @for (sub of col.subColumns; track sub.label) {
              <div
                class="absolute top-0 bottom-0 border-l border-gray-100"
                [style.left.px]="sub.startX"
              ></div>
            }
          }
        }
      </div>
    </div>
  `,
})
export class GridHeaderComponent {
  columns = input.required<TimelineColumn[]>();
  totalWidth = input.required<number>();

  hasSubColumns(): boolean {
    return this.columns().some(c => c.subColumns && c.subColumns.length > 0);
  }
}
