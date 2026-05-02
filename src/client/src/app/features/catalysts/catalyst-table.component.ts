import { Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';

import { FlatCatalyst } from '../../core/models/catalyst.model';
import { TableSkeletonBodyComponent } from '../../shared/components/skeleton/table-skeleton-body.component';
import { HighlightPipe } from '../../shared/pipes/highlight.pipe';

@Component({
  selector: 'app-catalyst-table',
  standalone: true,
  imports: [DatePipe, FormsModule, SelectModule, TableModule, TableSkeletonBodyComponent, HighlightPipe],
  template: `
    <p-table
      [value]="catalysts()"
      [loading]="loading()"
      [rowGroupMode]="'subheader'"
      groupRowsBy="time_bucket"
      dataKey="marker_id"
      styleClass="data-table"
      [filters]="gridFilters()"
      [lazy]="true"
      (onLazyLoad)="filterChange.emit($any($event))"
    >
      <ng-template #header>
        <tr>
          <th class="col-date-short">Date</th>
          <th class="col-category">
            Category
            <p-columnFilter
              field="category_name"
              display="menu"
              matchMode="in"
              [showMatchModes]="false"
              [showOperator]="false"
              [showAddButton]="false"
            >
              <ng-template #filter let-value let-filter="filterCallback">
                <p-select
                  [options]="categoryOptions()"
                  [ngModel]="value"
                  (ngModelChange)="filter($event)"
                  placeholder="All"
                  [showClear]="true"
                  optionLabel="label"
                  optionValue="value"
                  size="small"
                  appendTo="body"
                />
              </ng-template>
            </p-columnFilter>
          </th>
          <th>Catalyst</th>
          <th class="col-company">
            Company / Product
            <p-columnFilter
              field="company_name"
              display="menu"
              matchMode="in"
              [showMatchModes]="false"
              [showOperator]="false"
              [showAddButton]="false"
            >
              <ng-template #filter let-value let-filter="filterCallback">
                <p-select
                  [options]="companyOptions()"
                  [ngModel]="value"
                  (ngModelChange)="filter($event)"
                  placeholder="All"
                  [showClear]="true"
                  optionLabel="label"
                  optionValue="value"
                  size="small"
                  appendTo="body"
                />
              </ng-template>
            </p-columnFilter>
          </th>
          <th class="col-status">Status</th>
        </tr>
      </ng-template>

      <ng-template #groupheader let-catalyst>
        <tr class="data-table-group-header">
          <td colspan="5">
            <div
              class="flex items-baseline gap-2 px-1 py-1 text-[10px] font-bold uppercase tracking-widest"
              [class.text-brand-700]="catalyst.time_bucket === 'This Week'"
              [class.text-slate-500]="catalyst.time_bucket !== 'This Week'"
            >
              {{ catalyst.time_bucket }}
              @if (catalyst.time_bucket_range) {
                <span class="font-normal tracking-normal text-slate-400">
                  {{ catalyst.time_bucket_range }}
                </span>
              }
            </div>
          </td>
        </tr>
      </ng-template>

      <ng-template #body let-catalyst>
        <tr
          class="cursor-pointer transition-colors hover:bg-slate-50"
          [class.selected-row]="catalyst.marker_id === selectedId()"
          (click)="rowSelect.emit(catalyst.marker_id)"
          (keydown.enter)="rowSelect.emit(catalyst.marker_id)"
          tabindex="0"
          role="button"
          [attr.aria-label]="'View details for ' + catalyst.title"
          [attr.aria-pressed]="catalyst.marker_id === selectedId()"
        >
          <td class="font-mono text-xs tabular-nums text-slate-500">
            {{ catalyst.event_date | date: 'MMM dd' }}
          </td>
          <td>
            <span class="inline-flex items-center gap-1.5">
              <span
                class="inline-block h-2 w-2 shrink-0"
                [style.background]="catalyst.marker_type_color"
                [class.rounded-full]="catalyst.marker_type_shape === 'circle'"
                [style.transform]="
                  catalyst.marker_type_shape === 'diamond' ? 'rotate(45deg)' : 'none'
                "
              ></span>
              <span class="text-xs text-slate-500" [innerHTML]="catalyst.category_name | highlight: query()"></span>
            </span>
          </td>
          <td class="text-sm font-medium text-slate-900" [innerHTML]="catalyst.title | highlight: query()"></td>
          <td class="text-xs text-slate-500">
            @if (catalyst.company_name) {
              <span class="uppercase" [innerHTML]="catalyst.company_name | highlight: query()"></span>
              @if (catalyst.product_name) {
                <span> &middot; <span [innerHTML]="catalyst.product_name | highlight: query()"></span></span>
              }
            }
          </td>
          <td>
            @if (catalyst.is_projected) {
              <span
                class="inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-600"
              >
                Projected
              </span>
            } @else {
              <span
                class="inline-block rounded bg-green-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-green-600"
              >
                Confirmed
              </span>
            }
          </td>
        </tr>
      </ng-template>

      <ng-template #loadingbody>
        <app-table-skeleton-body
          [cells]="[
            { w: '52px', h: '11px' },
            { w: '88px' },
            { w: '60%' },
            { w: '52%' },
            { w: '64px', h: '14px', class: 'col-status' },
          ]"
        />
      </ng-template>
      <ng-template #emptymessage>
        <tr>
          <td colspan="5" class="py-8 text-center text-sm text-slate-400">
            No upcoming catalysts match your filters.
          </td>
        </tr>
      </ng-template>
    </p-table>
  `,
})
export class CatalystTableComponent {
  readonly catalysts = input.required<FlatCatalyst[]>();
  readonly loading = input<boolean>(false);
  readonly selectedId = input<string | null>(null);
  readonly categoryOptions = input<{ label: string; value: string }[]>([]);
  readonly companyOptions = input<{ label: string; value: string }[]>([]);
  readonly gridFilters = input<Record<string, { value: unknown; matchMode: string }[]>>({});
  /** Active global-search query; matches in text cells are wrapped in `<mark>`. */
  readonly query = input<string>('');
  readonly rowSelect = output<string>();
  readonly filterChange = output<Record<string, unknown>>();
}
