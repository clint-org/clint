# Frontend Architecture

[Back to index](README.md)

---

## Project Structure

```
src/client/
  src/
    app/
      app.component.ts          # Root component: router-outlet + global overlays (p-confirmdialog, p-toast)
      app.routes.ts             # Route definitions (lazy-loaded)
      app.config.ts             # App-level providers (router, animations, PrimeNG)
      core/
        guards/
          auth.guard.ts                  # authGuard + onboardingRedirectGuard
          agency.guard.ts                # kind === 'agency' AND (is_agency_member OR is_platform_admin) (gates /admin/*)
          super-admin.guard.ts           # kind === 'super-admin' AND is_platform_admin (gates /super-admin/*)
          tenant.guard.ts                # is_tenant_member(:tenantId) OR is_platform_admin (gates /t/:tenantId/*)
          marketing-landing.guard.ts     # gates /; routes by kind + auth + role-on-host (cross-host redirect when user lacks role for current host)
        util/
          color-scale.ts                 # generateBrandScale(seedHex) -> 50..950 hex scale (HSL math)
          cookie-session-storage.ts      # Supabase JS storage adapter using document.cookie
        layout/
          app-shell.component.ts        # Layout wrapper: sidebar + topbar + router-outlet
          sidebar.component.ts          # Unified nav: 48px collapsed (icons) / 220px expanded (hover/pin), always pushes content
          contextual-topbar.component.ts # Topbar: org/space breadcrumb + page identity (tabs, title, back nav, actions)
          icon-rail.component.ts        # (Unused) standalone icon rail -- absorbed into sidebar
          header.component.ts           # (Legacy) flat horizontal nav -- replaced by app-shell
          notification-bell.component.ts # Bell icon with unread count badge
          notification-panel.component.ts # Notification dropdown panel
        models/                 # TypeScript interfaces for all domain entities
          trial.model.ts        # Trial, TrialPhase, TrialNote, TherapeuticArea
          company.model.ts      # Company
          product.model.ts      # Product
          marker.model.ts       # MarkerType, TrialMarker
          catalyst.model.ts     # Catalyst, CatalystDetail, CatalystFilters, CatalystGroup, FlatCatalyst
          event.model.ts        # AppEvent, FeedItem, EventDetail, EventsPageFilters
          dashboard.model.ts    # DashboardData, DashboardFilters, ZoomLevel
          tenant.model.ts       # Tenant, TenantMember, TenantInvite, TenantAccessSettings
          space.model.ts        # Space, SpaceMember
          agency.model.ts       # Agency, AgencyMember, AgencyTenantSummary
          brand.model.ts        # Brand, BrandKind ('tenant'|'agency'|'super-admin'|'default')
        services/               # All business logic and API calls (16 services)
          topbar-state.service.ts # Lets pages contribute title, count, and actions to the topbar
      features/
        auth/                   # login.component (brand-driven), auth-callback.component (kind-aware redirect + self-join)
        marketing/              # marketing-landing.component (apex /, unauthenticated)
        agency/                 # Agency portal (mounted at /admin/*; agencyGuard + authGuard)
          agency-shell.component.ts             # Topbar + side nav (Tenants / Members / Branding) + <router-outlet>
          agency-tenant-list.component.ts       # Filterable table; row click -> tenant detail
          agency-tenant-new.component.ts        # Provisioning wizard with debounced subdomain availability check
          agency-tenant-detail.component.ts     # Branding edit + members list + "Open tenant" cross-host redirect
          agency-members.component.ts           # Add/remove agency members; lookup_user_by_email for email-based add
          agency-branding.component.ts          # Edit the agency portal's own brand
        super-admin/            # Super-admin portal (mounted at /super-admin/*; superAdminGuard + authGuard)
          super-admin-shell.component.ts        # Topbar + side nav (Agencies / Tenants / Domains)
          super-admin-agencies.component.ts     # All agencies + provision-agency dialog
          super-admin-tenants.component.ts      # All tenants + register-custom-domain dialog
          super-admin-domains.component.ts      # Retired-hostnames hold list
        dashboard/              # Main timeline grid + sub-components
        manage/                 # CRUD UIs for all entities
          companies/            # company-list, company-form
          products/             # product-list, product-form
          trials/               # trial-detail, trial-form, phase-form, marker-form, note-form
          marker-types/         # marker-type-list, marker-type-form
          therapeutic-areas/    # therapeutic-area-list, therapeutic-area-form
          taxonomies/           # Consolidated page: Therapeutic Areas, MOA, ROA with segmented control
        events/                 # Intelligence feed: table + detail panel
          events-page.component  # p-table with createGridState, detail panel toggle
          event-detail-panel.component # Right-side panel: description, sources, tags, thread, links
          event-form.component   # Create/edit event modal (p-dialog)
        catalysts/              # Key Catalysts: forward-looking marker timeline (child of landscape shell)
          catalysts-page.component   # Thin presenter: reads state.filteredCatalysts(), delegates detail to shared panel
          catalyst-table.component   # p-table with rowGroupMode="subheader" for time buckets
          catalyst-table.css         # Global table chrome (imported from styles.css)
          group-catalysts.ts         # Pure utility: adaptive time-bucket grouping (used by LandscapeStateService)
        spaces/                 # Space list, creation, and seed-demo URL trigger
          space-list.component.ts          # Filterable card grid with empty-state Create-space CTA
          seed-demo.component.ts           # Hits seed_demo_data RPC then redirects to catalysts; URL-only surface
        onboarding/             # Join with code; create-tenant path removed 2026-04-30 (orphan-tenant fix)
        tenant-settings/        # Tenant branding + members + access settings + danger zone
        space-settings/         # Per-space settings: general (name, description, delete) + members
          space-general.component.ts       # Name, description, danger zone (delete-space)
          space-members.component.ts       # Invite to space, role picker, remove member
        help/                   # User-facing role/permission docs
          roles-help.component.ts          # Renders role/permission breakdown for agency and tenant owners
      shared/
        animations/
          slide-panel.animation.ts  # Reusable slide-in/out trigger (@slidePanel) for overlay detail panels (200ms enter, 150ms leave)
          fade-tooltip.animation.ts # Reusable fade trigger (@fadeTooltip) for chart tooltips (120ms enter, 80ms leave)
          route-fade.animation.ts   # Route transition fade (@routeFade) for app-shell and landscape-shell (200ms)
          overlay.animation.ts      # Backdrop fade, menu slide-up, panel slide-down triggers for overlays
        styles/
          animations.css            # Global CSS entrance animations (.animate-content-enter, .animate-stagger, PrimeNG overrides, reduced-motion)
        constants/
          nav-icons.ts          # Canonical FA icon class for each navigable entity (single source of truth for sidebar, topbar, etc.)
        components/
          clint-logo.component.ts # Triple C logo mark: size-adaptive SVG with auto stroke thickening
          svg-icons/            # 6 SVG shape components for markers
          manage-page-shell.component.ts  # Padding-only page wrapper (optional narrow mode for detail pages)
          row-actions.component.ts        # Overflow (ellipsis) row-action menu
          status-tag.component.ts         # Squared status tag with status→tone mapping
          section-card.component.ts       # Flat bordered section with header + actions slot
          form-field.component.ts         # Labeled form field with error state
          form-actions.component.ts       # Cancel / submit button pair
          color-swatch.component.ts       # Color swatch chip
          marker-detail-panel.component.ts    # Unified detail panel shell: header (marker icon + category/type label + close button) + scrollable body. Accepts mode='inline' (static, used by catalysts page) or mode='drawer' (absolute overlay with @slidePanel animation + Escape-to-close, used by timeline). Replaces the former CatalystDetailPanelComponent and MarkerDetailDrawerComponent.
          marker-detail-content.component.ts # Shared detail panel body: title, projection/no-longer-expected badges, program (logo + company/product), trial context, date, description, source, upcoming markers, related events. Used by MarkerDetailPanelComponent and EventDetailPanelComponent.
        styles/
          manage-table.css      # Dense p-table chrome + shell layout classes
        utils/
          marker-icon.ts        # Shared marker shape-to-icon mapping
          grid-constants.ts     # Shared grid dimension constants
      config/
        primeng-theme.ts        # Aura preset, slate surface; exports buildBrandPreset(scale?: BrandScale)
    environments/
      environment.ts            # Supabase URL + anon key + apexDomain (empty = disable cookie session storage)
    assets/                     # Static resources
    main.ts                     # Bootstrap file
    styles.css                  # Global Tailwind CSS + manage-table.css + catalyst-table.css
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

## App Configuration & Bootstrap

The bootstrap sequence is whitelabel-aware. `main.ts`:

1. Reads `window.location.host` (or, in dev, the `?wl_kind=...&wl_id=...` query-string override)
2. Calls the anon-callable RPC `supabase.rpc('get_brand_by_host', { p_host: host })` via a temporary Supabase client created with `{ auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }` — disabling auth side effects is critical, otherwise this client's default `detectSessionInUrl: true` would race to consume the `?code=` fragment on `/auth/callback` into its own default-localStorage session (key `sb-{ref}-auth-token`) before `SupabaseService` (cookie storage, key `sb-auth`) can claim it, leaving the user with the session in the wrong storage and bouncing back to `/login`
3. Synchronously applies side effects:
   - `document.title = brand.app_display_name`
   - Swaps the `<link rel="icon">` href to `brand.favicon_url`
   - Sets `--brand-50` … `--brand-950` on `:root` from `generateBrandScale(brand.primary_color)`
4. Builds the dynamic preset: `buildBrandPreset(scale)` and passes it to `providePrimeNG`
5. Provides `BrandContextService` to DI with the brand pre-populated
6. `bootstrapApplication(AppComponent, mergeApplicationConfig(appConfig, dynamicConfig))`

If the RPC fails or the host doesn't match, `fetchBrand()` falls back to `DEFAULT_BRAND` (kind = `default`, teal scale, `auth_providers = ['google', 'microsoft']`). Bootstrap never blocks on the brand fetch beyond a single RPC round trip.

`app.config.ts` provides the static config (no `providePrimeNG` block — that moved to `main.ts` so the preset can be brand-driven):

```typescript
provideZoneChangeDetection({ eventCoalescing: true })
provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: 'always' }))
provideAnimationsAsync()
ConfirmationService
MessageService
```

App-level services: `ConfirmationService` (for `<p-confirmdialog>`) and `MessageService` (for `<p-toast>`).

Key decisions:
- `paramsInheritanceStrategy: 'always'` -- child routes inherit parent route params (tenantId, spaceId)
- `darkModeSelector: false` -- light mode only (no dark mode)
- `ripple: false` -- no Material-style ripple effects
- `buildBrandPreset(scale?)` lives in `config/primeng-theme.ts`; called with no argument it returns the existing teal-derived preset, with a scale it overrides `semantic.primary`. All other components (form fields, dialog, button, select, datatable, toast) reference `{primary.X}` so per-tenant overrides propagate transitively.

## Routing

All routes are lazy-loaded. Routes are host-aware AND role-aware: `agencyGuard`, `superAdminGuard`, and `marketingLandingGuard` short-circuit first on `BrandContextService.kind()`, then on the user's role for that host (`is_platform_admin` for super-admin, `is_agency_member` for agency). Server-side RPCs and RLS remain the authoritative gate; the guards prevent the empty privileged-shell from rendering for users who lack the role. The legacy `/t/:tenantId/...` shape is preserved for direct customers on the apex during cutover.

```
/                                   -> marketingLandingGuard
                                       (unauthed:  default -> MarketingLandingComponent; branded -> /login)
                                       (authed + has role:    default -> last tenant or /onboarding;
                                                              agency  -> /admin;
                                                              super-admin -> /super-admin;
                                                              tenant  -> /t/{brand.id}/spaces)
                                       (authed + lacks role for branded host: cross-host redirect to user's real home,
                                                                              or /onboarding if user has no agency/tenant)
/login                              -> LoginComponent (brand-driven; reads ?workspace= hint on apex)
/auth/callback                      -> AuthCallbackComponent (kind-aware redirect; attempts self-join on tenant subdomains)
/onboarding                         -> OnboardingComponent (authGuard)
/admin/*                            -> AgencyShellComponent (agencyGuard + authGuard)
  tenants                           -> AgencyTenantListComponent
  tenants/new                       -> AgencyTenantNewComponent
  tenants/:id                       -> AgencyTenantDetailComponent
  members                           -> AgencyMembersComponent
  branding                          -> AgencyBrandingComponent
/super-admin/*                      -> SuperAdminShellComponent (superAdminGuard + authGuard)
  agencies                          -> SuperAdminAgenciesComponent
  tenants                           -> SuperAdminTenantsComponent
  domains                           -> SuperAdminDomainsComponent
/t/:tenantId/                       -> AppShellComponent (layout wrapper; preserved for legacy / direct apex customers; gated by authGuard + tenantGuard)
  spaces                            -> SpaceListComponent
  settings                          -> TenantSettingsComponent
  help/roles                        -> RolesHelpComponent (user-facing role/permission breakdown; linked from space-members and tenant-settings invite dialogs)
  s/:spaceId/seed-demo              -> SeedDemoComponent (URL-only trigger for seed_demo_data; space-owner gated server-side)
  s/:spaceId/
    (empty)                         -> LandscapeShellComponent -> TimelineViewComponent
    bullseye/by-therapy-area        -> LandscapeIndexComponent
    bullseye/by-therapy-area/:id    -> LandscapeComponent
    bullseye/by-company             -> LandscapeIndexComponent
    bullseye/by-company/:id         -> LandscapeComponent
    bullseye/by-moa                 -> LandscapeIndexComponent
    bullseye/by-moa/:id             -> LandscapeComponent
    bullseye/by-roa                 -> LandscapeIndexComponent
    bullseye/by-roa/:id             -> LandscapeComponent
    positioning                     -> PositioningViewComponent
    catalysts                       -> CatalystsPageComponent
    manage/companies                -> CompanyListComponent
    manage/products                 -> ProductListComponent
    manage/trials                   -> TrialListComponent  (supports ?product=<id> filter)
    manage/trials/:id               -> TrialDetailComponent
    settings/marker-types           -> MarkerTypeListComponent
    settings/taxonomies             -> TaxonomiesPageComponent (Therapeutic Areas, MOA, ROA)
    events                          -> EventsPageComponent
/**                                 -> redirects to /
```

## Services

| Service | Responsibility |
|---|---|
| `BrandContextService` | Signal-based holder for the brand record from `get_brand_by_host`. Exposes `kind()`, `id()`, `appDisplayName()`, `logoUrl()`, `faviconUrl()`, `primaryColor()`, `authProviders()`, `hasSelfJoin()`, `suspended()`, `agency()` (`{name, logo_url} \| null` — only populated for tenant brands whose `tenants.agency_id` is set). Set once at bootstrap; `setBrand()` re-applies after a brand edit. |
| `SupabaseService` | Supabase client init, auth state (`currentUser`/`session` signals), `waitForSession()`, Google + Microsoft sign-in (`signInWithGoogle`, `signInWithMicrosoft`), sign-out. Conditionally uses cookie-based session storage (`createCookieStorage`) when `environment.apexDomain` is set and the current host is on the apex; otherwise localStorage. |
| `DashboardService` | Calls `get_dashboard_data()` RPC, maps nested response to typed models |
| `TenantService` | Tenant CRUD, member management, invite creation, `joinByCode()` flow, plus access settings (`getTenantAccessSettings`, `updateTenantAccess`), `selfJoinTenant`, `checkIsTenantMember` |
| `AgencyService` | Agency portal data layer: list tenants, provision tenant, update tenant branding, list/add/remove members, update agency branding, lookup user by email |
| `SuperAdminService` | Super-admin data layer: `listAllAgencies`, `listAllTenants`, `listRetiredHostnames`, `provisionAgency`, `registerCustomDomain`, `checkSubdomainAvailable`, `lookupUserByEmail` |
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
| `CatalystService` | Calls `get_catalyst_detail()` RPC for marker detail panels (used by events page and landscape state service) |
| `CtgovSyncService` | CT.gov API v2 fetch by NCT ID, maps to internal Trial fields |
| `TopbarStateService` | Root-level service for page-to-topbar communication. Pages set `title`, `recordCount`, `entityContext`, `entityTitle`, `actions`, `subTabs`, and `onSubTabClick` signals; the shell reads them and renders in the topbar. Pages call `clear()` on destroy. |

## Dashboard Component Hierarchy

```
DashboardComponent               # Orchestrates state, filters, loading
  FilterPanelComponent           # Collapsible filter sidebar (PrimeNG MultiSelect)
  ZoomControlComponent           # Yearly/quarterly/monthly/daily toggle
  LegendComponent                # Marker type reference grouped by category
  ExportDialogComponent          # PowerPoint export dialog
  DashboardGridComponent         # The timeline table (scrollable container, gear icon toggles MOA/ROA/Notes columns)
    GridHeaderComponent          # Column headers (date labels, sticky)
    RowLabel                     # Left column: company/product/trial labels (sticky)
    TrialRow                     # One row per trial
      PhaseBarComponent          # SVG <g> phase bar with rounded corners + label
      MarkerComponent            # SVG marker icon (6 shapes x 4 fills), receives trial/program context
        MarkerTooltipComponent   # Light hover tooltip: left accent bar, marker icon (shared svg-icons components), trial + program context
      RowNotesComponent          # Notes display below a trial row
  MarkerDetailPanelComponent     # Overlay panel (340px) on marker click: program, trial, date/status, description, source, upcoming, related (mode='drawer')
```

### DashboardComponent

The root dashboard component uses Angular signals extensively:

- `filtersSignal` -- reactive filter state
- `dashboardResource` -- `resource()` that reloads when filters change (request/loader pattern)
- `zoomLevel` -- signal driving column width calculations
- `computed()` -- derived lists for filter options (unique companies, etc.)
- `effect()` -- syncs filter state to URL query params

Click events on phase bars and trials navigate to trial detail pages. Marker clicks call `LandscapeStateService.selectMarker()`, which opens the shared detail panel rendered by the landscape shell. The detail panel (`MarkerDetailPanelComponent` with `mode='drawer'`, 340px, absolute-positioned right) fetches full detail via `get_catalyst_detail` RPC. Sections are ordered for the CI analyst's mental model: **Program** (company logo + company/product) and **Trial** (name, phase, recruitment status) appear first, followed by projection badge (Stout estimate / Company guidance / Primary source estimate) and "No longer expected" badge when applicable, then date/status, description, source URL (truncated to domain name via `extractDomain()`), upcoming markers, and related events. The header reuses the shared SVG icon components (`CircleIconComponent`, `DiamondIconComponent`, etc. from `shared/components/svg-icons/`) with fill style derived from `projection` (`actual` = filled, else outline) and `inner_mark` -- identical rendering to the timeline grid markers. The panel dismisses via X button or Escape; there is no backdrop. Clicking another marker inside the panel swaps its content in place. The panel persists across tab switches (timeline -> catalysts -> etc.) since it is owned by the landscape shell, not individual child views.

### AppShellComponent (Layout)

The `AppShellComponent` orchestrates the three-panel layout: sidebar + topbar + content area.

- **Sidebar** (`SidebarComponent`): Collapsed (48px, individual item icons with section dividers) or expanded (220px, icon + label per item). Both hover-expand and pin-expand use `position: relative` -- the sidebar always pushes content right, never overlays. Header contains the Triple C logo mark (`ClintLogoComponent`, 24px dark variant) + pin toggle. All icons sourced from `NAV_ICONS` constant. Org/space selection lives in the topbar, not the sidebar.
- **Topbar** (`ContextualTopbarComponent`): Left side shows an org/space breadcrumb (`Org / Space | Page`). Org and space are dropdown-switchable. Icons from `NAV_ICONS` appear on section tabs and list page titles. The right side of the divider adapts by page type:
  - `landscape` (used for all tab-based sections): dynamic section label (`sectionLabel` input) + icon-prefixed tab buttons. Landscape shows Timeline / Bullseye / Positioning / Catalysts; Intelligence shows Events; Manage shows Companies / Products / Trials. When Bullseye or Positioning is active, a row of smaller pill-style dimension sub-tabs appears after the main tabs (Bullseye: Therapy Area, Company, MOA, ROA; Positioning: MOA, Therapy Area, MOA + TA, Company, ROA). Sub-tab state is owned by `LandscapeShellComponent` and pushed to the topbar via `TopbarStateService.subTabs` / `onSubTabClick`.
  - `list`: icon + page title (e.g., "Taxonomies") + record count + action buttons (used for Settings pages)
  - `detail`: back button + entity eyebrow/title
  - `blank`: breadcrumb only
- **TopbarStateService**: Pages contribute their record count, action buttons, and dimension sub-tabs to the topbar via this root-level service. Pages set signals on init and call `clear()` on destroy. The shell reads these signals and passes them to the topbar component. Sub-tabs (`subTabs` signal + `onSubTabClick` callback) let feature pages like `LandscapeShellComponent` push view-specific dimension switchers without the app-shell knowing the feature details.
- **State persistence**: Stores `lastTenantId`, `lastSpaceId`, and `clint-sidebar-pinned` in localStorage
- **Route sync**: Recursively extracts route params (tenantId, spaceId) from Angular route tree

## Management Pages Pattern

All non-timeline management pages (Companies, Products, Trials, Marker Types, Therapeutic Areas, Tenant Settings, Spaces gallery) share a common presentation layer. The core visual principle is **zoning via background contrast**: the app root has `bg-slate-50`, and content surfaces (SectionCard, manage-table, p-dialog) are pure white with thin slate-200 borders. That 2-3% luminance shift is what separates "canvas" from "content zones" — no shadows, no gradients.

- **`ManagePageShellComponent`** -- padding-only layout wrapper. Provides consistent page padding (`1rem 2rem 4rem`). Accepts a `[narrow]="true"` input that caps the shell at `max-w-6xl` (~1152px) and centers it; use for form-heavy detail pages like `TrialDetailComponent` where fields shouldn't stretch to the viewport edge. Page identity (title, record count, action buttons) is handled by the topbar via `TopbarStateService`, not by this component.
  - **Scroll-container caveat for pages under `LandscapeShellComponent`**: the landscape shell wraps the routed outlet in a `relative flex-1 overflow-hidden` div so its bounded chart pages (Timeline / Bullseye / Positioning) can size their canvases against a fixed viewport. List-style pages routed under landscape (currently only Catalysts) flow naturally past that wrapper's height and would be clipped. Such pages MUST own their scroll container -- set `:host { display: block; height: 100%; overflow-y: auto }` with a mobile override (`overflow: visible; height: auto`) to fall back to the natural body scroll path. Pages under `AppShellComponent.content-area` (manage pages, agency portal, super-admin) inherit a scroll-capable parent and don't need this.
- **`SectionCardComponent`** -- flat white card with a `bg-slate-50/60` header strip (shaded zone for the uppercase tracked section label) and a white body (content zone). Used for sections on trial detail and each group inside the trial edit form. Supports `<div actions>` content projection in the header.
- **`manage-table.css`** (imported from `styles.css`) -- a single CSS layer that applies to any `<p-table>` opted in via `styleClass="manage-table"`. Produces a white card with slate-200 border, uppercase tracked 10px thead on a subtly-shaded slate-50/60 background, 13px dense rows with slate-100 row dividers, teal-50/55% row hover, and supports column modifiers `col-identifier` (mono tabular for NCT / generic names / codes), `col-num` (right-aligned tabular-nums), `col-secondary` (slate-500), and `col-actions` (narrow, right-aligned).
- **`RowActionsComponent`** -- `<app-row-actions [items]="...">` renders an ellipsis trigger button and an anchored PrimeNG `p-menu` popup. Destructive items set `styleClass: 'row-actions-danger'` so the shared CSS colors them red. Used on every manage-table row; replaces the bootstrap-style Edit/Delete text link pair. **Callers MUST memoize the `MenuItem[]`** — typically via a `private readonly menuCache = new Map<string, MenuItem[]>()` keyed by row id, cleared in the list's load method. Returning a fresh array from a `rowMenu(row)` template-call causes `p-menu` to re-render between `pointerdown` and `click`, which swallows the first click and forces the user to click every menu option twice. All existing list components (companies / products / trials / marker-types / therapeutic-areas / trial-detail / tenant-settings) use this pattern; copy it when adding a new list.
- **`StatusTagComponent`** -- `<app-status-tag [label]="t.status" />` auto-maps trial status strings to brand-safe tones (teal for Active/Recruiting, amber for Suspended/Not yet recruiting, slate for Completed/Terminated). Accepts an explicit `[tone]="'teal'|'amber'|'slate'|'neutral'"` override.

The Products list **no longer** renders its trials inline (the old chevron-expand + nested p-table pattern is removed). Instead, the Trials column shows a count that deep-links to `/manage/trials?product=<id>`, which filters the dedicated Trials list to that product. The "Add Trial" action moved with it: trials are created from the Trials list with a product dropdown, or from a product-filtered Trials view where the product is preselected.

The trial edit form (`TrialFormComponent`) **does not use `p-fieldset`**. The previous collapsible fieldset pattern for CT.gov sections (Study Design / Eligibility / Timeline / Regulatory) caused content-leakage bugs during collapse animations and has been replaced with sibling `SectionCard`s that are always expanded — users scroll. When adding new grouped form sections, follow the same pattern.

## Detail Panel Pattern (Overlay)

All detail panels across the app use a unified overlay pattern: a 340px absolute-positioned panel that slides in from the right edge of its container when an item is selected, and hides when nothing is selected. The chart/table beneath fills the full available width; the panel overlays on top of it. There is no backdrop or scroll lock -- the underlying content remains visible and interactive around the panel.

**Layout structure:** The container (`.landscape-layout` for landscape views, or a `position: relative` wrapper for events/catalysts) uses `position: relative` with its chart or table filling the full space. The panel wrapper (`.landscape-panel-wrap` or an inline `absolute` div) is positioned `absolute top-0 right-0 bottom-0 w-[340px] z-10` with a left box-shadow for depth.

**Consumers:**
- **Timeline + Catalysts** -- Shared `MarkerDetailPanelComponent` with `mode='drawer'` rendered by `LandscapeShellComponent`. State lives in `LandscapeStateService` (`selectedMarkerId`, `selectedDetail`, `detailLoading`). Panel persists across tab switches.
- **Bullseye** -- `LandscapeComponent` (dot click opens `BullseyeDetailPanelComponent`: product name, company, MOA/ROA tags, trials with recruitment status, recent markers with formatted dates, "Open in timeline" action)
- **Positioning** -- `PositioningViewComponent` (bubble click opens `PositioningDetailPanelComponent`: "COMPETITIVE GROUP" header, stacked stats, phase breakdown chips, clickable products with generic names and navigation arrows, "Open in bullseye" cross-navigation that maps the current positioning grouping to the matching bullseye dimension)
- **Events** -- `EventsPageComponent` (row click opens `EventDetailPanelComponent`)

**When adding a new detail panel:** use `position: relative` on the parent container, absolute-position the panel at the right edge, import `slidePanelAnimation` from `shared/animations/slide-panel.animation.ts`, and apply `@slidePanel` to the panel wrapper inside an `@if` block so the animation triggers on enter/leave.

## Shared Animations

Reusable Angular animation triggers live in `shared/animations/`:

- **`slidePanelAnimation`** (`@slidePanel`) -- translateX slide-in from the right (200ms ease-out enter, 150ms ease-in leave). Used by all five detail panel consumers listed above.
- **`fadeTooltipAnimation`** (`@fadeTooltip`) -- opacity fade (120ms ease-out enter, 80ms ease-in leave). Used by `BullseyeTooltipComponent` and `PositioningTooltipComponent` for chart hover tooltips.
- **`routeFadeAnimation`** (`@routeFade`) -- opacity fade (200ms) on route transitions. Bind to a value that changes on navigation (e.g., route path). Used by `AppShellComponent` (top-level routes) and `LandscapeShellComponent` (view mode + dimension changes).
- **`backdropFadeAnimation`** (`@backdropFade`) -- opacity fade (150ms enter, 100ms leave) for overlay backdrops. Used by the account menu in `AppShellComponent`.
- **`menuSlideUpAnimation`** (`@menuSlideUp`) -- fade + translateY slide up (150ms enter, 100ms leave) for menus appearing from below a trigger. Used by the account menu.
- **`panelSlideDownAnimation`** (`@panelSlideDown`) -- fade + translateY slide down (150ms enter, 100ms leave) for panels appearing below a trigger.

Import the trigger constant, add it to the component's `animations` array, and apply the trigger name (e.g., `@slidePanel`) to the conditionally-rendered element.

### CSS Animations (`shared/styles/animations.css`)

Global CSS-based entrance animations imported via `styles.css`. Angular handles route and overlay transitions; these handle in-page reveals:

- **`.animate-content-enter`** -- fade + subtle 6px lift (250ms). For page-level content blocks.
- **`.animate-fade-in`** -- simple opacity fade (200ms). For lighter entrance needs.
- **`.animate-stagger`** -- apply to parent; children animate sequentially with 30ms delays (capped at 8 children / 210ms to stay authoritative, not playful).
- **PrimeNG overrides** -- dialog gets a subtle scale-up entrance; toast messages use a cleaner slide transition. `AppComponent` configures toast to slide from the right via `showTransformOptions`.
- **Reduced motion** -- `@media (prefers-reduced-motion: reduce)` disables all custom animations and transitions.

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

The custom theme preset (`config/primeng-theme.ts`) is brand-aware. It exports `buildBrandPreset(scale?: BrandScale)` — called with no argument it returns the default preset (teal-derived primary scale), with a scale it overrides `semantic.primary`. All component overrides reference `{primary.X}` (never `{teal.X}`) so the override propagates.

Configured baseline:
- **Base**: Aura preset
- **Primary**: dynamic — defaults to teal (11 shade ramp: 50-950); per-tenant overrides via `BrandContextService.primaryColor()` -> `generateBrandScale()` -> `buildBrandPreset(scale)` in `main.ts`
- **Surface**: Slate neutrals (never tenant-driven; structural)
- **Dark mode**: Disabled
- **Ripple**: Disabled
- **CSS layers**: Disabled
- **Prefix**: `p`

## Overlays (Select / MultiSelect / DatePicker / AutoComplete / Menu / OverlayPanel)

`providePrimeNG` in `main.ts` sets `overlayOptions: { appendTo: 'body' }` globally. Every PrimeNG overlay component renders its panel as a direct child of `<body>`, so it ignores `overflow:hidden` and stacking contexts on its parent chain. Without this, dropdowns inside `p-table` / scroll containers / the topbar got clipped or hidden behind page content -- the original failure mode that motivated the change.

**Implication for styling:** body-portaled panels are outside the host component's view encapsulation, so `:host` and component-scoped selectors do not reach them. Use design tokens (theme overrides in `primeng-theme.ts`) or pass a `panelStyleClass` that resolves to a global rule. Existing PrimeNG styling is token-driven, so this is rarely a problem in practice.

**Custom (non-PrimeNG) dropdowns** -- e.g. the org/space breadcrumb in `ContextualTopbarComponent` -- are not covered by `appendTo`. Their host component must establish its own stacking context above the content area (`position: relative; z-index: 30` on `:host` in the topbar). Page content uses no z-index, so a small positive value is enough.

`p-dialog`, `p-confirmdialog`, `p-toast` already render at the app root and were never affected.

## Brand-Aware Tailwind Tokens

`styles.css` declares an `@theme` block with `--color-brand-50` … `--color-brand-950` mapped to CSS variables that default to the teal scale:

```css
@theme {
  --color-brand-50:  var(--brand-50,  #f0fdfa);
  --color-brand-100: var(--brand-100, #ccfbf1);
  /* ... through 950 */
}
```

The `var(--brand-X, <fallback>)` form means: when `main.ts` sets `--brand-X` on `:root` from `generateBrandScale(brand.primary_color)`, Tailwind picks it up. Otherwise it falls back to teal — existing tenants without a brand override render identically.

**Convention:** use `bg-brand-*`, `text-brand-*`, `border-brand-*`, `ring-brand-*`, `from-brand-*`, `via-brand-*`, `to-brand-*` (and `outline-`, `decoration-`, `divide-`, `placeholder-`, `accent-`, `caret-`, `fill-`, `stroke-` variants) for any utility that should respect the tenant brand. Never reach for `bg-teal-*` — that locks the color to the platform default. Slate, red, amber, green, cyan, violet stay hard-coded — those are data colors (markers, phase bars, status indicators) and are not tenant-configurable.

The codemod that landed during the whitelabel rollout swept `~73 occurrences` of `*-teal-*` → `*-brand-*` across the client. New code must follow the same convention.

`generateBrandScale(seedHex: string): BrandScale` lives in `core/util/color-scale.ts`. It converts the seed hex to HSL and **anchors the seed at the 600 stop** (the dominant brand stop in the codebase — buttons, links, active accents). Other stops derive from the seed's lightness via fixed deltas (lighter for 50–500, darker for 700–950) while preserving the seed's hue. Saturation tapers at the lightest stops (50/100/200) and darkest stops (900/950) to prevent candy-colored tints and muddy darks.

The seed-as-600 anchor means tenants get a "what you picked is what you see on buttons" experience. The trade-off: extreme seeds (very dark like `#08312a` at 11% lightness, or very light) cause the far end of the scale to clamp at the lightness floor (0.02) or ceiling (0.98), so layered dark surfaces or subtle background tints lose differentiation. Mid-tone seeds (lightness 0.30–0.55) produce the most balanced scales.

### Three brand surfaces

The app has three layers of branding, each with a distinct color source:

- **Tenant whitelabel surface** (`/t/:tenantId/...` on a tenant subdomain) — uses the tenant's `primary_color`. End users (the agency's pharma clients) see this; it must reflect the tenant identity.
- **Agency portal** (`/admin/*` on an agency subdomain) — uses the agency's `primary_color`. The agency's consultants live in this surface; reflecting their brand here is part of the whitelabel value the agency is paying for. Agencies with a pale seed should pick something with enough contrast for primary buttons (the brand picker should warn, but ultimately the agency owns the choice).
- **Super-admin portal** (`/super-admin/*` on `admin.<apex>`) — locked to the platform's standard teal palette via `.admin-brand-scope` on `SuperAdminShellComponent`. This is platform infrastructure, owned by the platform operator, not whitelabeled to anyone.

The `.admin-brand-scope` class lives in `shared/styles/admin-brand.css` and re-declares `--brand-50..950` and `--p-primary-50..950` to the platform teal scale. Both Tailwind utilities (`bg-brand-600`) and PrimeNG components (`{primary.600}`) inside the scope inherit the override via CSS variable cascade.

Apply `.admin-brand-scope` only to new super-admin shells. Don't add it to agency-portal or tenant-facing surfaces — those are whitelabel surfaces and must inherit their respective brand.

### Agency attribution on tenant surfaces

Tenant brands provisioned by an agency carry an `agency: { name, logo_url }` descriptor on the brand record (returned by `get_brand_by_host`). Two surfaces render it:

- **Login footer** (`auth/login.component.ts`). When `kind === 'tenant' && agency`, the card grows a `border-t` footer beneath the sign-in buttons containing "Competitive intelligence by" plus the agency logo. The tenant logo + "Sign in to {tenant}" stays at the top — the workspace is the foreground, the provider is the provenance.
- **App-shell sidebar** (`core/layout/sidebar.component.ts`). On a tenant host whose tenant has an agency, the agency occupies the platform-brand slot at the top of the sidebar — they whitelabeled Clint, so they sit where Clint would. **Expanded sidebar:** the agency's `logo_url` renders as a wordmark on a light `slate-50` tile (height 24px, max-width 156px, `object-fit: contain`) so dark-on-light agency wordmarks stay legible against the slate-900 sidebar. **Collapsed sidebar (48px):** an initial-letter badge on a brand-tinted square stands in for the wordmark, since wordmarks shrink illegibly at that width. **Fallback:** when the agency has no `logo_url`, the initial badge is used in both states. Sourced from `BrandContextService.agency` (host-derived), not from the URL's tenant id.

Both surfaces hide gracefully on agency, super-admin, and default brands (no agency descriptor → Clint mark in the sidebar, no agency footer on login). The agency portal at `/admin/*` uses its own shell (`AgencyShellComponent`), so the sidebar agency-mark logic never runs there.

**Earlier iteration:** `contextual-topbar.component.ts` rendered a small agency badge to the left of the tenant breadcrumb (separated by `/`). That treatment competed visually with the tenant brand on every page and used `object-fit: cover`, which center-cropped wide wordmarks (e.g. "STOUT STRATEGY" rendered as "STO|"). It was removed when the platform-brand slot moved to the sidebar.

The dev brand override at `main.ts` accepts `wl_agency_name` and `wl_agency_logo` query params (alongside `wl_kind=tenant`) for smoke-testing this attribution UI without a real tenant→agency row in the local DB.

## Toasts (save/action feedback)

All user-facing success feedback uses PrimeNG `p-toast` via `MessageService`. A single `<p-toast position="top-right" />` lives in `app.component.ts` -- individual components never render their own toast element.

**Pattern:** inject `MessageService` and call `this.messageService.add({ severity: 'success', summary: 'Saved.', life: 3000 })`. Use `life: 3000` (3 seconds auto-dismiss) for success confirmations. The toast stacks naturally if multiple actions fire in quick succession.

**Visual treatment:** Toasts use square corners (`borderRadius: 0`), a uniform `slate-200` border, and a 3px left-border accent colored per severity (teal for success, red for error, amber for warn, slate for info). Close button and icon are tightened for a compact, data-instrument feel. These overrides live in `primeng-theme.ts` (design tokens) and `primeng-overrides.css` (structural CSS).

**Do not** use inline `<span>` text next to buttons or `<p-message severity="success">` banners for save confirmations. Those patterns were removed in favor of the unified toast system. `<p-message>` is still used for inline error display within forms.

## Surfacing error messages from Supabase

Supabase RPC and query errors come back as `PostgrestError` -- a plain object with a `.message` field, **not** a JS `Error` instance. The naive catch pattern `e instanceof Error ? e.message : 'fallback'` silently masks the real reason (e.g. domain-mismatch from `add_tenant_owner`) with a generic fallback.

**Use `extractErrorMessage(err, fallback)` from `core/util/error-message.ts`** in any catch that surfaces a message to the user. It handles `Error`, string, and plain-object-with-`.message` shapes. Example:

```ts
try {
  await this.tenantService.addTenantOwner(id, email);
} catch (e) {
  this.addOwnerError.set(extractErrorMessage(e, 'Failed to add owner'));
}
```

Many older catches still use the buggy `instanceof Error` pattern; convert them when you touch nearby code, but don't sweep them in unrelated changes.

## Grids and list pages

All five manage-section list pages (companies, products, trials, therapeutic-areas, marker-types) share a single filtering, sorting, and pagination pattern built on PrimeNG `p-table`. Do not add new grids without following this pattern.

**Three units:**

- `src/client/src/app/shared/grids/create-grid-state.ts` — a factory called from inside a component that owns filter/sort/page signals, encodes and decodes URL query params, and exposes `filteredRows(raw)` as a projection. Must be called in an Angular injection context (component field initializer or constructor). Uses `inject(ActivatedRoute, Router)` internally.
- `src/client/src/app/shared/grids/url-codec.ts` and `filter-algebra.ts` — pure modules (no Angular imports) that the factory composes. Fully tested in `e2e/tests/grid-url-codec.spec.ts` and `e2e/tests/grid-filter-algebra.spec.ts` as Playwright pure-function specs that run via `npm run test:unit` with no browser or Supabase needed.
- `src/client/src/app/shared/components/grid-toolbar.component.ts` — presenter that renders the slim toolbar (global search + active-filter chips + clear-all). Takes the grid state as its only required input.

**Wiring a new grid:**

1. Declare a view-model interface for the row (decorated with any join data the grid displays).
2. Build a `rows` computed signal that produces the decorated view-models — no filtering, sorting, or paging in here.
3. Call `createGridState<RowType>({ columns, globalSearchFields, defaultSort? })` as a component field. Declare filterable columns via `ColumnDef`, specifying filter kind (`text`, `select`, `numeric`, `date`) per column.
4. Create `visibleRows = this.grid.filteredRows(this.rows)` and bind it to `<p-table [value]="visibleRows()">`.
5. On `<p-table>`, set `[lazy]="true"`, `(onLazyLoad)="grid.onLazyLoad($any($event))"`, `[paginator]="true"`, `[rows]="grid.page().rows"`, `[first]="grid.page().first"`, `[totalRecords]="grid.totalRecords()"`, `[rowsPerPageOptions]="[10, 25, 50, 100]"`, `[filters]="grid.primengFilters()"`.
6. Add `<app-grid-toolbar [state]="grid" searchPlaceholder="..." />` above the table inside `<app-manage-page-shell>`.
7. On each sortable column header add `pSortableColumn="<field>"` and `<p-sortIcon field="<field>" />`; on each filterable header add `<p-columnFilter field="<field>" display="menu" type="text|numeric">`. For select filters, provide a custom `<ng-template #filter>` with a `<select>` element that calls the `filterCallback`.
8. Update the `<ng-template #emptymessage>` to distinguish "no matches" (`grid.isFiltered()`) from "no data".
9. Inject `TopbarStateService` and use an `effect()` to sync `topbarState.recordCount.set(String(grid.totalRecords() || ''))`. Set page-specific action buttons in `ngOnInit` and call `topbarState.clear()` in `ngOnDestroy`.

**URL schema:** `?q=<text>&filter.<field>=<value>&sort=[-]<field>&page=<n>&pageSize=<n>`. See the design spec at `docs/superpowers/specs/2026-04-11-grid-filtering-design.md` for the full encoding rules, numeric operator syntax, and date range syntax.

**Deep-linking into a filtered grid:** consumers that navigate *into* a grid with specific filters pre-applied (e.g., `company-list::openProducts(id)` landing on a pre-filtered products grid) use `buildFilterQueryParams` from `shared/grids`. Do not hand-roll query params. The helper accepts a `Record<string, FilterValue>` and returns the query-param object to pass to `router.navigate(..., { queryParams })`. Consumers must know the target grid's filterable field names (e.g., `product.company_id`, `trial.product_id`) — see the per-grid column list in the spec for the public deep-link fields.

**Why `$any($event)` on `onLazyLoad`:** PrimeNG's `TableLazyLoadEvent.sortField` type is `string | string[] | null`, which is wider than what our handler accepts. The `$any()` template helper bypasses the strict template type check at this single binding point. If you find a cleaner way to align the types, replace it — but do not narrow PrimeNG's type, that breaks bindings.
