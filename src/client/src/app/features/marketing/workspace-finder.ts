/** Minimal shape of a `get_brand_by_host` result needed to decide existence. */
export interface WorkspaceBrandLookup {
  kind?: string;
}

/**
 * Whether a `get_brand_by_host` result corresponds to a real, reachable
 * workspace. The RPC returns `{ kind: 'default' }` for an unknown host and a
 * concrete kind (`tenant` | `agency` | `super-admin`) for a resolved one, so any
 * non-default kind means the workspace exists.
 */
export function isExistingWorkspace(brand: WorkspaceBrandLookup | null | undefined): boolean {
  return !!brand?.kind && brand.kind !== 'default';
}
