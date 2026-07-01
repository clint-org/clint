import type { ExtractionResult, DroppedEntity } from './types';

// NCT-mode chunking: a single Anthropic call that resolves the whole batch grows
// with the number of trials and can exceed LLM_TIMEOUT_MS (and Cloudflare's ~100s
// edge ceiling) for a within-limit import (#178). We split the studies into
// sub-batches the model resolves comfortably in time, run them concurrently, and
// merge their validated proposals here. Each sub-batch is resolved against the
// SAME inventory, so its `existing` matches share the inventory id space; only its
// `new` entities and its trials carry batch-local indices that must be reindexed.

/** Split `items` into contiguous chunks of at most `size`. */
export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk size must be >= 1');
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** One validated sub-batch: its cleaned proposals plus per-call accounting. */
export interface SubBatchExtraction {
  result: ExtractionResult;
  dropped: DroppedEntity[];
  warnings: string[];
  promptTokens: number;
  completionTokens: number;
}

// Dedup key for a company/asset match. Two sub-batches that each resolve the same
// entity must collapse to one proposal (else the review UI shows -- and commit
// creates -- a duplicate). `existing` matches key on the inventory id; `new`
// matches key on the normalized display name.
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

type CompanyMatch = ExtractionResult['companies'][number]['match'];
type AssetMatch = ExtractionResult['assets'][number]['match'];

function matchKey(match: CompanyMatch | AssetMatch): string {
  return match.kind === 'existing' ? `e:${match.id}` : `n:${normalizeName(match.name)}`;
}

/**
 * Merge concurrently-resolved sub-batches into a single proposal set with a
 * single global index space.
 *
 * - Companies and assets are deduped (see `matchKey`); the first occurrence wins.
 * - Trials are never deduped -- each NCT id lives in exactly one sub-batch -- but
 *   their cross-references (`sponsor_ref`, `asset_refs`, `primary_asset_ref`) and
 *   each asset's `company_ref` are remapped from batch-local to global indices.
 * - `dropped` and `warnings` are concatenated; token counts are summed.
 *
 * A single sub-batch is returned verbatim so the common (small-import) path keeps
 * exactly the pre-chunking behavior, including the model's own `source_summary`.
 */
export function mergeSubBatches(batches: SubBatchExtraction[]): SubBatchExtraction {
  if (batches.length === 1) return batches[0];

  const companies: ExtractionResult['companies'] = [];
  const assets: ExtractionResult['assets'] = [];
  const trials: ExtractionResult['trials'] = [];
  const companyKeyToIdx = new Map<string, number>();
  const assetKeyToIdx = new Map<string, number>();
  const dropped: DroppedEntity[] = [];
  const warnings: string[] = [];
  let promptTokens = 0;
  let completionTokens = 0;

  for (const batch of batches) {
    const r = batch.result;

    // companies: local index -> global index
    const companyMap: number[] = [];
    r.companies.forEach((c, i) => {
      const key = matchKey(c.match);
      let gi = companyKeyToIdx.get(key);
      if (gi === undefined) {
        gi = companies.length;
        companies.push(c);
        companyKeyToIdx.set(key, gi);
      }
      companyMap[i] = gi;
    });

    // assets: local index -> global index, with company_ref remapped
    const assetMap: number[] = [];
    r.assets.forEach((a, i) => {
      const key = matchKey(a.match);
      let gi = assetKeyToIdx.get(key);
      if (gi === undefined) {
        gi = assets.length;
        assets.push({ ...a, company_ref: remap(companyMap, a.company_ref) });
        assetKeyToIdx.set(key, gi);
      }
      assetMap[i] = gi;
    });

    // trials: appended with all refs remapped to the global index space
    r.trials.forEach((t) => {
      trials.push({
        ...t,
        sponsor_ref: remap(companyMap, t.sponsor_ref),
        asset_refs: t.asset_refs.map((ref) => remap(assetMap, ref)),
        primary_asset_ref:
          t.primary_asset_ref == null ? t.primary_asset_ref : remap(assetMap, t.primary_asset_ref),
      });
    });

    dropped.push(...batch.dropped);
    warnings.push(...batch.warnings);
    promptTokens += batch.promptTokens;
    completionTokens += batch.completionTokens;
  }

  const result: ExtractionResult = {
    source_summary: `Batch import of ${trials.length} ${trials.length === 1 ? 'trial' : 'trials'}`,
    source_title: null,
    source_date: null,
    companies,
    assets,
    trials,
    events: [],
  };

  return { result, dropped, warnings, promptTokens, completionTokens };
}

// Translate a batch-local ref through its local->global map. An out-of-bounds ref
// (a stale index left by validation's filtering) falls back to itself rather than
// silently pointing elsewhere -- matching the pre-chunking single-call behavior,
// where such a ref was handed downstream unchanged.
function remap(map: number[], ref: number): number {
  const mapped = map[ref];
  return mapped === undefined ? ref : mapped;
}
