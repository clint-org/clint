import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { BrandContextService } from '../services/brand-context.service';
import { SupabaseService } from '../services/supabase.service';

export const agencyGuard: CanActivateFn = async () => {
  const brand = inject(BrandContextService);
  const supabase = inject(SupabaseService);
  const router = inject(Router);

  if (brand.kind() !== 'agency') {
    return router.createUrlTree(['/']);
  }

  const agencyId = brand.brand().id;
  if (!agencyId) {
    return router.createUrlTree(['/']);
  }

  await supabase.waitForSession();
  if (!supabase.session()) {
    return router.createUrlTree(['/login']);
  }

  const [adminResult, memberResult] = await Promise.all([
    supabase.client.rpc('is_platform_admin'),
    supabase.client.rpc('is_agency_member', { p_agency_id: agencyId }),
  ]);
  if (adminResult.data === true || memberResult.data === true) {
    return true;
  }
  return router.createUrlTree(['/']);
};
