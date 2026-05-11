import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

// Strict guard for audit pages at /t/:tenantId/audit/events. Unlike the
// parent tenantGuard (which uses has_tenant_access, allowing space-only
// members), this guard requires explicit tenant membership to view audit logs.
// Tenant owners only (no cascading from agency owners).
export const auditTenantGuard: CanActivateFn = async (
  route: ActivatedRouteSnapshot
) => {
  const supabase = inject(SupabaseService);
  const router = inject(Router);

  const tenantId = route.paramMap.get('tenantId');
  if (!tenantId) {
    return router.createUrlTree(['/']);
  }

  await supabase.waitForSession();
  if (!supabase.session()) {
    return router.createUrlTree(['/login']);
  }

  const { data, error } = await supabase.client.rpc(
    'is_tenant_owner_strict',
    {
      p_tenant_id: tenantId,
    }
  );
  if (!error && data === true) {
    return true;
  }
  return router.createUrlTree(['/t', tenantId, 'spaces']);
};
