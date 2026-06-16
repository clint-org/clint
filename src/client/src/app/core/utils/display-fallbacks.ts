/**
 * Display fallbacks for the three cascade-safety placeholder cases.
 *
 * - resolveUserDisplay: name an actor whose row may be present, redacted,
 *   or missing entirely (deleted before redaction landed). Authorship rows
 *   survive user removal via redaction (#6 in the cascade-safety design),
 *   so the UI must render a placeholder rather than blanking out.
 * - resolveTherapeuticAreaLabel: trials.indication_id flips to
 *   nullable SET NULL when the parent indication is deleted (#2 in
 *   the design), so any list row joining through trials.indication
 *   must tolerate a null result.
 * - resolveSpaceBadge: spaces.archived_at is the soft-delete tier (#1 in
 *   the design); archived spaces still appear in some lists and need a
 *   visible badge so an owner does not mistake them for live spaces.
 *
 * No Angular runtime dependency. Pure functions, safe to call with
 * arbitrary input (null and undefined are normal, not bugs).
 */

export type UserRefInput =
  | { kind: 'present'; displayName?: string | null; email?: string | null }
  | { kind: 'redacted' }
  | { kind: 'missing' }
  | null
  | undefined;

export type TherapeuticAreaRefInput =
  | { name: string | null | undefined; abbreviation?: string | null }
  | null
  | undefined;

export type SpaceRefInput = { archivedAt?: string | Date | null } | null | undefined;

export interface SpaceBadge {
  label: string;
  tone: 'archived' | 'active';
}

function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Resolve the display string for a user reference that may be present,
 * redacted, or missing. Always returns a renderable string; never null.
 */
export function resolveUserDisplay(user: UserRefInput): string {
  if (user == null) return '(unknown user)';
  if (user.kind === 'missing') return '(unknown user)';
  if (user.kind === 'redacted') return '(redacted user)';
  // kind === 'present'
  if (isNonEmpty(user.displayName)) return user.displayName.trim();
  if (isNonEmpty(user.email)) return user.email.trim();
  return '(unknown user)';
}

/**
 * Resolve an indication label, falling back to the abbreviation if
 * the name is empty, and to "(uncategorized)" if both are empty or the
 * reference is missing. Trials whose indication_id was set to null
 * by FK cascade land in the missing branch.
 */
export function resolveTherapeuticAreaLabel(ta: TherapeuticAreaRefInput): string {
  if (ta == null) return '(uncategorized)';
  if (isNonEmpty(ta.name)) return ta.name.trim();
  if (isNonEmpty(ta.abbreviation)) return ta.abbreviation.trim();
  return '(uncategorized)';
}

/**
 * Whether the trial-detail header should render the raw `name` as a secondary
 * line beside the primary `acronym`. The header shows `acronym ?? name` as the
 * title, so the secondary line is only meaningful when `name` adds information:
 * it must exist, differ from the acronym already shown, and differ from the
 * NCT identifier (which has its own affordance). Prevents the "ATTAIN-1
 * ATTAIN-1" duplication when acronym === name (UI-23).
 */
export function shouldShowTrialSecondaryName(
  acronym: string | null | undefined,
  name: string | null | undefined,
  identifier: string | null | undefined,
): boolean {
  if (!isNonEmpty(acronym) || !isNonEmpty(name)) return false;
  return name.trim() !== acronym.trim() && name.trim() !== (identifier ?? '').trim();
}

/**
 * Resolve a badge for a space reference. Returns null when no badge is
 * needed (active space, or no reference). Archived spaces return a
 * single "(archived)" badge with the 'archived' tone.
 */
export function resolveSpaceBadge(space: SpaceRefInput): SpaceBadge | null {
  if (space == null) return null;
  if (space.archivedAt != null) {
    return { label: '(archived)', tone: 'archived' };
  }
  return null;
}
