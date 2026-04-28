import { Routes } from '@angular/router';
import { authGuard, onboardingRedirectGuard } from './core/guards/auth.guard';
import { agencyGuard } from './core/guards/agency.guard';
import { superAdminGuard } from './core/guards/super-admin.guard';

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
    path: 'admin',
    canActivate: [agencyGuard, authGuard],
    loadComponent: () =>
      import('./features/agency/agency-shell.component').then((m) => m.AgencyShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'tenants' },
      {
        path: 'tenants',
        loadComponent: () =>
          import('./features/agency/agency-tenant-list.component').then(
            (m) => m.AgencyTenantListComponent
          ),
      },
      {
        path: 'tenants/new',
        loadComponent: () =>
          import('./features/agency/agency-tenant-new.component').then(
            (m) => m.AgencyTenantNewComponent
          ),
      },
      {
        path: 'tenants/:id',
        loadComponent: () =>
          import('./features/agency/agency-tenant-detail.component').then(
            (m) => m.AgencyTenantDetailComponent
          ),
      },
      {
        path: 'members',
        loadComponent: () =>
          import('./features/agency/agency-members.component').then(
            (m) => m.AgencyMembersComponent
          ),
      },
      {
        path: 'branding',
        loadComponent: () =>
          import('./features/agency/agency-branding.component').then(
            (m) => m.AgencyBrandingComponent
          ),
      },
    ],
  },
  {
    path: 'super-admin',
    canActivate: [superAdminGuard, authGuard],
    loadComponent: () =>
      import('./features/super-admin/super-admin-shell.component').then(
        (m) => m.SuperAdminShellComponent
      ),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'agencies' },
      {
        path: 'agencies',
        loadComponent: () =>
          import('./features/super-admin/super-admin-agencies.component').then(
            (m) => m.SuperAdminAgenciesComponent
          ),
      },
      {
        path: 'tenants',
        loadComponent: () =>
          import('./features/super-admin/super-admin-tenants.component').then(
            (m) => m.SuperAdminTenantsComponent
          ),
      },
      {
        path: 'domains',
        loadComponent: () =>
          import('./features/super-admin/super-admin-domains.component').then(
            (m) => m.SuperAdminDomainsComponent
          ),
      },
    ],
  },
  {
    path: 'onboarding',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/onboarding/onboarding.component').then((m) => m.OnboardingComponent),
  },
  {
    path: 'provision-demo',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/onboarding/provision-demo.component').then(
        (m) => m.ProvisionDemoComponent
      ),
  },
  {
    path: 't/:tenantId',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./core/layout/app-shell.component').then((m) => m.AppShellComponent),
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
              import('./features/landscape/landscape-shell.component').then(
                (m) => m.LandscapeShellComponent
              ),
            children: [
              {
                path: '',
                loadComponent: () =>
                  import('./features/landscape/timeline-view.component').then(
                    (m) => m.TimelineViewComponent
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
                        (m) => m.LandscapeIndexComponent
                      ),
                  },
                  {
                    path: 'by-therapy-area/:entityId',
                    loadComponent: () =>
                      import('./features/landscape/landscape.component').then(
                        (m) => m.LandscapeComponent
                      ),
                  },
                  {
                    path: 'by-company',
                    loadComponent: () =>
                      import('./features/landscape/landscape-index.component').then(
                        (m) => m.LandscapeIndexComponent
                      ),
                  },
                  {
                    path: 'by-company/:entityId',
                    loadComponent: () =>
                      import('./features/landscape/landscape.component').then(
                        (m) => m.LandscapeComponent
                      ),
                  },
                  {
                    path: 'by-moa',
                    loadComponent: () =>
                      import('./features/landscape/landscape-index.component').then(
                        (m) => m.LandscapeIndexComponent
                      ),
                  },
                  {
                    path: 'by-moa/:entityId',
                    loadComponent: () =>
                      import('./features/landscape/landscape.component').then(
                        (m) => m.LandscapeComponent
                      ),
                  },
                  {
                    path: 'by-roa',
                    loadComponent: () =>
                      import('./features/landscape/landscape-index.component').then(
                        (m) => m.LandscapeIndexComponent
                      ),
                  },
                  {
                    path: 'by-roa/:entityId',
                    loadComponent: () =>
                      import('./features/landscape/landscape.component').then(
                        (m) => m.LandscapeComponent
                      ),
                  },
                ],
              },
              {
                path: 'positioning',
                children: [
                  { path: '', redirectTo: 'by-moa', pathMatch: 'full' as const },
                  {
                    path: 'by-moa',
                    loadComponent: () =>
                      import('./features/landscape/positioning-view.component').then(
                        (m) => m.PositioningViewComponent
                      ),
                  },
                  {
                    path: 'by-therapy-area',
                    loadComponent: () =>
                      import('./features/landscape/positioning-view.component').then(
                        (m) => m.PositioningViewComponent
                      ),
                  },
                  {
                    path: 'by-moa-therapy-area',
                    loadComponent: () =>
                      import('./features/landscape/positioning-view.component').then(
                        (m) => m.PositioningViewComponent
                      ),
                  },
                  {
                    path: 'by-company',
                    loadComponent: () =>
                      import('./features/landscape/positioning-view.component').then(
                        (m) => m.PositioningViewComponent
                      ),
                  },
                  {
                    path: 'by-roa',
                    loadComponent: () =>
                      import('./features/landscape/positioning-view.component').then(
                        (m) => m.PositioningViewComponent
                      ),
                  },
                ],
              },
              {
                path: 'catalysts',
                loadComponent: () =>
                  import('./features/catalysts/catalysts-page.component').then(
                    (m) => m.CatalystsPageComponent
                  ),
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
            path: 'manage/trials',
            loadComponent: () =>
              import('./features/manage/trials/trial-list.component').then(
                (m) => m.TrialListComponent
              ),
          },
          {
            path: 'manage/trials/:id',
            loadComponent: () =>
              import('./features/manage/trials/trial-detail.component').then(
                (m) => m.TrialDetailComponent
              ),
          },
          // Settings routes (moved from manage)
          {
            path: 'settings/marker-types',
            loadComponent: () =>
              import('./features/manage/marker-types/marker-type-list.component').then(
                (m) => m.MarkerTypeListComponent
              ),
          },
          {
            path: 'settings/taxonomies',
            loadComponent: () =>
              import('./features/manage/taxonomies/taxonomies-page.component').then(
                (m) => m.TaxonomiesPageComponent
              ),
          },
          {
            path: 'settings/general',
            loadComponent: () =>
              import('./features/space-settings/space-general.component').then(
                (m) => m.SpaceGeneralComponent
              ),
          },
          {
            path: 'settings/members',
            loadComponent: () =>
              import('./features/space-settings/space-members.component').then(
                (m) => m.SpaceMembersComponent
              ),
          },
          // Redirects: old manage taxonomy/marker paths -> new settings paths
          {
            path: 'manage/marker-types',
            redirectTo: 'settings/marker-types',
          },
          {
            path: 'manage/therapeutic-areas',
            redirectTo: 'settings/taxonomies',
          },
          {
            path: 'manage/mechanisms-of-action',
            redirectTo: 'settings/taxonomies',
          },
          {
            path: 'manage/routes-of-administration',
            redirectTo: 'settings/taxonomies',
          },
          {
            path: 'events',
            loadComponent: () =>
              import('./features/events/events-page.component').then((m) => m.EventsPageComponent),
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
