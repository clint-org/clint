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
import { ConfirmationService, MenuItem } from 'primeng/api';

import { CatalystDetail } from '../../core/models/event-detail.model';
import { EventCategoryDistribution, EventDetail, FeedItem } from '../../core/models/event.model';
import type { InnerMark, MarkerShape } from '../../core/models/marker.model';
import {
  ProjectionBadge,
  projectionBadge,
  projectionOutlineDash,
} from '../../core/models/marker-visual';
import { MarkerIconComponent } from '../../shared/components/svg-icons/marker-icon.component';
import { AnnotationService, Annotation } from '../../core/services/annotation.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { MarkerDetailContentComponent } from '../../shared/components/marker-detail-content.component';
import { MaterialsSectionComponent } from '../../shared/components/materials-section/materials-section.component';
import { DetailPanelEmptyStateComponent } from '../../shared/components/detail-panel-empty-state.component';
import { DetailPanelEntityLinkDirective } from '../../shared/components/detail-panel-entity-link.directive';
import { DetailPanelEntityListComponent } from '../../shared/components/detail-panel-entity-list.component';
import { DetailPanelEntityRowComponent } from '../../shared/components/detail-panel-entity-row.component';
import { DetailPanelPillComponent } from '../../shared/components/detail-panel-pill.component';
import { DetailPanelSectionComponent } from '../../shared/components/detail-panel-section.component';
import { DetailPanelShellComponent } from '../../shared/components/detail-panel-shell.component';
import { ExternalLinkComponent } from '../../shared/components/external-link.component';
import { SourceProvenanceLineComponent } from '../../shared/components/source-provenance/source-provenance-line.component';
import { BrandLogoComponent } from '../../shared/components/brand-logo.component';
import { RowActionsComponent } from '../../shared/components/row-actions.component';
import { LoaderComponent } from '../../shared/components/loader/loader.component';
import {
  feedItemToChangeEvent,
  flattenSummarySegments,
  summarySegmentsFor,
  type RichSummary,
} from '../../shared/utils/change-event-summary';
import { confirmDelete } from '../../shared/utils/confirm-delete';
import { buildEntityActionMenu } from '../../shared/entity-actions/entity-action-menu';
import { sourceDisplay } from './event-form/event-payload';

interface CategoryHistogramEntry {
  name: string;
  count: number;
  color: string;
  /** Share of the largest category, 0-100, for the distribution bar width. */
  sharePct: number;
  /** Marker glyph for marker categories; null for event/detected categories. */
  glyph: { shape: MarkerShape; color: string; innerMark: InnerMark; projected: boolean } | null;
}

interface RecentItemSummary {
  id: string;
  title: string;
  event_date: string;
  /** Marker glyph for marker rows; null otherwise. */
  glyph: {
    shape: MarkerShape;
    color: string;
    innerMark: InnerMark;
    projected: boolean;
    projectionBadge: ProjectionBadge;
    outlineDash: boolean;
  } | null;
  isProjected: boolean | null;
  sourceType: FeedItem['source_type'];
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
    DetailPanelEntityLinkDirective,
    DetailPanelEntityListComponent,
    DetailPanelEntityRowComponent,
    DetailPanelPillComponent,
    DetailPanelSectionComponent,
    DetailPanelShellComponent,
    ExternalLinkComponent,
    MarkerDetailContentComponent,
    MaterialsSectionComponent,
    MarkerIconComponent,
    RowActionsComponent,
    LoaderComponent,
    SourceProvenanceLineComponent,
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

  /**
   * Overview aggregates for the empty-state pane, computed server-side over the
   * FULL filtered set (not the loaded page): the category distribution, the
   * 3 most recent rows, the matching-row total, and the high-priority count.
   */
  readonly distribution = input<EventCategoryDistribution[]>([]);
  readonly recentItems = input<FeedItem[]>([]);
  readonly overviewTotal = input<number>(0);
  readonly overviewHighPriority = input<number>(0);

  readonly edit = output<void>();
  readonly delete = output<void>();
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

  /** Citation display text: label, else the URL host (D1 host-fallback). */
  protected sourceLabel(src: { url: string; label: string | null }): string {
    return sourceDisplay(src);
  }

  protected readonly isDetected = computed(
    () => this.selectedFeedItem()?.source_type === 'detected'
  );

  readonly hasSelection = computed(
    () => !!this.detail() || !!this.catalystDetail() || this.isDetected()
  );

  /**
   * Shared overflow kebab for the panel header. Edit is offered for any
   * editable, non-detected selection (the parent routes marker edits to the
   * trial page). Delete is offered only for an actual event selection -- a
   * marker is deleted on its trial, not from this panel.
   */
  protected readonly headerMenu = computed<MenuItem[]>(() => {
    if (!this.canEdit() || this.isDetected() || !this.hasSelection()) return [];
    if (this.detail()) {
      return buildEntityActionMenu({
        canEdit: true,
        editLabel: 'Edit event',
        onEdit: () => this.edit.emit(),
        onDelete: () => this.delete.emit(),
      });
    }
    return [{ label: 'Edit', icon: 'fa-solid fa-pen', command: () => this.edit.emit() }];
  });

  /**
   * Marker glyph for the panel header when a MARKER-source row is selected,
   * mirroring the timeline marker detail pane (which leads its header with
   * app-marker-icon). Null for event / detected selections, which lead with no
   * glyph -- matching how the events table marks marker rows alone.
   */
  protected readonly selectedMarkerGlyph = computed<{
    shape: MarkerShape;
    color: string;
    innerMark: InnerMark;
    projected: boolean;
    projectionBadge: ProjectionBadge;
    outlineDash: boolean;
  } | null>(() => {
    const fi = this.selectedFeedItem();
    if (!fi || fi.source_type !== 'marker' || !fi.marker_type_shape) return null;
    return {
      shape: fi.marker_type_shape,
      color: fi.marker_type_color ?? CATEGORY_COLOR_FALLBACK,
      innerMark: fi.marker_type_inner_mark ?? ('none' as InnerMark),
      projected: !!fi.is_projected,
      projectionBadge: projectionBadge(fi.projection),
      outlineDash: projectionOutlineDash(fi.projection),
    };
  });

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
    return summarySegmentsFor(feedItemToChangeEvent(fi, this.spaceId()));
  });

  readonly highPriorityCount = computed(() => this.overviewHighPriority());

  // Distribution is server-aggregated over the full filtered set (already sorted
  // by count desc); map it to the bar's view model. Event/detected categories
  // have no marker glyph and fall back to the static category palette.
  readonly categoryHistogram = computed<CategoryHistogramEntry[]>(() => {
    const entries = this.distribution();
    const max = Math.max(1, ...entries.map((e) => e.count));
    return entries.map((e) => ({
      name: e.name,
      count: e.count,
      color: e.category_color ?? CATEGORY_COLOR[e.name] ?? CATEGORY_COLOR_FALLBACK,
      sharePct: Math.round((e.count / max) * 100),
      glyph: e.marker_type_shape
        ? {
            shape: e.marker_type_shape,
            color: e.marker_type_color ?? CATEGORY_COLOR_FALLBACK,
            innerMark: e.marker_type_inner_mark ?? ('none' as InnerMark),
            projected: false,
          }
        : null,
    }));
  });

  // Server returns the 3 latest rows by event_date over the full filtered set.
  readonly mostRecent = computed<RecentItemSummary[]>(() =>
    this.recentItems().map((i) => ({
      id: i.id,
      // Detected rows carry a generic event-type title ("Marker Added");
      // compose the same rich summary the table shows so the row is useful.
      title:
        i.source_type === 'detected' && i.change_event_type
          ? flattenSummarySegments(summarySegmentsFor(feedItemToChangeEvent(i)).segments)
          : i.title,
      event_date: i.event_date,
      sourceType: i.source_type,
      isProjected: i.is_projected,
      glyph:
        i.source_type === 'marker' && i.marker_type_shape
          ? {
              shape: i.marker_type_shape,
              color: i.marker_type_color ?? CATEGORY_COLOR_FALLBACK,
              innerMark: i.marker_type_inner_mark ?? ('none' as InnerMark),
              projected: !!i.is_projected,
              projectionBadge: projectionBadge(i.projection),
              outlineDash: projectionOutlineDash(i.projection),
            }
          : null,
    }))
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
   * The WAS -> NOW date diff for a detected `date_moved` change, with a
   * directional shift label. Drives the amber diff-hero card so a slipped
   * projection reads at a glance (later = bad = down arrow). Null for any
   * non-date change.
   */
  protected readonly dateDiff = computed<{
    was: string;
    now: string;
    shift: string;
    later: boolean;
  } | null>(() => {
    const item = this.selectedFeedItem();
    if (!item || item.source_type !== 'detected' || item.change_event_type !== 'date_moved') {
      return null;
    }
    const payload = item.change_payload ?? {};
    const was = payload['from'] != null ? String(payload['from']) : '';
    const now = payload['to'] != null ? String(payload['to']) : '';
    if (!was || !now) return null;
    const raw = payload['days_shifted'] ?? payload['days_diff'];
    const days = raw == null ? NaN : Number(raw);
    const later = Number.isFinite(days) ? days > 0 : now > was;
    const shift = Number.isFinite(days)
      ? `${Math.abs(days)} days ${days > 0 ? 'later' : 'earlier'}`
      : 'date moved';
    return { was, now, shift, later };
  });

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
