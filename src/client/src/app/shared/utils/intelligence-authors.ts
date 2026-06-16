/**
 * Resolve intelligence author ids to display names. The intelligence RPCs now
 * return an `authors` map ({user_id: display_name}); a parent may also pass an
 * explicit override map. When neither resolves an id, fall back to the first
 * two characters of the UUID so the byline is never blank. (Persona fix P1.2 —
 * replaces the bare UUID-prefix initials the UI used to show.)
 */

/** Last-resort fallback when no display name resolves: UUID-prefix initials. */
export function initialsFromId(id: string): string {
  return id.slice(0, 2).toUpperCase();
}

/**
 * Resolve a single author id to a display name. Payload `authors` are
 * authoritative; `override` (the optional component input) wins over them;
 * UUID-prefix initials are the fallback.
 */
export function resolveAuthorName(
  id: string | null | undefined,
  authors?: Record<string, string> | null,
  override?: Record<string, string> | null,
): string {
  if (!id) return '';
  const map = { ...(authors ?? {}), ...(override ?? {}) };
  return map[id] ?? initialsFromId(id);
}

/**
 * Resolve a list of contributor ids to a comma-joined display string,
 * returning "--" when the list is empty.
 */
export function resolveContributorLine(
  ids: readonly (string | null | undefined)[] | null | undefined,
  authors?: Record<string, string> | null,
  override?: Record<string, string> | null,
): string {
  const names = (ids ?? [])
    .map((id) => resolveAuthorName(id, authors, override))
    .filter((s) => !!s);
  return names.length ? names.join(', ') : '--';
}
