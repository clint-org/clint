import { ActivatedRoute } from '@angular/router';

export interface RouteScope {
  tenantId: string | null;
  spaceId: string | null;
}

/**
 * Minimal shape of an ActivatedRouteSnapshot needed for scope resolution: a
 * paramMap plus a parent link. Declared structurally so the resolver can be
 * unit-tested without the Angular router (an ActivatedRouteSnapshot satisfies
 * it).
 */
export interface ScopeSnapshot {
  paramMap: { has(name: string): boolean; get(name: string): string | null };
  parent: ScopeSnapshot | null;
}

/**
 * Walk up a route snapshot chain to resolve the tenant/space ids that key the
 * /t/:tenantId/s/:spaceId app shell. Components rendered as siblings of a
 * space-keyed route (dashboard grid, bullseye panel, change badge) need this
 * because the ids live on an ancestor route, not their own. The nearest node
 * wins when an id appears at multiple levels.
 */
export function resolveScopeFromSnapshot(snapshot: ScopeSnapshot | null): RouteScope {
  let snap = snapshot;
  let tenantId: string | null = null;
  let spaceId: string | null = null;
  while (snap) {
    if (!tenantId && snap.paramMap.has('tenantId')) tenantId = snap.paramMap.get('tenantId');
    if (!spaceId && snap.paramMap.has('spaceId')) spaceId = snap.paramMap.get('spaceId');
    snap = snap.parent;
  }
  return { tenantId, spaceId };
}

export function resolveScopeFromRoute(route: ActivatedRoute): RouteScope {
  return resolveScopeFromSnapshot(route.snapshot as unknown as ScopeSnapshot);
}
