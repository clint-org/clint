import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';

import { FlatCatalyst } from '../../core/models/event-detail.model';
import {
  ProjectionBadge,
  projectionBadge,
  projectionOutlineDash,
} from '../../core/models/marker-visual';
import { markerPeriodLabel } from '../../core/models/marker-date-precision';
import { ChangeBadgeComponent } from '../../shared/components/change-badge/change-badge.component';
import { TableSkeletonBodyComponent } from '../../shared/components/skeleton/table-skeleton-body.component';
import { MarkerIconComponent } from '../../shared/components/svg-icons/marker-icon.component';
import { HighlightPipe } from '../../shared/pipes/highlight.pipe';
import { viewDetailsLabel } from '../../shared/utils/accessible-row-label';
import { catalystContextLine } from './group-events';

/** Hovered catalyst row + cursor position for the preview tooltip. */
export interface CatalystHoverEvent {
  catalyst: FlatCatalyst;
  x: number;
  y: number;
}

@Component({
  selector: 'app-event-table',
  standalone: true,
  imports: [
    ChangeBadgeComponent,
    DatePipe,
    FormsModule,
    MarkerIconComponent,
    SelectModule,
    TableModule,
    TableSkeletonBodyComponent,
    HighlightPipe,
  ],
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
      (onLazyLoad)="onLazyLoad($event)"
    >
      <ng-template #header>
        <tr>
          <th class="col-date-short">Date</th>
          <th class="col-category">
            Category
            <p-column-filter
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
            </p-column-filter>
          </th>
          <th>Event</th>
          <th class="col-company">
            Company / Asset
            <p-column-filter
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
            </p-column-filter>
          </th>
          <th class="col-status">Status</th>
        </tr>
      </ng-template>

      <ng-template #groupheader let-catalyst>
        <tr class="data-table-group-header">
          <td colspan="5">
            <div class="flex items-baseline gap-2 px-1 py-1">
              <span
                class="text-[10px] font-bold uppercase tracking-[0.14em]"
                [class.text-brand-700]="catalyst.time_bucket === 'This Week'"
                [class.text-slate-500]="catalyst.time_bucket !== 'This Week'"
              >
                {{ catalyst.time_bucket }}
              </span>
              @if (catalyst.time_bucket_range) {
                <span class="font-mono text-[10px] tracking-normal text-slate-400">
                  {{ catalyst.time_bucket_range }}
                </span>
              }
              <span
                class="ml-auto font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400"
              >
                {{ bucketCount(catalyst.time_bucket) }}
                {{ bucketCount(catalyst.time_bucket) === 1 ? 'event' : 'events' }}
              </span>
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
          (mouseenter)="onRowHover(catalyst, $event)"
          (mousemove)="onRowHover(catalyst, $event)"
          (mouseleave)="rowHover.emit(null)"
          tabindex="0"
          role="button"
          [attr.aria-label]="viewDetailsLabel(catalyst.title)"
          [attr.aria-pressed]="catalyst.marker_id === selectedId()"
        >
          <td class="font-mono text-xs tabular-nums text-slate-500">
            @if (periodLabel(catalyst); as label) {
              ~{{ label }}
            } @else {
              {{ catalyst.event_date | date: 'MMM dd' }}
            }
          </td>
          <td>
            <span class="inline-flex items-center gap-2">
              <app-marker-icon
                [shape]="catalyst.marker_type_shape"
                [color]="catalyst.marker_type_color"
                [size]="15"
                [fillStyle]="catalyst.is_projected ? 'outline' : 'filled'"
                [innerMark]="catalyst.marker_type_inner_mark"
                [isNle]="catalyst.no_longer_expected"
                [projectionBadge]="markerBadge(catalyst)"
                [outlineDash]="markerOutlineDash(catalyst)"
              />
              <span
                class="whitespace-nowrap font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500"
                [innerHTML]="catalyst.category_name | highlight: query()"
              ></span>
            </span>
          </td>
          <td class="text-sm font-medium text-slate-900">
            <span class="inline-flex items-center gap-1.5">
              <span [innerHTML]="catalyst.title | highlight: query()"></span>
              <app-change-badge
                [count]="catalyst.trial_recent_changes_count ?? 0"
                [type]="catalyst.trial_most_recent_change_type ?? null"
                [eventId]="catalyst.trial_most_recent_change_event_id ?? null"
              />
            </span>
            @if (catalystContextLine(catalyst); as context) {
              <span
                class="mt-0.5 block text-xs font-normal text-slate-500"
                [innerHTML]="context | highlight: query()"
              ></span>
            }
          </td>
          <td class="text-xs text-slate-500">
            @if (catalyst.company_name) {
              <span
                class="uppercase"
                [innerHTML]="catalyst.company_name | highlight: query()"
              ></span>
              @if (catalyst.asset_name) {
                <span>
                  &middot; <span [innerHTML]="catalyst.asset_name | highlight: query()"></span
                ></span>
              }
            }
          </td>
          <td>
            <!-- Status as an unmistakable Projected/Confirmed pill, matching
                 the marker-kit StatusTag: amber + hollow dot for projected,
                 brand + filled dot for confirmed. The trailing arrow signals
                 the row opens a detail pane. -->
            <span class="inline-flex items-center gap-2">
              <span
                class="inline-flex items-center gap-1.5 border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase leading-none tracking-[0.1em]"
                [class.border-amber-200]="catalyst.is_projected"
                [class.bg-amber-50]="catalyst.is_projected"
                [class.text-amber-800]="catalyst.is_projected"
                [class.border-brand-200]="!catalyst.is_projected"
                [class.bg-brand-50]="!catalyst.is_projected"
                [class.text-brand-700]="!catalyst.is_projected"
              >
                <span
                  class="box-border h-[7px] w-[7px] shrink-0 rounded-full border-[1.5px]"
                  [class.border-amber-700]="catalyst.is_projected"
                  [class.bg-transparent]="catalyst.is_projected"
                  [class.border-brand-700]="!catalyst.is_projected"
                  [class.bg-brand-700]="!catalyst.is_projected"
                  aria-hidden="true"
                ></span>
                {{ catalyst.is_projected ? 'Projected' : 'Confirmed' }}
              </span>
              <i
                class="fa-solid fa-arrow-right text-[10px] text-slate-300"
                aria-hidden="true"
              ></i>
            </span>
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
            No upcoming events match your filters.
          </td>
        </tr>
      </ng-template>
    </p-table>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventTableComponent {
  protected readonly viewDetailsLabel = viewDetailsLabel;
  protected readonly catalystContextLine = catalystContextLine;

  /**
   * Event count per time bucket, derived from the rows already in view (no
   * extra query). Surfaced in the group subheader so each bucket reads how
   * many catalysts it holds.
   */
  private readonly bucketCounts = computed(() => {
    const counts = new Map<string, number>();
    for (const c of this.catalysts()) {
      counts.set(c.time_bucket, (counts.get(c.time_bucket) ?? 0) + 1);
    }
    return counts;
  });

  protected bucketCount(bucket: string): number {
    return this.bucketCounts().get(bucket) ?? 0;
  }

  /** Approximate period label ("Q4 '26") for a fuzzy-dated catalyst, else null. */
  /**
   * Projection tier badge + forecast dash, matching the timeline glyph. The
   * dashboard flatten carries no anchor_type (same as the timeline markers), so
   * the badge is projection-only -- consistent with the row it mirrors.
   */
  protected markerBadge(catalyst: FlatCatalyst): ProjectionBadge {
    return projectionBadge(catalyst.projection);
  }

  protected markerOutlineDash(catalyst: FlatCatalyst): boolean {
    return projectionOutlineDash(catalyst.projection);
  }

  protected periodLabel(catalyst: FlatCatalyst): string | null {
    return markerPeriodLabel(catalyst.event_date, catalyst.date_precision);
  }
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
  /** Hovered row + cursor position for the catalyst preview tooltip; null clears it. */
  readonly rowHover = output<CatalystHoverEvent | null>();

  protected onRowHover(catalyst: FlatCatalyst, event: MouseEvent): void {
    this.rowHover.emit({ catalyst, x: event.clientX, y: event.clientY });
  }

  protected onLazyLoad(event: unknown): void {
    // PrimeNG emits TableLazyLoadEvent here. We forward the whole event
    // so the grid-state machinery can read filters/sort/page off it; the
    // cast keeps a single sink for typing rather than scattering casts.
    this.filterChange.emit(event as Record<string, unknown>);
  }
}
