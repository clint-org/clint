import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

// Walk up the route tree to find a param by name -- accounts for params
// defined on parent routes (e.g., :tenantId on the parent t/:tenantId block).
function findParam(
  route: ActivatedRouteSnapshot | null,
  name: string
): string | null {
  let cursor: ActivatedRouteSnapshot | null = route;
  while (cursor) {
    const value = cursor.paramMap.get(name);
    if (value) return value;
    cursor = cursor.parent;
  }
  return null;
}

// Strict guard for audit pages at /t/:tenantId/s/:spaceId/audit/events.
// Requires owner-level access to the space (via has_space_access with
// array['owner']). No cascading from tenant owners or agency owners.
export const auditSpaceGuard: CanActivateFn = async (
  route: ActivatedRouteSnapshot
) => {
  const supabase = inject(SupabaseService);
  const router = inject(Router);

  const spaceId = findParam(route, 'spaceId');
  const tenantId = findParam(route, 'tenantId');

  if (!spaceId) {
    return router.createUrlTree(['/']);
  }

  await supabase.waitForSession();
  if (!supabase.session()) {
    return router.createUrlTree(['/login']);
  }

  const { data, error } = await supabase.client.rpc('has_space_access', {
    p_space_id: spaceId,
    p_roles: ['owner'],
  });
  if (!error && data === true) {
    return true;
  }
  return tenantId
    ? router.createUrlTree(['/t', tenantId, 's', spaceId])
    : router.createUrlTree(['/']);
};
