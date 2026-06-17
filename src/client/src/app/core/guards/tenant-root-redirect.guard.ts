import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';

import { SpaceService } from '../services/space.service';
import { resolveTenantRootTarget } from './tenant-root-target';

/**
 * Tenant root (/t/:tenantId) redirect. Replaces the blank app shell + double
 * "select space" step: route straight into the user's only / last-opened
 * accessible space, else to the spaces picker. See resolveTenantRootTarget for
 * the rules. The guard always returns a UrlTree, so its route never renders.
 */
export const tenantRootRedirectGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  const router = inject(Router);
  const spaceService = inject(SpaceService);

  let tenantId = '';
  let snap: ActivatedRouteSnapshot | null = route;
  while (snap) {
    if (snap.paramMap.has('tenantId')) tenantId = snap.paramMap.get('tenantId')!;
    snap = snap.parent;
  }

  // Spaces in this tenant the user can actually enter: this tenant's
  // (non-archived) spaces intersected with the caller's explicit membership.
  const [spaces, accessibleIds] = await Promise.all([
    spaceService.listSpaces(tenantId),
    spaceService.listAccessibleSpaceIds(),
  ]);
  const accessibleInTenant = spaces.filter((s) => accessibleIds.has(s.id)).map((s) => s.id);

  const target = resolveTenantRootTarget(accessibleInTenant, localStorage.getItem('lastSpaceId'));

  return router.createUrlTree(
    target.kind === 'space'
      ? ['/t', tenantId, 's', target.spaceId]
      : ['/t', tenantId, 'spaces']
  );
};
