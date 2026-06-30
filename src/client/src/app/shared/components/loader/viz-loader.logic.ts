/**
 * Min-display timing for the visualization-page loader. Extracted as a pure
 * function so the timing rule is unit-testable without rendering the component
 * (units run in plain node and cannot TestBed-render an Angular template).
 */

/** Once shown, the loader stays up at least this long so fast loads don't flash. */
export const VIZ_LOADER_MIN_DISPLAY_MS = 400;

/**
 * Milliseconds to wait before hiding the loader. Returns 0 to hide immediately
 * (the minimum window has already elapsed, or the loader was never shown).
 *
 * @param shownAt timestamp the loader became visible, or null if not shown
 * @param now current timestamp, same clock as `shownAt`
 * @param minMs minimum display window
 */
export function loaderHideDelay(
  shownAt: number | null,
  now: number,
  minMs: number = VIZ_LOADER_MIN_DISPLAY_MS
): number {
  if (shownAt === null) return 0;
  const remaining = minMs - (now - shownAt);
  return remaining > 0 ? remaining : 0;
}
