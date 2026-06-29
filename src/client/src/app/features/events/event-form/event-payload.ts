// Pure builders + helpers for the merged Event form. No Angular, no Supabase.
// Aligned to the SHIPPED RPC contracts on the cutover tip:
//   create_event(p_space_id, p_event_type_id, p_title, p_event_date, p_anchor_type, p_anchor_id,
//     p_projection, p_date_precision, p_end_date, p_end_date_precision, p_is_ongoing,
//     p_description, p_source_url, p_significance, p_visibility, p_source_doc_id, p_sources jsonb)
//   update_event(p_event_id, p_title, p_event_date, p_projection, p_date_precision, p_end_date,
//     p_end_date_precision, p_is_ongoing, p_description, p_source_url, p_significance, p_visibility,
//     p_no_longer_expected)   <-- note: update_event does NOT change event_type or anchor.

export type AnchorType = 'space' | 'company' | 'asset' | 'trial';
export type DatePrecision = 'exact' | 'month' | 'quarter' | 'half' | 'year';
export type Extent = 'point' | 'until' | 'onwards';
export type Projection = 'actual' | 'company' | 'primary' | 'forecasted';
export type SignificanceChoice = 'Default' | 'High' | 'Low';
export type VisibilityChoice = 'Default' | 'Pinned' | 'Hidden';

export interface SourceRow {
  url: string;
  label: string;
}

export interface EventFormState {
  eventTypeId: string | null;
  anchorType: AnchorType;
  anchorId: string | null;
  title: string;
  eventDate: string; // resolved ISO (already midpoint-resolved for fuzzy precisions)
  datePrecision: DatePrecision;
  extent: Extent;
  endDate: string | null;
  endDatePrecision: DatePrecision;
  projection: Projection;
  significance: SignificanceChoice;
  visibility: VisibilityChoice;
  noLongerExpected: boolean;
  description: string;
  sources: SourceRow[];
}

// Args for create_event, minus p_space_id/p_source_doc_id/p_source_url (service supplies/null).
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

// Args for update_event (mutable fields only; no type/anchor change).
export interface UpdateEventArgs {
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

export const PROJECTION_OPTIONS: { label: string; value: Projection }[] = [
  { label: 'Confirmed actual', value: 'actual' },
  { label: 'Company guidance', value: 'company' },
  { label: 'Primary intelligence', value: 'primary' },
  { label: 'Forecasted', value: 'forecasted' },
];

export function significanceValue(choice: SignificanceChoice): 'high' | 'low' | null {
  if (choice === 'High') return 'high';
  if (choice === 'Low') return 'low';
  return null;
}

export function visibilityValue(choice: VisibilityChoice): 'pinned' | 'hidden' | null {
  if (choice === 'Pinned') return 'pinned';
  if (choice === 'Hidden') return 'hidden';
  return null;
}

function endFields(s: EventFormState): { end: string | null; precision: DatePrecision; ongoing: boolean } {
  if (s.extent === 'until') return { end: s.endDate, precision: s.endDatePrecision, ongoing: false };
  if (s.extent === 'onwards') return { end: null, precision: 'exact', ongoing: true };
  return { end: null, precision: 'exact', ongoing: false };
}

function sourcesJsonb(rows: SourceRow[]): { url: string; label: string | null }[] | null {
  const clean = rows
    .filter((r) => r.url.trim())
    .map((r) => ({ url: r.url.trim(), label: r.label.trim() || null }));
  return clean.length ? clean : null;
}

export function buildCreateEventArgs(s: EventFormState): CreateEventArgs {
  const e = endFields(s);
  return {
    p_event_type_id: s.eventTypeId!,
    p_title: s.title.trim(),
    p_event_date: s.eventDate,
    p_anchor_type: s.anchorType,
    p_anchor_id: s.anchorType === 'space' ? null : s.anchorId,
    p_projection: s.projection,
    p_date_precision: s.datePrecision,
    p_end_date: e.end,
    p_end_date_precision: e.precision,
    p_is_ongoing: e.ongoing,
    p_description: s.description.trim() || null,
    p_significance: significanceValue(s.significance),
    p_visibility: visibilityValue(s.visibility),
    p_sources: sourcesJsonb(s.sources),
  };
}

export function buildUpdateEventArgs(s: EventFormState): UpdateEventArgs {
  const e = endFields(s);
  return {
    p_title: s.title.trim(),
    p_event_date: s.eventDate,
    p_projection: s.projection,
    p_date_precision: s.datePrecision,
    p_end_date: e.end,
    p_end_date_precision: e.precision,
    p_is_ongoing: e.ongoing,
    p_description: s.description.trim() || null,
    p_significance: significanceValue(s.significance),
    p_visibility: visibilityValue(s.visibility),
    p_no_longer_expected: s.noLongerExpected,
  };
}

// Period sub-divisions per fuzzy precision (0-based value -> label).
export const PERIOD_SUBS: Record<'month' | 'quarter' | 'half', { label: string; value: number }[]> = {
  month: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(
    (label, value) => ({ label, value }),
  ),
  quarter: ['Q1', 'Q2', 'Q3', 'Q4'].map((label, value) => ({ label, value })),
  half: ['H1', 'H2'].map((label, value) => ({ label, value })),
};

/** Resolve a fuzzy period to the midpoint ISO date the timeline renders at. */
export function resolvePeriodMidpoint(
  precision: DatePrecision,
  year: number,
  sub: number,
  exactDate: string,
): string {
  const yyyy = String(year).padStart(4, '0');
  if (precision === 'exact') return exactDate;
  if (precision === 'year') return `${yyyy}-07-02`;
  if (precision === 'half') return sub === 0 ? `${yyyy}-04-01` : `${yyyy}-10-01`;
  if (precision === 'quarter') return `${yyyy}-${['02', '05', '08', '11'][sub] ?? '02'}-15`;
  return `${yyyy}-${String(sub + 1).padStart(2, '0')}-15`;
}

/** Detail/compact display text for a source row: label, else the URL host (D1 decision). */
export function sourceDisplay(row: { url: string; label: string | null }): string {
  if (row.label && row.label.trim()) return row.label.trim();
  try {
    return new URL(row.url).host;
  } catch {
    return row.url;
  }
}

/** Validity: type + title + (space-anchor OR entity) + (extent=until -> end >= start). */
export function isEventFormValid(s: EventFormState): boolean {
  if (!s.eventTypeId) return false;
  if (!s.title.trim()) return false;
  if (s.anchorType !== 'space' && !s.anchorId) return false;
  if (s.extent === 'until') {
    if (!s.endDate) return false;
    if (s.endDate < s.eventDate) return false;
  }
  return true;
}
