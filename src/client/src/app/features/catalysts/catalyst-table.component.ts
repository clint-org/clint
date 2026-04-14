import { Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TableModule } from 'primeng/table';

import { FlatCatalyst } from '../../core/models/catalyst.model';

@Component({
  selector: 'app-catalyst-table',
  standalone: true,
  imports: [DatePipe, TableModule],
  template: `
    <p-table
      [value]="catalysts()"
      [rowGroupMode]="'subheader'"
      groupRowsBy="time_bucket"
      [scrollable]="true"
      scrollHeight="flex"
      dataKey="marker_id"
      styleClass="catalyst-table"
    >
      <ng-template #header>
        <tr>
          <th class="w-[80px]">Date</th>
          <th class="w-[110px]">Category</th>
          <th>Catalyst</th>
          <th class="w-[200px]">Company / Product</th>
          <th class="w-[90px]">Status</th>
        </tr>
      </ng-template>

      <ng-template #groupheader let-catalyst>
        <tr class="catalyst-group-header">
          <td colspan="5">
            <div
              class="flex items-baseline gap-2 px-1 py-1 text-[10px] font-bold uppercase tracking-widest"
              [class.text-teal-700]="catalyst.time_bucket === 'This Week'"
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
            {{ catalyst.event_date | date:'MMM dd' }}
          </td>
          <td>
            <span class="inline-flex items-center gap-1.5">
              <span
                class="inline-block h-2 w-2 shrink-0"
                [style.background]="catalyst.marker_type_color"
                [class.rounded-full]="catalyst.marker_type_shape === 'circle'"
                [style.transform]="catalyst.marker_type_shape === 'diamond' ? 'rotate(45deg)' : 'none'"
              ></span>
              <span class="text-xs text-slate-500">{{ catalyst.category_name }}</span>
            </span>
          </td>
          <td class="text-sm font-medium text-slate-900">{{ catalyst.title }}</td>
          <td class="text-xs text-slate-500">
            @if (catalyst.company_name) {
              <span class="uppercase">{{ catalyst.company_name }}</span>
              @if (catalyst.product_name) {
                <span> &middot; {{ catalyst.product_name }}</span>
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
  readonly selectedId = input<string | null>(null);
  readonly rowSelect = output<string>();
}
