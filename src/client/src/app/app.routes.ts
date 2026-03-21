import { Routes } from '@angular/router';
import { authGuard, onboardingRedirectGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'auth/callback',
    loadComponent: () =>
      import('./features/auth/auth-callback.component').then((m) => m.AuthCallbackComponent),
  },
  {
    path: 'onboarding',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/onboarding/onboarding.component').then((m) => m.OnboardingComponent),
  },
  {
    path: 't/:tenantId',
    canActivate: [authGuard],
    children: [
      {
        path: 'spaces',
        loadComponent: () =>
          import('./features/spaces/space-list.component').then((m) => m.SpaceListComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/tenant-settings/tenant-settings.component').then(
            (m) => m.TenantSettingsComponent
          ),
      },
      {
        path: 's/:spaceId',
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
          },
          {
            path: 'manage/companies',
            loadComponent: () =>
              import('./features/manage/companies/company-list.component').then(
                (m) => m.CompanyListComponent
              ),
          },
          {
            path: 'manage/products',
            loadComponent: () =>
              import('./features/manage/products/product-list.component').then(
                (m) => m.ProductListComponent
              ),
          },
          {
            path: 'manage/trials/:id',
            loadComponent: () =>
              import('./features/manage/trials/trial-detail.component').then(
                (m) => m.TrialDetailComponent
              ),
          },
          {
            path: 'manage/marker-types',
            loadComponent: () =>
              import('./features/manage/marker-types/marker-type-list.component').then(
                (m) => m.MarkerTypeListComponent
              ),
          },
          {
            path: 'manage/therapeutic-areas',
            loadComponent: () =>
              import('./features/manage/therapeutic-areas/therapeutic-area-list.component').then(
                (m) => m.TherapeuticAreaListComponent
              ),
          },
        ],
      },
    ],
  },
  {
    path: '',
    canActivate: [onboardingRedirectGuard],
    children: [],
  },
  { path: '**', redirectTo: '' },
];
