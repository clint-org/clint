import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';
import { BrandContextService } from '../services/brand-context.service';
import { TenantService } from '../services/tenant.service';

/**
 * Root-path guard. Routes based on host brand kind and auth state.
 *
 * Unauthenticated:
 *   - default host       -> marketing landing
 *   - any branded host   -> /login
 *
 * Authenticated:
 *   - agency host        -> /admin
 *   - super-admin host   -> /super-admin
 *   - tenant host        -> /t/{brand.id}/spaces
 *   - default host       -> last-used tenant if any, else /onboarding
 *
 * The per-kind routing must mirror auth-callback's redirectAfterSignIn — the
 * callback only runs on fresh sign-in; this guard handles the apex-cookie
 * case where an already-authenticated user lands on a branded host without
 * going through the callback.
 */
export const marketingLandingGuard: CanActivateFn = async () => {
  const supabaseService = inject(SupabaseService);
  const brand = inject(BrandContextService);
  const tenantService = inject(TenantService);
  const router = inject(Router);

  await supabaseService.waitForSession();
  const kind = brand.kind();

  if (!supabaseService.session()) {
    if (kind === 'default') return true;
    return router.createUrlTree(['/login']);
  }

  if (kind === 'agency') return router.createUrlTree(['/admin']);
  if (kind === 'super-admin') return router.createUrlTree(['/super-admin']);
  if (kind === 'tenant') {
    const id = brand.brand().id;
    if (id) return router.createUrlTree(['/t', id, 'spaces']);
    return router.createUrlTree(['/onboarding']);
  }

  // default host: route to user's most recent tenant, or onboarding.
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
