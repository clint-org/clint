import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';
import { TenantService } from '../services/tenant.service';

export const authGuard: CanActivateFn = async () => {
  const supabaseService = inject(SupabaseService);
  const router = inject(Router);

  await supabaseService.waitForSession();

  if (!supabaseService.session()) {
    return router.createUrlTree(['/login']);
  }

  return true;
};

export const onboardingRedirectGuard: CanActivateFn = async () => {
  const supabaseService = inject(SupabaseService);
  const tenantService = inject(TenantService);
  const router = inject(Router);

  await supabaseService.waitForSession();

  if (!supabaseService.session()) {
    return router.createUrlTree(['/login']);
  }

  try {
    const tenants = await tenantService.listMyTenants();
    if (tenants.length === 0) {
      return router.createUrlTree(['/onboarding']);
    }
    const lastTenantId = localStorage.getItem('lastTenantId');
    const tenant = tenants.find((t) => t.id === lastTenantId) ?? tenants[0];
    return router.createUrlTree(['/t', tenant.id, 'spaces']);
  } catch {
    return router.createUrlTree(['/onboarding']);
  }
};
