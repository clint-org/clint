import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';

import type { GridState } from '../grids/filter-types';

// The toolbar never calls `filteredRows` (the only T-dependent method on
// GridState<T>), so the T parameter is effectively unused here. Using
// `GridState<any>` lets any concrete row type bind cleanly via structural
// assignment. GridState<AssetRow> is not assignable to GridState<unknown>
// because the generic is invariant through the filteredRows signature.
@Component({
  selector: 'app-grid-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    FormsModule,
    ButtonModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
  ],
  template: `
    <div class="grid-toolbar mb-3">
      <div class="flex items-center gap-3">
        <ng-content select="[gridToolbarStart]" />
        <p-iconfield
          iconPosition="left"
          [styleClass]="
            'search-tinted' +
            (state().globalSearch() ? ' has-value' : '') +
            (searchAlignment() === 'end' ? ' ml-auto' : '')
          "
        >
          <p-inputicon><i class="fa-solid fa-magnifying-glass text-[11px]"></i></p-inputicon>
          <input
            pInputText
            type="text"
            class="w-72"
            [attr.aria-label]="searchPlaceholder()"
            [placeholder]="searchPlaceholder()"
            [ngModel]="state().globalSearch()"
            (ngModelChange)="onSearchInput($event)"
          />
        </p-iconfield>

        <div
          class="flex items-center gap-3"
          [class.ml-auto]="searchAlignment() !== 'end'"
        >
          @if (state().isFiltered() && state().rawTotal() > 0) {
            <span
              class="font-mono text-[11px] tabular-nums text-slate-500"
              aria-live="polite"
            >
              Showing {{ state().totalRecords() | number }} of
              {{ state().rawTotal() | number }}
            </span>
          }

          @if (state().isDirty()) {
            <button
              type="button"
              class="font-mono text-[11px] uppercase tracking-[0.08em] text-slate-400 hover:text-slate-700 focus:outline-none focus:underline focus:underline-offset-2"
              (click)="state().resetToDefaults()"
              aria-label="Reset filters, sort, and page to defaults"
            >
              Reset to defaults
            </button>
          }

          <!-- Render only when there is something to clear: a permanently
               visible disabled button reads as broken chrome on unfiltered
               lists (UI review 2026-06-12, item 8). -->
          @if (state().isFiltered()) {
            <p-button
              [label]="clearLabel()"
              severity="secondary"
              [text]="true"
              size="small"
              (onClick)="state().clearAll()"
              [attr.aria-label]="clearLabel() + ' (filters only)'"
            />
          }
        </div>

        <!-- Trailing slot, pinned to the right edge of the toolbar. Hosts the
             export trigger so list pages match the Landscape top-right export
             convention. Empty on pages that don't project into it. -->
        <ng-content select="[gridToolbarEnd]" />
      </div>

      @if (state().activeFilters().length > 0 || leadingChip()) {
        <div class="mt-2 flex flex-wrap items-center gap-2" role="list" aria-label="Active filters">
          <!-- Optional leading chip for a filter that lives outside the grid's
               own filter state (e.g. the events page's hierarchical entity
               scope). Same affordance as the column chips so there is one
               mental model for "what is narrowing this list". -->
          @if (leadingChip(); as lc) {
            <span
              role="listitem"
              class="inline-flex items-center gap-1.5 border border-slate-200 border-l-[3px] border-l-brand-600 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-800"
            >
              <span class="text-slate-500">{{ lc.header }}:</span>
              <span>{{ lc.label }}</span>
              <button
                type="button"
                class="-mr-0.5 ml-0.5 rounded text-slate-400 hover:text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
                [attr.aria-label]="'Remove ' + lc.header + ' ' + lc.label + ' filter'"
                (click)="leadingChipRemove.emit()"
              >
                <i class="fa-solid fa-xmark text-[10px]"></i>
              </button>
            </span>
          }
          @for (chip of state().activeFilters(); track chip.field) {
            <span
              role="listitem"
              class="inline-flex items-center gap-1.5 border border-slate-200 border-l-[3px] border-l-brand-600 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-800"
            >
              <span class="text-slate-500">{{ chip.header }}:</span>
              <span>{{ chip.label }}</span>
              <button
                type="button"
                class="-mr-0.5 ml-0.5 rounded text-slate-400 hover:text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
                [attr.aria-label]="'Remove ' + chip.header + ' ' + chip.label + ' filter'"
                (click)="state().clearFilter(chip.field)"
              >
                <i class="fa-solid fa-xmark text-[10px]"></i>
              </button>
            </span>
          }
        </div>
      }
    </div>
  `,
})
export class GridToolbarComponent {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly state = input.required<GridState<any>>();
  readonly searchPlaceholder = input<string>('Search...');
  readonly searchAlignment = input<'start' | 'end'>('start');

  /**
   * Optional chip for a filter applied outside the grid's own filter state
   * (e.g. an entity scope carried in the URL). Rendered first in the chip row
   * with the same look as the column chips; its `×` emits `leadingChipRemove`.
   */
  readonly leadingChip = input<{ header: string; label: string } | null>(null);
  readonly leadingChipRemove = output<void>();

  protected readonly clearLabel = computed(() => {
    const n = this.state().activeFilters().length;
    return n > 0 ? `Clear filters (${n})` : 'Clear filters';
  });

  onSearchInput(value: string): void {
    this.state().onGlobalSearchInput(value);
  }
}
