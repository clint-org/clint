import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MessageModule } from 'primeng/message';
import { TableLazyLoadEvent, TableModule } from 'primeng/table';
import { Tooltip } from 'primeng/tooltip';

import { FeedItem } from '../../core/models/event.model';
import { EventService } from '../../core/services/event.service';
import { TopbarStateService } from '../../core/services/topbar-state.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { SectionHeaderComponent } from '../../shared/components/section-header/section-header.component';
import { TableSkeletonBodyComponent } from '../../shared/components/skeleton/table-skeleton-body.component';
import {
  feedItemToChangeEvent,
  summarySegmentsFor,
  type RichSummary,
} from '../../shared/utils/change-event-summary';
import { viewDetailsLabel } from '../../shared/utils/accessible-row-label';
import { entityCellParts, type EntityCellParts } from '../events/entity-cell';
import { EventDetailPanelComponent } from '../events/event-detail-panel.component';
import { buildDetectedFilters } from './activity-filters';

interface PageState {
  first: number;
  rows: number;
}

/**
 * Read-only Activity log. Renders DETECTED changes only: CT.gov registry deltas
 * and analyst-edit deltas surfaced by `get_events_page_data` (source_type
 * 'detected'). Unlike the legacy Events feed (de-routed in the Stage 3
 * events->activity split), Activity offers no create/edit/delete affordances and
 * no filter controls -- it is a passive audit trail. The selected-row detail
 * reuses EventDetailPanelComponent's detected branch with [canEdit]="false".
 */
@Component({
  selector: 'app-activity-page',
  imports: [
    DatePipe,
    MessageModule,
    TableModule,
    Tooltip,
    ManagePageShellComponent,
    SectionHeaderComponent,
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
  readonly page = signal<PageState>({ first: 0, rows: 25 });

  protected readonly viewDetailsLabel = viewDetailsLabel;

  private lastQueryKey: string | null = null;
  private fetchSeq = 0;

  // Reactive fetch: re-queries the detected feed whenever the space or page
  // window changes, discarding stale (superseded) responses via a monotonic id.
  private readonly feedEffect = effect(() => {
    const spaceId = this.spaceId();
    const page = this.page();
    if (!spaceId) return;
    const key = `${spaceId}:${page.first}:${page.rows}`;
    if (key === this.lastQueryKey) return;
    this.lastQueryKey = key;
    void this.fetchFeed(spaceId, page);
  });

  private readonly countEffect = effect(() => {
    this.topbarState.recordCount.set(String(this.total() || ''));
  });

  ngOnInit(): void {
    this.tenantId = this.getRouteParam('tenantId');
    this.spaceId.set(this.getRouteParam('spaceId'));
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  onLazyLoad(event: TableLazyLoadEvent): void {
    this.page.set({ first: event.first ?? 0, rows: event.rows ?? 25 });
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
    const t = item.change_event_type;
    if (!t) return '--';
    // The marker_* change types are internal discriminators; "marker" is retired from
    // user-facing copy, so they read as "Event ..." (matching the change-summary text).
    const labels: Record<string, string> = {
      marker_added: 'Event added',
      marker_removed: 'Event removed',
      marker_updated: 'Event edited',
    };
    if (labels[t]) return labels[t];
    const spaced = t.replace(/_/g, ' ');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
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

  private async fetchFeed(spaceId: string, page: PageState): Promise<void> {
    const seq = ++this.fetchSeq;
    this.loading.set(true);
    this.error.set(null);
    try {
      const feed = await this.eventService.getEventsPageData(
        spaceId,
        buildDetectedFilters(),
        page.rows,
        page.first
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
