import type { DatePrecision, InnerMark, MarkerShape } from './marker.model';

export interface Catalyst {
  marker_id: string;
  title: string;
  event_date: string;
  date_precision: DatePrecision;
  end_date: string | null;
  end_date_precision: DatePrecision;
  is_ongoing: boolean;
  category_name: string;
  category_id: string;
  marker_type_name: string;
  marker_type_color: string;
  marker_type_shape: MarkerShape;
  marker_type_inner_mark: InnerMark;
  is_projected: boolean;
  /**
   * Projection tier ('actual' | 'company' | 'primary' | 'forecasted'), carried
   * from the dashboard/flatten so catalyst glyphs render the same projection
   * badge ('c'/'f') as the timeline row. 'actual' for confirmed dates.
   */
  projection: string;
  no_longer_expected: boolean;
  company_name: string | null;
  company_id: string | null;
  /**
   * The owning company's logo (companies.logo_url), threaded from the dashboard
   * data the catalyst list flattens from. Optional so a catalyst built from a
   * payload without it renders the initial-tile fallback.
   */
  company_logo_url?: string | null;
  asset_name: string | null;
  asset_id: string | null;
  trial_name: string | null;
  trial_acronym: string | null;
  trial_id: string | null;
  trial_phase: string | null;
  description: string | null;
  /**
   * Legacy single citation column. Retained until S5 drops it. Reads prefer
   * `sources` / `registry_url`; this is the mid-transition fallback.
   */
  source_url: string | null;
  /**
   * Attached citations from `event_sources` ({url, label}), emitted by the
   * read RPCs (e.g. get_event_detail). Optional: dashboard-flattened rows
   * may carry only `source_url` until that RPC derives them.
   */
  sources?: { id?: string; url: string; label: string | null }[];
  /**
   * Derived ClinicalTrials.gov link for trial-anchored markers, emitted by the
   * read RPCs from the anchor trial's identifier. Never stored.
   */
  registry_url?: string | null;
  /**
   * Change-feed badge fields propagated from the catalyst's parent trial
   * (via the dashboard data the catalyst list flattens from). Optional so
   * any catalyst built from a payload without these fields renders no badge.
   */
  trial_recent_changes_count?: number;
  trial_most_recent_change_type?: string | null;
  trial_most_recent_change_event_id?: string | null;
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
    company_logo_url: string | null;
    /**
     * Unified-event keys the merged Event form reads for edit-hydration and the
     * events-page flat unwrap (added to get_event_detail in Stage 3). anchor_type
     * is the events.anchor_type enum; significance / visibility are the raw event
     * qualifier values (null = default).
     */
    event_id: string;
    event_type_id: string;
    anchor_type: 'space' | 'company' | 'asset' | 'trial';
    anchor_id: string | null;
    significance: 'high' | 'low' | null;
    visibility: 'pinned' | 'hidden' | null;
    space_id: string;
    created_at: string;
    updated_at: string;
    /**
     * Import provenance: the source_documents row this marker landed from when
     * created by an AI import. Null for manually created markers.
     */
    source_doc_id: string | null;
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
  /** Future events sharing this event's anchor (parent asset / company / space), soonest first. */
  upcoming_markers: UpcomingMarker[];
  /** Past events sharing this event's anchor, most-recent first. Symmetric with upcoming_markers. */
  recent_markers: UpcomingMarker[];
  related_events: RelatedEvent[];
}

export interface UpcomingMarker {
  marker_id: string;
  title: string;
  event_date: string;
  marker_type_name: string;
  marker_type_color: string;
  marker_type_shape: MarkerShape;
  marker_type_inner_mark: InnerMark;
  /**
   * Owning trial of a trial-anchored context row (acronym preferred, name
   * fallback). Null for asset- and company-anchored rows, which the pane
   * leaves unlabeled since the asset is already the pane's subject.
   */
  trial_acronym: string | null;
  trial_name: string | null;
  is_projected: boolean;
  projection: string | null;
  no_longer_expected: boolean;
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
