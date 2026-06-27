/**
 * Pure row-mapping utilities for TaxonomiesHelpComponent.
 * No Angular dependencies -- exported here so specs can import and exercise
 * the real transform without pulling in the Angular compiler.
 */

export interface VocabRow {
  name: string;
  detail: string | null;
}

/**
 * Sorts `rows` by `display_order` ascending and maps each row to a `VocabRow`
 * using the caller-supplied `detail` extractor.
 */
export function toVocabRows<T extends { name: string; display_order: number }>(
  rows: readonly T[],
  detail: (r: T) => string | null,
): VocabRow[] {
  return [...rows]
    .sort((a, b) => a.display_order - b.display_order)
    .map((r) => ({ name: r.name, detail: detail(r) }));
}
