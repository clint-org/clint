import { MarkerCategory, MarkerType } from '../../../core/models/marker.model';

/**
 * A taxonomy row is system-managed (and therefore read-only in any single
 * space) when it is flagged `is_system` or carries no `space_id`. System rows
 * are shared across all spaces, so the UI must not expose edit/delete
 * affordances for them. The guard lives here so the table and the row-menu use
 * the same predicate rather than re-deriving it inline.
 */
export function isSystemTaxonomyRow(row: {
  is_system?: boolean;
  space_id?: string | null;
}): boolean {
  return row.is_system === true || row.space_id === null || row.space_id === undefined;
}

/**
 * Map a save error to a user-facing message. The D2 migration added
 * unique(space_id, name) to both event_types and event_type_categories, so a
 * duplicate custom name surfaces as Postgres 23505; we translate that into a
 * readable inline message instead of leaking the raw constraint text. Any other
 * error falls back to its own message, then to generic copy.
 */
export function taxonomyDuplicateNameMessage(err: unknown, entityLabel: string): string {
  if (isUniqueViolation(err)) {
    return `An ${entityLabel} with this name already exists in this space. Choose a different name.`;
  }
  if (
    err &&
    typeof err === 'object' &&
    'message' in err &&
    typeof (err as { message?: unknown }).message === 'string'
  ) {
    return (err as { message: string }).message;
  }
  return `Could not save ${entityLabel}. Check your connection and try again.`;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
}

/** Categories sorted by display order for the table (system rows sort first). */
export function categoriesSorted(categories: MarkerCategory[]): MarkerCategory[] {
  return [...categories].sort((a, b) => {
    const aSystem = isSystemTaxonomyRow(a) ? 0 : 1;
    const bSystem = isSystemTaxonomyRow(b) ? 0 : 1;
    if (aSystem !== bSystem) return aSystem - bSystem;
    return a.display_order - b.display_order;
  });
}

/** Count of event types filed under each category, keyed by category_id. */
export function buildTypeCounts(types: MarkerType[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of types) {
    counts.set(t.category_id, (counts.get(t.category_id) ?? 0) + 1);
  }
  return counts;
}
