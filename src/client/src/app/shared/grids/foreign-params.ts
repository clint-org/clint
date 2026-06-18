/**
 * Helpers that keep the grid's URL sync from clobbering query params it does
 * not own. The grid owns `q`, `sort`, `page`, `pageSize`, and any `filter.*`
 * key (see encodeFilterState). Every other key is foreign -- e.g. a deep-link
 * `eventId` / `detectedId` or an entity `scope` carried by another feature on
 * the same route -- and must survive a grid-driven router.navigate, which
 * otherwise replaces the entire query string.
 *
 * Pure functions, no Angular imports, so they unit-test without a TestBed.
 */

/** Whether a query-param key belongs to the grid's own namespace. */
export function isGridParamKey(key: string): boolean {
  return (
    key === 'q' ||
    key === 'sort' ||
    key === 'page' ||
    key === 'pageSize' ||
    key.startsWith('filter.')
  );
}

/**
 * Merge the grid's encoded params with any foreign params currently on the
 * route, so the grid replaces only its own keys and leaves cross-feature deep
 * links (eventId, detectedId, entity scope, ...) intact.
 */
export function mergeForeignParams(
  encoded: Record<string, string>,
  current: Map<string, string | string[]>
): Record<string, string> {
  const out: Record<string, string> = { ...encoded };
  for (const [key, value] of current.entries()) {
    if (isGridParamKey(key)) continue;
    out[key] = Array.isArray(value) ? value.join(',') : value;
  }
  return out;
}
