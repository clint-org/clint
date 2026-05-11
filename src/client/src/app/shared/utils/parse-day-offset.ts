/**
 * Parse a "Nd" shorthand (e.g. "7d", "30d") into a number of days.
 * Returns null for unrecognised values so callers can skip silently.
 */
export function parseDayOffset(value: string): number | null {
  const m = /^(\d+)d$/i.exec(value.trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
