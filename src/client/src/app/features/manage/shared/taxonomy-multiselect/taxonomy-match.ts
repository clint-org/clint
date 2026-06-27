/**
 * Pure matching helpers for inline taxonomy creation. Used by
 * TaxonomyMultiselect to decide whether a typed value already exists (exact),
 * resembles existing values (near), or is genuinely new (none).
 *
 * Normalization is intentionally aggressive: it folds case and strips all
 * non-alphanumeric characters (including whitespace and hyphens) so that
 * "GLP-1", "GLP 1", and "GLP1" converge. It does NOT fold accents or Greek
 * letters -- see the design doc's out-of-scope note.
 */

export interface TaxonomyOption {
  id: string;
  name: string;
}

export type MatchKind = 'exact' | 'near' | 'none';

export interface MatchResult {
  kind: MatchKind;
  /** Closest existing options when kind is 'near'; empty otherwise. Max 2. */
  near: TaxonomyOption[];
}

/** Minimum normalized query length before near suggestions are offered. */
const MIN_NEAR_QUERY_LEN = 2;
/** Cap on how many near suggestions to surface. */
const NEAR_LIMIT = 2;

export function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}

function nearThreshold(len: number): number {
  return len <= 8 ? 2 : Math.ceil(len * 0.15);
}

export function classify(text: string, options: TaxonomyOption[]): MatchResult {
  const query = normalize(text);
  if (query.length === 0) return { kind: 'none', near: [] };

  const scored = options.map((option) => ({
    option,
    norm: normalize(option.name),
  }));

  if (scored.some((s) => s.norm === query)) {
    return { kind: 'exact', near: [] };
  }

  if (query.length < MIN_NEAR_QUERY_LEN) return { kind: 'none', near: [] };

  const threshold = nearThreshold(query.length);
  const near = scored
    .map((s) => ({ option: s.option, distance: levenshtein(query, s.norm), norm: s.norm }))
    .filter((s) => s.norm.length > 0)
    .filter((s) => s.norm.includes(query) || query.includes(s.norm) || s.distance <= threshold)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, NEAR_LIMIT)
    .map((s) => s.option);

  return near.length > 0 ? { kind: 'near', near } : { kind: 'none', near: [] };
}
