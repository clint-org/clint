import { MarkerCategory, MarkerType } from '../../../core/models/marker.model';

/** Count of marker types filed under each category, keyed by category_id. */
export function buildTypeCounts(types: MarkerType[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of types) {
    counts.set(t.category_id, (counts.get(t.category_id) ?? 0) + 1);
  }
  return counts;
}

/** Custom (space-scoped) categories, sorted by display order for the legend. */
export function customCategoriesSorted(categories: MarkerCategory[]): MarkerCategory[] {
  return categories
    .filter((c) => !c.is_system)
    .sort((a, b) => a.display_order - b.display_order);
}

/** System categories, sorted by display order (read-only context rows). */
export function systemCategoriesSorted(categories: MarkerCategory[]): MarkerCategory[] {
  return categories
    .filter((c) => c.is_system)
    .sort((a, b) => a.display_order - b.display_order);
}
