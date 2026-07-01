import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DatePicker } from 'primeng/datepicker';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { Tooltip } from 'primeng/tooltip';

import { FeedItem } from '../../core/models/event.model';
import { EventService } from '../../core/services/event.service';
import { TopbarStateService } from '../../core/services/topbar-state.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { SectionHeaderComponent } from '../../shared/components/section-header/section-header.component';
import { GridToolbarComponent } from '../../shared/components/grid-toolbar.component';
import { TableSkeletonBodyComponent } from '../../shared/components/skeleton/table-skeleton-body.component';
import { createGridState, toDatePickerRange } from '../../shared/grids';
import {
  feedItemToChangeEvent,
  summarySegmentsFor,
  type RichSummary,
} from '../../shared/utils/change-event-summary';
import { viewDetailsLabel } from '../../shared/utils/accessible-row-label';
import { entityCellParts, type EntityCellParts } from '../events/entity-cell';
import { buildServerQuery, type ServerQuery } from '../events/server-query';
import { EventDetailPanelComponent } from '../events/event-detail-panel.component';
import {
  ACTIVITY_SOURCE_OPTIONS,
  ACTIVITY_TYPE_OPTIONS,
  changeTypeLabel,
} from './activity-filters';

/**
 * Read-only Activity log. Renders DETECTED changes only: CT.gov registry deltas
 * and analyst-edit deltas surfaced by `get_events_page_data` (source_type
 * 'detected'). Unlike the legacy Events feed (de-routed in the Stage 3
 * events->activity split), Activity offers no create/edit/delete affordances --
 * it is a passive audit trail. It DOES carry the shared grid-filter idiom
 * (GridToolbar global search + per-column Logged / Source / Type filters,
 * matching the Events and Future-events tables); every filter is applied
 * server-side via buildServerQuery, with sourceType pinned to 'detected'. The
 * selected-row detail reuses EventDetailPanelComponent's detected branch with
 * [canEdit]="false".
 */
@Component({
  selector: 'app-activity-page',
  imports: [
    DatePipe,
    FormsModule,
    DatePicker,
    MessageModule,
    SelectModule,
    TableModule,
    Tooltip,
    ManagePageShellComponent,
    SectionHeaderComponent,
    GridToolbarComponent,
    TableSkeletonBodyComponent,
    EventDetailPanelComponent,
  ],
  templateUrl: './activity-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityPageComponent implements OnInit, OnDestroy {
  private readonly eventService = inject(EventService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly topbarState = inject(TopbarStateService);

  readonly spaceId = signal('');
  tenantId = '';

  readonly items = signal<FeedItem[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly selectedItem = signal<FeedItem | null>(null);

  protected readonly viewDetailsLabel = viewDetailsLabel;
  protected readonly sourceOptions = ACTIVITY_SOURCE_OPTIONS;
  protected readonly typeOptions = ACTIVITY_TYPE_OPTIONS;

  // The Logged range picker's model is OWNED by this signal, not re-derived from
  // the grid's re-seeded filter value on every change-detection pass. Binding
  // `[ngModel]` to a fresh array each pass made p-datepicker re-emit through the
  // grid's filter re-seed and loop (the page froze). Holding the EXACT array the
  // picker emitted means writeValue never sees a new reference, so it never
  // re-emits; `loggedRangeSyncEffect` clears it when the filter is cleared
  // elsewhere (the toolbar's Clear).
  protected readonly loggedRange = signal<Date[] | null>(null);

  /** Apply a Logged date-range selection: own the value, then narrow the grid. */
  protected onLoggedRange(range: Date[] | null, apply: (value: unknown) => void): void {
    this.loggedRange.set(range);
    apply(range);
  }

  // Grid state -- must be initialized in field initializer (injection context).
  // Only feed_ts / change_source / change_event_type are filterable columns;
  // Change and Entity are covered by the toolbar's global search.
  readonly grid = createGridState<FeedItem>({
    columns: [
      { field: 'feed_ts', header: 'Logged', filter: { kind: 'date' } },
      {
        field: 'change_source',
        header: 'Source',
        filter: { kind: 'select', options: () => this.sourceOptions },
      },
      {
        field: 'change_event_type',
        header: 'Type',
        filter: { kind: 'select', options: () => this.typeOptions },
      },
    ],
    globalSearchFields: ['title', 'entity_name', 'company_name', 'change_event_type'],
    defaultSort: { field: 'feed_ts', order: -1 },
    defaultPageSize: 25,
    persistenceKey: 'activity',
  });

  // Keep the range picker's model in step when the feed_ts filter is cleared
  // from outside the picker (the toolbar Clear resets grid.filters()).
  private readonly loggedRangeSyncEffect = effect(() => {
    const f = this.grid.filters()['feed_ts'];
    if (!f && this.loggedRange() !== null) this.loggedRange.set(null);
  });

  // The full server query derived from grid state + space, with sourceType
  // pinned to 'detected' so the Activity feed never widens to analyst events.
  private readonly serverQuery = computed<ServerQuery>(() =>
    buildServerQuery(
      this.grid.filters(),
      this.grid.sort(),
      this.grid.page(),
      this.grid.debouncedGlobalSearch(),
      null,
      this.spaceId(),
      { forcedSourceType: 'detected' }
    )
  );

  private lastQueryKey: string | null = null;
  private fetchSeq = 0;

  // Reactive fetch: re-queries whenever the derived query changes, skipping
  // identical queries and discarding stale responses via a monotonic id.
  private readonly feedEffect = effect(() => {
    const q = this.serverQuery();
    if (!q.spaceId) return;
    const key = JSON.stringify(q);
    if (key === this.lastQueryKey) return;
    this.lastQueryKey = key;
    void this.fetchFeed(q);
  });

  private readonly countEffect = effect(() => {
    this.topbarState.recordCount.set(String(this.total() || ''));
  });

  ngOnInit(): void {
    this.tenantId = this.getRouteParam('tenantId');
    this.spaceId.set(this.getRouteParam('spaceId'));
    // Deep link with a Logged date filter already in the URL: reflect it in the
    // picker so the control shows the active range.
    const f = this.grid.filters()['feed_ts'];
    if (f && f.kind === 'date') this.loggedRange.set(toDatePickerRange([f.from, f.to]));
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  /** Rich change summary segments for a detected row (reused from the feed). */
  protected getDetectedSummary(item: FeedItem): RichSummary {
    return summarySegmentsFor(feedItemToChangeEvent(item, this.spaceId()));
  }

  /** Entity column cell (level badge + most-specific name + parent path). */
  protected entityCell(item: FeedItem): EntityCellParts {
    return entityCellParts(item);
  }

  /** Humanized change type label, e.g. "date_moved" -> "Date moved". */
  protected changeTypeLabel(item: FeedItem): string {
    return changeTypeLabel(item.change_event_type);
  }

  /** Origin of a detected change: registry feed vs analyst edit. */
  protected sourceLabel(item: FeedItem): string {
    switch (item.change_source) {
      case 'ctgov':
        return 'CT.gov';
      case 'analyst':
        return 'Analyst';
      case 'source_import':
        return 'Import';
      default:
        return 'System';
    }
  }

  onRowClick(item: FeedItem): void {
    // Detected rows render entirely from the FeedItem payload, so selecting a
    // row needs no detail fetch (mirrors the events feed's detected branch).
    this.selectedItem.set(this.selectedItem()?.id === item.id ? null : item);
  }

  closePanel(): void {
    this.selectedItem.set(null);
  }

  /** Navigate to a clicked trial from the detail panel's related-entity list. */
  onTrialClick(trialId: string): void {
    void this.router.navigate([
      '/t',
      this.tenantId,
      's',
      this.spaceId(),
      'profiles',
      'trials',
      trialId,
    ]);
  }

  private async fetchFeed(q: ServerQuery): Promise<void> {
    const seq = ++this.fetchSeq;
    this.loading.set(true);
    this.error.set(null);
    try {
      const feed = await this.eventService.getEventsPageData(
        q.spaceId,
        q.filters,
        q.limit,
        q.offset
      );
      if (seq !== this.fetchSeq) return; // a newer query superseded this one
      this.items.set(feed.items);
      this.total.set(feed.total);
    } catch (err) {
      if (seq !== this.fetchSeq) return;
      this.error.set(err instanceof Error ? err.message : 'Failed to load activity.');
    } finally {
      if (seq === this.fetchSeq) this.loading.set(false);
    }
  }

  private getRouteParam(name: string): string {
    let route = this.route.snapshot;
    while (route) {
      const id = route.paramMap.get(name);
      if (id) return id;
      if (!route.parent) break;
      route = route.parent;
    }
    return '';
  }
}
