import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { SupabaseService } from '../services/supabase.service';

// Walk up the route tree to find a param by name -- accounts for params
// defined on parent routes (e.g., :tenantId on the parent t/:tenantId block).
function findParam(route: ActivatedRouteSnapshot | null, name: string): string | null {
  let cursor: ActivatedRouteSnapshot | null = route;
  while (cursor) {
    const value = cursor.paramMap.get(name);
    if (value) return value;
    cursor = cursor.parent;
  }
  return null;
}

/**
 * Owner-only guard for space settings pages (General, Members, Fields). Requires
 * owner-level access to the space via `has_space_access` with `['owner']`. No
 * cascading from tenant owners or agency owners -- the space owner role is the
 * authoritative gate (server-side RLS remains the final word).
 *
 * Reference settings (Marker Types, Taxonomies) stay ungated: any space member
 * may view them. On denial we surface a short toast (matching the spaceGuard
 * P1.3a pattern -- never bounce silently) and redirect to the space root.
 */
export const spaceOwnerGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  const supabase = inject(SupabaseService);
  const router = inject(Router);
  const messageService = inject(MessageService);

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

  // Never bounce silently: a non-owner who deep-links here gets a short reason.
  messageService.add({
    severity: 'info',
    summary: 'Owner access required',
    detail: 'Only a space owner can open this setting.',
    life: 6000,
  });
  return tenantId
    ? router.createUrlTree(['/t', tenantId, 's', spaceId])
    : router.createUrlTree(['/']);
};
