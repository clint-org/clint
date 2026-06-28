export interface EventCategory {
  id: string;
  space_id: string | null;
  name: string;
  display_order: number;
  is_system: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventThread {
  id: string;
  space_id: string;
  title: string;
  created_by: string | null;
  created_at: string;
}

export interface EventSource {
  id: string;
  event_id: string;
  url: string;
  label: string | null;
  created_at: string;
}

export interface EventLink {
  id: string;
  source_event_id: string;
  target_event_id: string;
  created_by: string | null;
  created_at: string;
}

import { ChangeEventSource, ChangeEventType } from './change-event.model';
import type { InnerMark, MarkerShape } from './marker.model';

export type EventPriority = 'high' | 'low';

export type EntityLevel = 'space' | 'company' | 'product' | 'trial';

/**
 * One category bucket of the events overview distribution, aggregated by
 * get_events_page_data over the FULL filtered set (not just the loaded page).
 * Marker fields carry a representative marker's glyph so the share bar can be
 * drawn for marker categories; they are null for event / detected categories.
 */
export interface EventCategoryDistribution {
  name: string;
  count: number;
  marker_type_shape: MarkerShape | null;
  marker_type_color: string | null;
  marker_type_inner_mark: InnerMark | null;
  category_color: string | null;
}

/**
 * Full response of get_events_page_data: the page of `items`, plus overview
 * aggregates computed server-side over the entire filtered set so the overview
 * pane is accurate regardless of how many rows are loaded.
 */
export interface EventsPageData {
  items: FeedItem[];
  total: number;
  highPriorityCount: number;
  distribution: EventCategoryDistribution[];
  recent: FeedItem[];
}

export interface AppEvent {
  id: string;
  space_id: string;
  company_id: string | null;
  asset_id: string | null;
  trial_id: string | null;
  category_id: string;
  thread_id: string | null;
  thread_order: number | null;
  title: string;
  event_date: string;
  description: string | null;
  priority: EventPriority;
  tags: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

/** A row returned by get_events_page_data RPC (event, marker, or detected change). */
export interface FeedItem {
  source_type: 'event' | 'marker' | 'detected';
  id: string;
  title: string;
  feed_ts: string;
  event_date: string;
  category_name: string;
  category_id: string | null;
  priority: EventPriority | null;
  entity_level: EntityLevel;
  entity_name: string;
  entity_id: string | null;
  company_name: string | null;
  company_id: string | null;
  asset_id: string | null;
  asset_name: string | null;
  trial_id: string | null;
  trial_name: string | null;
  tags: string[];
  has_thread: boolean;
  thread_id: string | null;
  description: string | null;
  source_url: string | null;
  change_event_type: ChangeEventType | null;
  change_payload: Record<string, unknown> | null;
  change_source: ChangeEventSource | null;
  has_annotation: boolean;
  observed_at: string | null;
  company_logo_url: string | null;
  /**
   * Marker-taxonomy glyph + projection status. Populated only for
   * source_type === 'marker' (null on event / detected rows): the category
   * cell renders the marker glyph (shape + color + inner mark) and the status
   * column shows a Projected/Confirmed pill. `category_color` colors the
   * overview distribution bar for marker categories (events keep their
   * client-side category palette).
   */
  is_projected: boolean | null;
  marker_type_shape: MarkerShape | null;
  marker_type_color: string | null;
  marker_type_inner_mark: InnerMark | null;
  category_color: string | null;
}

/** Full event detail returned by get_event_detail RPC. */
export interface EventDetail {
  id: string;
  // Import provenance: the source_documents row this event landed from when
  // created by an AI import. Null for manually created events.
  source_doc_id: string | null;
  space_id: string;
  title: string;
  event_date: string;
  description: string | null;
  priority: EventPriority;
  tags: string[];
  thread_id: string | null;
  thread_order: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  category: { id: string; name: string };
  entity_level: EntityLevel;
  entity_name: string;
  entity_id: string | null;
  company_name: string | null;
  company_id: string | null;
  asset_id: string | null;
  sources: { id: string; url: string; label: string | null }[];
  thread: {
    id: string;
    title: string;
    events: { id: string; title: string; event_date: string; thread_order: number }[];
  } | null;
  linked_events: {
    id: string;
    title: string;
    event_date: string;
    category_name: string;
  }[];
}

export interface EventsPageFilters {
  dateFrom: string | null;
  dateTo: string | null;
  entityLevel: EntityLevel | null;
  entityId: string | null;
  // Category display names (event, marker, and synthetic detected categories
  // share a name space). The histogram groups by name and detected categories
  // have no id, so the feed filters by name, not by category id.
  categoryNames: string[];
  tags: string[];
  priority: EventPriority | null;
  sourceType: 'event' | 'marker' | 'detected' | null;
  search: string | null;
  sortField: string | null;
  sortDir: 'asc' | 'desc' | null;
}
