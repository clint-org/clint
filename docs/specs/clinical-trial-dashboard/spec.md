---
id: spec-2026-001
title: Clinical Trial Status Dashboard
slug: clinical-trial-dashboard
status: completed
created: 2026-03-14
updated: 2026-03-15
---

# Clinical Trial Status Dashboard

## Summary

A full-stack web application that replicates and enhances the clinical trial status tracking currently done in PowerPoint. The dashboard displays a hierarchical grid (Company > Product > Therapeutic Area) alongside a horizontal timeline with configurable zoom, where clinical trial phases are shown as colored bars and key events are plotted as interactive markers with tooltips. The system supports manual data entry, extensible marker types, free-text annotations, and Google login via Supabase Auth.

## Goals

- Replace the static PowerPoint-based clinical trial tracking workflow with an interactive, data-driven web application
- Provide a clear visual timeline of trial phases (I through IV, plus Observational) with event markers at configurable zoom levels (yearly down to daily)
- Enable filtering by company, product, and therapeutic area
- Support extensible marker types so users can define new event categories beyond the initial set
- Authenticate users via Google login (Supabase Auth) with row-level security on all data

## Non-Goals (MVP)

- Export to PDF or PowerPoint (deferred to a follow-up spec)
- External data integration with ClinicalTrials.gov or other registries
- Change tracking / highlighting of updates since last view
- Real-time collaboration
- Mobile-optimized layout (desktop-first)
- Email/password or other auth providers beyond Google

---

## Architecture Overview

```
┌─────────────────────┐     ┌──────────────────────────────────┐
│   Angular 19 SPA    │────>│         Supabase                 │
│   (src/client/)     │<────│                                  │
│                     │     │  PostgREST  - auto-generated     │
│  - Timeline Grid    │     │               REST API from      │
│  - Marker Renderer  │     │               Postgres schema    │
│  - Phase Bars       │     │                                  │
│  - Filter Panel     │     │  Auth       - Google OAuth       │
│  - Google Login     │     │                                  │
│                     │     │  PostgreSQL - companies, products,│
│  Tailwind CSS v4    │     │               trials, phases,    │
│  (no component lib) │     │               markers, notes     │
└─────────────────────┘     └──────────────────────────────────┘
```

**Frontend**: Angular 19 with standalone components, signals for reactive state (`signal()`, `computed()`, `effect()`), `resource()` API for declarative data fetching, new control flow syntax (`@if`, `@for`, `@switch`), and Tailwind CSS v4 for all styling. No component library (no Angular Material, no DaisyUI). SVG-based timeline rendering for markers and phase bars. Uses `inject()` for DI throughout.

**Backend**: Supabase only -- no .NET, no Node, no separate API server. The Angular app queries PostgreSQL directly through the Supabase JS client (`@supabase/supabase-js`), which uses PostgREST under the hood. All CRUD operations, filtering, and joins are handled by PostgREST query syntax.

**Auth**: Supabase Auth with Google OAuth provider. RLS policies on all tables enforce row-level access via `auth.uid()`.

**Database**: PostgreSQL managed by Supabase. Schema controlled via Supabase CLI migrations (`supabase/migrations/`). Seed data in `supabase/seed.sql`.

---

## Data Model

### Entity Relationship

```
Company (1) ──< Product (N)
Product (1) ──< Trial (N)
Trial (1) ──< TrialPhase (N)
Trial (1) ──< TrialMarker (N)
Trial (1) ──< TrialNote (N)
MarkerType (1) ──< TrialMarker (N)
TherapeuticArea (1) ──< Trial (N)
```

### Tables

All tables live in the `public` schema. All use `uuid` primary keys with `gen_random_uuid()` defaults. All have RLS enabled with policies scoped to `auth.uid()`.

#### `companies`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK, default gen_random_uuid()) | |
| user_id | uuid (FK to auth.users) | Owner -- used by RLS |
| name | varchar(255) | e.g., "AstraZeneca" |
| logo_url | varchar(500) | Optional company logo |
| display_order | int | Sort order in dashboard |
| created_at | timestamptz (default now()) | |
| updated_at | timestamptz (default now()) | |

#### `products`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| user_id | uuid (FK to auth.users) | Owner -- used by RLS |
| company_id | uuid (FK to companies) | References companies |
| name | varchar(255) | e.g., "Farxiga" |
| generic_name | varchar(255) | e.g., "dapagliflozin" |
| logo_url | varchar(500) | Optional product image |
| display_order | int | Sort order within company |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### `therapeutic_areas`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| user_id | uuid (FK to auth.users) | Owner -- used by RLS |
| name | varchar(255) | e.g., "Heart Failure HFpEF" |
| abbreviation | varchar(50) | e.g., "CKD", "DKD" |
| created_at | timestamptz | |

#### `trials`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| user_id | uuid (FK to auth.users) | Owner -- used by RLS |
| product_id | uuid (FK to products) | References products |
| therapeutic_area_id | uuid (FK to therapeutic_areas) | References therapeutic_areas |
| name | varchar(255) | e.g., "EMPEROR-Preserved" |
| identifier | varchar(100) | e.g., "NCT04515849" |
| sample_size | int | N= value, nullable |
| status | varchar(50) | Active, Completed, Terminated, etc. |
| notes | text | Free-text annotation shown on right side |
| display_order | int | Sort order within product |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### `trial_phases`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| user_id | uuid (FK to auth.users) | Owner -- used by RLS |
| trial_id | uuid (FK to trials) | References trials |
| phase_type | varchar(20) | P1, P2, P3, P4, OBS |
| start_date | date | Phase start |
| end_date | date | Phase end (nullable if ongoing) |
| color | varchar(7) | Hex color override, nullable (uses default) |
| label | varchar(100) | Display label, e.g., "[P3] DAPA-MI" |
| created_at | timestamptz | |

#### `marker_types`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| user_id | uuid (FK to auth.users, nullable) | Null for system types, set for user-created |
| name | varchar(100) | e.g., "Projected Data Reported" |
| icon | varchar(50) | Icon identifier (SVG name or class) |
| shape | varchar(20) | circle, diamond, flag, arrow, x, bar |
| fill_style | varchar(20) | outline, filled, striped, gradient |
| color | varchar(7) | Default hex color |
| is_system | boolean | True for predefined, false for user-created |
| display_order | int | Order in legend/key |
| created_at | timestamptz | |

**Predefined marker types (seeded via seed.sql):**
1. Projected Data Reported - circle, outline, green
2. Data Reported - circle, filled, green
3. Projected Regulatory Filing - diamond, outline, red
4. Submitted Regulatory Filing - diamond, filled, red
5. Label Projected Approval/Launch - flag, outline, blue
6. Label Update - flag, striped, blue
7. Est. Range of Potential Launch - bar, gradient, blue
8. Primary Completion Date (PCD) - circle, filled, dark gray
9. Change from Prior Update - arrow, filled, orange
10. Event No Longer Expected - x, filled, red

#### `trial_markers`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| user_id | uuid (FK to auth.users) | Owner -- used by RLS |
| trial_id | uuid (FK to trials) | References trials |
| marker_type_id | uuid (FK to marker_types) | References marker_types |
| event_date | date | When on timeline |
| end_date | date | For range markers (e.g., Est. Launch Range), nullable |
| tooltip_text | text | Hover tooltip content |
| tooltip_image_url | varchar(500) | Optional image in tooltip |
| is_projected | boolean | Whether this is a projection vs actual |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### `trial_notes`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| user_id | uuid (FK to auth.users) | Owner -- used by RLS |
| trial_id | uuid (FK to trials) | References trials |
| content | text | Note content |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### RLS Policy Pattern

All tables follow the same user-ownership pattern. Example for `companies`:

```sql
-- select: users can view their own companies
create policy "users can view own companies"
on public.companies for select
to authenticated
using ( auth.uid() = user_id );

-- insert: users can create companies for themselves
create policy "users can insert own companies"
on public.companies for insert
to authenticated
with check ( auth.uid() = user_id );

-- update: users can update their own companies
create policy "users can update own companies"
on public.companies for update
to authenticated
using ( auth.uid() = user_id )
with check ( auth.uid() = user_id );

-- delete: users can delete their own companies
create policy "users can delete own companies"
on public.companies for delete
to authenticated
using ( auth.uid() = user_id );
```

`marker_types` has a special case: system marker types (where `is_system = true` and `user_id is null`) are readable by all authenticated users but not editable or deletable.

---

## Data Access Design

There is no REST API layer to design. The Angular app uses the Supabase JS client directly. All queries go through PostgREST.

### Query Patterns

**List with relations (e.g., dashboard data):**
```typescript
const { data, error } = await supabase
  .from('companies')
  .select(`
    *,
    products (
      *,
      trials (
        *,
        therapeutic_areas (*),
        trial_phases (*),
        trial_markers (*, marker_types (*)),
        trial_notes (*)
      )
    )
  `)
  .order('display_order');
```

**Filtered queries:**
```typescript
const { data, error } = await supabase
  .from('trials')
  .select('*, trial_phases(*), trial_markers(*, marker_types(*))')
  .in('product_id', selectedProductIds)
  .order('display_order');
```

**Single record CRUD:**
```typescript
// Create
const { data, error } = await supabase
  .from('companies')
  .insert({ name, display_order, user_id: currentUser.id })
  .select()
  .single();

// Update
const { data, error } = await supabase
  .from('companies')
  .update({ name })
  .eq('id', companyId)
  .select()
  .single();

// Delete
const { error } = await supabase
  .from('companies')
  .delete()
  .eq('id', companyId);
```

### Dashboard Aggregation

For the main dashboard view, a PostgreSQL function handles the complex hierarchical query with filtering to avoid multiple round-trips:

```sql
create or replace function public.get_dashboard_data(
  p_company_ids uuid[] default null,
  p_product_ids uuid[] default null,
  p_therapeutic_area_ids uuid[] default null,
  p_start_year int default null,
  p_end_year int default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
  -- Returns hierarchical JSON: companies > products > trials with phases, markers, notes
  -- Filters applied at each level; date range filters trial_phases and trial_markers
$$;
```

Called from Angular via:
```typescript
const { data, error } = await supabase.rpc('get_dashboard_data', {
  p_company_ids: filters.companyIds,
  p_start_year: filters.startYear,
  p_end_year: filters.endYear,
});
```

---

## Frontend Design

### Component Architecture

```
AppComponent
├── AuthCallbackComponent (handles Google OAuth redirect)
├── LoginComponent (Google sign-in button)
├── HeaderComponent (app title, user menu, sign-out)
├── FilterPanelComponent
│   ├── Company multi-select (custom Tailwind dropdown)
│   ├── Product multi-select
│   ├── Therapeutic Area multi-select
│   └── Date range picker (custom Tailwind inputs)
├── TimelineZoomControlComponent
│   └── Zoom slider (yearly / quarterly / monthly / daily)
├── DashboardGridComponent
│   ├── GridHeaderComponent (year/quarter/month columns)
│   └── TrialRowComponent (repeated per trial)
│       ├── RowLabelComponent (company/product/therapeutic area cells with rowspan)
│       ├── PhaseBarComponent (SVG horizontal bar for each phase)
│       ├── MarkerComponent (SVG icon positioned on timeline)
│       │   └── MarkerTooltipComponent (overlay on hover)
│       └── RowNotesComponent (right-side annotations)
├── LegendComponent (marker type key, matching the PowerPoint footer)
└── ManagementPanelComponent (slide-out or modal, built with Tailwind)
    ├── CompanyFormComponent
    ├── ProductFormComponent
    ├── TrialFormComponent
    ├── PhaseFormComponent
    ├── MarkerFormComponent
    └── MarkerTypeFormComponent
```

All components are standalone (no NgModules). All use `inject()` for DI, signals for state, and Tailwind CSS for styling.

### Timeline Rendering Strategy

The timeline is the core visual component. It uses SVG within Angular components:

1. **Grid columns**: Calculated based on zoom level. At yearly zoom, each year gets equal width. At monthly zoom, each month gets a column. Column widths scale proportionally.

2. **Phase bars**: SVG `<rect>` elements positioned by mapping `start_date`/`end_date` to x-coordinates within the timeline. Color-coded by phase type. Phase label text rendered inside or beside the bar.

3. **Markers**: SVG icons (`<circle>`, `<polygon>` for diamonds, custom `<path>` for flags, arrows, X) positioned at the x-coordinate corresponding to `event_date`. For range markers (Est. Launch Range), render a gradient `<rect>`.

4. **Row grouping**: Company and Product cells use CSS `grid-row` spanning. Alternating background colors for readability using Tailwind utility classes.

5. **Zoom**: Changing zoom level recalculates column widths and repositions all SVG elements. Smooth CSS transitions for zoom animations. A horizontal scrollbar appears when zoomed in beyond viewport width.

### Key Interactions

- **Hover on marker**: Shows tooltip with `tooltip_text` and optional image
- **Click on marker**: Opens edit form for that marker
- **Click on phase bar**: Opens edit form for that phase
- **Click on trial name**: Opens full trial edit form
- **Right-click context menu**: Add marker, add phase, edit trial, delete
- **Drag on empty timeline area**: Create new phase bar (stretch to set date range)
- **Filter changes**: Re-fetch dashboard data via Supabase and re-render

### State Management

Use Angular 19 signals and the `resource()` API for reactive state:
- `dashboardData` - fetched via `resource()` calling `supabase.rpc('get_dashboard_data', ...)` with automatic loading/error states
- `filters` - `signal()` for current filter selections
- `zoomLevel` - `signal()` with current zoom (enum: yearly, quarterly, monthly, daily)
- `timelineRange` - `linkedSignal()` derived from zoomLevel and filter changes
- `currentUser` - `signal()` managed by SupabaseService from `onAuthStateChange`
- Use `computed()` for derived values (e.g., visible rows, column positions)
- Use `effect()` sparingly for side effects (e.g., URL sync with filter state)

### Routing

| Route | Component | Guard |
|-------|-----------|-------|
| `/login` | LoginComponent | Redirect to `/` if already authenticated |
| `/auth/callback` | AuthCallbackComponent | None (handles OAuth redirect) |
| `/` | DashboardComponent | AuthGuard |
| `/manage/companies` | CompanyListComponent | AuthGuard |
| `/manage/products` | ProductListComponent | AuthGuard |
| `/manage/trials/:id` | TrialDetailComponent | AuthGuard |
| `/manage/marker-types` | MarkerTypeListComponent | AuthGuard |
| `/manage/therapeutic-areas` | TherapeuticAreaListComponent | AuthGuard |

---

## Tasks

```yaml
tasks:
  # -- Database migrations (sequential, ordered timestamps) --

  - id: T1
    title: "Database migration - core tables"
    description: |
      Create the first Supabase migration with core reference tables:
      companies, products, therapeutic_areas.
      - All tables in public schema with uuid PKs (gen_random_uuid())
      - All tables include user_id (FK to auth.users) for RLS
      - Enable RLS on each table
      - Add table comments per SQL style guide
      - All SQL lowercase, snake_case naming
      Follow docs/supabase-guides/database-create-migration.md and
      docs/supabase-guides/sql-style-guide.md for conventions.
    files:
      - create: supabase/migrations/20260315120000_create_core_tables.sql
    dependencies: []
    verification: "supabase db reset"

  - id: T2
    title: "Database migration - trial tables and marker types"
    description: |
      Create migration for trial-related tables:
      trials, trial_phases, marker_types, trial_markers, trial_notes.
      - All tables include user_id for RLS
      - marker_types.user_id is nullable (null for system types)
      - Foreign keys to core tables (companies, products, therapeutic_areas)
      - Proper indexes on foreign key columns and columns used in filters
    files:
      - create: supabase/migrations/20260315120100_create_trial_tables.sql
    dependencies: [T1]
    verification: "supabase db reset"

  - id: T3
    title: "Database migration - RLS policies"
    description: |
      Create RLS policies for all tables. Each table gets four policies
      (select, insert, update, delete) scoped to authenticated role
      using auth.uid() = user_id.
      Special case for marker_types: system types (is_system = true)
      are readable by all authenticated users.
      Follow docs/supabase-guides/database-rls-policies.md.
    files:
      - create: supabase/migrations/20260315120200_create_rls_policies.sql
    dependencies: [T2]
    verification: "supabase db reset"

  - id: T4
    title: "Database - seed data and dashboard function"
    description: |
      1. Add seed data for the 10 predefined marker types to supabase/seed.sql.
         System marker types have is_system=true and user_id=null.
      2. Create a database function get_dashboard_data() that returns
         the hierarchical dataset (companies > products > trials with
         phases, markers, notes) as JSONB. Accepts optional filter
         parameters: p_company_ids, p_product_ids, p_therapeutic_area_ids,
         p_start_year, p_end_year. Uses SECURITY INVOKER so RLS applies.
         Follow docs/supabase-guides/database-functions.md.
    files:
      - create: supabase/seed.sql
      - create: supabase/migrations/20260315120300_create_dashboard_function.sql
    dependencies: [T3]
    verification: "supabase db reset"

  # -- Angular project setup --

  - id: T5
    title: "Project scaffolding - Angular 19 + Supabase + Tailwind v4"
    description: |
      Initialize the project:
      - Create Angular 19 project under src/client/ with standalone components
      - Install and configure Tailwind CSS v4 via PostCSS plugin (.postcssrc.json)
      - Add @import "tailwindcss" to src/styles.css
      - Install @supabase/supabase-js
      - Create environment files with Supabase URL and anon key placeholders
      - Initialize Supabase project (supabase init) if not already done
      - Configure ESLint for ng lint
      - No Angular Material, no other component libraries
    files:
      - create: src/client/angular.json
      - create: src/client/package.json
      - create: src/client/tsconfig.json
      - create: src/client/.postcssrc.json
      - create: src/client/src/main.ts
      - create: src/client/src/styles.css
      - create: src/client/src/app/app.component.ts
      - create: src/client/src/app/app.config.ts
      - create: src/client/src/app/app.routes.ts
      - create: src/client/src/environments/environment.ts
      - create: src/client/src/environments/environment.development.ts
    dependencies: []
    verification: "cd src/client && npm install && npx ng lint && npx ng build"

  - id: T6
    title: "Supabase service and Google Auth"
    description: |
      Create the core SupabaseService that initializes the Supabase client
      and manages auth state:
      - createClient() with environment config
      - currentUser signal updated via onAuthStateChange()
      - signInWithGoogle() using supabase.auth.signInWithOAuth({ provider: 'google' })
      - signOut() method
      - session getter
      Create AuthCallbackComponent to handle the OAuth redirect.
      Create LoginComponent with a Google sign-in button (styled with Tailwind).
      Create AuthGuard (canActivate) that redirects to /login if not authenticated.
      Wire up routing with guards.
    files:
      - create: src/client/src/app/core/services/supabase.service.ts
      - create: src/client/src/app/core/guards/auth.guard.ts
      - create: src/client/src/app/features/auth/login.component.ts
      - create: src/client/src/app/features/auth/login.component.html
      - create: src/client/src/app/features/auth/auth-callback.component.ts
      - modify: src/client/src/app/app.routes.ts
    dependencies: [T5]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T7
    title: "Core layout, routing, and TypeScript interfaces"
    description: |
      Set up the app shell:
      - HeaderComponent with app title, user menu (avatar, sign-out), styled with Tailwind
      - Define TypeScript interfaces for all data models (Company, Product,
        Trial, TrialPhase, MarkerType, TrialMarker, TrialNote, DashboardData)
      - Create placeholder components for all routes (dashboard, manage/*)
      - Wire up lazy-loaded routes via loadComponent
      - Use @if, @for, @switch in all templates
    files:
      - create: src/client/src/app/core/layout/header.component.ts
      - create: src/client/src/app/core/layout/header.component.html
      - create: src/client/src/app/core/models/company.model.ts
      - create: src/client/src/app/core/models/product.model.ts
      - create: src/client/src/app/core/models/trial.model.ts
      - create: src/client/src/app/core/models/marker.model.ts
      - create: src/client/src/app/core/models/dashboard.model.ts
      - create: src/client/src/app/features/dashboard/dashboard.component.ts
      - create: src/client/src/app/features/manage/ (placeholder components)
      - modify: src/client/src/app/app.component.ts
      - modify: src/client/src/app/app.routes.ts
    dependencies: [T6]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T8
    title: "Data services - Supabase JS client queries"
    description: |
      Create Angular services for all entities using Supabase JS client:
      - CompanyService: CRUD + list with products
      - ProductService: CRUD + list by company
      - TherapeuticAreaService: CRUD + list all
      - TrialService: CRUD + list with filters, nested phases/markers/notes
      - TrialPhaseService: create, update, delete
      - TrialMarkerService: create, update, delete
      - MarkerTypeService: list all (system + user), create/update/delete user types
      - TrialNoteService: create, update, delete
      - DashboardService: calls supabase.rpc('get_dashboard_data', filters)
      All services use inject(SupabaseService) and return Promise<T>.
      Destructure { data, error } and throw on error.
    files:
      - create: src/client/src/app/core/services/company.service.ts
      - create: src/client/src/app/core/services/product.service.ts
      - create: src/client/src/app/core/services/therapeutic-area.service.ts
      - create: src/client/src/app/core/services/trial.service.ts
      - create: src/client/src/app/core/services/trial-phase.service.ts
      - create: src/client/src/app/core/services/trial-marker.service.ts
      - create: src/client/src/app/core/services/marker-type.service.ts
      - create: src/client/src/app/core/services/trial-note.service.ts
      - create: src/client/src/app/core/services/dashboard.service.ts
    dependencies: [T7]
    verification: "cd src/client && npx ng lint && npx ng build"

  # -- Dashboard UI components --

  - id: T9
    title: "Filter panel component"
    description: |
      Build the FilterPanelComponent with custom Tailwind-styled multi-select
      dropdowns for Company, Product, and Therapeutic Area. Includes date
      range inputs (start year / end year).
      - Fetch filter options from Supabase via respective services
      - Use signals for filter state
      - Emit filter changes via output() function
      - Keyboard navigable dropdowns with visible focus indicators
      - Use @for to render options, @if for empty states
    files:
      - create: src/client/src/app/features/dashboard/filter-panel/filter-panel.component.ts
      - create: src/client/src/app/features/dashboard/filter-panel/filter-panel.component.html
      - create: src/client/src/app/shared/components/multi-select/multi-select.component.ts
      - create: src/client/src/app/shared/components/multi-select/multi-select.component.html
    dependencies: [T8]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T10
    title: "Timeline grid - header and row layout"
    description: |
      Build the DashboardGridComponent with the timeline header
      (year/quarter/month columns based on zoom level) and the
      row structure with company/product/therapeutic area label cells
      that span multiple rows using CSS grid-row.
      Build the TimelineZoomControlComponent (zoom slider).
      Build TimelineService with date-to-pixel coordinate mapping.
      All styled with Tailwind utilities.
    files:
      - create: src/client/src/app/features/dashboard/grid/dashboard-grid.component.ts
      - create: src/client/src/app/features/dashboard/grid/dashboard-grid.component.html
      - create: src/client/src/app/features/dashboard/grid/grid-header.component.ts
      - create: src/client/src/app/features/dashboard/grid/grid-header.component.html
      - create: src/client/src/app/features/dashboard/grid/trial-row.component.ts
      - create: src/client/src/app/features/dashboard/grid/trial-row.component.html
      - create: src/client/src/app/features/dashboard/grid/row-label.component.ts
      - create: src/client/src/app/features/dashboard/zoom-control/zoom-control.component.ts
      - create: src/client/src/app/core/services/timeline.service.ts
    dependencies: [T7]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T11
    title: "Phase bar SVG rendering"
    description: |
      Build the PhaseBarComponent that renders SVG rectangles for
      trial phases, positioned and scaled according to the timeline.
      Color-coded by phase type with configurable override.
      Shows phase label text inside or beside the bar.
      Handles click to open edit form.
      All non-SVG styling via Tailwind.
    files:
      - create: src/client/src/app/features/dashboard/grid/phase-bar.component.ts
      - create: src/client/src/app/features/dashboard/grid/phase-bar.component.html
    dependencies: [T10]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T12
    title: "Marker SVG rendering with tooltips"
    description: |
      Build the MarkerComponent that renders SVG icons for each
      marker type (circle, diamond, flag, arrow, x, bar) with
      correct fill styles (outline, filled, striped, gradient).
      Build the MarkerTooltipComponent for hover overlays showing
      tooltip text and optional images.
      Create reusable SVG icon components for each shape.
    files:
      - create: src/client/src/app/features/dashboard/grid/marker.component.ts
      - create: src/client/src/app/features/dashboard/grid/marker.component.html
      - create: src/client/src/app/features/dashboard/grid/marker-tooltip.component.ts
      - create: src/client/src/app/features/dashboard/grid/marker-tooltip.component.html
      - create: src/client/src/app/shared/components/svg-icons/circle-icon.component.ts
      - create: src/client/src/app/shared/components/svg-icons/diamond-icon.component.ts
      - create: src/client/src/app/shared/components/svg-icons/flag-icon.component.ts
      - create: src/client/src/app/shared/components/svg-icons/arrow-icon.component.ts
      - create: src/client/src/app/shared/components/svg-icons/x-icon.component.ts
      - create: src/client/src/app/shared/components/svg-icons/bar-icon.component.ts
    dependencies: [T10]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T13
    title: "Legend and notes components"
    description: |
      Build the LegendComponent showing all marker types with their
      SVG icons and labels (matching the PowerPoint footer key).
      Build the RowNotesComponent for the right-side annotations
      on each trial row.
    files:
      - create: src/client/src/app/features/dashboard/legend/legend.component.ts
      - create: src/client/src/app/features/dashboard/legend/legend.component.html
      - create: src/client/src/app/features/dashboard/grid/row-notes.component.ts
      - create: src/client/src/app/features/dashboard/grid/row-notes.component.html
    dependencies: [T12]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T14
    title: "Dashboard integration - data binding and interactions"
    description: |
      Wire up the full dashboard:
      - Use resource() to fetch data via DashboardService.getDashboardData()
        with signal-based filter parameters for automatic refetching
      - Pass data to grid via signal inputs
      - Bind filters, handle zoom changes
      - Implement click-to-edit on markers and phase bars (opens management panel)
      - Context menus for adding new items
      - Integrate all sub-components using @defer for heavy components
      - Loading and error states with Tailwind-styled indicators
    files:
      - modify: src/client/src/app/features/dashboard/dashboard.component.ts
      - create: src/client/src/app/features/dashboard/dashboard.component.html
    dependencies: [T4, T8, T9, T10, T11, T12, T13]
    verification: "cd src/client && npx ng lint && npx ng build"

  # -- Management forms --

  - id: T15
    title: "Management forms - Companies, Products, Therapeutic Areas"
    description: |
      Build CRUD forms and list views for managing Companies, Products,
      and Therapeutic Areas.
      - Custom Tailwind-styled form inputs, tables, and modals
      - Keyboard navigable with proper ARIA labels
      - Forms use reactive signals, not template-driven or reactive forms
      - List views with inline edit/delete actions
      - All data operations via respective Supabase-backed services
    files:
      - create: src/client/src/app/features/manage/companies/company-list.component.ts
      - create: src/client/src/app/features/manage/companies/company-list.component.html
      - create: src/client/src/app/features/manage/companies/company-form.component.ts
      - create: src/client/src/app/features/manage/companies/company-form.component.html
      - create: src/client/src/app/features/manage/products/product-list.component.ts
      - create: src/client/src/app/features/manage/products/product-list.component.html
      - create: src/client/src/app/features/manage/products/product-form.component.ts
      - create: src/client/src/app/features/manage/products/product-form.component.html
      - create: src/client/src/app/features/manage/therapeutic-areas/therapeutic-area-list.component.ts
      - create: src/client/src/app/features/manage/therapeutic-areas/therapeutic-area-list.component.html
      - create: src/client/src/app/features/manage/therapeutic-areas/therapeutic-area-form.component.ts
      - create: src/client/src/app/features/manage/therapeutic-areas/therapeutic-area-form.component.html
      - create: src/client/src/app/shared/components/modal/modal.component.ts
      - create: src/client/src/app/shared/components/modal/modal.component.html
    dependencies: [T8]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T16
    title: "Management forms - Trials, Markers, Marker Types"
    description: |
      Build the trial detail/edit form with sections for phases,
      markers, and notes. Build the marker type management view
      for creating custom marker types with shape/color/fill selection.
      - Trial form includes inline phase and marker management
      - Marker type form has visual preview of shape + fill + color
      - System marker types are read-only (is_system = true)
    files:
      - create: src/client/src/app/features/manage/trials/trial-detail.component.ts
      - create: src/client/src/app/features/manage/trials/trial-detail.component.html
      - create: src/client/src/app/features/manage/trials/trial-form.component.ts
      - create: src/client/src/app/features/manage/trials/trial-form.component.html
      - create: src/client/src/app/features/manage/trials/phase-form.component.ts
      - create: src/client/src/app/features/manage/trials/marker-form.component.ts
      - create: src/client/src/app/features/manage/trials/note-form.component.ts
      - create: src/client/src/app/features/manage/marker-types/marker-type-list.component.ts
      - create: src/client/src/app/features/manage/marker-types/marker-type-list.component.html
      - create: src/client/src/app/features/manage/marker-types/marker-type-form.component.ts
      - create: src/client/src/app/features/manage/marker-types/marker-type-form.component.html
    dependencies: [T8]
    verification: "cd src/client && npx ng lint && npx ng build"
```

---

## Open Questions

1. **Company logos/product images**: Should the dashboard display company and product logos inline (as shown in the PowerPoint with Jardiance, Farxiga logos), or are text labels sufficient for MVP?
2. **Trial name linking**: The PowerPoint shows trial names as hyperlinks (e.g., "EMPEROR-Preserved"). Should these link to ClinicalTrials.gov entries or be plain text for MVP?
3. **Print layout**: Beyond the deferred PDF/PPT export, should the browser print stylesheet be optimized for direct printing?

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| SVG timeline rendering performance with many trials | Virtualize rows outside viewport; limit initial dataset with filtering |
| Complex Supabase PostgREST nested queries for dashboard | Use a database function (get_dashboard_data) to handle the aggregation server-side |
| Custom Tailwind UI components (dropdowns, modals) lack polish | Build shared reusable components early (T9 multi-select, T15 modal); iterate |
| Complex zoom level transitions | Start with discrete zoom levels (yearly/quarterly/monthly) before adding smooth zoom |
| Phase bar drag-to-create UX complexity | Implement click-to-create with form first; add drag interaction as enhancement |
| Google OAuth redirect flow issues in development | Configure Supabase Auth redirect URLs for both localhost and production |
