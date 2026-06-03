import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';

/**
 * Redirects the legacy /activity route to /events?source=detected within
 * the same space context (/t/:tenantId/s/:spaceId/events).
 */
export const activityRedirectGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const router = inject(Router);

  // Walk up the route snapshot tree to collect tenantId and spaceId.
  let tenantId = '';
  let spaceId = '';
  let snap: ActivatedRouteSnapshot | null = route;
  while (snap) {
    if (snap.paramMap.has('tenantId')) tenantId = snap.paramMap.get('tenantId')!;
    if (snap.paramMap.has('spaceId')) spaceId = snap.paramMap.get('spaceId')!;
    snap = snap.parent;
  }

  return router.createUrlTree(['/t', tenantId, 's', spaceId, 'events'], {
    queryParams: { source: 'detected' },
  });
};
