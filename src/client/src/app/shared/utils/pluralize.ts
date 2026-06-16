/**
 * Pick the singular or plural noun for a count. Returns the noun only (no
 * number), so callers compose "{{ count }} {{ pluralize(...) }}". A count of
 * exactly 1 is singular; everything else (including 0, null, undefined) is
 * plural — the natural reading for an empty or unknown tally. (UI-24.)
 */
export function pluralize(
  count: number | null | undefined,
  singular: string,
  plural?: string,
): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}
