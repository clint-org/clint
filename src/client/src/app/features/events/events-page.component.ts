import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';

import {
  EventCategory,
  EventDetail,
  EventsPageFilters,
  FeedItem,
} from '../../core/models/event.model';
import { MarkerCategory } from '../../core/models/marker.model';
import { EventService } from '../../core/services/event.service';
import { EventCategoryService } from '../../core/services/event-category.service';
import { MarkerCategoryService } from '../../core/services/marker-category.service';
import { EventFilterBarComponent } from './event-filter-bar.component';
import { EventFeedItemComponent } from './event-feed-item.component';
import { EventFormComponent } from './event-form.component';
import { confirmDelete } from '../../shared/utils/confirm-delete';

@Component({
  selector: 'app-events-page',
  standalone: true,
  imports: [
    ButtonModule,
    Dialog,
    MessageModule,
    ProgressSpinner,
    EventFilterBarComponent,
    EventFeedItemComponent,
    EventFormComponent,
  ],
  templateUrl: './events-page.component.html',
})
export class EventsPageComponent implements OnInit {
  private eventService = inject(EventService);
  private eventCategoryService = inject(EventCategoryService);
  private markerCategoryService = inject(MarkerCategoryService);
  private route = inject(ActivatedRoute);
  private confirmation = inject(ConfirmationService);

  spaceId = '';

  // Data
  feedItems = signal<FeedItem[]>([]);
  eventCategories = signal<EventCategory[]>([]);
  markerCategories = signal<MarkerCategory[]>([]);
  spaceTags = signal<string[]>([]);
  selectedDetail = signal<EventDetail | null>(null);

  // UI state
  loading = signal(false);
  error = signal<string | null>(null);
  modalOpen = signal(false);
  editingEventId = signal<string | null>(null);
  hasMore = signal(true);

  // Filters
  filters = signal<EventsPageFilters>({
    dateFrom: null,
    dateTo: null,
    entityLevel: null,
    entityId: null,
    categoryIds: [],
    tags: [],
    priority: null,
    sourceType: null,
  });

  readonly allCategories = computed(() => {
    const eCats = this.eventCategories().map((c) => ({
      id: c.id,
      name: c.name,
      group: 'Events',
    }));
    const mCats = this.markerCategories().map((c) => ({
      id: c.id,
      name: c.name,
      group: 'Markers',
    }));
    return [...eCats, ...mCats];
  });

  private readonly PAGE_SIZE = 50;

  async ngOnInit(): Promise<void> {
    this.spaceId = this.getSpaceId();
    await this.loadInitialData();
  }

  async onFiltersChanged(newFilters: EventsPageFilters): Promise<void> {
    this.filters.set(newFilters);
    await this.loadFeed();
  }

  async loadMore(): Promise<void> {
    const currentItems = this.feedItems();
    this.loading.set(true);
    try {
      const moreItems = await this.eventService.getEventsPageData(
        this.spaceId,
        this.filters(),
        this.PAGE_SIZE,
        currentItems.length,
      );
      if (moreItems.length < this.PAGE_SIZE) {
        this.hasMore.set(false);
      }
      this.feedItems.set([...currentItems, ...moreItems]);
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : 'Failed to load more events.',
      );
    } finally {
      this.loading.set(false);
    }
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
    this.closeModal();
    await this.loadFeed();
    // Refresh tags in case new ones were added
    this.spaceTags.set(await this.eventService.getSpaceTags(this.spaceId));
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
      await this.loadFeed();
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : 'Could not delete event.',
      );
    }
  }

  async onSelectItem(item: FeedItem): Promise<void> {
    if (item.source_type !== 'event') {
      // Markers don't have expandable detail in events page
      return;
    }
    // Toggle: if already selected, deselect
    if (this.selectedDetail()?.id === item.id) {
      this.selectedDetail.set(null);
      return;
    }
    try {
      const detail = await this.eventService.getEventDetail(item.id);
      this.selectedDetail.set(detail);
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : 'Could not load event detail.',
      );
    }
  }

  private async loadInitialData(): Promise<void> {
    this.loading.set(true);
    try {
      const [feed, eCats, mCats, tags] = await Promise.all([
        this.eventService.getEventsPageData(this.spaceId, this.filters(), this.PAGE_SIZE, 0),
        this.eventCategoryService.list(this.spaceId),
        this.markerCategoryService.list(this.spaceId),
        this.eventService.getSpaceTags(this.spaceId),
      ]);
      this.feedItems.set(feed);
      this.eventCategories.set(eCats);
      this.markerCategories.set(mCats);
      this.spaceTags.set(tags);
      if (feed.length < this.PAGE_SIZE) {
        this.hasMore.set(false);
      }
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : 'Failed to load events.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  private async loadFeed(): Promise<void> {
    this.loading.set(true);
    this.hasMore.set(true);
    try {
      const feed = await this.eventService.getEventsPageData(
        this.spaceId,
        this.filters(),
        this.PAGE_SIZE,
        0,
      );
      this.feedItems.set(feed);
      if (feed.length < this.PAGE_SIZE) {
        this.hasMore.set(false);
      }
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : 'Failed to load events.',
      );
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
