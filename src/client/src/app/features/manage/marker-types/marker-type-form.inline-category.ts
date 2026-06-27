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
