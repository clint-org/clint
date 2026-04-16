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
          auth.guard.ts         # authGuard + onboardingRedirectGuard
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
          tenant.model.ts       # Tenant, TenantMember, TenantInvite
          space.model.ts        # Space, SpaceMember
        services/               # All business logic and API calls (16 services)
          topbar-state.service.ts # Lets pages contribute title, count, and actions to the topbar
      features/
        auth/                   # login.component, auth-callback.component
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
        catalysts/              # Key Catalysts: forward-looking marker timeline
          catalysts-page.component   # Smart component: filters, data fetching, grouping
          catalyst-table.component   # p-table with rowGroupMode="subheader" for time buckets
          catalyst-table.css         # Global table chrome (imported from styles.css)
          group-catalysts.ts         # Pure utility: adaptive time-bucket grouping
        spaces/                 # Space list and creation
        onboarding/             # Create org / join with invite code
        tenant-settings/        # Tenant management and member invites
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
        primeng-theme.ts        # Aura preset, teal primary, slate surface
    environments/
      environment.ts            # Supabase URL + anon key
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

App-level services: `ConfirmationService` (for `<p-confirmdialog>`) and `MessageService` (for `<p-toast>`).

Key decisions:
- `paramsInheritanceStrategy: 'always'` -- child routes inherit parent route params (tenantId, spaceId)
- `darkModeSelector: false` -- light mode only (no dark mode)
- `ripple: false` -- no Material-style ripple effects

## Routing

All routes are lazy-loaded. The `/t/:tenantId` route loads `AppShellComponent` as a layout wrapper (icon rail + sidebar + topbar), and all tenant/space routes render inside its `<router-outlet>`.

```
/login                              -> LoginComponent
/auth/callback                      -> AuthCallbackComponent
/onboarding                         -> OnboardingComponent (authGuard)
/t/:tenantId/                       -> AppShellComponent (layout wrapper)
  spaces                            -> SpaceListComponent
  settings                          -> TenantSettingsComponent
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
    manage/companies                -> CompanyListComponent
    manage/products                 -> ProductListComponent
    manage/trials                   -> TrialListComponent  (supports ?product=<id> filter)
    manage/trials/:id               -> TrialDetailComponent
    settings/marker-types           -> MarkerTypeListComponent
    settings/taxonomies             -> TaxonomiesPageComponent (Therapeutic Areas, MOA, ROA)
    events                          -> EventsPageComponent
    catalysts                       -> CatalystsPageComponent
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
| `CatalystService` | Calls `get_key_catalysts()` and `get_catalyst_detail()` RPCs for the Key Catalysts page |
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

Click events on phase bars and trials navigate to trial detail pages. Marker clicks open an overlay detail panel (`MarkerDetailPanelComponent` with `mode='drawer'`, 340px, absolute-positioned right) that fetches full detail via `CatalystService.getCatalystDetail()`. Sections are ordered for the CI analyst's mental model: **Program** (company logo + company/product) and **Trial** (name, phase, recruitment status) appear first, followed by projection badge (Stout estimate / Company guidance / Primary source estimate) and "No longer expected" badge when applicable, then date/status, description, source URL (truncated to domain name via `extractDomain()`), upcoming markers, and related events. The header reuses the shared SVG icon components (`CircleIconComponent`, `DiamondIconComponent`, etc. from `shared/components/svg-icons/`) with fill style derived from `projection` (`actual` = filled, else outline) and `inner_mark` -- identical rendering to the timeline grid markers. The panel dismisses via X button or Escape; there is no backdrop. Clicking another marker inside the panel swaps its content in place. The panel uses the shared `@slidePanel` animation from `shared/animations/slide-panel.animation.ts`.

### AppShellComponent (Layout)

The `AppShellComponent` orchestrates the three-panel layout: sidebar + topbar + content area.

- **Sidebar** (`SidebarComponent`): Collapsed (48px, individual item icons with section dividers) or expanded (220px, icon + label per item). Both hover-expand and pin-expand use `position: relative` -- the sidebar always pushes content right, never overlays. Header contains the Triple C logo mark (`ClintLogoComponent`, 24px dark variant) + pin toggle. All icons sourced from `NAV_ICONS` constant. Org/space selection lives in the topbar, not the sidebar.
- **Topbar** (`ContextualTopbarComponent`): Left side shows an org/space breadcrumb (`Org / Space | Page`). Org and space are dropdown-switchable. Icons from `NAV_ICONS` appear on section tabs and list page titles. The right side of the divider adapts by page type:
  - `landscape` (used for all tab-based sections): dynamic section label (`sectionLabel` input) + icon-prefixed tab buttons. Landscape shows Timeline / Bullseye / Positioning; Intelligence shows Events / Catalysts; Manage shows Companies / Products / Trials. When Bullseye or Positioning is active, a row of smaller pill-style dimension sub-tabs appears after the main tabs (Bullseye: Therapy Area, Company, MOA, ROA; Positioning: MOA, Therapy Area, MOA + TA, Company, ROA). Sub-tab state is owned by `LandscapeShellComponent` and pushed to the topbar via `TopbarStateService.subTabs` / `onSubTabClick`.
  - `list`: icon + page title (e.g., "Taxonomies") + record count + action buttons (used for Settings pages)
  - `detail`: back button + entity eyebrow/title
  - `blank`: breadcrumb only
- **TopbarStateService**: Pages contribute their record count, action buttons, and dimension sub-tabs to the topbar via this root-level service. Pages set signals on init and call `clear()` on destroy. The shell reads these signals and passes them to the topbar component. Sub-tabs (`subTabs` signal + `onSubTabClick` callback) let feature pages like `LandscapeShellComponent` push view-specific dimension switchers without the app-shell knowing the feature details.
- **State persistence**: Stores `lastTenantId`, `lastSpaceId`, and `clint-sidebar-pinned` in localStorage
- **Route sync**: Recursively extracts route params (tenantId, spaceId) from Angular route tree

## Management Pages Pattern

All non-timeline management pages (Companies, Products, Trials, Marker Types, Therapeutic Areas, Tenant Settings, Spaces gallery) share a common presentation layer. The core visual principle is **zoning via background contrast**: the app root has `bg-slate-50`, and content surfaces (SectionCard, manage-table, p-dialog) are pure white with thin slate-200 borders. That 2-3% luminance shift is what separates "canvas" from "content zones" — no shadows, no gradients.

- **`ManagePageShellComponent`** -- padding-only layout wrapper. Provides consistent page padding (`1rem 2rem 4rem`). Accepts a `[narrow]="true"` input that caps the shell at `max-w-6xl` (~1152px) and centers it; use for form-heavy detail pages like `TrialDetailComponent` where fields shouldn't stretch to the viewport edge. Page identity (title, record count, action buttons) is handled by the topbar via `TopbarStateService`, not by this component.
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
- **Timeline** -- `MarkerDetailPanelComponent` with `mode='drawer'` (marker click opens panel)
- **Bullseye** -- `LandscapeComponent` (dot click opens `BullseyeDetailPanelComponent`: product name, company, MOA/ROA tags, trials with recruitment status, recent markers with formatted dates, "Open in timeline" action)
- **Positioning** -- `PositioningViewComponent` (bubble click opens `PositioningDetailPanelComponent`: "COMPETITIVE GROUP" header, stacked stats, phase breakdown chips, clickable products with generic names and navigation arrows, "Open in bullseye" cross-navigation that maps the current positioning grouping to the matching bullseye dimension)
- **Events** -- `EventsPageComponent` (row click opens `EventDetailPanelComponent`)
- **Catalysts** -- `CatalystsPageComponent` (row click opens `MarkerDetailPanelComponent` with `mode='inline'`)

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

The custom theme preset (`config/primeng-theme.ts`) configures:
- **Base**: Aura preset
- **Primary**: Teal (11 shade ramp: 50-950)
- **Surface**: Slate neutrals
- **Dark mode**: Disabled
- **Ripple**: Disabled
- **CSS layers**: Disabled
- **Prefix**: `p`

## Toasts (save/action feedback)

All user-facing success feedback uses PrimeNG `p-toast` via `MessageService`. A single `<p-toast position="top-right" />` lives in `app.component.ts` -- individual components never render their own toast element.

**Pattern:** inject `MessageService` and call `this.messageService.add({ severity: 'success', summary: 'Saved.', life: 3000 })`. Use `life: 3000` (3 seconds auto-dismiss) for success confirmations. The toast stacks naturally if multiple actions fire in quick succession.

**Visual treatment:** Toasts use square corners (`borderRadius: 0`), a uniform `slate-200` border, and a 3px left-border accent colored per severity (teal for success, red for error, amber for warn, slate for info). Close button and icon are tightened for a compact, data-instrument feel. These overrides live in `primeng-theme.ts` (design tokens) and `primeng-overrides.css` (structural CSS).

**Do not** use inline `<span>` text next to buttons or `<p-message severity="success">` banners for save confirmations. Those patterns were removed in favor of the unified toast system. `<p-message>` is still used for inline error display within forms.

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
