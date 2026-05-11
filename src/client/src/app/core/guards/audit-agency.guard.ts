import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { BrandContextService } from '../services/brand-context.service';
import { SupabaseService } from '../services/supabase.service';

// Strict guard for agency audit pages at /admin/audit/events. Requires
// owner-level membership in the agency (via is_agency_member with
// array['owner']). Also gated by the parent agencyGuard's kind check.
export const auditAgencyGuard: CanActivateFn = async () => {
  const brand = inject(BrandContextService);
  const supabase = inject(SupabaseService);
  const router = inject(Router);

  const agencyId = brand.brand().id;
  if (!agencyId) {
    return router.createUrlTree(['/']);
  }

  await supabase.waitForSession();
  if (!supabase.session()) {
    return router.createUrlTree(['/login']);
  }

  const { data, error } = await supabase.client.rpc('is_agency_member', {
    p_agency_id: agencyId,
    p_roles: ['owner'],
  });
  if (!error && data === true) {
    return true;
  }
  return router.createUrlTree(['/admin']);
};
