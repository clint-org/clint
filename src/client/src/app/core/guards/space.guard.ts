import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { SupabaseService } from '../services/supabase.service';

export const spaceGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  const supabase = inject(SupabaseService);
  const router = inject(Router);
  const messageService = inject(MessageService);

  // Walk up the route tree to collect both ids -- the guard runs on the
  // s/:spaceId block whose params include :spaceId, but :tenantId lives on
  // the parent t/:tenantId activation.
  let cursor: ActivatedRouteSnapshot | null = route;
  let tenantId: string | null = null;
  let spaceId: string | null = null;
  while (cursor) {
    spaceId = spaceId ?? cursor.paramMap.get('spaceId');
    tenantId = tenantId ?? cursor.paramMap.get('tenantId');
    cursor = cursor.parent;
  }

  if (!spaceId || !tenantId) {
    return router.createUrlTree(['/']);
  }

  await supabase.waitForSession();
  if (!supabase.session()) {
    return router.createUrlTree(['/login']);
  }

  const { data, error } = await supabase.client.rpc('has_space_access', {
    p_space_id: spaceId,
  });
  if (!error && data === true) {
    return true;
  }
  // Never bounce silently: the redirect lands on the spaces list (often the
  // page the user just left), so explain why. (Persona fix P1.3a.)
  messageService.add({
    severity: 'info',
    summary: 'No access to this engagement',
    detail: 'Ask an engagement owner to add you as a member.',
    life: 6000,
  });
  return router.createUrlTree(['/t', tenantId, 'spaces']);
};
