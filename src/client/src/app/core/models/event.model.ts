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

export type EventPriority = 'high' | 'low';

export type EntityLevel = 'space' | 'company' | 'product' | 'trial';

export interface AppEvent {
  id: string;
  space_id: string;
  company_id: string | null;
  product_id: string | null;
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
}

/** A row returned by get_events_page_data RPC (event or marker). */
export interface FeedItem {
  source_type: 'event' | 'marker';
  id: string;
  title: string;
  event_date: string;
  category_name: string;
  category_id: string;
  priority: EventPriority | null;
  entity_level: EntityLevel;
  entity_name: string;
  entity_id: string | null;
  company_name: string | null;
  tags: string[];
  has_thread: boolean;
  thread_id: string | null;
  description: string | null;
  source_url: string | null;
}

/** Full event detail returned by get_event_detail RPC. */
export interface EventDetail {
  id: string;
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
  category: { id: string; name: string };
  entity_level: EntityLevel;
  entity_name: string;
  entity_id: string | null;
  company_name: string | null;
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
  categoryIds: string[];
  tags: string[];
  priority: EventPriority | null;
  sourceType: 'event' | 'marker' | null;
}
