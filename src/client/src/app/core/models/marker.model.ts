import type { DatePrecision } from './marker-date-precision';

export type { DatePrecision } from './marker-date-precision';

export interface MarkerCategory {
  id: string;
  space_id: string | null;
  name: string;
  display_order: number;
  is_system: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type MarkerShape =
  | 'circle'
  | 'diamond'
  | 'flag'
  | 'triangle'
  | 'square'
  | 'hexagon'
  | 'dashed-line';
export type FillStyle = 'outline' | 'filled';
export type InnerMark = 'dot' | 'dash' | 'check' | 'x' | 'none';

export interface MarkerType {
  id: string;
  space_id: string | null;
  created_by: string | null;
  category_id: string;
  name: string;
  shape: MarkerShape;
  fill_style: FillStyle;
  color: string;
  inner_mark: InnerMark;
  is_system: boolean;
  display_order: number;
  created_at: string;
  default_significance?: 'high' | 'low' | null;
  marker_categories?: MarkerCategory;
}

export type Projection = 'forecasted' | 'company' | 'primary' | 'actual';

export interface Marker {
  id: string;
  space_id: string;
  created_by: string;
  marker_type_id: string;
  title: string;
  projection: Projection;
  /**
   * Anchor level of the underlying event (`space`/`company`/`asset`/`trial`).
   * Rides through the read paths on the events row (`*` selects and the
   * dashboard RPC's per-anchor event objects). Optional because some legacy
   * read shapes do not surface it; consumers must tolerate its absence.
   * Used by `resolveMarkerVisual` to badge a `primary` projection `p` on
   * non-trial anchors (asset/company), where primary means a non-registry
   * primary source rather than the CT.gov registry default.
   */
  anchor_type?: 'space' | 'company' | 'asset' | 'trial';
  event_date: string;
  date_precision: DatePrecision;
  end_date: string | null;
  end_date_precision: DatePrecision;
  is_ongoing: boolean;
  description: string | null;
  /**
   * Legacy single citation column. Retained until S5 drops it. New writes go
   * through `event_sources` (see `sources`); displays prefer `sources` /
   * `registry_url` and fall back to this only mid-transition.
   */
  source_url: string | null;
  /**
   * Attached citations from `event_sources`, ordered by `sort_order`. Present
   * on reads that embed the citations (e.g. `EVENTS_SELECT` via
   * `mapEventToMarker`). The manage form maps its single Source URL field to
   * one entry here.
   */
  sources?: { url: string; label: string | null }[];
  /**
   * Derived ClinicalTrials.gov link for trial-anchored events, emitted by the
   * read RPCs from the anchor trial's identifier. Never stored; absent on read
   * paths (like `get_dashboard_data`) that do not yet derive it.
   */
  registry_url?: string | null;
  metadata: Record<string, unknown> | null;
  is_projected: boolean;
  no_longer_expected: boolean;
  significance?: 'high' | 'low' | null;
  visibility?: 'pinned' | 'hidden' | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  marker_types?: MarkerType;
  marker_assignments?: MarkerAssignment[];
}

export interface MarkerAssignment {
  id: string;
  marker_id: string;
  trial_id: string;
  created_at: string;
  trials?: { id: string; name: string; identifier: string | null };
}
