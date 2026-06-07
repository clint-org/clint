/**
 * Pure navigation helpers for the engagement landing page.
 *
 * The engagement landing sits at the space root (`/t/:tenantId/s/:spaceId`).
 * Switching spaces via the header space switcher navigates to the same route
 * config with a different `:spaceId`, so Angular reuses the component instance
 * and `ngOnInit` does not fire again. The component re-extracts the route ids
 * on every NavigationEnd and uses this helper to decide whether the resolved
 * engagement actually changed and a data reload is warranted.
 */
export interface EngagementRouteIds {
  tenantId: string | null;
  spaceId: string | null;
}

/**
 * Returns true when navigation has resolved to a different, fully-identified
 * engagement than before.
 *
 * Returns false when:
 *   - the ids are incomplete (avoids loading before the route fully resolves), or
 *   - the engagement is unchanged (avoids a redundant reload right after the
 *     initial `ngOnInit` load, whose NavigationEnd fires with the same ids).
 */
export function shouldReloadEngagement(
  prev: EngagementRouteIds,
  next: EngagementRouteIds
): boolean {
  if (!next.tenantId || !next.spaceId) return false;
  return prev.tenantId !== next.tenantId || prev.spaceId !== next.spaceId;
}
