export type ChangeEventSource = 'ctgov' | 'analyst';

export type ChangeEventType =
  | 'status_changed'
  | 'date_moved'
  | 'phase_transitioned'
  | 'enrollment_target_changed'
  | 'arm_added'
  | 'arm_removed'
  | 'intervention_changed'
  | 'outcome_measure_changed'
  | 'sponsor_changed'
  | 'eligibility_criteria_changed'
  | 'eligibility_changed'
  | 'trial_withdrawn'
  | 'marker_added'
  | 'projection_finalized'
  | 'marker_reclassified'
  | 'marker_updated'
  | 'marker_removed';

export interface ChangeEvent {
  id: string;
  trial_id: string;
  space_id: string;
  event_type: ChangeEventType;
  source: ChangeEventSource;
  payload: Record<string, unknown>;
  occurred_at: string;
  observed_at: string;
  marker_id: string | null;
  // joined for display
  trial_name: string;
  trial_identifier: string | null;
  product_name: string | null;
  company_name: string | null;
  marker_title: string | null;
  marker_color: string | null;
  marker_type_name: string | null;
  from_marker_type_name: string | null;
  to_marker_type_name: string | null;
}

export interface ActivityFeedFilters {
  event_types?: ChangeEventType[];
  sources?: ChangeEventSource[];
  trial_ids?: string[];
  date_range?: '7d' | '30d' | 'all';
  whitelist?: 'high_signal';
}

export interface ActivityFeedCursor {
  observed_at: string;
  id: string;
}

export interface ActivityFeedPage {
  events: ChangeEvent[];
  next_cursor: ActivityFeedCursor | null;
}

export interface MarkerChangeRow {
  id: string;
  marker_id: string;
  change_type: 'created' | 'updated' | 'deleted';
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  changed_at: string;
  changed_by_email: string | null;
}
