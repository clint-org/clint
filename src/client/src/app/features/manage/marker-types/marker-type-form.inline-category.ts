import { MarkerCategory } from '../../../core/models/marker.model';

/** Minimal slice of MarkerCategoryService the inline-create flow depends on. */
export interface InlineCategoryCreator {
  create(spaceId: string, name: string): Promise<MarkerCategory>;
}

/**
 * Create a category inline from the marker-type form. Trims the name and skips
 * the call for blank input, returning null so the caller leaves state untouched.
 */
export async function createInlineCategory(
  service: InlineCategoryCreator,
  spaceId: string,
  rawName: string
): Promise<MarkerCategory | null> {
  const name = rawName.trim();
  if (!name) return null;
  return service.create(spaceId, name);
}

/**
 * Whether the category dropdown should offer a "Create '<name>'" footer row for
 * the current filter text: non-empty and not an exact (case-insensitive) match
 * of an existing category.
 */
export function shouldOfferCategoryCreate(
  rawName: string,
  categories: { name: string }[]
): boolean {
  const label = rawName.trim();
  if (!label) return false;
  const lower = label.toLowerCase();
  return !categories.some((c) => c.name.toLowerCase() === lower);
}
