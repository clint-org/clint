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
          color-scale.ts                 # generateBrandScale(seedHex) -> 50..950 hex scale (HSL math); pickStopForSurface(scale, surfaceHex) -> stop with WCAG 4.5:1 contrast against the surface (drives --brand-on-dark/--brand-on-light)
          cookie-session-storage.ts      # Supabase JS storage adapter using document.cookie
        layout/
          app-shell.component.ts        # Layout wrapper: sidebar + topbar + router-outlet
          sidebar.component.ts          # Unified nav: 48px collapsed (icons) / 220px expanded (hover/pin), always pushes content
          contextual-topbar.component.ts # Topbar: org/space breadcrumb + page identity (tabs, title, back nav, actions)
          icon-rail.component.ts        # (Unused) standalone icon rail -- absorbed into sidebar
          header.component.ts           # (Legacy) flat horizontal nav -- replaced by app-shell
        models/                 # TypeScript interfaces for all domain entities
          trial.model.ts        # Trial, TrialPhase, TrialNote, TherapeuticArea
          company.model.ts      # Company
          asset.model.ts      # Product
          marker.model.ts       # MarkerType, TrialMarker
          catalyst.model.ts     # Catalyst, CatalystDetail, CatalystFilters, CatalystGroup, FlatCatalyst
          event.model.ts        # AppEvent, FeedItem, EventDetail, EventsPageFilters
          dashboard.model.ts    # DashboardData, DashboardFilters, ZoomLevel
          tenant.model.ts       # Tenant, TenantMember, TenantInvite, TenantAccessSettings
          space.model.ts        # Space, SpaceMember
          agency.model.ts       # Agency, AgencyMember, AgencyTenantSummary
          brand.model.ts        # Brand, BrandKind ('tenant'|'agency'|'super-admin'|'default')
          phase-colors.ts       # Shared PHASE_DESCRIPTORS + PHASE_COLORS map; single source of truth used by phase-bar.component (data viz) and phases-help (live-render reference)
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
          assets/             # asset-list, asset-form
          trials/               # trial-detail, trial-list, trial-create-dialog, trial-edit-dialog, marker-form, note-form
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
        help/                   # User-facing help pages (live-render where possible, stop-hook flags editorial drift)
          roles-help.component.ts          # Role/permission breakdown for agency and tenant owners
          markers-help.component.ts        # Marker semantics: editorial color rule, projection convention, live-rendered marker types from MarkerTypeService
          phases-help.component.ts         # Phase bar semantics, driven by shared PHASE_DESCRIPTORS in core/models/phase-colors.ts
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
          svg-icons/            # Per-shape SVG icons + the shared <app-marker-icon> wrapper that owns shape selection / fill / NLE rules
          manage-page-shell.component.ts  # Padding-only page wrapper (optional narrow mode for detail pages)
          row-actions.component.ts        # Overflow (ellipsis) row-action menu
          status-tag.component.ts         # Squared status tag with status→tone mapping
          section-card.component.ts       # Flat bordered section with header + actions slot
          form-field.component.ts         # Labeled form field with error state
          form-actions.component.ts       # Cancel / submit button pair
          color-swatch.component.ts       # Color swatch chip
          ctgov-source-tag.component.ts   # Slate "CT.gov" badge for auto-derived markers; renders nothing when metadata.source is not 'ctgov'
          marker-detail-panel.component.ts    # Thin marker-pane composition: drops the marker shape glyph into the shell's headerLeading slot and renders MarkerDetailContentComponent in the body. Accepts mode='inline' or mode='drawer' (340px @slidePanel overlay). Density resolves to 'compact' for drawer / 'roomy' for inline.
          marker-detail-content.component.ts # Marker pane body: title meta strip (status pill + date), program, trial (with optional CT.gov field overlay), description, unified Source section (CT.gov provenance dl when auto-derived, simple URL otherwise), upcoming markers, related events, materials, and DetailPanelHistoryComponent with field-level diff. Used by MarkerDetailPanelComponent and (for marker-source rows) EventDetailPanelComponent.
          detail-panel-shell.component.ts     # Canonical container for every detail pane (marker, event, positioning, bullseye). Owns header (headerLeading + brand-tone label + headerActions + close), scroll body, footer slot, aria-live, Escape-to-close. Inputs: density (compact/roomy), labelTone (brand/muted), bordered, showHeader, showClose. See "Detail Panel Pattern" below.
          detail-panel-section.component.ts   # Section primitive: eyebrow + content with the canonical mt-3 border-t pt-3 rhythm. Pass first=true for the first section after the title meta strip (uses mt-4).
          detail-panel-entity-row.component.ts # Clickable row primitive: button + hover bg + focus ring + trailing arrow. Set clickable=false for read-only rows in the same visual family.
          detail-panel-entity-list.component.ts # Wraps entity rows with consistent space-y-px.
          detail-panel-empty-state.component.ts # Renders the "Click an X to see details" action prompt; caller composes count/histogram/recent via primitives.
          detail-panel-pill.component.ts      # Status / projection / priority pill. One source of truth for tone-to-color (green/amber/red/slate/blue/brand) + dot.
          detail-panel-history.component.ts   # Collapsible audit trail with Field|Before|After diff table per entry; "View raw JSON" toggle preserves the engineering case.
          detail-panel-mini-phase-bar.component.ts # 7-segment compact phase bar (PRECLIN -> LAUNCHED) using PHASE_COLOR. Distinct from the SVG dashboard PhaseBarComponent.
          detail-panel-phase-race.component.ts # Two-line label + mini phase bar comparison row, sorted by phase rank desc. Used by the positioning detail pane.
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
    styles.css                  # Global Tailwind CSS + theme tokens + feature stylesheet imports (manage-table, catalyst-table, landscape)
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
   - Sets `--brand-on-dark` and `--brand-on-light` on `:root` via `pickStopForSurface(scale, surfaceHex)` — surface-aware foreground tokens that pick the brand stop with WCAG 4.5:1 contrast against the canonical dark chrome (`#0f172a`, used by `sidebar` and `icon-rail`) and against white. Components on dark surfaces reference `var(--brand-on-dark)` instead of `var(--brand-600)` so tenants whose seed is dark (deep navy, maroon) get bumped to a lighter stop (typically 400/300) for the logo, active markers, avatar text, focus outlines, and translucent washes; default teal-600 already clears the bar and stays on 600.
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

The route tree below is auto-generated from `src/client/src/app/app.routes.ts`. Run `npm run docs:arch` from `src/client/` to regenerate after editing routes.

<!-- AUTO-GEN:ROUTES -->
```
/login   LoginComponent
/auth/callback   AuthCallbackComponent
/admin   agencyGuard + authGuard | AgencyShellComponent
  (empty)   -> tenants
  /tenants   AgencyTenantListComponent
  /tenants/new   AgencyTenantNewComponent
  /tenants/:id   AgencyTenantDetailComponent
  /members   AgencyMembersComponent
  /branding   AgencyBrandingComponent
  /audit-log   auditAgencyGuard | AgencyAuditLogComponent
/super-admin   superAdminGuard + authGuard | SuperAdminShellComponent
  (empty)   -> agencies
  /agencies   SuperAdminAgenciesComponent
  /tenants   SuperAdminTenantsComponent
  /domains   SuperAdminDomainsComponent
  /audit-log   SuperAdminAuditLogComponent
/onboarding   authGuard | OnboardingComponent
/t/:tenantId   authGuard + tenantGuard | AppShellComponent
  /spaces   SpaceListComponent
  /settings   tenantSettingsGuard | TenantSettingsComponent
  /settings/audit-log   auditTenantGuard | TenantAuditLogComponent
  /help/roles   RolesHelpComponent
  /help/phases   PhasesHelpComponent
  /s/:spaceId   spaceGuard
    (empty)   EngagementLandingComponent | exact
    /help/markers   MarkersHelpComponent
    (empty)   LandscapeShellComponent
      /timeline   TimelineViewComponent
      /bullseye
        (empty)   -> by-therapy-area
        /by-therapy-area   LandscapeIndexComponent
        /by-therapy-area/:entityId   LandscapeComponent
        /by-company   LandscapeIndexComponent
        /by-company/:entityId   LandscapeComponent
        /by-moa   LandscapeIndexComponent
        /by-moa/:entityId   LandscapeComponent
        /by-roa   LandscapeIndexComponent
        /by-roa/:entityId   LandscapeComponent
      /positioning
        (empty)   -> by-moa
        /by-moa   PositioningViewComponent
        /by-therapy-area   PositioningViewComponent
        /by-moa-therapy-area   PositioningViewComponent
        /by-company   PositioningViewComponent
        /by-roa   PositioningViewComponent
      /catalysts   CatalystsPageComponent
    /intelligence   IntelligenceBrowseComponent
    /materials   MaterialsBrowsePageComponent
    /activity   EngagementActivityPageComponent
    /landscape   -> bullseye/by-therapy-area
    /landscape/by-therapy-area   -> bullseye/by-therapy-area
    /landscape/by-therapy-area/:entityId   -> bullseye/by-therapy-area/:entityId
    /landscape/by-company   -> bullseye/by-company
    /landscape/by-company/:entityId   -> bullseye/by-company/:entityId
    /landscape/by-moa   -> bullseye/by-moa
    /landscape/by-moa/:entityId   -> bullseye/by-moa/:entityId
    /landscape/by-roa   -> bullseye/by-roa
    /landscape/by-roa/:entityId   -> bullseye/by-roa/:entityId
    /landscape/:therapeuticAreaId   -> bullseye/by-therapy-area/:therapeuticAreaId
    /manage/companies   CompanyListComponent
    /manage/assets   AssetListComponent
    /manage/trials   TrialListComponent
    /manage/trials/:id   TrialDetailComponent
    /manage/companies/:id   CompanyDetailComponent
    /manage/assets/:id   AssetDetailComponent
    /manage/markers/:id   MarkerDetailComponent
    /manage/engagement   EngagementDetailComponent
    /settings/marker-types   MarkerTypeListComponent
    /settings/taxonomies   TaxonomiesPageComponent
    /settings/general   SpaceGeneralComponent
    /settings/members   SpaceMembersComponent
    /settings/fields   SpaceFieldVisibilitySettingsComponent
    /settings/audit-log   auditSpaceGuard | SpaceAuditLogComponent
    /manage/marker-types   -> settings/marker-types
    /manage/therapeutic-areas   -> settings/taxonomies
    /manage/mechanisms-of-action   -> settings/taxonomies
    /manage/routes-of-administration   -> settings/taxonomies
    /events   EventsPageComponent
    /seed-demo   SeedDemoComponent
(empty)   marketingLandingGuard | MarketingLandingComponent | exact
/**   -> /
```
<!-- /AUTO-GEN:ROUTES -->

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
| `AssetService` | Product CRUD linked to a company (with display_order) |
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
| `SpaceRoleService` | Resolves the current user's `space_members.role` for the current `:spaceId` URL segment. Watches `NavigationEnd`, refetches on space change, exposes `currentUserRole()`, `isOwner()`, `canEdit()` (owner or editor), `canRead()` signals. Drives role-aware UI gating: write controls render only when `canEdit()` or `isOwner()` is true (Save/Delete on space-general, Invite + role dropdown + remove on space-members, Add buttons on manage lists, row Edit/Delete menus, etc.). Server-side RLS remains the authoritative gate; this service prevents the UI from offering actions the caller cannot execute. |

## Dashboard Component Hierarchy

```
DashboardComponent               # Orchestrates state, filters, loading
  FilterPanelComponent           # Collapsible filter sidebar (PrimeNG MultiSelect)
  ZoomControlComponent           # Yearly/quarterly/monthly/daily toggle
  LegendComponent                # Marker type reference grouped by category
  ExportDialogComponent          # PowerPoint export dialog
  DashboardGridComponent         # The timeline table (scrollable container, gear icon toggles MOA/ROA/Notes columns)
    GridHeaderComponent          # Column headers (date labels, sticky)
    RowLabel                     # Left column: company/asset/trial labels (sticky)
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

Click events on phase bars and trials navigate to trial detail pages. Marker clicks call `LandscapeStateService.selectMarker()`, which opens the shared detail panel rendered by the landscape shell. The detail panel (`MarkerDetailPanelComponent` with `mode='drawer'`, 340px, absolute-positioned right) fetches full detail via `get_catalyst_detail` RPC. Body composition is detailed in the "Detail Panel Pattern" section below; the header uses the shared `<app-marker-icon>` (single source of truth for shape + color + projection-derived fill + inner mark + NLE overlay) projected into the shell's `headerLeading` slot — identical rendering to the timeline grid markers, the catalyst category cell, and the bullseye Recent Markers list. The panel dismisses via X button or Escape; there is no backdrop. Clicking another marker inside the panel swaps its content in place. The panel persists between timeline <-> catalysts (same marker data, different layout) and across same-mode dimension switches; entering bullseye or positioning clears the selection (no marker referent in those views) -- the clear is wired in `LandscapeShellComponent`'s router-events subscription. The shell also consumes `?markerId=` on /timeline so cross-pane jumps (e.g. bullseye Recent Markers row → timeline) auto-open the drawer on arrival.

Cross-view jump CTAs let analysts pivot lenses on the same selection without losing context: bullseye's "Open in timeline" footer button calls `LandscapeComponent.onOpenInTimeline()`, which navigates to `/t/{tenantId}/s/{spaceId}/timeline` with `assetIds` + `therapeuticAreaIds` query params (NOT the space root, which would render the landscape index). Positioning's "Open in bullseye" maps the active grouping to the closest bullseye dimension; the asset-row click in the same pane navigates to `/timeline?assetIds=` so the analyst lands on that asset trial timeline rather than re-entering the bullseye view. Marker pane (catalysts) provides "Open trial" and a clickable Trial section that routes to `/manage/trials/:id`. Event pane provides "Open thread", and its Related events / Thread events / Category histogram rows now stay in-pane (loading detail by id directly rather than searching the limited feed window). Bullseye Recent Markers rows route through `?markerId=` to open the timeline drawer.

### AppShellComponent (Layout)

The `AppShellComponent` orchestrates the three-panel layout: sidebar + topbar + content area.

- **Sidebar** (`SidebarComponent`): Collapsed (48px, individual item icons with section dividers) or expanded (220px, icon + label per item). Both hover-expand and pin-expand use `position: relative` -- the sidebar always pushes content right, never overlays. Header contains the Triple C logo mark (`ClintLogoComponent`, 24px dark variant) + pin toggle. All icons sourced from `NAV_ICONS` constant. Org/space selection lives in the topbar, not the sidebar.
- **Topbar** (`ContextualTopbarComponent`): Left side shows an org/space breadcrumb (`Org / Space | Page`). Org and space are dropdown-switchable. Icons from `NAV_ICONS` appear on section tabs and list page titles. The right side of the divider adapts by page type:
  - `landscape` (used for all tab-based sections): dynamic section label (`sectionLabel` input) + icon-prefixed tab buttons. Landscape shows Timeline / Bullseye / Positioning / Future Catalysts; Intelligence shows Events; Manage shows Companies / Products / Trials. When Bullseye or Positioning is active, a row of smaller pill-style dimension sub-tabs appears after the main tabs (Bullseye: Therapy Area, Company, MOA, ROA; Positioning: MOA, Therapy Area, MOA + TA, Company, ROA). Sub-tab state is owned by `LandscapeShellComponent` and pushed to the topbar via `TopbarStateService.subTabs` / `onSubTabClick`.
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
- **`RowActionsComponent`** -- `<app-row-actions [items]="...">` renders an ellipsis trigger button and an anchored PrimeNG `p-menu` popup. Destructive items set `styleClass: 'row-actions-danger'` so the shared CSS colors them red. Used on every manage-table row; replaces the bootstrap-style Edit/Delete text link pair. **Callers MUST memoize the `MenuItem[]`** — typically via a `private readonly menuCache = new Map<string, MenuItem[]>()` keyed by row id, cleared in the list's load method. Returning a fresh array from a `rowMenu(row)` template-call causes `p-menu` to re-render between `pointerdown` and `click`, which swallows the first click and forces the user to click every menu option twice. All existing list components (companies / assets / trials / marker-types / therapeutic-areas / trial-detail / tenant-settings) use this pattern; copy it when adding a new list.
- **`StatusTagComponent`** -- `<app-status-tag [label]="t.status" />` auto-maps trial status strings to brand-safe tones (teal for Active/Recruiting, amber for Suspended/Not yet recruiting, slate for Completed/Terminated). Accepts an explicit `[tone]="'teal'|'amber'|'slate'|'neutral'"` override.
- **`CtgovSourceTagComponent`** -- `<app-ctgov-source-tag [metadata]="m.metadata" />` renders a small slate `CT.gov` chip when the marker's `metadata.source === 'ctgov'`, and nothing otherwise. Use `[variant]="'detailed'"` for the longer "Synced from CT.gov" pill in the marker detail panel header. Drop it next to any marker title (table cell, hover tooltip, panel header) without conditional `@if` -- it self-suppresses for analyst-created markers. The marker detail panel pairs the badge with a richer provenance block (source field path, anticipated/actual date type, last sync timestamp, link to clinicaltrials.gov) when the same metadata signal is present.

The Assets list **no longer** renders its trials inline (the old chevron-expand + nested p-table pattern is removed). Instead, the Trials column shows a count that deep-links to `/manage/trials?product=<id>`, which filters the dedicated Trials list to that asset. The "Add Trial" action moved with it: trials are created from the Trials list with an asset dropdown, or from an asset-filtered Trials view where the asset is preselected.

The trial edit form (`TrialFormComponent`) **does not use `p-fieldset`**. The previous collapsible fieldset pattern for CT.gov sections (Study Design / Eligibility / Timeline / Regulatory) caused content-leakage bugs during collapse animations and has been replaced with sibling `SectionCard`s that are always expanded — users scroll. When adding new grouped form sections, follow the same pattern.

## Detail Panel Pattern (Shell + Primitives)

Every detail pane in the platform (marker, event, positioning, bullseye) is built by composing a small set of standalone primitives in `shared/components/detail-panel-*.component.ts`. The pane components themselves are thin compositions that map domain data into the primitive slots; the primitives own all spacing, colour, divider, eyebrow, focus-ring, and empty-state rules so the visual family stays consistent without per-pane drift.

### The primitives

- **`DetailPanelShellComponent`** (`<app-detail-panel-shell>`) — canonical container. Renders the header strip (`headerLeading` slot for marker glyph, brand-tone eyebrow `[label]`, `headerActions` slot for edit/etc, close button), the scrolling body (default content slot), and the footer slot (`<div footer ...>` for primary actions). Inputs: `[density]` (`'compact'` for the 340px drawer, `'roomy'` for in-column panes), `[labelTone]` (`'brand'` when something is selected, `'muted'` for the empty-state overview eyebrow), `[showHeader]`, `[showClose]`, `[bordered]`. Owns `aria-live="polite"`, `role="region"`, and document-level Escape-to-close.
- **`DetailPanelSectionComponent`** (`<app-detail-panel-section>`) — single section with a `[label]` eyebrow and the standard `mt-3 border-t border-slate-100 pt-3` rhythm. Pass `[first]="true"` for the first section after the title block (uses `mt-4`). Replaces ad-hoc `<section><p class="text-[10px]...">` markup across all panes.
- **`DetailPanelEntityListComponent`** + **`DetailPanelEntityRowComponent`** (`<app-detail-panel-entity-list>` / `<app-detail-panel-entity-row>`) — clickable row pattern. Each row is a `<button>` with hover background, focus ring, and a trailing `→` arrow that recolors on hover. Set `[clickable]="false"` for read-only rows in the same visual family. Used by Upcoming markers, Related events, Thread events, Linked events, Trials, Products, Recent markers, and every empty-state histogram.
- **`DetailPanelEmptyStateComponent`** (`<app-detail-panel-empty-state>`) — renders the `Click an X to see details` action prompt. Caller composes the count summary + histogram + recent-activity sections via standard primitives. Pair with the shell's `labelTone="muted"` to render a passive overview eyebrow (e.g. `Catalysts · overview`) when nothing is selected.
- **`DetailPanelPillComponent`** (`<app-detail-panel-pill [tone]="...">`) — status / projection / priority pill. One source of truth for `rounded-full`, padding, dot, and the tone-to-color map (`green | amber | red | slate | blue | brand`). Replaces the prior pillbox markup that diverged across panes.
- **`DetailPanelHistoryComponent`** (`<app-detail-panel-history>`) — collapsible audit trail. Caller projects `MarkerChangeRow[]` into `HistoryEntry[]` (with field labels + value formatters) and the primitive renders a `Field | Before | After` diff table per entry. The "View raw JSON" toggle preserves the engineering case. Lazy-load is wired via the `(toggleOpen)` event so the caller can fetch on first expand.
- **`DetailPanelMiniPhaseBarComponent`** (`<app-detail-panel-mini-phase-bar>`) — compact 7-segment phase bar (PRECLIN → P1 → P2 → P3 → P4 → APPROVED → LAUNCHED). Each filled segment uses its own `PHASE_COLOR`; segments past `[currentPhase]` render in slate-200. Distinct from the dashboard's SVG `PhaseBarComponent`, which is a date-axis visualization.
- **`DetailPanelPhaseRaceComponent`** (`<app-detail-panel-phase-race>`) — visual race comparison: two-line label (asset / company) + mini phase bar + phase glyph. Sorted by phase rank descending so the leader sits at the top. Used by the positioning detail pane to answer "who's winning this race and by how much" at a glance.

### Consumers

- **Timeline + Catalysts** — `MarkerDetailPanelComponent` (`mode='drawer'`, `density='compact'`) rendered by `LandscapeShellComponent`. Body is `MarkerDetailContentComponent` composed from the primitives above. The catalyst's projection state is collapsed into a single status pill ("Confirmed actual" or "Projected · Stout estimate") in the meta strip directly under the title — there is no separate Date/Status grid. Source treatment is unified: the slate-50 box is gone; CT.gov-derived markers render a small `Field / Date type / Last synced` dl under the standard `Source` section eyebrow, analyst-created markers render just the URL link in the same slot. History uses `DetailPanelHistoryComponent` with field-level diff (`event_date`, `projection`, `is_projected`, etc. via `MARKER_FIELD_LABELS` from `shared/utils/marker-fields.ts` — same vocabulary used by the activity feed's `summaryFor()` so a `marker_updated` event reads with the same field names as the History pane).
- **Events** — `EventDetailPanelComponent` is **always** rendered in the right column. When no row is selected, it shows an empty-state overview (count + high-priority count + clickable "By category" histogram + "Most recent" list) so the column is never blank. Selected state uses `DetailPanelPill` for the priority badge, `DetailPanelEntityRow` for thread + linked events, and a slim ghost footer button "Open thread" when the event has a thread. Thread / related-event / category-filter outputs are wired in `EventsPageComponent`: `relatedEventClick` and `threadEventClick` both call `openByEventId(id)` (which loads detail directly by id rather than searching the feed window), and `categoryFilter` updates the grid's `category_name` text filter so the chip row stays in sync. The `?eventId=` deep-link uses a `queryParamMap` subscription (not a one-shot `ngOnInit` read) so cross-page jumps from the marker drawer continue to work when the events page is already mounted. All `&mdash;` separators are gone (project rule); replaced with middle dots.
- **Positioning** — `PositioningDetailPanelComponent` is **always** rendered. Header eyebrow now reflects the active grouping ("MOA group" / "Therapy area group" / "MOA + TA group" / "Company group" / "ROA group") instead of generic "COMPETITIVE GROUP". Selected state replaces the old phase-breakdown chips with a `DetailPanelPhaseRace` (every asset, leader at top, 7-segment bar). Empty state pattern matches bullseye.
- **Bullseye** — `BullseyeDetailPanelComponent` header eyebrow renamed `SELECTED` → `Drug` (says what is selected, not that something is). Selected and empty states migrated onto the shell + primitives. Recent markers list renders the real `<app-marker-icon>` (not a colored dot) and each row is clickable: emits `openMarker` on the panel, which `LandscapeComponent` routes to `/timeline?markerId=` so the timeline drawer opens on arrival. Trial list keeps the inline CT.gov field renderer.

### Layout structure (overlay vs in-column)

The marker pane in landscape is still an **overlay** — `LandscapeShellComponent` absolute-positions a 340px wrapper with `slidePanelAnimation` and renders the panel inside. The event, positioning, and bullseye panes are **always-mounted in-column** (380px on /events, sized by `landscape-panel-wrap` on landscape views). When adding a new detail pane, prefer in-column with an empty state — the column never sits blank, and the empty state teaches the surface.

### When extending or adding a new pane

1. Drop a `<app-detail-panel-shell>` at the root with the right `[density]` and `[label]`.
2. Compose body content from `<app-detail-panel-section>` blocks (eyebrow + content), with `[first]="true"` on the first one after the title meta strip.
3. Use `<app-detail-panel-entity-list>` + `<app-detail-panel-entity-row>` for any list of clickable references — never re-roll the hover/focus/arrow markup.
4. Use `<app-detail-panel-pill>` for status, projection, or priority badges — never inline the chip Tailwind classes.
5. For an empty state: render `<app-detail-panel-empty-state prompt="Click X to see details">` inside the shell with `labelTone="muted"`, then compose the overview using the same section/list primitives.
6. Add a slim ghost footer CTA via `<div footer class="border-t border-slate-100 px-5 py-3">…</div>` — use the existing button styling (`inline-flex w-full items-center justify-center gap-1.5 rounded-sm border border-slate-200 ...`) for consistency.

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
DashboardFilters { companyIds, assetIds, therapeuticAreaIds, startYear, endYear,
                   recruitmentStatuses, studyTypes, phases }
ZoomLevel        'yearly' | 'quarterly' | 'monthly' | 'daily'
```

## SVG Icon Components

Marker shape primitives + a single shared wrapper, all in `shared/components/svg-icons/`. Always use `<app-marker-icon>` at call sites — it owns shape selection, fill rules, NLE overlay, and the dashed-line variant. The per-shape components are implementation details.

| Component | Role | Inputs |
|---|---|---|
| `MarkerIconComponent` (`<app-marker-icon>`) | **Canonical entry point.** Renders the right shape (incl. `dashed-line`) with the shared fill / NLE / inner-mark rules. Used by timeline grid, marker drawer header, bullseye Recent Markers, catalyst category cell. | shape, color, size, fillStyle, innerMark, isNle |
| `CircleIconComponent` / `DiamondIconComponent` / `SquareIconComponent` | Shape primitives (with optional `innerMark`) | size, color, fillStyle, innerMark |
| `FlagIconComponent` / `TriangleIconComponent` | Shape primitives (no inner mark) | size, color, fillStyle |
| `NleOverlayComponent` | Strikethrough bar drawn over the shape when a marker is `no_longer_expected` | size |

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

**Surface-aware foreground tokens.** `--brand-on-dark` and `--brand-on-light` (also set on `:root` from `main.ts`) are the legibility-safe foreground tokens for components that sit on the canonical dark chrome (`#0f172a`, used by `sidebar` and `icon-rail`) and on white surfaces respectively. They are derived by `pickStopForSurface(scale, surfaceHex, minRatio = 4.5)` in `core/util/color-scale.ts`, which walks the scale (lighter for dark surfaces, darker for light surfaces) and returns the first stop that clears WCAG 4.5:1; if nothing clears the bar, it returns the highest-contrast stop available. The default teal-600 already clears the bar, so existing branding is unchanged; dark seeds (deep navy, maroon) get bumped to a lighter stop in the chrome while still rendering at 600 on light surfaces. **Convention:** components on dark surfaces (currently `sidebar.component.ts` and `icon-rail.component.ts`) use `var(--brand-on-dark)` for *all* brand foreground references — solid uses (logo square, active indicator, avatar text/border), focus outlines, and translucent washes (`rgb(from var(--brand-on-dark) r g b / 0.15)`). Light-surface components (topbar, headers, content) keep using `var(--brand-600)`.

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

All five manage-section list pages (companies, assets, trials, therapeutic-areas, marker-types) share a single filtering, sorting, and pagination pattern built on PrimeNG `p-table`. Do not add new grids without following this pattern.

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

**Deep-linking into a filtered grid:** consumers that navigate *into* a grid with specific filters pre-applied (e.g., `company-list::openAssets(id)` landing on a pre-filtered assets grid) use `buildFilterQueryParams` from `shared/grids`. Do not hand-roll query params. The helper accepts a `Record<string, FilterValue>` and returns the query-param object to pass to `router.navigate(..., { queryParams })`. Consumers must know the target grid's filterable field names (e.g., `asset.company_id`, `trial.product_id`) — see the per-grid column list in the spec for the public deep-link fields.

**`?selected=<id>` on companies and assets lists:** the company and asset list pages also honor `?selected=<id>` from the URL. On init they look up the entity by id and call `grid.onGlobalSearchInput(target.name)` so the grid filters to that single row. The `selected` param must be read from `route.snapshot.queryParamMap` BEFORE `await loadData()` because the grid's URL-sync effect rewrites query params to its own state during init, which would otherwise drop `selected`. Used by the command palette for company/asset activation.

**Why `$any($event)` on `onLazyLoad`:** PrimeNG's `TableLazyLoadEvent.sortField` type is `string | string[] | null`, which is wider than what our handler accepts. The `$any()` template helper bypasses the strict template type check at this single binding point. If you find a cleaner way to align the types, replace it — but do not narrow PrimeNG's type, that breaks bindings.

## Documentation Drift

Auto-generated. Lists Angular services, models, and SVG icon components whose conventional class name does not appear anywhere in this file. Add a row to the appropriate table (Services / Models / SVG Icon Components) for each flagged item, or document why it is intentionally excluded.

<!-- AUTO-GEN:DRIFT -->
**Services:**
- `AuditEventService`
- `ChangeEventService`
- `EventCategoryService`
- `EventThreadService`
- `EventService`
- `LandscapeService`
- `MarkerCategoryService`
- `MarkerService`
- `MaterialService`
- `MechanismOfActionService`
- `PaletteHotkeyService`
- `PalettePinService`
- `PaletteRecentsService`
- `PaletteService`
- `PrimaryIntelligenceService`
- `ProseMirrorService`
- `RouteOfAdministrationService`
- `SpaceFieldVisibilityService`

**Models:**
- `Asset`
- `AuditEvent`
- `ChangeEvent`
- `CtgovField`
- `MechanismOfAction`
- `Palette`
- `PrimaryIntelligence`
- `RouteOfAdministration`

**SVG icon components:**
_All svg-icon components documented._
<!-- /AUTO-GEN:DRIFT -->
