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
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { LoaderComponent } from '../../shared/components/loader/loader.component';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { Tooltip } from 'primeng/tooltip';

import { CatalystDetail } from '../../core/models/event-detail.model';
import {
  EventCategoryDistribution,
  EventDetail,
  FeedItem,
} from '../../core/models/event.model';
import { FillStyle, MarkerCategory } from '../../core/models/marker.model';
import {
  ProjectionBadge,
  projectionBadge,
  projectionOutlineDash,
} from '../../core/models/marker-visual';
import { MarkerIconComponent } from '../../shared/components/svg-icons/marker-icon.component';
import { DetailPanelPillComponent } from '../../shared/components/detail-panel-pill.component';
import { EventDetailService } from '../../core/services/event-detail.service';
import { EventService } from '../../core/services/event.service';
import { MarkerCategoryService } from '../../core/services/marker-category.service';
import { slidePanelAnimation } from '../../shared/animations/slide-panel.animation';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { SectionHeaderComponent } from '../../shared/components/section-header/section-header.component';
import { GridToolbarComponent } from '../../shared/components/grid-toolbar.component';
import { TableSkeletonBodyComponent } from '../../shared/components/skeleton/table-skeleton-body.component';
import { HighlightPipe } from '../../shared/pipes/highlight.pipe';
import { createGridState } from '../../shared/grids';
import {
  feedItemToChangeEvent,
  flattenSummarySegments,
  summarySegmentsFor,
  type RichSummary,
} from '../../shared/utils/change-event-summary';
import { EventDetailPanelComponent } from './event-detail-panel.component';
import { EventFormDialogComponent } from './event-form/event-form-dialog.component';
import { confirmDelete } from '../../shared/utils/confirm-delete';
import { TopbarStateService } from '../../core/services/topbar-state.service';
import { SpaceRoleService } from '../../core/services/space-role.service';
import { formatEventDateSuffix } from './format-event-date-suffix';
import { viewDetailsLabel } from '../../shared/utils/accessible-row-label';
import { EntityScope, parseEntityScope, scopeChipLabel } from './entity-scope';
import { buildServerQuery, type ServerQuery } from './server-query';
import { entityCellParts, type EntityCellParts } from './entity-cell';
import {
  ExportButtonComponent,
  type ExportAction,
} from '../../shared/export/export-button.component';
import { GridExcelExportService } from '../../shared/export/grid-excel-export.service';
import { ExportNamingService } from '../../shared/export/export-naming.service';
import { buildEventsExportColumns } from './events-export.util';

/**
 * The synthetic category names the detected (CT.gov) leg of get_events_page_data
 * assigns to trial_change_events rows, which have no category_id. Mirrors the
 * leg-3 `category_name` CASE in the events RPC migration; kept in sync there so
 * a click on a detected histogram bucket renders a real category-filter chip.
 */
const DETECTED_CATEGORY_NAMES = [
  'Trial status',
  'Timeline',
  'Phase',
  'Protocol design',
  'Catalyst lifecycle',
  'Other',
] as const;

@Component({
  selector: 'app-events-page',
  imports: [
    DatePipe,
    FormsModule,
    ButtonModule,
    MessageModule,
    LoaderComponent,
    SelectModule,
    TableModule,
    Tooltip,
    ManagePageShellComponent,
    SectionHeaderComponent,
    GridToolbarComponent,
    TableSkeletonBodyComponent,
    EventDetailPanelComponent,
    EventFormDialogComponent,
    HighlightPipe,
    ExportButtonComponent,
    MarkerIconComponent,
    DetailPanelPillComponent,
  ],
  templateUrl: './events-page.component.html',
  animations: [slidePanelAnimation],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventsPageComponent implements OnInit, OnDestroy {
  private eventService = inject(EventService);
  private catalystService = inject(EventDetailService);
  private markerCategoryService = inject(MarkerCategoryService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  private readonly topbarState = inject(TopbarStateService);
  private readonly excel = inject(GridExcelExportService);
  private readonly exportNaming = inject(ExportNamingService);
  protected spaceRole = inject(SpaceRoleService);

  readonly spaceId = signal('');
  tenantId = '';

  // Data
  readonly feedItems = signal<FeedItem[]>([]);
  // The unified event taxonomy (event_type_categories). One taxonomy now backs
  // both markers and analyst events; the separate event_categories table was
  // dropped in the Stage 1 cutover.
  readonly markerCategories = signal<MarkerCategory[]>([]);

  // Overview aggregates over the FULL filtered set (not the loaded page), so
  // the detail-pane distribution / recent / counts reflect every matching
  // event rather than only what is on screen.
  readonly overviewDistribution = signal<EventCategoryDistribution[]>([]);
  readonly overviewRecent = signal<FeedItem[]>([]);
  readonly overviewHighPriority = signal(0);

  // Server-side entity scope carried by the "See all" link from a detail page.
  readonly scope = signal<EntityScope | null>(null);

  // The scoped entity's display name, resolved from the loaded feed: every row
  // in a scoped view belongs to that entity's subtree, so the most-specific
  // name for the scope level is consistent across rows. Null until rows load
  // (or for an empty scoped result), in which case the chip falls back to the
  // level noun.
  private readonly scopeEntityName = computed<string | null>(() => {
    const s = this.scope();
    if (!s) return null;
    const row = this.feedItems()[0];
    if (!row) return null;
    switch (s.entityLevel) {
      case 'company':
        return row.company_name;
      case 'product':
        return row.asset_name;
      case 'trial':
        return row.trial_name ?? row.entity_name;
    }
  });

  // The entity scope rendered as a filter chip in the grid toolbar (named,
  // with a level-aware "+ assets & trials" rollup suffix), or null when
  // unscoped. Replaces the old separate "Scoped to this ..." banner.
  readonly scopeChip = computed<{ header: string; label: string } | null>(() => {
    const s = this.scope();
    if (!s) return null;
    return { header: 'Scope', label: scopeChipLabel(s.entityLevel, this.scopeEntityName()) };
  });

  // UI state
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly editingEventId = signal<string | null>(null);

  // Detail panel
  readonly selectedItem = signal<FeedItem | null>(null);
  readonly selectedDetail = signal<EventDetail | null>(null);
  readonly selectedCatalystDetail = signal<CatalystDetail | null>(null);
  readonly detailLoading = signal(false);

  // Category filter options, keyed by display NAME (not id). The overview
  // histogram groups by category_name and detected-change categories have no
  // id, so the feed filters by name -- options carry the name as both label and
  // value so the column dropdown and the histogram-driven chips agree and the
  // chip resolves a clean label. Names are deduped because an event category
  // and a marker category can share one (e.g. "Regulatory"), and the synthetic
  // detected categories are appended so a click on one of those buckets renders
  // a real chip label rather than the raw "<value>" fallback.
  readonly allCategoryOptions = computed(() => {
    const names = new Set<string>();
    for (const c of this.markerCategories()) names.add(c.name);
    for (const n of DETECTED_CATEGORY_NAMES) names.add(n);
    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ label: name, value: name }));
  });

  // Grid state -- must be initialized in field initializer (injection context)
  readonly grid = createGridState<FeedItem>({
    columns: [
      {
        field: 'feed_ts',
        header: 'Logged',
        filter: { kind: 'date' },
      },
      {
        field: 'source_type',
        header: 'Source',
        filter: {
          kind: 'select',
          options: () => [
            { label: 'Event', value: 'event' },
            { label: 'Marker', value: 'marker' },
            { label: 'Detected', value: 'detected' },
          ],
        },
      },
      {
        field: 'title',
        header: 'Title',
        // Detected rows render a composed change summary in place of the raw
        // title (see the #body template); mirror that text so the export cell
        // matches the screen instead of showing the empty/internal title.
        getValue: (row) => this.getTitleDisplay(row),
      },
      {
        field: 'category_name',
        header: 'Category',
        filter: { kind: 'select', options: () => this.allCategoryOptions() },
      },
      {
        field: 'entity_display',
        header: 'Entity',
        getValue: (row) => this.getEntityDisplay(row),
      },
      {
        field: 'priority',
        header: 'Priority',
        filter: {
          kind: 'select',
          options: () => [
            { label: 'High', value: 'high' },
            { label: 'Low', value: 'low' },
          ],
        },
      },
    ],
    globalSearchFields: [
      'title',
      'category_name',
      'entity_name',
      'company_name',
      'change_event_type',
    ],
    defaultSort: { field: 'feed_ts', order: -1 },
    defaultPageSize: 25,
    persistenceKey: 'events',
  });

  // Events is server-paginated: the export captures the currently loaded page
  // of feed rows (feedItems()), which is the "current view" by design.
  readonly exportActions: ExportAction[] = [
    {
      label: 'Excel',
      format: 'xlsx',
      run: async () =>
        this.excel.export({
          sheetName: 'Events',
          filename: await this.exportNaming.stem(this.spaceId(), 'events'),
          columns: buildEventsExportColumns({
            title: (i) => this.getTitleDisplay(i),
            entity: (i) => this.getEntityDisplay(i),
          }),
          rows: this.feedItems(),
        }),
    },
  ];

  protected readonly serverTotal = signal(0);

  // Bumped to force a refetch after a mutation (create/edit/delete/annotation),
  // once the mutating service call has invalidated the events cache tag.
  private readonly reloadTick = signal(0);

  // The full server query derived from grid state + scope + space. The table
  // renders exactly what the server returns; filtering/search/sort/pagination
  // are all server-side.
  private readonly serverQuery = computed<ServerQuery>(() =>
    buildServerQuery(
      this.grid.filters(),
      this.grid.sort(),
      this.grid.page(),
      this.grid.debouncedGlobalSearch(),
      this.scope(),
      this.spaceId()
    )
  );

  private lastQueryKey: string | null = null;
  private fetchSeq = 0;

  // Reactive fetch: re-queries whenever the derived query (or reloadTick)
  // changes, skipping identical queries and discarding stale (superseded)
  // responses via a monotonic request id.
  private readonly feedEffect = effect(() => {
    const q = this.serverQuery();
    const tick = this.reloadTick();
    if (!q.spaceId) return;
    const key = `${JSON.stringify(q)}:${tick}`;
    if (key === this.lastQueryKey) return;
    this.lastQueryKey = key;
    void this.fetchFeed(q);
  });

  private readonly countEffect = effect(() => {
    this.topbarState.recordCount.set(String(this.serverTotal() || ''));
  });

  async ngOnInit(): Promise<void> {
    this.tenantId = this.getTenantId();

    const sourceParam = this.route.snapshot.queryParamMap.get('source');
    if (sourceParam === 'detected' || sourceParam === 'event' || sourceParam === 'marker') {
      this.grid.filters.update((f) => ({
        ...f,
        source_type: { kind: 'select', values: [sourceParam] },
      }));
    }

    // "See all" from an entity detail page deep-links here with the entity
    // scope as query params; apply it so the feed matches the panel it came
    // from rather than dumping the user into the unscoped, global list.
    this.scope.set(
      parseEntityScope(
        this.route.snapshot.queryParamMap.get('entityLevel'),
        this.route.snapshot.queryParamMap.get('entityId')
      )
    );

    // Setting spaceId last lets the reactive feedEffect fire its first fetch
    // with the source filter + scope above already applied.
    this.spaceId.set(this.getSpaceId());
    await this.loadCategoryOptions();

    this.route.queryParamMap.subscribe(async (params) => {
      const eventId = params.get('eventId');
      if (eventId && this.selectedItem()?.id !== eventId) {
        await this.openByEventId(eventId);
      }
      const detectedId = params.get('detectedId');
      if (detectedId && this.selectedItem()?.id !== detectedId) {
        await this.openByDetectedId(detectedId);
      }
    });
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  /**
   * Marker glyph fill: projected markers render as an outline (expected),
   * confirmed markers fill solid. Mirrors the catalyst table mapping so the
   * same marker reads identically across surfaces.
   */
  protected markerFillStyle(item: FeedItem): FillStyle {
    return item.is_projected ? 'outline' : 'filled';
  }

  /** Projection tier badge + forecast dash, matching the timeline glyph. */
  protected markerBadge(item: FeedItem): ProjectionBadge {
    return projectionBadge(item.projection);
  }

  protected markerOutlineDash(item: FeedItem): boolean {
    return projectionOutlineDash(item.projection);
  }

  /**
   * Directional date-shift label for a detected `date_moved` change, e.g.
   * "120d later" / "30d earlier", else null. Drives the amber shift chip in
   * the status column so a slip reads at a glance.
   */
  protected detectedShift(item: FeedItem): { text: string; later: boolean } | null {
    if (item.source_type !== 'detected' || item.change_event_type !== 'date_moved') return null;
    const payload = item.change_payload ?? {};
    const raw = payload['days_shifted'] ?? payload['days_diff'];
    if (raw == null) return null;
    const days = Number(raw);
    if (!Number.isFinite(days) || days === 0) return null;
    return { text: `${Math.abs(days)}d ${days > 0 ? 'later' : 'earlier'}`, later: days > 0 };
  }

  protected getDetectedSummary(item: FeedItem): RichSummary {
    return summarySegmentsFor(feedItemToChangeEvent(item, this.spaceId()));
  }

  protected formatEventDateSuffix(item: FeedItem): string {
    return formatEventDateSuffix(item);
  }

  protected readonly viewDetailsLabel = viewDetailsLabel;

  /**
   * Flat title text matching what the row renders: detected rows show the
   * composed change-event summary, everything else shows the raw title. Shared
   * by the Title column's export getValue so the Excel cell mirrors the screen.
   */
  getTitleDisplay(item: FeedItem): string {
    if (item.source_type === 'detected' && item.change_event_type) {
      return flattenSummarySegments(this.getDetectedSummary(item).segments);
    }
    return item.title ?? '';
  }

  getEntityDisplay(item: FeedItem): string {
    if (item.entity_level === 'space') return 'Industry';
    if (item.entity_level === 'company' && item.company_name) return item.company_name;
    if (item.company_name && item.entity_name) return `${item.company_name} / ${item.entity_name}`;
    if (item.entity_name) return item.entity_name;
    return '--';
  }

  /** Entity column cell (level badge + most-specific name + parent path). */
  protected entityCell(item: FeedItem): EntityCellParts {
    return entityCellParts(item);
  }

  async onRowClick(item: FeedItem): Promise<void> {
    if (this.selectedItem()?.id === item.id) {
      this.selectedItem.set(null);
      this.selectedDetail.set(null);
      this.selectedCatalystDetail.set(null);
      return;
    }

    this.selectedItem.set(item);
    this.selectedDetail.set(null);
    this.selectedCatalystDetail.set(null);

    if (item.source_type === 'detected') {
      return;
    }

    this.detailLoading.set(true);

    try {
      if (item.source_type === 'event') {
        const detail = await this.eventService.getEventDetail(item.id);
        if (this.selectedItem()?.id === item.id) {
          this.selectedDetail.set(detail);
        }
      } else {
        const detail = await this.catalystService.getCatalystDetail(item.id);
        if (this.selectedItem()?.id === item.id) {
          this.selectedCatalystDetail.set(detail);
        }
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not load detail.');
    } finally {
      this.detailLoading.set(false);
    }
  }

  closePanel(): void {
    this.selectedItem.set(null);
    this.selectedDetail.set(null);
    this.selectedCatalystDetail.set(null);
  }

  onAnnotationChanged(): void {
    this.reloadTick.update((t) => t + 1);
  }

  /**
   * Empty-state "Most recent" row click: jump to that feed item by
   * resolving it from the loaded feed and routing through the standard
   * row-click path (loads detail, opens panel).
   */
  async onRecentClick(itemId: string): Promise<void> {
    const item = this.feedItems().find((i) => i.id === itemId);
    if (item) await this.onRowClick(item);
  }

  /**
   * Open the detail pane for an event id that may not be in the loaded
   * feed (e.g. a related-event from the marker drawer or a thread sibling
   * that's older than the current page). Always treats the id as an event
   * since `eventId` deep-links and panel cross-links never carry markers.
   */
  async openByEventId(eventId: string): Promise<void> {
    if (this.selectedItem()?.id === eventId) return;
    this.detailLoading.set(true);
    this.selectedDetail.set(null);
    this.selectedCatalystDetail.set(null);
    try {
      const detail = await this.eventService.getEventDetail(eventId);
      this.selectedItem.set({
        source_type: 'event',
        id: detail.id,
        title: detail.title,
        feed_ts: detail.created_at, // feed_ts mirrors get_events_page_data: events use created_at
        event_date: detail.event_date,
        category_name: detail.category.name,
        category_id: detail.category.id,
        priority: detail.priority,
        entity_level: detail.entity_level,
        entity_name: detail.entity_name,
        entity_id: detail.entity_id,
        company_name: detail.company_name,
        company_id: detail.company_id,
        asset_id: detail.asset_id,
        asset_name: null,
        trial_id: detail.entity_level === 'trial' ? detail.entity_id : null,
        trial_name: detail.entity_level === 'trial' ? detail.entity_name : null,
        tags: detail.tags,
        has_thread: !!detail.thread,
        thread_id: detail.thread_id,
        description: detail.description,
        source_url: null,
        change_event_type: null,
        change_payload: null,
        change_source: null,
        has_annotation: false,
        observed_at: null,
        company_logo_url: null,
        is_projected: null,
        marker_type_shape: null,
        marker_type_color: null,
        marker_type_inner_mark: null,
        category_color: null,
      });
      this.selectedDetail.set(detail);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not load event.');
    } finally {
      this.detailLoading.set(false);
    }
  }

  /**
   * Open the detail pane for a detected change event by its trial_change_events
   * id. Unlike openByEventId (analyst events via get_event_detail), detected
   * rows render entirely from the FeedItem payload, so we fetch the single
   * feed row and select it. Used by the ?detectedId deep-link from the
   * recent-change dot.
   */
  async openByDetectedId(changeEventId: string): Promise<void> {
    if (this.selectedItem()?.id === changeEventId) return;
    this.detailLoading.set(true);
    this.selectedDetail.set(null);
    this.selectedCatalystDetail.set(null);
    try {
      const item = await this.eventService.getDetectedEvent(this.spaceId(), changeEventId);
      if (item) {
        this.selectedItem.set(item);
      } else {
        this.error.set('Could not find that change event.');
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not load event.');
    } finally {
      this.detailLoading.set(false);
    }
  }

  /**
   * Filter the feed table by category from the overview histogram. Sets a
   * `select` filter on `category_name` valued by the category NAME, matching
   * the column's declared filter kind so the chip row, the p-table column
   * filter, and the server query (which filters by `p_category_names`) all
   * stay in sync. A text filter here was the bug: it left the server query
   * empty (no narrowing) and, once round-tripped through the URL, was re-read
   * as a select whose name was passed to the uuid `p_category_ids`.
   */
  onCategoryFilter(name: string): void {
    this.grid.filters.update((f) => ({
      ...f,
      category_name: { kind: 'select', values: [name] },
    }));
  }

  /** Load a marker (catalyst) detail by id when crossed-linked from another marker. */
  async openByMarkerId(markerId: string): Promise<void> {
    if (this.selectedItem()?.id === markerId) return;
    this.detailLoading.set(true);
    this.selectedDetail.set(null);
    this.selectedCatalystDetail.set(null);
    try {
      const detail = await this.catalystService.getCatalystDetail(markerId);
      this.selectedItem.set({
        source_type: 'marker',
        id: detail.catalyst.marker_id,
        title: detail.catalyst.title,
        feed_ts: detail.catalyst.event_date, // Catalyst lacks created_at; event_date is the best available approximation
        event_date: detail.catalyst.event_date,
        category_name: detail.catalyst.category_name,
        category_id: detail.catalyst.category_id,
        priority: null,
        entity_level: detail.catalyst.trial_id
          ? 'trial'
          : detail.catalyst.asset_id
            ? 'product'
            : detail.catalyst.company_id
              ? 'company'
              : 'space',
        entity_name:
          detail.catalyst.trial_acronym ??
          detail.catalyst.trial_name ??
          detail.catalyst.asset_name ??
          detail.catalyst.company_name ??
          '',
        entity_id:
          detail.catalyst.trial_id ?? detail.catalyst.asset_id ?? detail.catalyst.company_id,
        company_name: detail.catalyst.company_name,
        company_id: detail.catalyst.company_id,
        asset_id: detail.catalyst.asset_id,
        asset_name: detail.catalyst.asset_name,
        trial_id: detail.catalyst.trial_id,
        trial_name: detail.catalyst.trial_acronym ?? detail.catalyst.trial_name,
        tags: [],
        has_thread: false,
        thread_id: null,
        description: detail.catalyst.description,
        source_url: detail.catalyst.source_url,
        change_event_type: null,
        change_payload: null,
        change_source: null,
        has_annotation: false,
        observed_at: null,
        company_logo_url: null,
        is_projected: detail.catalyst.is_projected,
        marker_type_shape: detail.catalyst.marker_type_shape,
        marker_type_color: detail.catalyst.marker_type_color,
        marker_type_inner_mark: detail.catalyst.marker_type_inner_mark,
        category_color: detail.catalyst.marker_type_color,
      });
      this.selectedCatalystDetail.set(detail);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not load marker.');
    } finally {
      this.detailLoading.set(false);
    }
  }

  /** Navigate to the trial detail page for a clicked trial in the marker pane. */
  onTrialClick(trialId: string): void {
    this.router.navigate([
      '/t',
      this.getTenantId(),
      's',
      this.spaceId(),
      'profiles',
      'trials',
      trialId,
    ]);
  }

  private getTenantId(): string {
    let route = this.route.snapshot;
    while (route) {
      const id = route.paramMap.get('tenantId');
      if (id) return id;
      if (!route.parent) break;
      route = route.parent;
    }
    return '';
  }

  openCreateModal(): void {
    this.editingEventId.set(null);
    this.modalOpen.set(true);
  }

  openEditModal(eventId: string): void {
    this.editingEventId.set(eventId);
    this.modalOpen.set(true);
  }

  // Edit icon on the detail panel branches by selection kind. Events open the
  // inline form here. Trial-anchored markers route to the trial page where the
  // marker editor lives in trial context; asset/company/space-anchored markers
  // have no such page, so they open the same inline merged Event form (the path
  // the entity events table uses). Markers no longer have their own detail page.
  onEditSelected(): void {
    const item = this.selectedItem();
    if (!item) return;
    if (item.source_type === 'marker') {
      const trialId = this.selectedCatalystDetail()?.catalyst.trial_id;
      if (trialId) {
        this.router.navigate(
          ['/t', this.tenantId, 's', this.spaceId(), 'profiles', 'trials', trialId],
          {
            queryParams: { marker: item.id },
          }
        );
        return;
      }
      this.openEditModal(item.id);
      return;
    }
    this.openEditModal(item.id);
  }

  // Delete from the detail-panel kebab. Only manual events are deletable here;
  // the kebab never offers Delete for markers (deleted on their trial) or
  // detected items, but guard defensively in case the selection shifts.
  onDeleteSelected(): void {
    const item = this.selectedItem();
    if (!item || item.source_type !== 'event') return;
    void this.onDeleteEvent(item.id);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.editingEventId.set(null);
  }

  async onSaved(): Promise<void> {
    const summary = this.editingEventId() ? 'Event updated.' : 'Event created.';
    this.closeModal();
    this.reloadTick.update((t) => t + 1);
    this.messageService.add({ severity: 'success', summary, life: 3000 });
  }

  async onDeleteEvent(eventId: string): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete event',
      message: 'Delete this event?',
      requireTypedConfirmation: true,
      typedConfirmationValue: 'delete',
    });
    if (!ok) return;
    this.error.set(null);
    try {
      await this.eventService.delete(eventId);
      if (this.selectedItem()?.id === eventId) {
        this.closePanel();
      }
      this.reloadTick.update((t) => t + 1);
      this.messageService.add({ severity: 'success', summary: 'Event deleted.', life: 3000 });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not delete event.');
    }
  }

  /** Clear the entity scope; the reactive feedEffect refetches the full feed. */
  async clearScope(): Promise<void> {
    if (!this.scope()) return;
    this.scope.set(null);
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { entityLevel: null, entityId: null },
      queryParamsHandling: 'merge',
    });
  }

  private async fetchFeed(q: ServerQuery): Promise<void> {
    const seq = ++this.fetchSeq;
    this.loading.set(true);
    try {
      const feed = await this.eventService.getEventsPageData(
        q.spaceId,
        q.filters,
        q.limit,
        q.offset
      );
      if (seq !== this.fetchSeq) return; // a newer query superseded this one
      this.feedItems.set(feed.items);
      this.serverTotal.set(feed.total);
      this.overviewDistribution.set(feed.distribution);
      this.overviewRecent.set(feed.recent);
      this.overviewHighPriority.set(feed.highPriorityCount);
    } catch (err) {
      if (seq !== this.fetchSeq) return;
      this.error.set(err instanceof Error ? err.message : 'Failed to load events.');
    } finally {
      if (seq === this.fetchSeq) this.loading.set(false);
    }
  }

  private async loadCategoryOptions(): Promise<void> {
    const sid = this.spaceId();
    try {
      this.markerCategories.set(await this.markerCategoryService.list(sid));
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load categories.');
    }
  }

  private getSpaceId(): string {
    let route = this.route.snapshot;
    while (route) {
      const id = route.paramMap.get('spaceId');
      if (id) return id;
      if (!route.parent) break;
      route = route.parent;
    }
    return '';
  }
}
