/**
 * Where an authenticated visit to the tenant root (/t/:tenantId) should land.
 *
 * The old behaviour rendered the app shell with an empty outlet -- a blank
 * screen with no guidance -- and then required a second "pick a space" step.
 * Instead we route intelligently:
 *
 *  - exactly one accessible space in this tenant -> straight into it (no picker
 *    for the common single-engagement case),
 *  - otherwise the last-opened space if it is still accessible here,
 *  - otherwise the real spaces picker (which also carries the no-access state).
 *
 * Pure (the membership + last-space inputs are passed in) so the node unit
 * runner tests every branch without a router.
 */
export interface TenantRootTarget {
  kind: 'space' | 'picker';
  /** Present only when kind === 'space'. */
  spaceId?: string;
}

export function resolveTenantRootTarget(
  accessibleSpaceIds: readonly string[],
  lastSpaceId: string | null
): TenantRootTarget {
  if (accessibleSpaceIds.length === 1) {
    return { kind: 'space', spaceId: accessibleSpaceIds[0] };
  }
  if (lastSpaceId && accessibleSpaceIds.includes(lastSpaceId)) {
    return { kind: 'space', spaceId: lastSpaceId };
  }
  return { kind: 'picker' };
}
