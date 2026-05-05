import { Component, computed, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { Tooltip } from 'primeng/tooltip';

import { CatalystDetail } from '../../core/models/catalyst.model';
import { EventCategory, EventDetail, FeedItem } from '../../core/models/event.model';
import { MarkerCategory } from '../../core/models/marker.model';
import { CatalystService } from '../../core/services/catalyst.service';
import { EventService } from '../../core/services/event.service';
import { EventCategoryService } from '../../core/services/event-category.service';
import { MarkerCategoryService } from '../../core/services/marker-category.service';
import { slidePanelAnimation } from '../../shared/animations/slide-panel.animation';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { GridToolbarComponent } from '../../shared/components/grid-toolbar.component';
import { TableSkeletonBodyComponent } from '../../shared/components/skeleton/table-skeleton-body.component';
import { HighlightPipe } from '../../shared/pipes/highlight.pipe';
import { createGridState } from '../../shared/grids';
import { EventDetailPanelComponent } from './event-detail-panel.component';
import { EventFormComponent } from './event-form.component';
import { confirmDelete } from '../../shared/utils/confirm-delete';
import { TopbarStateService } from '../../core/services/topbar-state.service';
import { SpaceRoleService } from '../../core/services/space-role.service';

@Component({
  selector: 'app-events-page',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    ButtonModule,
    Dialog,
    MessageModule,
    ProgressSpinner,
    SelectModule,
    TableModule,
    Tooltip,
    ManagePageShellComponent,
    GridToolbarComponent,
    TableSkeletonBodyComponent,
    EventDetailPanelComponent,
    EventFormComponent,
    HighlightPipe,
  ],
  templateUrl: './events-page.component.html',
  animations: [slidePanelAnimation],
})
export class EventsPageComponent implements OnInit, OnDestroy {
  private eventService = inject(EventService);
  private catalystService = inject(CatalystService);
  private eventCategoryService = inject(EventCategoryService);
  private markerCategoryService = inject(MarkerCategoryService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  private readonly topbarState = inject(TopbarStateService);
  protected spaceRole = inject(SpaceRoleService);

  private readonly topbarActionsEffect = effect(() => {
    if (this.spaceRole.canEdit()) {
      this.topbarState.actions.set([
        {
          label: 'New Event',
          icon: 'fa-solid fa-plus',
          text: true,
          callback: () => this.openCreateModal(),
        },
      ]);
    } else {
      this.topbarState.actions.set([]);
    }
  });

  spaceId = '';

  // Data
  feedItems = signal<FeedItem[]>([]);
  eventCategories = signal<EventCategory[]>([]);
  markerCategories = signal<MarkerCategory[]>([]);

  // UI state
  loading = signal(false);
  error = signal<string | null>(null);
  modalOpen = signal(false);
  editingEventId = signal<string | null>(null);

  // Detail panel
  selectedItem = signal<FeedItem | null>(null);
  selectedDetail = signal<EventDetail | null>(null);
  selectedCatalystDetail = signal<CatalystDetail | null>(null);
  detailLoading = signal(false);

  // All categories combined for the category filter
  readonly allCategoryOptions = computed(() => {
    const eCats = this.eventCategories().map((c) => ({
      label: c.name,
      value: c.id,
    }));
    const mCats = this.markerCategories().map((c) => ({
      label: c.name,
      value: c.id,
    }));
    return [...eCats, ...mCats];
  });

  private readonly PAGE_SIZE = 50;

  // Grid state -- must be initialized in field initializer (injection context)
  readonly grid = createGridState<FeedItem>({
    columns: [
      {
        field: 'event_date',
        header: 'Date',
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
          ],
        },
      },
      {
        field: 'title',
        header: 'Title',
        filter: { kind: 'text' },
      },
      {
        field: 'category_name',
        header: 'Category',
        filter: { kind: 'text' },
      },
      {
        field: 'entity_display',
        header: 'Entity',
        filter: { kind: 'text' },
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
    globalSearchFields: ['title', 'category_name', 'entity_name', 'company_name'],
    defaultSort: { field: 'event_date', order: -1 },
    defaultPageSize: 25,
  });

  readonly visibleRows = this.grid.filteredRows(this.feedItems);

  private readonly countEffect = effect(() => {
    this.topbarState.recordCount.set(String(this.grid.totalRecords() || ''));
  });

  async ngOnInit(): Promise<void> {
    this.spaceId = this.getSpaceId();
    await this.loadInitialData();

    // Subscribe so deep-links keep working when navigating *to* this page
    // from another route (component is reused, ngOnInit only fires once).
    this.route.queryParamMap.subscribe(async (params) => {
      const eventId = params.get('eventId');
      if (eventId && this.selectedItem()?.id !== eventId) {
        await this.openByEventId(eventId);
      }
    });
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  /** Compute entity display string for a feed item. */
  getEntityDisplay(item: FeedItem): string {
    if (item.entity_level === 'space') return 'Industry';
    if (item.entity_level === 'company' && item.company_name) return item.company_name;
    if (item.company_name && item.entity_name) return `${item.company_name} / ${item.entity_name}`;
    if (item.entity_name) return item.entity_name;
    return '--';
  }

  async onRowClick(item: FeedItem): Promise<void> {
    // Toggle: clicking the same row closes the panel
    if (this.selectedItem()?.id === item.id) {
      this.selectedItem.set(null);
      this.selectedDetail.set(null);
      this.selectedCatalystDetail.set(null);
      return;
    }

    this.selectedItem.set(item);
    this.selectedDetail.set(null);
    this.selectedCatalystDetail.set(null);
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
        event_date: detail.event_date,
        category_name: detail.category.name,
        category_id: detail.category.id,
        priority: detail.priority,
        entity_level: detail.entity_level,
        entity_name: detail.entity_name,
        entity_id: detail.entity_id,
        company_name: detail.company_name,
        tags: detail.tags,
        has_thread: !!detail.thread,
        thread_id: detail.thread_id,
        description: detail.description,
        source_url: null,
      });
      this.selectedDetail.set(detail);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not load event.');
    } finally {
      this.detailLoading.set(false);
    }
  }

  /**
   * Filter the feed table by category from the empty-state histogram.
   * Uses the grid's text filter on `category_name` so the filter chip
   * row + p-table column filter stay in sync with the user's intent.
   */
  onCategoryFilter(name: string): void {
    this.grid.filters.update((f) => ({
      ...f,
      category_name: { kind: 'text', contains: name },
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
        event_date: detail.catalyst.event_date,
        category_name: detail.catalyst.category_name,
        category_id: detail.catalyst.category_id,
        priority: null,
        entity_level: detail.catalyst.trial_id
          ? 'trial'
          : detail.catalyst.product_id
            ? 'product'
            : detail.catalyst.company_id
              ? 'company'
              : 'space',
        entity_name:
          detail.catalyst.trial_name ??
          detail.catalyst.product_name ??
          detail.catalyst.company_name ??
          '',
        entity_id:
          detail.catalyst.trial_id ?? detail.catalyst.product_id ?? detail.catalyst.company_id,
        company_name: detail.catalyst.company_name,
        tags: [],
        has_thread: false,
        thread_id: null,
        description: detail.catalyst.description,
        source_url: detail.catalyst.source_url,
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
      this.spaceId,
      'manage',
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

  closeModal(): void {
    this.modalOpen.set(false);
    this.editingEventId.set(null);
  }

  async onSaved(): Promise<void> {
    const summary = this.editingEventId() ? 'Event updated.' : 'Event created.';
    this.closeModal();
    await this.loadFeed();
    this.messageService.add({ severity: 'success', summary, life: 3000 });
  }

  async onDeleteEvent(eventId: string): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete event',
      message: 'Delete this event? This cannot be undone.',
    });
    if (!ok) return;
    this.error.set(null);
    try {
      await this.eventService.delete(eventId);
      // Close detail panel if the deleted event was selected
      if (this.selectedItem()?.id === eventId) {
        this.closePanel();
      }
      await this.loadFeed();
      this.messageService.add({ severity: 'success', summary: 'Event deleted.', life: 3000 });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not delete event.');
    }
  }

  private async loadInitialData(): Promise<void> {
    this.loading.set(true);
    try {
      const [feed, eCats, mCats] = await Promise.all([
        this.eventService.getEventsPageData(
          this.spaceId,
          {
            dateFrom: null,
            dateTo: null,
            entityLevel: null,
            entityId: null,
            categoryIds: [],
            tags: [],
            priority: null,
            sourceType: null,
          },
          this.PAGE_SIZE,
          0
        ),
        this.eventCategoryService.list(this.spaceId),
        this.markerCategoryService.list(this.spaceId),
      ]);
      this.feedItems.set(feed);
      this.eventCategories.set(eCats);
      this.markerCategories.set(mCats);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load events.');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadFeed(): Promise<void> {
    this.loading.set(true);
    try {
      const feed = await this.eventService.getEventsPageData(
        this.spaceId,
        {
          dateFrom: null,
          dateTo: null,
          entityLevel: null,
          entityId: null,
          categoryIds: [],
          tags: [],
          priority: null,
          sourceType: null,
        },
        this.PAGE_SIZE,
        0
      );
      this.feedItems.set(feed);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load events.');
    } finally {
      this.loading.set(false);
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
