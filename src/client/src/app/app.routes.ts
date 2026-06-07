import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { agencyGuard } from './core/guards/agency.guard';
import { superAdminGuard } from './core/guards/super-admin.guard';
import { tenantGuard } from './core/guards/tenant.guard';
import { spaceGuard } from './core/guards/space.guard';
import { tenantSettingsGuard } from './core/guards/tenant-settings.guard';
import { auditTenantGuard } from './core/guards/audit-tenant.guard';
import { auditAgencyGuard } from './core/guards/audit-agency.guard';
import { auditSpaceGuard } from './core/guards/audit-space.guard';
import { marketingLandingGuard } from './core/guards/marketing-landing.guard';
import { sourceImportGuard } from './core/guards/source-import.guard';
import { sourceImportDeactivateGuard } from './core/guards/source-import-deactivate.guard';
import { activityRedirectGuard } from './core/guards/activity-redirect.guard';
import { importGuard } from './core/guards/import.guard';
import { editGuard } from './core/guards/edit.guard';

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
    path: 'privacy',
    loadComponent: () =>
      import('./features/legal/privacy-policy.component').then((m) => m.PrivacyPolicyComponent),
  },
  {
    path: 'terms',
    loadComponent: () =>
      import('./features/legal/terms-of-service.component').then((m) => m.TermsOfServiceComponent),
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
      {
        path: 'audit-log',
        canActivate: [auditAgencyGuard],
        loadComponent: () =>
          import('./features/agency/agency-audit-log.component').then(
            (m) => m.AgencyAuditLogComponent
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
      {
        path: 'audit-log',
        loadComponent: () =>
          import('./features/super-admin/super-admin-audit-log.component').then(
            (m) => m.SuperAdminAuditLogComponent
          ),
      },
      {
        path: 'ai-usage',
        loadComponent: () =>
          import('./features/super-admin/super-admin-ai-usage.component').then(
            (m) => m.SuperAdminAiUsageComponent
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
    path: 't/:tenantId',
    canActivate: [authGuard, tenantGuard],
    loadComponent: () =>
      import('./core/layout/app-shell.component').then((m) => m.AppShellComponent),
    children: [
      {
        path: 'spaces',
        loadComponent: () =>
          import('./features/spaces/space-list.component').then((m) => m.SpaceListComponent),
      },
      {
        path: 'spaces/archived',
        loadComponent: () =>
          import('./features/spaces/space-archived-list.component').then(
            (m) => m.SpaceArchivedListComponent
          ),
      },
      {
        path: 'settings',
        canActivate: [tenantSettingsGuard],
        loadComponent: () =>
          import('./features/tenant-settings/tenant-settings.component').then(
            (m) => m.TenantSettingsComponent
          ),
      },
      {
        path: 'settings/audit-log',
        canActivate: [auditTenantGuard],
        loadComponent: () =>
          import('./features/tenant-settings/tenant-audit-log.component').then(
            (m) => m.TenantAuditLogComponent
          ),
      },
      {
        path: 'help/roles',
        loadComponent: () =>
          import('./features/help/roles-help.component').then((m) => m.RolesHelpComponent),
      },
      {
        path: 'help/phases',
        loadComponent: () =>
          import('./features/help/phases-help.component').then((m) => m.PhasesHelpComponent),
      },
      {
        path: 's/:spaceId',
        canActivate: [spaceGuard],
        children: [
          // Engagement landing: the default surface for /t/:tenantId/s/:spaceId.
          // Phase 1 of docs/specs/engagement-landing/spec.md. Renders without
          // the landscape shell so the filter bar / topbar tab strip stay
          // landscape-only. pathMatch:'full' keeps the shell available for
          // /timeline and the rest of the landscape routes below.
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./features/engagement-landing/engagement-landing.component').then(
                (m) => m.EngagementLandingComponent
              ),
          },
          {
            path: 'import',
            canActivate: [importGuard],
            loadComponent: () =>
              import('./features/source-import/import-page.component').then(
                (m) => m.ImportPageComponent
              ),
          },
          {
            path: 'import/:aiCallId/review',
            canActivate: [sourceImportGuard],
            canDeactivate: [sourceImportDeactivateGuard],
            loadComponent: () =>
              import('./features/source-import/review-page.component').then(
                (m) => m.ReviewPageComponent
              ),
          },
          {
            path: 'help/markers',
            loadComponent: () =>
              import('./features/help/markers-help.component').then((m) => m.MarkersHelpComponent),
          },
          {
            path: '',
            loadComponent: () =>
              import('./features/landscape/landscape-shell.component').then(
                (m) => m.LandscapeShellComponent
              ),
            children: [
              {
                path: 'timeline',
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
                    loadComponent: () =>
                      import('./features/landscape/landscape.component').then(
                        (m) => m.LandscapeComponent
                      ),
                  },
                  // Legacy redirects: old dimension routes -> /bullseye (query-param model)
                  { path: 'by-indication', redirectTo: '', pathMatch: 'full' },
                  { path: 'by-indication/:entityId', redirectTo: '', pathMatch: 'full' },
                  { path: 'by-company', redirectTo: '', pathMatch: 'full' },
                  { path: 'by-company/:entityId', redirectTo: '', pathMatch: 'full' },
                  { path: 'by-moa', redirectTo: '', pathMatch: 'full' },
                  { path: 'by-moa/:entityId', redirectTo: '', pathMatch: 'full' },
                  { path: 'by-roa', redirectTo: '', pathMatch: 'full' },
                  { path: 'by-roa/:entityId', redirectTo: '', pathMatch: 'full' },
                ],
              },
              {
                path: 'heatmap',
                children: [
                  { path: '', redirectTo: 'by-moa', pathMatch: 'full' as const },
                  {
                    path: 'by-moa',
                    loadComponent: () =>
                      import('./features/landscape/heatmap-view.component').then(
                        (m) => m.HeatmapViewComponent
                      ),
                  },
                  {
                    path: 'by-indication',
                    loadComponent: () =>
                      import('./features/landscape/heatmap-view.component').then(
                        (m) => m.HeatmapViewComponent
                      ),
                  },
                  {
                    path: 'by-moa-indication',
                    loadComponent: () =>
                      import('./features/landscape/heatmap-view.component').then(
                        (m) => m.HeatmapViewComponent
                      ),
                  },
                  {
                    path: 'by-company',
                    loadComponent: () =>
                      import('./features/landscape/heatmap-view.component').then(
                        (m) => m.HeatmapViewComponent
                      ),
                  },
                  {
                    path: 'by-roa',
                    loadComponent: () =>
                      import('./features/landscape/heatmap-view.component').then(
                        (m) => m.HeatmapViewComponent
                      ),
                  },
                ],
              },
              // Legacy redirects: old /positioning/* paths -> /heatmap/*
              { path: 'positioning', redirectTo: 'heatmap', pathMatch: 'full' },
              { path: 'positioning/by-moa', redirectTo: 'heatmap/by-moa' },
              { path: 'positioning/by-indication', redirectTo: 'heatmap/by-indication' },
              {
                path: 'positioning/by-moa-indication',
                redirectTo: 'heatmap/by-moa-indication',
              },
              { path: 'positioning/by-company', redirectTo: 'heatmap/by-company' },
              { path: 'positioning/by-roa', redirectTo: 'heatmap/by-roa' },
              {
                path: 'catalysts',
                loadComponent: () =>
                  import('./features/catalysts/catalysts-page.component').then(
                    (m) => m.CatalystsPageComponent
                  ),
              },
            ],
          },
          {
            path: 'intelligence',
            loadComponent: () =>
              import('./shared/components/intelligence-browse/intelligence-browse.component').then(
                (m) => m.IntelligenceBrowseComponent
              ),
          },
          {
            path: 'materials',
            loadComponent: () =>
              import('./features/materials-browse/materials-browse-page.component').then(
                (m) => m.MaterialsBrowsePageComponent
              ),
          },
          {
            path: 'activity',
            canActivate: [activityRedirectGuard],
            // Guard always redirects; component is never rendered.
            children: [],
          },
          // Redirects: old /landscape/* paths -> /bullseye
          { path: 'landscape', pathMatch: 'full', redirectTo: 'bullseye' },
          { path: 'landscape/by-therapy-area', redirectTo: 'bullseye' },
          { path: 'landscape/by-therapy-area/:entityId', redirectTo: 'bullseye' },
          { path: 'landscape/by-company', redirectTo: 'bullseye' },
          { path: 'landscape/by-company/:entityId', redirectTo: 'bullseye' },
          { path: 'landscape/by-moa', redirectTo: 'bullseye' },
          { path: 'landscape/by-moa/:entityId', redirectTo: 'bullseye' },
          { path: 'landscape/by-roa', redirectTo: 'bullseye' },
          { path: 'landscape/by-roa/:entityId', redirectTo: 'bullseye' },
          { path: 'landscape/:therapeuticAreaId', redirectTo: 'bullseye' },
          // Manage routes (unchanged)
          {
            path: 'manage/companies',
            canActivate: [editGuard],
            loadComponent: () =>
              import('./features/manage/companies/company-list.component').then(
                (m) => m.CompanyListComponent
              ),
          },
          {
            path: 'manage/assets',
            canActivate: [editGuard],
            loadComponent: () =>
              import('./features/manage/assets/asset-list.component').then(
                (m) => m.AssetListComponent
              ),
          },
          {
            path: 'manage/trials',
            canActivate: [editGuard],
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
          {
            path: 'manage/companies/:id',
            loadComponent: () =>
              import('./features/manage/companies/company-detail.component').then(
                (m) => m.CompanyDetailComponent
              ),
          },
          {
            path: 'manage/assets/:id',
            loadComponent: () =>
              import('./features/manage/assets/asset-detail.component').then(
                (m) => m.AssetDetailComponent
              ),
          },
          {
            path: 'manage/engagement',
            loadComponent: () =>
              import('./features/manage/engagement/engagement-detail.component').then(
                (m) => m.EngagementDetailComponent
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
          {
            path: 'settings/fields',
            loadComponent: () =>
              import('./features/space-settings/space-field-visibility-settings.component').then(
                (m) => m.SpaceFieldVisibilitySettingsComponent
              ),
          },
          {
            path: 'settings/audit-log',
            canActivate: [auditSpaceGuard],
            loadComponent: () =>
              import('./features/space-settings/space-audit-log.component').then(
                (m) => m.SpaceAuditLogComponent
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
          {
            path: 'seed-demo',
            loadComponent: () =>
              import('./features/spaces/seed-demo.component').then((m) => m.SeedDemoComponent),
          },
        ],
      },
    ],
  },
  {
    path: '',
    pathMatch: 'full',
    canActivate: [marketingLandingGuard],
    loadComponent: () =>
      import('./features/marketing/marketing-landing.component').then(
        (m) => m.MarketingLandingComponent
      ),
  },
  {
    path: '**',
    loadComponent: () =>
      import('./features/not-found/not-found.component').then((m) => m.NotFoundComponent),
  },
];
