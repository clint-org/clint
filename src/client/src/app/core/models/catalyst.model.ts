export interface Catalyst {
  marker_id: string;
  title: string;
  event_date: string;
  end_date: string | null;
  category_name: string;
  category_id: string;
  marker_type_name: string;
  marker_type_icon: string | null;
  marker_type_color: string;
  marker_type_shape: string;
  is_projected: boolean;
  company_name: string | null;
  company_id: string | null;
  product_name: string | null;
  product_id: string | null;
  trial_name: string | null;
  trial_id: string | null;
  trial_phase: string | null;
  description: string | null;
  source_url: string | null;
  /**
   * Change-feed badge fields propagated from the catalyst's parent trial
   * (via the dashboard data the catalyst list flattens from). Optional so
   * any catalyst built from a payload without these fields renders no badge.
   */
  trial_recent_changes_count?: number;
  trial_most_recent_change_type?: string | null;
}

/**
 * Provenance metadata recorded on auto-derived markers. Set by
 * _seed_ctgov_markers when CT.gov sync creates a Trial Start / PCD /
 * Trial End marker. Manually-created markers have null metadata or a
 * different shape (e.g. {pathway: 'priority'} for FDA Submission rows).
 */
export interface CtgovMarkerMetadata {
  source: 'ctgov';
  field: string;
  snapshot_id: string;
  ctgov_date_type: 'ACTUAL' | 'ANTICIPATED';
}

export interface CatalystDetail {
  catalyst: Catalyst & {
    recruitment_status: string | null;
    projection: string;
    no_longer_expected: boolean;
    company_logo_url: string | null;
    marker_type_inner_mark: string;
    /**
     * Markers metadata jsonb passthrough; see CtgovMarkerMetadata for the
     * auto-derived shape. Other shapes possible for manual markers.
     */
    metadata: Record<string, unknown> | null;
    /**
     * Parent trial's last successful CT.gov sync (null if never synced).
     * Used by the marker-detail provenance block to show freshness.
     */
    ctgov_last_synced_at: string | null;
  };
  upcoming_markers: UpcomingMarker[];
  related_events: RelatedEvent[];
}

export interface UpcomingMarker {
  marker_id: string;
  title: string;
  event_date: string;
  marker_type_name: string;
  is_projected: boolean;
}

export interface RelatedEvent {
  event_id: string;
  title: string;
  event_date: string;
  category_name: string;
}

export interface CatalystGroup {
  label: string;
  date_range: string;
  catalysts: Catalyst[];
}

/** Catalyst with computed time_bucket field for p-table row grouping. */
export interface FlatCatalyst extends Catalyst {
  time_bucket: string;
  time_bucket_range: string;
}
