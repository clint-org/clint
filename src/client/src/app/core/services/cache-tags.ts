/**
 * Shared RpcCache tag builders for landscape-derived reads.
 *
 * The bullseye / heatmap / landscape-index reads each carry a specific,
 * parameterized cache tag (`space:<id>:bullseye:<dimension>:<entityId>`,
 * `space:<id>:landscape:<dimension>`, `space:<id>:heatmap`, ...). RpcCache
 * matches tags by exact Set membership, so those parameterized tags are not
 * enumerable from a sibling write service. Every landscape read therefore also
 * carries this coarse per-space umbrella tag; event/marker writes invalidate
 * the umbrella to refresh all landscape surfaces at once.
 *
 * Use this helper on both sides (the `cache.get` tags and the write-path
 * `invalidateTags`) so the produced and invalidated tag can never drift via a
 * typo. Follow-up to #175; see issue #177.
 */
export function landscapeAllTag(spaceId: string): string {
  return `space:${spaceId}:landscape-all`;
}
