/**
 * Fuzzy / approximate marker dates.
 *
 * A catalyst is often only known to a quarter ("Q4 2026"), a month, a half, or
 * a year. The timeline axis is exact-date, so we store the period MIDPOINT in
 * `markers.event_date` (a real date the axis can place) plus a `date_precision`
 * enum that records how precise that date actually is. The UI then renders the
 * period label ("~Q4 '26") and an "(estimated)" affordance instead of a false
 * exact day, and the marker form re-derives the period selectors from the
 * stored midpoint when editing.
 *
 * This module is the single source of truth for the midpoint math and the
 * label derivation. It is pure (no Angular) so the node unit runner tests it.
 */

export type DatePrecision = 'exact' | 'month' | 'quarter' | 'half' | 'year';

export const DATE_PRECISIONS: readonly DatePrecision[] = [
  'exact',
  'month',
  'quarter',
  'half',
  'year',
];

export const DATE_PRECISION_LABELS: Record<DatePrecision, string> = {
  exact: 'Exact date',
  month: 'Month',
  quarter: 'Quarter',
  half: 'Half (H1/H2)',
  year: 'Year',
};

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function isApproximate(precision: DatePrecision | null | undefined): boolean {
  return !!precision && precision !== 'exact';
}

/** Parse a 'YYYY-MM-DD' date string into numeric parts without timezone drift. */
function isoParts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  return { y, m, d };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * The representative MIDPOINT date stored in `event_date` for an approximate
 * period. `sub` is the 1-based quarter (1-4), month (1-12), or half (1-2);
 * ignored for year. Throws for 'exact' (the form keeps the user's real date).
 */
export function precisionMidpointISO(
  precision: Exclude<DatePrecision, 'exact'>,
  year: number,
  sub: number
): string {
  switch (precision) {
    case 'month':
      return `${year}-${pad2(sub)}-15`;
    case 'quarter': {
      // middle month of the quarter: Q1->Feb, Q2->May, Q3->Aug, Q4->Nov
      const middleMonth = (sub - 1) * 3 + 2;
      return `${year}-${pad2(middleMonth)}-15`;
    }
    case 'half':
      // H1 (Jan-Jun) -> Apr 1; H2 (Jul-Dec) -> Oct 1
      return sub === 1 ? `${year}-04-01` : `${year}-10-01`;
    case 'year':
      return `${year}-07-01`;
  }
}

/**
 * The compact period label for an approximate marker, derived from its stored
 * midpoint + precision (e.g. "Q4 '26", "Nov '26", "H2 '26", "2026"). Returns
 * null for exact dates (the caller renders the real date). No '~' prefix --
 * callers add it where the approximate affordance belongs.
 */
export function markerPeriodLabel(
  eventDateISO: string | null | undefined,
  precision: DatePrecision | null | undefined
): string | null {
  if (!isApproximate(precision) || !eventDateISO) return null;
  const { y, m } = isoParts(eventDateISO);
  const yy = String(y).slice(-2);
  switch (precision) {
    case 'month':
      return `${MONTHS[m - 1]} '${yy}`;
    case 'quarter':
      return `Q${Math.floor((m - 1) / 3) + 1} '${yy}`;
    case 'half':
      return `H${m <= 6 ? 1 : 2} '${yy}`;
    case 'year':
      return `${y}`;
    default:
      return null;
  }
}

/**
 * Recover the {year, sub} period selectors from a stored midpoint, so the
 * marker form can repopulate its pickers when editing an approximate marker.
 */
export function markerPeriodFromDate(
  eventDateISO: string,
  precision: DatePrecision
): { year: number; sub: number } {
  const { y, m } = isoParts(eventDateISO);
  switch (precision) {
    case 'month':
      return { year: y, sub: m };
    case 'quarter':
      return { year: y, sub: Math.floor((m - 1) / 3) + 1 };
    case 'half':
      return { year: y, sub: m <= 6 ? 1 : 2 };
    default:
      return { year: y, sub: 1 };
  }
}
