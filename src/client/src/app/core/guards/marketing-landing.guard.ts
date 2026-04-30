import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';
import { BrandContextService } from '../services/brand-context.service';
import { TenantService } from '../services/tenant.service';
import { AgencyService } from '../services/agency.service';
import { environment } from '../../../environments/environment';

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
  const agencyService = inject(AgencyService);
  const router = inject(Router);

  await supabaseService.waitForSession();
  const kind = brand.kind();

  if (!supabaseService.session()) {
    if (kind === 'default') return true;
    return router.createUrlTree(['/login']);
  }

  if (kind === 'super-admin') {
    const { data } = await supabaseService.client.rpc('is_platform_admin');
    if (data === true) return router.createUrlTree(['/super-admin']);
    // Signed-in non-admin landed on admin host. Fall through to find them their real home.
  } else if (kind === 'agency') {
    const agencyId = brand.brand().id;
    if (agencyId) {
      const [adminR, memberR] = await Promise.all([
        supabaseService.client.rpc('is_platform_admin'),
        supabaseService.client.rpc('is_agency_member', { p_agency_id: agencyId }),
      ]);
      if (adminR.data === true || memberR.data === true) {
        return router.createUrlTree(['/admin']);
      }
    }
    // Signed in but not a member of this agency. Fall through.
  } else if (kind === 'tenant') {
    const id = brand.brand().id;
    if (id) return router.createUrlTree(['/t', id, 'spaces']);
    return router.createUrlTree(['/onboarding']);
  }

  // Either default host, or a branded host the user has no role for. Resolve their
  // real home: agency memberships take precedence (cross-host to the agency portal);
  // fall back to last-used tenant; fall back to onboarding.
  try {
    const agencies = await agencyService.listMyAgencies();
    if (agencies.length > 0 && environment.apexDomain) {
      const agency = agencies[0];
      window.location.href = `${window.location.protocol}//${agency.subdomain}.${environment.apexDomain}/admin`;
      return false;
    }
  } catch {
    // ignore — fall through to tenant lookup.
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
