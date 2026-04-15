import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';

import type { GridState } from '../grids/filter-types';

// The toolbar never calls `filteredRows` (the only T-dependent method on
// GridState<T>), so the T parameter is effectively unused here. Using
// `GridState<any>` lets any concrete row type bind cleanly via structural
// assignment. GridState<ProductRow> is not assignable to GridState<unknown>
// because the generic is invariant through the filteredRows signature.
@Component({
  selector: 'app-grid-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ButtonModule, IconFieldModule, InputIconModule, InputTextModule],
  template: `
    <div class="grid-toolbar mb-3">
      <div class="flex items-center justify-between gap-3">
        <p-iconfield iconPosition="left">
          <p-inputicon><i class="fa-solid fa-magnifying-glass text-[11px] text-slate-400"></i></p-inputicon>
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

        <p-button
          label="Clear all"
          severity="secondary"
          [text]="true"
          size="small"
          [disabled]="!state().isFiltered()"
          (onClick)="state().clearAll()"
          [attr.aria-label]="'Clear all filters'"
        />
      </div>

      @if (state().activeFilters().length > 0) {
        <div class="mt-2 flex flex-wrap items-center gap-2" role="list" aria-label="Active filters">
          @for (chip of state().activeFilters(); track chip.field) {
            <span
              role="listitem"
              class="inline-flex items-center gap-1.5 border border-slate-200 border-l-[3px] border-l-teal-600 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-800"
            >
              <span class="text-slate-500">{{ chip.header }}:</span>
              <span>{{ chip.label }}</span>
              <button
                type="button"
                class="-mr-0.5 ml-0.5 rounded text-slate-400 hover:text-slate-700 focus:outline-none focus:ring-1 focus:ring-teal-500"
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

  onSearchInput(value: string): void {
    this.state().onGlobalSearchInput(value);
  }
}
