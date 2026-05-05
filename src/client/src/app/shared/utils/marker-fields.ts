/**
 * Single source of truth for how the *fields of a marker* present to a user:
 * the human label for each column, the projection enum vocabulary, and a
 * value formatter that knows which fields are dates vs booleans vs enums.
 *
 * Consumers:
 *  - marker-detail-content.component.ts (History pane: per-field diff rows)
 *  - change-event-summary.ts (activity feed / what-changed / intelligence
 *    feed: marker_updated comma-list, projection enum lookups)
 *  - any future surface that renders a marker field name or value
 *
 * Keep this map a superset of every field that any surface displays so that
 * the same column reads the same way everywhere.
 */

export const MARKER_FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  event_date: 'Event date',
  end_date: 'End date',
  recruitment_status: 'Recruitment status',
  is_projected: 'Projected',
  projection: 'Projection source',
  no_longer_expected: 'No longer expected',
  source_url: 'Source URL',
};

export const MARKER_DATE_FIELDS: ReadonlySet<string> = new Set(['event_date', 'end_date']);
export const MARKER_BOOL_FIELDS: ReadonlySet<string> = new Set([
  'is_projected',
  'no_longer_expected',
]);

export const PROJECTION_LABEL: Record<string, string> = {
  actual: 'Confirmed actual',
  stout: 'Projected · Stout estimate',
  company: 'Projected · Company guidance',
  primary: 'Projected · Primary source estimate',
};

/**
 * Format a single value the way it should appear in a diff cell or summary.
 * Returns null when the value is empty/missing so callers can render a dash
 * or skip the cell.
 */
export function formatMarkerFieldValue(field: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (MARKER_DATE_FIELDS.has(field) && typeof value === 'string') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
    }
  }
  if (MARKER_BOOL_FIELDS.has(field)) return value ? 'Yes' : 'No';
  if (field === 'projection' && typeof value === 'string') {
    return PROJECTION_LABEL[value] ?? value;
  }
  return String(value);
}

/**
 * Format an ISO date string as "Mar 15, 2026". Returns the original string
 * if it doesn't parse. Used by date-bearing summary lines.
 */
export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Format a (from -> to) date pair as "Mar 15 → Jul 13, 2026" when both dates
 * fall in the same year, or "Oct 1, 2027 → Mar 29, 2028" when they don't.
 * Falls back to the raw strings (or "?") on missing/unparseable input so the
 * caller never has to defend against bad payloads.
 */
export function formatDateRange(from: unknown, to: unknown): string {
  const fromStr = typeof from === 'string' && from.length > 0 ? from : null;
  const toStr = typeof to === 'string' && to.length > 0 ? to : null;
  if (!fromStr || !toStr) return `${fromStr ?? '?'} → ${toStr ?? '?'}`;
  const fromDate = new Date(fromStr);
  const toDate = new Date(toStr);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return `${fromStr} → ${toStr}`;
  }
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  const optsWithYear: Intl.DateTimeFormatOptions = { ...opts, year: 'numeric' };
  const sameYear = fromDate.getUTCFullYear() === toDate.getUTCFullYear();
  if (sameYear) {
    return `${fromDate.toLocaleDateString('en-US', opts)} → ${toDate.toLocaleDateString('en-US', optsWithYear)}`;
  }
  return `${fromDate.toLocaleDateString('en-US', optsWithYear)} → ${toDate.toLocaleDateString('en-US', optsWithYear)}`;
}
