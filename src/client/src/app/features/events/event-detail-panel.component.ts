import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ConfirmationService } from 'primeng/api';

import { CatalystDetail } from '../../core/models/catalyst.model';
import type { ChangeEvent } from '../../core/models/change-event.model';
import { EventDetail, FeedItem } from '../../core/models/event.model';
import { AnnotationService, Annotation } from '../../core/services/annotation.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { MarkerDetailContentComponent } from '../../shared/components/marker-detail-content.component';
import { DetailPanelEmptyStateComponent } from '../../shared/components/detail-panel-empty-state.component';
import { DetailPanelEntityListComponent } from '../../shared/components/detail-panel-entity-list.component';
import { DetailPanelEntityRowComponent } from '../../shared/components/detail-panel-entity-row.component';
import { DetailPanelPillComponent } from '../../shared/components/detail-panel-pill.component';
import { DetailPanelSectionComponent } from '../../shared/components/detail-panel-section.component';
import { DetailPanelShellComponent } from '../../shared/components/detail-panel-shell.component';
import { BrandLogoComponent } from '../../shared/components/brand-logo.component';
import { summarySegmentsFor, type RichSummary } from '../../shared/utils/change-event-summary';
import { confirmDelete } from '../../shared/utils/confirm-delete';

interface CategoryHistogramEntry {
  name: string;
  count: number;
  color: string;
}

interface RecentItemSummary {
  id: string;
  title: string;
  event_date: string;
}

const CATEGORY_COLOR_FALLBACK = '#94a3b8';

const CATEGORY_COLOR: Record<string, string> = {
  'M&A': '#f97316', // orange-500
  Earnings: '#0891b2', // cyan-600
  Conference: '#8b5cf6', // violet-500
  Licensing: '#f59e0b', // amber-500
  Regulatory: '#dc2626', // red-600
  Clinical: '#16a34a', // green-600
};

@Component({
  selector: 'app-event-detail-panel',
  imports: [
    DatePipe,
    FormsModule,
    BrandLogoComponent,
    RouterLink,
    DetailPanelEmptyStateComponent,
    DetailPanelEntityListComponent,
    DetailPanelEntityRowComponent,
    DetailPanelPillComponent,
    DetailPanelSectionComponent,
    DetailPanelShellComponent,
    MarkerDetailContentComponent,
  ],
  templateUrl: './event-detail-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventDetailPanelComponent {
  private readonly annotationService = inject(AnnotationService);
  private readonly supabase = inject(SupabaseService);
  private readonly confirmation = inject(ConfirmationService);

  readonly detail = input<EventDetail | null>(null);
  readonly catalystDetail = input<CatalystDetail | null>(null);
  readonly canEdit = input<boolean>(true);
  readonly spaceId = input<string>('');
  readonly tenantId = input<string>('');

  /** The currently selected FeedItem (used for detected branch). */
  readonly selectedFeedItem = input<FeedItem | null>(null);

  /** Feed snapshot used to render the empty-state overview. */
  readonly feedItems = input<FeedItem[]>([]);

  readonly edit = output<void>();
  readonly panelClose = output<void>();
  readonly openThread = output<void>();
  readonly threadEventClick = output<string>();
  readonly relatedEventClick = output<string>();
  readonly recentClick = output<string>();
  readonly categoryFilter = output<string>();
  readonly markerSelect = output<string>();
  readonly trialClick = output<string>();

  /** Emitted when an annotation is created, updated, or deleted so the parent can refresh. */
  readonly annotationChanged = output<void>();

  // Annotation editing state
  protected readonly annotationEditing = signal(false);
  protected readonly annotationBody = signal('');
  protected readonly annotationSaving = signal(false);
  protected readonly annotationData = signal<Annotation | null>(null);
  protected readonly annotationLoading = signal(false);

  constructor() {
    effect(() => {
      const item = this.selectedFeedItem();
      this.annotationEditing.set(false);
      this.annotationBody.set('');
      this.annotationData.set(null);
      if (item?.source_type === 'detected' && item.has_annotation) {
        void this.loadAnnotation(item.id);
      }
    });
  }

  protected readonly isDetected = computed(
    () => this.selectedFeedItem()?.source_type === 'detected'
  );

  readonly hasSelection = computed(
    () => !!this.detail() || !!this.catalystDetail() || this.isDetected()
  );

  readonly headerLabel = computed(() => {
    const d = this.detail();
    if (d) return d.category.name;
    const cd = this.catalystDetail();
    if (cd) return `${cd.catalyst.category_name} · ${cd.catalyst.marker_type_name}`;
    const fi = this.selectedFeedItem();
    if (fi?.source_type === 'detected') return fi.category_name;
    return 'Events · overview';
  });

  /** Compute rich summary segments from a detected FeedItem. */
  protected readonly detectedSummary = computed<RichSummary | null>(() => {
    const fi = this.selectedFeedItem();
    if (!fi || fi.source_type !== 'detected' || !fi.change_event_type || !fi.change_payload) {
      return null;
    }
    // Build a minimal ChangeEvent to feed summarySegmentsFor
    const syntheticEvent: ChangeEvent = {
      id: fi.id,
      trial_id: fi.entity_id ?? '',
      space_id: '',
      event_type: fi.change_event_type,
      source: fi.change_source ?? 'ctgov',
      payload: fi.change_payload,
      occurred_at: fi.event_date,
      observed_at: fi.observed_at ?? fi.event_date,
      marker_id: null,
      trial_name: fi.entity_name,
      trial_identifier: null,
      asset_name: null,
      company_name: fi.company_name,
      company_logo_url: fi.company_logo_url,
      marker_title: null,
      marker_color: null,
      marker_type_name: null,
      from_marker_type_name: null,
      to_marker_type_name: null,
    };
    return summarySegmentsFor(syntheticEvent);
  });

  readonly highPriorityCount = computed(
    () => this.feedItems().filter((i) => i.priority === 'high').length
  );

  readonly categoryHistogram = computed<CategoryHistogramEntry[]>(() => {
    const counts = new Map<string, number>();
    for (const item of this.feedItems()) {
      counts.set(item.category_name, (counts.get(item.category_name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({
        name,
        count,
        color: CATEGORY_COLOR[name] ?? CATEGORY_COLOR_FALLBACK,
      }))
      .sort((a, b) => b.count - a.count);
  });

  readonly mostRecent = computed<RecentItemSummary[]>(() =>
    this.feedItems()
      .slice()
      .sort((a, b) => b.event_date.localeCompare(a.event_date))
      .slice(0, 3)
      .map((i) => ({ id: i.id, title: i.title, event_date: i.event_date }))
  );

  /**
   * Fetch the annotation body for a detected item. Called when a detected
   * FeedItem with has_annotation=true is selected. The body is not part of
   * the FeedItem (only a boolean flag is), so we query it separately.
   */
  protected async loadAnnotation(changeEventId: string): Promise<void> {
    this.annotationLoading.set(true);
    try {
      const { data, error } = await this.supabase.client
        .from('change_event_annotations')
        .select('id, body, change_event_id, created_at, updated_at')
        .eq('change_event_id', changeEventId)
        .maybeSingle();
      if (this.selectedFeedItem()?.id !== changeEventId) return;
      if (error) throw error;
      this.annotationData.set(data as Annotation | null);
    } catch {
      if (this.selectedFeedItem()?.id !== changeEventId) return;
      this.annotationData.set(null);
    } finally {
      if (this.selectedFeedItem()?.id === changeEventId) {
        this.annotationLoading.set(false);
      }
    }
  }

  protected startAnnotationEdit(currentBody?: string): void {
    this.annotationEditing.set(true);
    this.annotationBody.set(currentBody ?? '');
  }

  protected cancelAnnotationEdit(): void {
    this.annotationEditing.set(false);
    this.annotationBody.set('');
  }

  protected async saveAnnotation(changeEventId: string): Promise<void> {
    const body = this.annotationBody().trim();
    if (!body) return;
    this.annotationSaving.set(true);
    try {
      const result = await this.annotationService.upsert(changeEventId, body);
      this.annotationData.set(result);
      this.annotationEditing.set(false);
      this.annotationBody.set('');
      this.annotationChanged.emit();
    } finally {
      this.annotationSaving.set(false);
    }
  }

  protected async deleteAnnotation(changeEventId: string): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete analyst note',
      message: 'Delete this analyst note? This cannot be undone.',
      requireTypedConfirmation: false,
    });
    if (!ok) return;
    try {
      await this.annotationService.delete(changeEventId);
      this.annotationData.set(null);
      this.annotationChanged.emit();
    } catch {
      // Error handled by service
    }
  }

  /**
   * Extract change detail rows from the payload for the structured
   * before/after card. Returns key/value pairs appropriate to the event type.
   */
  protected getChangeDetailRows(
    item: FeedItem
  ): { label: string; previous: string; current: string }[] {
    const payload = item.change_payload;
    if (!payload) return [];

    const rows: { label: string; previous: string; current: string }[] = [];

    switch (item.change_event_type) {
      case 'date_moved':
        rows.push({
          label: 'Date',
          previous: String(payload['from'] ?? ''),
          current: String(payload['to'] ?? ''),
        });
        if (payload['days_shifted'] != null || payload['days_diff'] != null) {
          const days = payload['days_shifted'] ?? payload['days_diff'];
          rows.push({
            label: 'Shift',
            previous: '',
            current: `${Math.abs(Number(days))} days ${Number(days) > 0 ? 'later' : 'earlier'}`,
          });
        }
        break;
      case 'status_changed':
        rows.push({
          label: 'Status',
          previous: String(payload['from'] ?? ''),
          current: String(payload['to'] ?? ''),
        });
        break;
      case 'phase_transitioned': {
        const from = Array.isArray(payload['from'])
          ? payload['from'].join('/')
          : String(payload['from'] ?? '');
        const to = Array.isArray(payload['to'])
          ? payload['to'].join('/')
          : String(payload['to'] ?? '');
        rows.push({ label: 'Phase', previous: from, current: to });
        break;
      }
      case 'enrollment_target_changed':
        rows.push({
          label: 'Enrollment target',
          previous: String(payload['from'] ?? ''),
          current: String(payload['to'] ?? ''),
        });
        break;
      case 'sponsor_changed':
        rows.push({
          label: 'Sponsor',
          previous: String(payload['from'] ?? ''),
          current: String(payload['to'] ?? ''),
        });
        break;
      case 'eligibility_changed':
        rows.push({
          label: String(payload['which_field'] ?? 'Eligibility'),
          previous: String(payload['from'] ?? ''),
          current: String(payload['to'] ?? ''),
        });
        break;
      default:
        // Generic: show any from/to values present in the payload
        if (payload['from'] != null || payload['to'] != null) {
          rows.push({
            label: 'Value',
            previous: String(payload['from'] ?? ''),
            current: String(payload['to'] ?? ''),
          });
        }
        break;
    }
    return rows;
  }
}
