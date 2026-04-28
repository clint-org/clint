import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { BrandContextService } from '../services/brand-context.service';

export const superAdminGuard: CanActivateFn = () => {
  const brand = inject(BrandContextService);
  const router = inject(Router);
  if (brand.kind() !== 'super-admin') {
    return router.createUrlTree(['/']);
  }
  return true;
};
