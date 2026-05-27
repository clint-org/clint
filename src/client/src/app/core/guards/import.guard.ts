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

  if (!spaceRole.canEdit()) {
    messages.add({
      severity: 'warn',
      summary: 'Editor access required to import data.',
      life: 5000,
    });
    return router.createUrlTree(['/t', tenantId, 's', spaceId]);
  }

  const { data } = await supabase.client
    .from('ai_config')
    .select('ai_enabled')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!data || data.ai_enabled !== true) {
    messages.add({
      severity: 'warn',
      summary: 'AI-assisted import is not enabled for this organization.',
      life: 5000,
    });
    return router.createUrlTree(['/t', tenantId, 's', spaceId]);
  }

  return true;
};
