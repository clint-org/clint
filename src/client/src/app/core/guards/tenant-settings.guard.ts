import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

// Strict guard for /t/:tenantId/settings -- the parent tenantGuard uses
// has_tenant_access (loose; includes space-only members), so a Reader of
// any space could otherwise reach the empty/inert tenant-settings page
// (members table hidden by RLS, every mutation rejected at the RPC layer).
// This guard requires explicit tenant membership and bounces non-members
// back to the spaces list.
export const tenantSettingsGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  const supabase = inject(SupabaseService);
  const router = inject(Router);

  let cursor: ActivatedRouteSnapshot | null = route;
  let tenantId: string | null = null;
  while (cursor) {
    tenantId = tenantId ?? cursor.paramMap.get('tenantId');
    cursor = cursor.parent;
  }
  if (!tenantId) {
    return router.createUrlTree(['/']);
  }

  await supabase.waitForSession();
  if (!supabase.session()) {
    return router.createUrlTree(['/login']);
  }

  const { data, error } = await supabase.client.rpc('is_tenant_member', {
    p_tenant_id: tenantId,
  });
  if (!error && data === true) {
    return true;
  }
  return router.createUrlTree(['/t', tenantId, 'spaces']);
};
