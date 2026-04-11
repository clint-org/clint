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
        components/
          svg-icons/            # 6 SVG shape components for markers
          manage-page-shell.component.ts  # Full-bleed page shell (eyebrow, title, count, actions)
          row-actions.component.ts        # Overflow (ellipsis) row-action menu
          status-tag.component.ts         # Squared status tag with status→tone mapping
          section-card.component.ts       # Flat bordered section with header + actions slot
          form-field.component.ts         # Labeled form field with error state
          form-actions.component.ts       # Cancel / submit button pair
          color-swatch.component.ts       # Color swatch chip
        styles/
          manage-table.css      # Dense p-table chrome + shell layout classes
        utils/
          marker-icon.ts        # Shared marker shape-to-icon mapping
          grid-constants.ts     # Shared grid dimension constants
      config/
        primeng-theme.ts        # Aura preset, teal primary, slate surface
    environments/
      environment.ts            # Supabase URL + anon key
    assets/                     # Static resources
    main.ts                     # Bootstrap file
    styles.css                  # Global Tailwind CSS + shared/styles/manage-table.css
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
    manage/trials                   -> TrialListComponent  (supports ?product=<id> filter)
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
| `TrialService` | Trial CRUD with nested relations (phases, markers, notes, therapeutic areas). Exposes `listByProduct(productId)` and `listBySpace(spaceId)`. |
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

- **Left**: "Clint" logo + tenant dropdown (if multiple tenants) + space dropdown, separated by slate-200 slashes
- **Center**: Uppercase tracked navigation links when inside a space (Dashboard, Companies, Products, Trials, Markers, Areas) with a teal-600 underline on the active link
- **Right**: Settings gear icon + initials avatar button that opens a native popover (no PrimeNG `MenuModule` — that would be eager-loaded) with the signed-in email and a Sign out action. The popover closes on outside click, Escape, or navigation.
- **State persistence**: Stores `lastTenantId` and `lastSpaceId` in localStorage
- **Route sync**: Recursively extracts route params (tenantId, spaceId) from Angular route tree

## Management Pages Pattern

All non-timeline management pages (Companies, Products, Trials, Marker Types, Therapeutic Areas, Tenant Settings, Spaces gallery) share a common presentation layer. The core visual principle is **zoning via background contrast**: the app root has `bg-slate-50`, and content surfaces (SectionCard, manage-table, p-dialog) are pure white with thin slate-200 borders. That 2-3% luminance shift is what separates "canvas" from "content zones" — no shadows, no gradients.

- **`ManagePageShellComponent`** -- layout shell with eyebrow label, tracked title, optional record count, optional subtitle, and a right-aligned `<div actions>` content-projection slot. Defaults to full-bleed for list/table pages. Accepts a `[narrow]="true"` input that caps the shell at `max-w-6xl` (~1152px) and centers it; use for form-heavy detail pages like `TrialDetailComponent` where fields shouldn't stretch to the viewport edge.
- **`SectionCardComponent`** -- flat white card with a `bg-slate-50/60` header strip (shaded zone for the uppercase tracked section label) and a white body (content zone). Used for sections on trial detail and each group inside the trial edit form. Supports `<div actions>` content projection in the header.
- **`manage-table.css`** (imported from `styles.css`) -- a single CSS layer that applies to any `<p-table>` opted in via `styleClass="manage-table"`. Produces a white card with slate-200 border, uppercase tracked 10px thead on a subtly-shaded slate-50/60 background, 13px dense rows with slate-100 row dividers, teal-50/55% row hover, and supports column modifiers `col-identifier` (mono tabular for NCT / generic names / codes), `col-num` (right-aligned tabular-nums), `col-secondary` (slate-500), and `col-actions` (narrow, right-aligned).
- **`RowActionsComponent`** -- `<app-row-actions [items]="...">` renders an ellipsis trigger button and an anchored PrimeNG `p-menu` popup. Destructive items set `styleClass: 'row-actions-danger'` so the shared CSS colors them red. Used on every manage-table row; replaces the bootstrap-style Edit/Delete text link pair. **Callers MUST memoize the `MenuItem[]`** — typically via a `private readonly menuCache = new Map<string, MenuItem[]>()` keyed by row id, cleared in the list's load method. Returning a fresh array from a `rowMenu(row)` template-call causes `p-menu` to re-render between `pointerdown` and `click`, which swallows the first click and forces the user to click every menu option twice. All existing list components (companies / products / trials / marker-types / therapeutic-areas / trial-detail / tenant-settings) use this pattern; copy it when adding a new list.
- **`StatusTagComponent`** -- `<app-status-tag [label]="t.status" />` auto-maps trial status strings to brand-safe tones (teal for Active/Recruiting, amber for Suspended/Not yet recruiting, slate for Completed/Terminated). Accepts an explicit `[tone]="'teal'|'amber'|'slate'|'neutral'"` override.

The Products list **no longer** renders its trials inline (the old chevron-expand + nested p-table pattern is removed). Instead, the Trials column shows a count that deep-links to `/manage/trials?product=<id>`, which filters the dedicated Trials list to that product. The "Add Trial" action moved with it: trials are created from the Trials list with a product dropdown, or from a product-filtered Trials view where the product is preselected.

The trial edit form (`TrialFormComponent`) **does not use `p-fieldset`**. The previous collapsible fieldset pattern for CT.gov sections (Study Design / Eligibility / Timeline / Regulatory) caused content-leakage bugs during collapse animations and has been replaced with sibling `SectionCard`s that are always expanded — users scroll. When adding new grouped form sections, follow the same pattern.

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
