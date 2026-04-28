import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';
import { BrandContextService } from '../services/brand-context.service';
import { TenantService } from '../services/tenant.service';

/**
 * Root-path guard for the apex (default-host) marketing landing.
 *
 * - Unauthenticated + brand kind 'default'  -> render the marketing landing.
 * - Unauthenticated + tenant/agency/super-admin host -> redirect to /login.
 *   On those branded hosts the root URL is just a sign-in entry point.
 * - Authenticated -> defer to legacy onboarding behavior: send to /onboarding
 *   for users with no tenants, otherwise to their last-used tenant. This
 *   preserves the existing direct-customer flow on the apex host.
 */
export const marketingLandingGuard: CanActivateFn = async () => {
  const supabaseService = inject(SupabaseService);
  const brand = inject(BrandContextService);
  const tenantService = inject(TenantService);
  const router = inject(Router);

  await supabaseService.waitForSession();

  // Unauthenticated path: marketing on default host, login everywhere else.
  if (!supabaseService.session()) {
    if (brand.kind() === 'default') {
      // Allow the route to render the MarketingLandingComponent.
      return true;
    }
    return router.createUrlTree(['/login']);
  }

  // Authenticated path: legacy onboarding redirect (matches onboardingRedirectGuard).
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
