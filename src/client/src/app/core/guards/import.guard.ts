import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { SupabaseService } from '../services/supabase.service';
import { SpaceRoleService } from '../services/space-role.service';

export const importGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  const supabase = inject(SupabaseService);
  const router = inject(Router);
  const messages = inject(MessageService);
  const spaceRole = inject(SpaceRoleService);

  let cursor: ActivatedRouteSnapshot | null = route;
  let tenantId: string | null = null;
  let spaceId: string | null = null;
  while (cursor) {
    tenantId = tenantId ?? cursor.paramMap.get('tenantId');
    spaceId = spaceId ?? cursor.paramMap.get('spaceId');
    cursor = cursor.parent;
  }

  if (!tenantId || !spaceId) {
    return router.createUrlTree(['/']);
  }

  await supabase.waitForSession();
  if (!supabase.session()) {
    return router.createUrlTree(['/login']);
  }

  // Await the role rather than reading canEdit() synchronously: this guard
  // runs before NavigationEnd, so the role fetch may not have started yet
  // (direct loads of /import bounced legitimate owners).
  const role = await spaceRole.ensureRole(spaceId);
  if (role !== 'owner' && role !== 'editor') {
    messages.add({
      severity: 'warn',
      summary: 'Editor access required to import data.',
      life: 5000,
    });
    return router.createUrlTree(['/t', tenantId, 's', spaceId]);
  }

  // Read via the SECURITY DEFINER RPC, not a direct ai_config select: the table's
  // RLS is platform-admin-only (cost caps are Clint's concern), so a direct read
  // returns nothing for space editors/viewers and wrongly blocks them. The RPC
  // surfaces ai_enabled to any user with access to the tenant.
  const { data } = await supabase.client.rpc('get_tenant_ai_status', {
    p_tenant_id: tenantId,
  });
  const aiEnabled = (data as { ai_enabled?: boolean } | null)?.ai_enabled === true;

  if (!aiEnabled) {
    messages.add({
      severity: 'warn',
      summary: 'AI-assisted import is not enabled for this organization.',
      life: 5000,
    });
    return router.createUrlTree(['/t', tenantId, 's', spaceId]);
  }

  return true;
};
