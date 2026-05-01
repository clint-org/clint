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

  const { data, error } = await supabase.client.rpc('has_tenant_access', {
    p_tenant_id: tenantId,
  });
  if (!error && data === true) {
    return true;
  }
  return router.createUrlTree(['/']);
};
