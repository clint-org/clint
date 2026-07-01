/**
 * Date-range column filter helpers, shared by the grid state and any list that
 * renders a range date-picker as a column filter. Kept pure and free of Angular
 * DI so the conversion can be unit-tested directly.
 *
 * The grid's date FilterValue stores `from`/`to` as YYYY-MM-DD strings (so it
 * round-trips through the URL). A PrimeNG range p-datepicker emits Date objects,
 * so its value must be normalized to those strings before it enters grid state.
 */

/** Format a Date to a LOCAL YYYY-MM-DD (never UTC), avoiding a TZ day-shift. */
export function toLocalIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD string into a LOCAL Date (midnight), or null if invalid. */
export function parseLocalIsoDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Normalize a PrimeNG date-filter value (a `[start, end]` array of Date objects
 * from a range picker, or already-serialized YYYY-MM-DD strings) into the grid's
 * `{from, to}` shape. Returns null when both ends are empty so the filter clears.
 */
export function normalizeDateFilterValue(
  raw: unknown
): { from: string | null; to: string | null } | null {
  if (!Array.isArray(raw)) return null;
  const fmt = (v: unknown): string | null => {
    if (v == null || v === '') return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : toLocalIsoDate(v);
    return String(v);
  };
  const from = fmt(raw[0]);
  const to = fmt(raw[1]);
  if (from === null && to === null) return null;
  return { from, to };
}

/**
 * The inverse for rendering: turn the grid's stored `[from, to]` strings (the
 * value a `#filter` template receives) back into Date objects for the range
 * p-datepicker's ngModel. Returns null when nothing is set.
 */
export function toDatePickerRange(value: unknown): Date[] | null {
  if (!Array.isArray(value)) return null;
  const out: Date[] = [];
  for (const v of value) {
    if (v == null || v === '') continue;
    const d = v instanceof Date ? v : parseLocalIsoDate(String(v));
    if (d && !Number.isNaN(d.getTime())) out.push(d);
  }
  return out.length ? out : null;
}
