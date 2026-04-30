import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

export const tenantGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
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

  const [adminResult, memberResult] = await Promise.all([
    supabase.client.rpc('is_platform_admin'),
    supabase.client.rpc('is_tenant_member', { p_tenant_id: tenantId }),
  ]);
  if (adminResult.data === true || memberResult.data === true) {
    return true;
  }
  return router.createUrlTree(['/']);
};
