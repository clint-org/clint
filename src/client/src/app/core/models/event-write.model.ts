// Unified Event write contract (the cutover's create_event / update_event RPCs).
// Shared by the merged Event form (feature) and EventService (core).

export type AnchorType = 'space' | 'company' | 'asset' | 'trial';
export type DatePrecision = 'exact' | 'month' | 'quarter' | 'half' | 'year';
export type Projection = 'actual' | 'company' | 'primary' | 'forecasted';

/** Args for create_event, minus p_space_id (the service supplies it). */
export interface CreateEventArgs {
  p_event_type_id: string;
  p_title: string;
  p_event_date: string;
  p_anchor_type: AnchorType;
  p_anchor_id: string | null;
  p_projection: Projection;
  p_date_precision: DatePrecision;
  p_end_date: string | null;
  p_end_date_precision: DatePrecision;
  p_is_ongoing: boolean;
  p_description: string | null;
  p_significance: 'high' | 'low' | null;
  p_visibility: 'pinned' | 'hidden' | null;
  p_sources: { url: string; label: string | null }[] | null;
}

/**
 * Args for update_event. Includes type + anchor (re-anchor on edit, user decision
 * 2026-06-29); the backend update_event RPC extension is owned by the cutover/DB session.
 */
export interface UpdateEventArgs {
  p_event_type_id: string;
  p_anchor_type: AnchorType;
  p_anchor_id: string | null;
  p_title: string;
  p_event_date: string;
  p_projection: Projection;
  p_date_precision: DatePrecision;
  p_end_date: string | null;
  p_end_date_precision: DatePrecision;
  p_is_ongoing: boolean;
  p_description: string | null;
  p_significance: 'high' | 'low' | null;
  p_visibility: 'pinned' | 'hidden' | null;
  p_no_longer_expected: boolean;
}
