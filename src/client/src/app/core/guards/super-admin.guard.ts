import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { BrandContextService } from '../services/brand-context.service';
import { SupabaseService } from '../services/supabase.service';

export const superAdminGuard: CanActivateFn = async () => {
  const brand = inject(BrandContextService);
  const supabase = inject(SupabaseService);
  const router = inject(Router);

  if (brand.kind() !== 'super-admin') {
    return router.createUrlTree(['/']);
  }

  await supabase.waitForSession();
  if (!supabase.session()) {
    return router.createUrlTree(['/login']);
  }

  const { data, error } = await supabase.client.rpc('is_platform_admin');
  if (error || data !== true) {
    return router.createUrlTree(['/']);
  }
  return true;
};
