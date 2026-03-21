# Frontend Architecture

[Back to index](README.md)

---

## Project Structure

```
src/client/
  src/
    app/
      app.component.ts          # Root component: header + router-outlet
      app.routes.ts             # Route definitions (lazy-loaded)
      app.config.ts             # App-level providers (router, animations, PrimeNG)
      core/
        guards/
          auth.guard.ts         # authGuard + onboardingRedirectGuard
        layout/
          header.component.ts   # Navigation: logo, tenant/space switcher, user menu
        models/                 # TypeScript interfaces for all domain entities
          trial.model.ts        # Trial, TrialPhase, TrialNote, TherapeuticArea
          company.model.ts      # Company
          product.model.ts      # Product
          marker.model.ts       # MarkerType, TrialMarker
          dashboard.model.ts    # DashboardData, DashboardFilters, ZoomLevel
          tenant.model.ts       # Tenant, TenantMember, TenantInvite
          space.model.ts        # Space, SpaceMember
        services/               # All business logic and API calls (15 services)
      features/
        auth/                   # login.component, auth-callback.component
        dashboard/              # Main timeline grid + sub-components
        manage/                 # CRUD UIs for all entities
          companies/            # company-list, company-form
          products/             # product-list, product-form
          trials/               # trial-detail, trial-form, phase-form, marker-form, note-form
          marker-types/         # marker-type-list, marker-type-form
          therapeutic-areas/    # therapeutic-area-list, therapeutic-area-form
        spaces/                 # Space list and creation
        onboarding/             # Create org / join with invite code
        tenant-settings/        # Tenant management and member invites
      shared/
        components/svg-icons/   # 6 SVG shape components for markers
      config/
        primeng-theme.ts        # Aura preset, teal primary, slate surface
    environments/
      environment.ts            # Supabase URL + anon key
    assets/                     # Static resources
    main.ts                     # Bootstrap file
    styles.css                  # Global Tailwind CSS (@import "tailwindcss")
```

## Angular Conventions

The frontend strictly follows Angular 19 patterns:

- **Standalone components only** -- no NgModules anywhere
- **`inject()` for DI** -- not constructor injection
- **Signals for state** -- `signal()`, `computed()`, `effect()`, `resource()`
- **Signal inputs/outputs** -- `input()` and `output()` (new syntax)
- **New control flow** -- `@if`, `@for`, `@switch` (not `*ngIf`, `*ngFor`)
- **Lazy loading** -- all feature routes use `loadComponent` / `loadChildren`
- **Lean components** -- business logic belongs in services, not components
- **Inline templates** -- most components use template literals in the decorator
- **Async/await** -- all async operations use async/await, not RxJS Observables in services

## App Configuration

`app.config.ts` provides:

```typescript
provideZoneChangeDetection({ eventCoalescing: true })
provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: 'always' }))
provideAnimationsAsync()
providePrimeNG({
  theme: {
    preset: ClinicalTheme,
    options: { prefix: 'p', darkModeSelector: false, cssLayer: false }
  },
  ripple: false
})
```

Key decisions:
- `paramsInheritanceStrategy: 'always'` -- child routes inherit parent route params (tenantId, spaceId)
- `darkModeSelector: false` -- light mode only (no dark mode)
- `ripple: false` -- no Material-style ripple effects

## Routing

All routes are lazy-loaded. The route hierarchy:

```
/login                              -> LoginComponent
/auth/callback                      -> AuthCallbackComponent
/onboarding                         -> OnboardingComponent (authGuard)
/t/:tenantId/
  spaces                            -> SpaceListComponent
  settings                          -> TenantSettingsComponent
  s/:spaceId/
    (empty)                         -> DashboardComponent
    manage/companies                -> CompanyListComponent
    manage/products                 -> ProductListComponent
    manage/trials/:id               -> TrialDetailComponent
    manage/marker-types             -> MarkerTypeListComponent
    manage/therapeutic-areas        -> TherapeuticAreaListComponent
/                                   -> onboardingRedirectGuard (auto-redirect)
/**                                 -> redirects to /
```

## Services

| Service | Responsibility |
|---|---|
| `SupabaseService` | Supabase client init, auth state (`currentUser`/`session` signals), `waitForSession()`, Google sign-in/out |
| `DashboardService` | Calls `get_dashboard_data()` RPC, maps nested response to typed models, `seedDemoData()` |
| `TenantService` | Tenant CRUD, member management, invite creation, `joinByCode()` flow |
| `SpaceService` | Space CRUD via `create_space()` RPC, member management, role updates |
| `CompanyService` | Company CRUD within a space (with display_order) |
| `ProductService` | Product CRUD linked to a company (with display_order) |
| `TrialService` | Trial CRUD with nested relations (phases, markers, notes, therapeutic areas) |
| `TrialPhaseService` | Phase records (phase_type, start/end dates, color, label) |
| `TrialMarkerService` | Event markers (event_date, end_date, tooltip_text, is_projected) |
| `TrialNoteService` | Free-text annotations on trials |
| `MarkerTypeService` | Custom marker type CRUD (system types are read-only) |
| `TherapeuticAreaService` | Therapeutic area CRUD (name, abbreviation) |
| `TimelineService` | Date-to-pixel calculations, column generation, zoom config |
| `PptxExportService` | Client-side PowerPoint generation via pptxgenjs |
| `CtgovSyncService` | CT.gov API v2 fetch by NCT ID, maps to internal Trial fields |

## Dashboard Component Hierarchy

```
DashboardComponent               # Orchestrates state, filters, loading
  FilterPanelComponent           # Collapsible filter sidebar (PrimeNG MultiSelect)
  ZoomControlComponent           # Yearly/quarterly/monthly/daily toggle
  LegendComponent                # Marker type reference grouped by category
  ExportDialogComponent          # PowerPoint export dialog
  DashboardGridComponent         # The timeline table (scrollable container)
    GridHeaderComponent          # Column headers (date labels, sticky)
    RowLabel                     # Left column: company/product/trial labels (sticky)
    TrialRow                     # One row per trial
      PhaseBarComponent          # SVG <g> phase bar with rounded corners + label
      MarkerComponent            # SVG marker icon (6 shapes x 4 fills)
        MarkerTooltipComponent   # Hover tooltip with marker details
      RowNotesComponent          # Notes display below a trial row
```

### DashboardComponent

The root dashboard component uses Angular signals extensively:

- `filtersSignal` -- reactive filter state
- `dashboardResource` -- `resource()` that reloads when filters change (request/loader pattern)
- `zoomLevel` -- signal driving column width calculations
- `computed()` -- derived lists for filter options (unique companies, etc.)
- `effect()` -- syncs filter state to URL query params

Click events on phase bars, markers, and trials emit from the grid and navigate to trial detail pages.

### HeaderComponent

The `HeaderComponent` provides global navigation:

- **Left**: "Clint" logo + tenant dropdown (if multiple tenants) + space dropdown
- **Center**: Navigation links when inside a space (Dashboard, Companies, Products, Markers, Therapeutic Areas)
- **Right**: Settings gear icon, user email, Sign out button
- **State persistence**: Stores `lastTenantId` and `lastSpaceId` in localStorage
- **Route sync**: Recursively extracts route params (tenantId, spaceId) from Angular route tree

## Models

Seven TypeScript model files define the domain:

```typescript
Company       { id, space_id, name, logo_url, display_order, created_by, created_at, updated_at }
Product       { id, space_id, company_id, name, generic_name, logo_url, display_order, created_by, ... }
Trial         { id, space_id, product_id, therapeutic_area_id, name, identifier, sample_size, status,
                notes, display_order, + 35 CT.gov dimension fields, created_by, ... }
TrialPhase    { id, trial_id, space_id, phase_type, start_date, end_date, color, label, created_by, ... }
TrialMarker   { id, trial_id, space_id, marker_type_id, event_date, end_date, tooltip_text,
                tooltip_image_url, is_projected, created_by, ... }
TrialNote     { id, trial_id, space_id, content, created_by, ... }
MarkerType    { id, space_id, name, icon, shape, fill_style, color, is_system, display_order }
TherapeuticArea { id, space_id, name, abbreviation, created_by, ... }
Space         { id, tenant_id, name, description, created_by, ... }
SpaceMember   { space_id, user_id, role }  // 'owner' | 'editor' | 'viewer'
Tenant        { id, name, slug }
TenantMember  { tenant_id, user_id, role }  // 'owner' | 'member'
TenantInvite  { id, tenant_id, email, role, invite_code, created_by, accepted_at, expires_at }

// Aggregates
DashboardData    { companies: CompanyWithProducts[] }
DashboardFilters { companyIds, productIds, therapeuticAreaIds, startYear, endYear,
                   recruitmentStatuses, studyTypes, phases }
ZoomLevel        'yearly' | 'quarterly' | 'monthly' | 'daily'
```

## SVG Icon Components

Six custom SVG marker shape components in `shared/components/svg-icons/`:

| Component | Shape | Inputs |
|---|---|---|
| `CircleIconComponent` | Circle | size, color, fillStyle |
| `DiamondIconComponent` | Diamond/rhombus | size, color, fillStyle |
| `FlagIconComponent` | Flag on pole | size, color, fillStyle |
| `ArrowIconComponent` | Up-pointing triangle | size, color, fillStyle |
| `XIconComponent` | Overlaid X mark | size, color, fillStyle |
| `BarIconComponent` | Horizontal bar | size, color, fillStyle |

All support four fill styles via SVG `<defs>`: `filled`, `outline`, `striped`, `gradient`.

## PrimeNG Theme

The custom theme preset (`config/primeng-theme.ts`) configures:
- **Base**: Aura preset
- **Primary**: Teal (11 shade ramp: 50-950)
- **Surface**: Slate neutrals
- **Dark mode**: Disabled
- **Ripple**: Disabled
- **CSS layers**: Disabled
- **Prefix**: `p`
