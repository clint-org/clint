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
            (m) => m.TenantSettingsComponent,
          ),
      },
      {
        path: 's/:spaceId',
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/landscape/landscape-shell.component').then(
                (m) => m.LandscapeShellComponent,
              ),
            children: [
              {
                path: '',
                loadComponent: () =>
                  import('./features/landscape/timeline-view.component').then(
                    (m) => m.TimelineViewComponent,
                  ),
              },
              {
                path: 'bullseye',
                children: [
                  {
                    path: '',
                    pathMatch: 'full',
                    redirectTo: 'by-therapy-area',
                  },
                  {
                    path: 'by-therapy-area',
                    loadComponent: () =>
                      import('./features/landscape/landscape-index.component').then(
                        (m) => m.LandscapeIndexComponent,
                      ),
                  },
                  {
                    path: 'by-therapy-area/:entityId',
                    loadComponent: () =>
                      import('./features/landscape/landscape.component').then(
                        (m) => m.LandscapeComponent,
                      ),
                  },
                  {
                    path: 'by-company',
                    loadComponent: () =>
                      import('./features/landscape/landscape-index.component').then(
                        (m) => m.LandscapeIndexComponent,
                      ),
                  },
                  {
                    path: 'by-company/:entityId',
                    loadComponent: () =>
                      import('./features/landscape/landscape.component').then(
                        (m) => m.LandscapeComponent,
                      ),
                  },
                  {
                    path: 'by-moa',
                    loadComponent: () =>
                      import('./features/landscape/landscape-index.component').then(
                        (m) => m.LandscapeIndexComponent,
                      ),
                  },
                  {
                    path: 'by-moa/:entityId',
                    loadComponent: () =>
                      import('./features/landscape/landscape.component').then(
                        (m) => m.LandscapeComponent,
                      ),
                  },
                  {
                    path: 'by-roa',
                    loadComponent: () =>
                      import('./features/landscape/landscape-index.component').then(
                        (m) => m.LandscapeIndexComponent,
                      ),
                  },
                  {
                    path: 'by-roa/:entityId',
                    loadComponent: () =>
                      import('./features/landscape/landscape.component').then(
                        (m) => m.LandscapeComponent,
                      ),
                  },
                ],
              },
            ],
          },
          // Redirects: old /landscape/* paths -> /bullseye/*
          {
            path: 'landscape',
            pathMatch: 'full',
            redirectTo: 'bullseye/by-therapy-area',
          },
          {
            path: 'landscape/by-therapy-area',
            redirectTo: 'bullseye/by-therapy-area',
          },
          {
            path: 'landscape/by-therapy-area/:entityId',
            redirectTo: 'bullseye/by-therapy-area/:entityId',
          },
          {
            path: 'landscape/by-company',
            redirectTo: 'bullseye/by-company',
          },
          {
            path: 'landscape/by-company/:entityId',
            redirectTo: 'bullseye/by-company/:entityId',
          },
          {
            path: 'landscape/by-moa',
            redirectTo: 'bullseye/by-moa',
          },
          {
            path: 'landscape/by-moa/:entityId',
            redirectTo: 'bullseye/by-moa/:entityId',
          },
          {
            path: 'landscape/by-roa',
            redirectTo: 'bullseye/by-roa',
          },
          {
            path: 'landscape/by-roa/:entityId',
            redirectTo: 'bullseye/by-roa/:entityId',
          },
          {
            path: 'landscape/:therapeuticAreaId',
            redirectTo: 'bullseye/by-therapy-area/:therapeuticAreaId',
          },
          // Manage routes (unchanged)
          {
            path: 'manage/companies',
            loadComponent: () =>
              import('./features/manage/companies/company-list.component').then(
                (m) => m.CompanyListComponent,
              ),
          },
          {
            path: 'manage/products',
            loadComponent: () =>
              import('./features/manage/products/product-list.component').then(
                (m) => m.ProductListComponent,
              ),
          },
          {
            path: 'manage/trials',
            loadComponent: () =>
              import('./features/manage/trials/trial-list.component').then(
                (m) => m.TrialListComponent,
              ),
          },
          {
            path: 'manage/trials/:id',
            loadComponent: () =>
              import('./features/manage/trials/trial-detail.component').then(
                (m) => m.TrialDetailComponent,
              ),
          },
          {
            path: 'manage/marker-types',
            loadComponent: () =>
              import('./features/manage/marker-types/marker-type-list.component').then(
                (m) => m.MarkerTypeListComponent,
              ),
          },
          {
            path: 'manage/mechanisms-of-action',
            loadComponent: () =>
              import(
                './features/manage/mechanisms-of-action/mechanism-of-action-list.component'
              ).then((m) => m.MechanismOfActionListComponent),
          },
          {
            path: 'manage/routes-of-administration',
            loadComponent: () =>
              import(
                './features/manage/routes-of-administration/route-of-administration-list.component'
              ).then((m) => m.RouteOfAdministrationListComponent),
          },
          {
            path: 'manage/therapeutic-areas',
            loadComponent: () =>
              import('./features/manage/therapeutic-areas/therapeutic-area-list.component').then(
                (m) => m.TherapeuticAreaListComponent,
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
