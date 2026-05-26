import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { SourceImportService } from '../../features/source-import/source-import.service';

export const sourceImportGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const service = inject(SourceImportService);
  const router = inject(Router);
  const messages = inject(MessageService);

  const aiCallId = route.paramMap.get('aiCallId');
  const proposal = service.proposal();

  if (!proposal || proposal.ai_call_id !== aiCallId) {
    let snap: ActivatedRouteSnapshot | null = route;
    let tenantId: string | null = null;
    let spaceId: string | null = null;
    while (snap) {
      tenantId = tenantId ?? snap.paramMap.get('tenantId');
      spaceId = spaceId ?? snap.paramMap.get('spaceId');
      snap = snap.parent;
    }

    messages.add({
      severity: 'warn',
      summary: 'Import session expired. Start a new import.',
      life: 5000,
    });

    if (tenantId && spaceId) {
      return router.createUrlTree(['/t', tenantId, 's', spaceId]);
    }
    return router.createUrlTree(['/']);
  }

  return true;
};
