---
id: spec-2026-006
title: Clint Product Runbook
slug: runbook
status: draft
created: 2026-03-21
updated: 2026-03-21
---

# Clint -- Clinical Trial Status Dashboard: Runbook

> A comprehensive reference for developers, operators, and end users.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Motivation](#2-motivation)
3. [Tech Stack](#3-tech-stack)
4. [Features](#4-features)
5. [Architecture Overview](#5-architecture-overview)
6. [Frontend Architecture](#6-frontend-architecture)
7. [Backend Architecture](#7-backend-architecture)
8. [Database Schema](#8-database-schema)
9. [Authentication & Security](#9-authentication--security)
10. [Multi-Tenant Model](#10-multi-tenant-model)
11. [User Guide](#11-user-guide)
12. [Developer Guide](#12-developer-guide)
13. [Deployment](#13-deployment)

---

## 1. Product Overview

**Clint** is a web-based clinical trial status dashboard built for pharmaceutical executives and business development teams. It provides a structured, interactive timeline view of drug development pipelines -- organized by company, product, and therapeutic area -- with configurable zoom levels, event markers, and filtering capabilities.

The dashboard replaces static PowerPoint-based tracking workflows with a live, collaborative, data-driven application that supports multiple organizations and teams.

---

## 2. Motivation

### The Problem

Pharmaceutical BD teams and executives track competitive clinical trial landscapes using manually maintained PowerPoint slides. This approach has fundamental limitations:

- **Stale data** -- slides are only as current as the last manual update
- **No collaboration** -- multiple teams maintain separate versions
- **Poor interactivity** -- no filtering, zooming, or drill-down
- **Limited scalability** -- adding companies or trials requires slide redesign
- **No audit trail** -- changes are invisible and untracked

### The Solution

Clint provides a purpose-built web application that mirrors the familiar visual language of the PowerPoint format (timeline grid, phase bars, event markers) while adding:

- Real-time collaborative data management
- Flexible filtering and zoom
- Multi-tenant isolation so different organizations each have their own data
- PowerPoint export for stakeholders who still need slides

### Design Principles

The product follows **Clinical Precision** as its core design personality -- inspired by medical journals and regulatory documents. The UI prioritizes:

- **Visual parsability** over decoration -- data density without noise
- **Markers pop** -- the events executives scan for are the primary visual element
- **Phase bars as backdrop** -- subtle context, not the focus
- **Teal + Slate palette** -- clinical and precise, not generic

---

## 3. Tech Stack

### Why These Choices

| Layer | Technology | Rationale |
|---|---|---|
| Frontend Framework | Angular 19 | Strong typing, predictable structure, signals-based reactivity, enterprise-grade |
| UI Components | PrimeNG 19 | Comprehensive component library; Aura preset supports custom teal/slate theming |
| Styling | Tailwind CSS v4 | Utility-first layout around PrimeNG; no custom CSS boilerplate |
| Backend / DB | Supabase | Managed Postgres + Auth + PostgREST in one; RLS provides tenant isolation |
| Auth | Google OAuth (via Supabase) | Zero-friction SSO for enterprise users; no password management |
| Export | pptxgenjs | Client-side PowerPoint generation; no server-side processing needed |
| Deployment | Netlify | Static SPA hosting with zero-config builds; CDN-distributed |

### Full Version Inventory

```
Angular           19.x
TypeScript        5.6
RxJS              7.8
PrimeNG           19.x
@primeng/themes   19.x
Tailwind CSS      4.x
tailwindcss-primeui 0.6.1
@angular/cdk      19.x
Supabase JS       2.49
pptxgenjs         4.0.1
FontAwesome Free  7.2
Node.js           (LTS)
PostgreSQL        15+ (via Supabase)
zone.js           0.15
tslib             2.6
```

---

## 4. Features

### 4.1 Timeline Dashboard

The primary view of the application. Displays a grid where rows represent clinical trials and columns represent time. The grid is organized hierarchically:

```
Company
  +-- Product
        +-- Trial (with phase bars and event markers)
```

**Phase Bars** -- horizontal bands that span the timeline for each trial phase. Color-coded by phase type:
- **Phase 1** -- Muted slate (`#94a3b8`, early/exploratory)
- **Phase 2** -- Cyan (`#67e8f9`, building evidence)
- **Phase 3** -- Teal (`#2dd4bf`, pivotal trials)
- **Phase 4** -- Violet (`#a78bfa`, post-approval)
- **Observational** -- Amber (`#fbbf24`, caution-adjacent)

**Event Markers** -- icons placed at specific dates on the timeline. 10 system-provided marker types plus custom user-defined types. Shapes include circles, diamonds, flags, arrows, bars, and X marks -- each with color coding by category:
- Green circles -- Data events
- Red diamonds -- Regulatory events
- Blue flags/bars -- Approval/Launch events
- Orange/red arrows/X -- Change/status events

**Notes** -- free-text annotations attached to trials, displayed inline.

### 4.2 Timeline Zoom

Four zoom levels let users control the time granularity. The `TimelineService` defines pixel-per-year ratios for each:

| Zoom | Pixels/Year | Column Unit | Use Case |
|---|---|---|---|
| Yearly | 200 px | 1 year | 5-10 year pipelines |
| Quarterly | 600 px (150/quarter) | 1 quarter | 2-3 year views |
| Monthly | 1200 px (100/month) | 1 month | Near-term tracking |
| Daily | 1460 px (4/day) | 1 day | Precise event placement |

The `TimelineService` provides `dateToX()` and `xToDate()` methods for converting between pixel positions and ISO dates, plus `getColumns()` for generating hierarchical column headers with sub-columns.

### 4.3 Filtering

The `FilterPanelComponent` lets users narrow the dashboard to:

- **Companies** -- show only selected companies
- **Products** -- show only selected products
- **Therapeutic Areas** -- filter by medical indication (Oncology, Cardiology, etc.)
- **Date Range** -- clamp the visible timeline window (start year / end year)
- **Recruitment Status** -- Active, Completed, Suspended, etc.
- **Study Type** -- Interventional, Observational, Expanded Access
- **Phase** -- P1, P2, P3, P4, Observational

All filter values are passed as arrays to the `get_dashboard_data()` RPC function.

### 4.4 Legend

A grouped reference panel (`LegendComponent`) showing all marker types with their SVG icons and labels. Organized by category. Collapsible for more dashboard space.

### 4.5 Data Management

A full CRUD interface for managing all data within a space:

| Section | What You Manage |
|---|---|
| Companies | Pharma/biotech company records (name, logo_url, display_order, color) |
| Products | Drug/therapy products linked to a company (name, generic_name, logo_url) |
| Trials | Clinical studies with all metadata + CT.gov dimensions |
| Trial Phases | Phase records with phase_type, start_date, end_date, color, label |
| Trial Markers | Event markers with event_date, end_date, tooltip_text, is_projected |
| Trial Notes | Free-text annotations on trials |
| Marker Types | Custom marker types beyond the 10 system defaults |
| Therapeutic Areas | Medical indication categories (name, abbreviation) |

### 4.6 PowerPoint Export

The `PptxExportService` generates a `.pptx` file replicating the dashboard view using `pptxgenjs`. Users can configure:

- Title slide content
- Which trials to include
- Date range for the export (start/end year)
- Zoom level

Export details:
- Fixed slide dimensions: 13.33" x 7.5" (widescreen)
- Label column width: 2.8" (Company / Product / Trial names)
- Phase bars rendered with exact colors matching the dashboard
- Markers rendered with shape/fill/color matching their type definitions
- Date labels on markers with overlap detection
- Alternating row backgrounds for readability
- Legend showing all marker types
- Runs entirely client-side -- no file is sent to a server

### 4.7 CT.gov Dimensions

The `CtgovSyncService` can fetch trial data from the ClinicalTrials.gov API v2 by NCT ID and map it to internal fields. Trials can store 35+ fields from the ClinicalTrials.gov data model, including:

- **Logistics**: recruitment_status, sponsor_type, lead_sponsor, collaborators[], study_countries[], study_regions[]
- **Scientific Design**: study_type, phase, design_allocation, design_intervention_model, design_masking, design_primary_purpose, enrollment_type
- **Clinical Context**: conditions[], intervention_type, intervention_name, primary/secondary_outcome_measures (jsonb), is_rare_disease
- **Eligibility**: eligibility_sex, eligibility_min_age, eligibility_max_age, accepts_healthy_volunteers, eligibility_criteria, sampling_method
- **Timeline**: start_date, primary_completion_date, study_completion_date (each with _type: Actual|Estimated), plus posting dates
- **Regulatory**: has_dmc, is_fda_regulated_drug, is_fda_regulated_device, fda_designations[], submission_type
- **Sync Tracking**: ctgov_last_synced_at, ctgov_raw_json

Helper methods in the sync service handle phase mapping, masking conversion, sponsor class normalization, country extraction, and region inference.

### 4.8 Multi-Tenant Workspaces

The application supports multiple organizations (tenants) and multiple projects within each organization (spaces):

- Each **tenant** represents an organization (e.g., a pharma company or consulting firm)
- Each **space** within a tenant is a separate project/pipeline workspace
- Members can be invited to tenants via invite codes (7-day expiry)
- Spaces have role-based access: owner, editor, viewer
- Data is fully isolated between spaces -- no cross-tenant data leakage

### 4.9 Authentication

Google OAuth via Supabase Auth. Users sign in with their Google account; no password management required. Auth state is managed in the Angular frontend via reactive signals (`currentUser`, `session`) in `SupabaseService`.

---

## 5. Architecture Overview

```
+---------------------------------------------------------------------+
|                          Browser (User)                              |
|                                                                     |
|   +--------------------------------------------------------------+  |
|   |              Angular 19 SPA (src/client/)                    |  |
|   |                                                              |  |
|   |  +-------------+  +--------------+  +-------------------+   |  |
|   |  |  Dashboard  |  |    Manage    |  |  Auth / Onboard   |   |  |
|   |  |  (timeline) |  |  (CRUD UI)   |  |  (login, spaces)  |   |  |
|   |  +-------------+  +--------------+  +-------------------+   |  |
|   |                                                              |  |
|   |  Services layer: SupabaseService, DashboardService, etc.    |  |
|   +--------------------------------------------------------------+  |
|                         |  Supabase JS Client                       |
+-------------------------+-------------------------------------------+
                          | HTTPS
+-------------------------v-------------------------------------------+
|                         Supabase (Cloud)                            |
|                                                                     |
|  +--------------+  +--------------+  +--------------------------+  |
|  |   PostgREST  |  |     Auth     |  |       PostgreSQL 15      |  |
|  |  (auto REST  |  |  (Google     |  |                          |  |
|  |   from schema|  |   OAuth)     |  |  Tables, Functions, RLS  |  |
|  +--------------+  +--------------+  +--------------------------+  |
+---------------------------------------------------------------------+
```

### Data Flow

1. User signs in with Google -- Supabase Auth issues a JWT
2. Angular app stores the JWT in `SupabaseService.session` (signal)
3. All API calls from the Supabase JS client include the JWT automatically
4. Supabase PostgREST validates the JWT and applies Row Level Security
5. RLS policies check `auth.uid()` against `space_members` / `tenant_members` tables
6. Dashboard data is fetched via a single `get_dashboard_data()` RPC that returns nested JSON
7. Angular components consume reactive signals derived from service state

---

## 6. Frontend Architecture

### Project Structure

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
          circle-icon.component.ts
          diamond-icon.component.ts
          flag-icon.component.ts
          arrow-icon.component.ts
          x-icon.component.ts
          bar-icon.component.ts
      config/
        primeng-theme.ts        # Aura preset, teal primary, slate surface
    environments/
      environment.ts            # Supabase URL + anon key
    assets/                     # Static resources
    main.ts                     # Bootstrap file
    styles.css                  # Global Tailwind CSS (@import "tailwindcss")
```

### Angular Conventions

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

### App Configuration

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

### Routing

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

### Services

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

### Dashboard Component Hierarchy

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

### Key Component: DashboardComponent

The root dashboard component uses Angular signals extensively:

- `filtersSignal` -- reactive filter state
- `dashboardResource` -- `resource()` that reloads when filters change (request/loader pattern)
- `zoomLevel` -- signal driving column width calculations
- `computed()` -- derived lists for filter options (unique companies, etc.)
- `effect()` -- syncs filter state to URL query params

Click events on phase bars, markers, and trials emit from the grid and navigate to trial detail pages.

### Header Component

The `HeaderComponent` provides global navigation:

- **Left**: "Clint" logo + tenant dropdown (if multiple tenants) + space dropdown
- **Center**: Navigation links when inside a space (Dashboard, Companies, Products, Markers, Therapeutic Areas)
- **Right**: Settings gear icon, user email, Sign out button
- **State persistence**: Stores `lastTenantId` and `lastSpaceId` in localStorage
- **Route sync**: Recursively extracts route params (tenantId, spaceId) from Angular route tree

### Models

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

### SVG Icon Components

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

---

## 7. Backend Architecture

The backend is entirely managed by Supabase -- no custom server code.

### Supabase Services Used

| Service | Purpose |
|---|---|
| PostgreSQL 15 | Primary data store for all application data |
| PostgREST | Auto-generated REST API from the Postgres schema; used for CRUD operations |
| Supabase Auth | JWT-based auth with Google OAuth provider; 1-hour JWT expiry with refresh token rotation |
| Supabase JS 2.49 | Client library used by Angular to call all backend APIs |

### Database Functions (RPCs)

**`get_dashboard_data(p_space_id, p_company_ids, p_product_ids, p_therapeutic_area_ids, p_start_year, p_end_year, p_recruitment_statuses, p_study_types, p_phases)`**

The single most important function. Accepts a space ID and optional filter arrays, and returns a single nested JSON object:

```json
{
  "companies": [
    {
      "id": "...", "name": "...", "color": "...",
      "products": [
        {
          "id": "...", "name": "...",
          "trials": [
            {
              "id": "...", "name": "...",
              "therapeutic_area": { "name": "...", "abbreviation": "..." },
              "recruitment_status": "...", "study_type": "...", "phase": "...",
              "phases": [{ "phase_type": "...", "start_date": "...", "end_date": "..." }],
              "markers": [{ "event_date": "...", "marker_type": { "shape": "...", "color": "..." } }],
              "notes": [{ "content": "..." }]
            }
          ]
        }
      ]
    }
  ]
}
```

This eliminates N+1 query problems. The entire dashboard renders from a single RPC call. Uses `SECURITY INVOKER` so RLS policies apply to the calling user.

**`create_tenant(p_name, p_slug)`**

Creates a new tenant record and adds the calling user as the owner in `tenant_members` in a single transaction. Uses `SECURITY DEFINER` to bypass RLS bootstrapping issues.

**`create_space(p_tenant_id, p_name, p_description)`**

Creates a new space and adds the calling user as the space owner. Verifies the caller is a member of the parent tenant before creation. Uses `SECURITY DEFINER`.

**`seed_demo_data(p_space_id)`**

Populates a space with pharmaceutical demo data -- companies (AstraZeneca, Eli Lilly, Novo Nordisk), products (Farxiga, Jardiance, Mounjaro, Ozempic), therapeutic areas, 8 trials with phases and markers. Idempotent (checks if user already has companies).

**`has_space_access(p_space_id, p_roles)`**

Helper function used in RLS policies. Returns true if the calling user is either:
- A member of the space with one of the given roles, or
- The owner of the parent tenant

**`is_tenant_member(p_tenant_id, p_roles)`**

Helper for tenant-level RLS. Returns true if the calling user has the specified role in the tenant.

### Views

**`space_members_view`** -- Joins `space_members` with `auth.users` metadata to expose display name (from `raw_user_meta_data->full_name` or email) and email alongside membership records. Uses `SECURITY INVOKER`.

**`tenant_members_view`** -- Same pattern for tenant membership.

---

## 8. Database Schema

All schema changes are in `supabase/migrations/` as timestamped SQL files. The current schema is built from 16 migrations.

### Migration History

| # | File | Purpose |
|---|---|---|
| 1 | `20260315120000_create_core_tables.sql` | Core domain tables: companies, products, therapeutic_areas |
| 2 | `20260315120100_create_trial_tables.sql` | Trial tables: trials, trial_phases, marker_types, trial_markers, trial_notes |
| 3 | `20260315120200_create_rls_policies.sql` | Initial user_id-based RLS policies |
| 4 | `20260315120300_create_dashboard_function.sql` | `get_dashboard_data()` RPC with JSON aggregation |
| 5 | `20260315163507_seed_system_marker_types.sql` | 10 system marker types with fixed UUIDs |
| 6 | `20260315163538_seed_demo_data_function.sql` | `seed_demo_data()` function for testing |
| 7 | `20260315170000_create_tenant_space_tables.sql` | Multi-tenant tables + helper functions |
| 8 | `20260315170100_add_space_id_to_data_tables.sql` | Migrates from user_id to space_id model (destructive) |
| 9 | `20260315170200_update_seed_demo_data_for_spaces.sql` | Updates seed function for space model |
| 10 | `20260315181748_fix_tenant_creation_rls.sql` | Fixes RLS bootstrapping for tenant/space creation |
| 11 | `20260315191402_create_tenant_function.sql` | `create_tenant()` and `create_space()` RPCs |
| 12 | `20260315192926_seed_pharma_demo_data.sql` | Realistic pharma demo data (BI, Azurity, multi-tenant) |
| 13 | `20260315194716_add_member_views.sql` | `tenant_members_view` and `space_members_view` |
| 14 | `20260315200000_add_ctgov_dimensions.sql` | 35+ CT.gov metadata columns on trials |
| 15 | `20260315200100_update_dashboard_function_filters.sql` | Filter params for CT.gov fields in RPC |
| 16 | `20260315200200_enrich_demo_trials.sql` | CT.gov metadata for demo trials |

### Core Data Tables

```sql
-- Organizations that own pharma pipelines
companies (
  id            uuid PRIMARY KEY,
  space_id      uuid REFERENCES spaces(id) NOT NULL,
  created_by    uuid NOT NULL,
  name          text NOT NULL,
  logo_url      text,
  display_order integer,
  created_at    timestamptz,
  updated_at    timestamptz
)

-- Drug/therapy products belonging to a company
products (
  id            uuid PRIMARY KEY,
  space_id      uuid REFERENCES spaces(id) NOT NULL,
  created_by    uuid NOT NULL,
  company_id    uuid REFERENCES companies(id),
  name          text NOT NULL,
  generic_name  text,
  logo_url      text,
  display_order integer,
  created_at    timestamptz,
  updated_at    timestamptz
)

-- Clinical trial entries
trials (
  id                          uuid PRIMARY KEY,
  space_id                    uuid NOT NULL,
  created_by                  uuid NOT NULL,
  product_id                  uuid REFERENCES products(id),
  therapeutic_area_id         uuid REFERENCES therapeutic_areas(id),
  name                        text NOT NULL,
  identifier                  text,
  sample_size                 integer,
  status                      text,
  notes                       text,
  display_order               integer,
  -- CT.gov dimensions (35+ fields):
  recruitment_status          text,
  study_type                  text,
  phase                       text,
  sponsor_type                text,
  lead_sponsor                text,
  collaborators               text[],
  study_countries             text[],
  study_regions               text[],
  design_allocation           text,
  design_intervention_model   text,
  design_masking              text,
  design_primary_purpose      text,
  enrollment_type             text,
  conditions                  text[],
  intervention_type           text,
  intervention_name           text,
  primary_outcome_measures    jsonb,
  secondary_outcome_measures  jsonb,
  is_rare_disease             boolean,
  eligibility_sex             text,
  eligibility_min_age         text,
  eligibility_max_age         text,
  accepts_healthy_volunteers  boolean,
  eligibility_criteria        text,
  sampling_method             text,
  start_date                  date,
  start_date_type             text,
  primary_completion_date     date,
  primary_completion_date_type text,
  study_completion_date       date,
  study_completion_date_type  text,
  study_first_posted_date     date,
  results_first_posted_date   date,
  last_update_posted_date     date,
  has_dmc                     boolean,
  is_fda_regulated_drug       boolean,
  is_fda_regulated_device     boolean,
  fda_designations            text[],
  submission_type             text,
  ctgov_last_synced_at        timestamptz,
  ctgov_raw_json              jsonb,
  created_at                  timestamptz,
  updated_at                  timestamptz
)

-- Individual phases within a trial
trial_phases (
  id            uuid PRIMARY KEY,
  space_id      uuid NOT NULL,
  created_by    uuid NOT NULL,
  trial_id      uuid REFERENCES trials(id),
  phase_type    text NOT NULL,    -- 'P1'|'P2'|'P3'|'P4'|'OBS'
  start_date    date,
  end_date      date,
  color         text,             -- hex color override
  label         text,             -- custom label
  created_at    timestamptz,
  updated_at    timestamptz
)

-- Event markers placed on the timeline
trial_markers (
  id                uuid PRIMARY KEY,
  space_id          uuid NOT NULL,
  created_by        uuid NOT NULL,
  trial_id          uuid REFERENCES trials(id),
  marker_type_id    uuid REFERENCES marker_types(id),
  event_date        date NOT NULL,
  end_date          date,            -- for range markers (bar type)
  tooltip_text      text,
  tooltip_image_url text,
  is_projected      boolean,
  created_at        timestamptz,
  updated_at        timestamptz
)

-- Free-text notes on trials
trial_notes (
  id          uuid PRIMARY KEY,
  space_id    uuid NOT NULL,
  created_by  uuid NOT NULL,
  trial_id    uuid REFERENCES trials(id),
  content     text NOT NULL,
  created_at  timestamptz,
  updated_at  timestamptz
)

-- Marker type definitions (10 system + custom user types)
marker_types (
  id            uuid PRIMARY KEY,
  space_id      uuid,              -- null for system types
  created_by    uuid,              -- null for system types
  name          text NOT NULL,
  icon          text,
  shape         text,              -- 'circle'|'diamond'|'flag'|'arrow'|'bar'|'x'
  fill_style    text,              -- 'filled'|'outline'|'striped'|'gradient'
  color         text,              -- hex color
  is_system     boolean,
  display_order integer,
  created_at    timestamptz,
  updated_at    timestamptz
)

-- Therapeutic area classifications
therapeutic_areas (
  id            uuid PRIMARY KEY,
  space_id      uuid NOT NULL,
  created_by    uuid NOT NULL,
  name          text NOT NULL,
  abbreviation  text,
  created_at    timestamptz,
  updated_at    timestamptz
)
```

### Multi-Tenant Tables

```sql
-- Top-level organizations
tenants (
  id          uuid PRIMARY KEY,
  name        text NOT NULL,
  slug        text UNIQUE,
  created_by  uuid,
  created_at  timestamptz,
  updated_at  timestamptz
)

-- Organization membership with roles
tenant_members (
  tenant_id   uuid REFERENCES tenants(id),
  user_id     uuid REFERENCES auth.users(id),
  role        text,           -- 'owner' | 'member'
  joined_at   timestamptz,
  PRIMARY KEY (tenant_id, user_id)
)

-- Invite codes for joining tenants
tenant_invites (
  id          uuid PRIMARY KEY,
  tenant_id   uuid REFERENCES tenants(id),
  email       text,
  role        text,
  invite_code text UNIQUE,
  created_by  uuid,
  accepted_at timestamptz,
  expires_at  timestamptz     -- default: 7 days from creation
)

-- Project workspaces within a tenant
spaces (
  id          uuid PRIMARY KEY,
  tenant_id   uuid REFERENCES tenants(id),
  name        text NOT NULL,
  description text,
  created_by  uuid,
  created_at  timestamptz,
  updated_at  timestamptz
)

-- Space membership with roles
space_members (
  space_id    uuid REFERENCES spaces(id),
  user_id     uuid REFERENCES auth.users(id),
  role        text,           -- 'owner' | 'editor' | 'viewer'
  joined_at   timestamptz,
  PRIMARY KEY (space_id, user_id)
)
```

### System Marker Types

10 marker types are pre-seeded with fixed UUIDs (`a0000000-0000-0000-0000-00000000000X`) and available in all spaces:

| # | Name | Shape | Fill | Color | Category |
|---|---|---|---|---|---|
| 1 | Projected Data Reported | Circle | Outline | Green | Data |
| 2 | Data Reported | Circle | Filled | Green | Data |
| 3 | Projected Regulatory Filing | Diamond | Outline | Red | Regulatory |
| 4 | Submitted Regulatory Filing | Diamond | Filled | Red | Regulatory |
| 5 | Label Projected Approval/Launch | Flag | Outline | Blue | Approval |
| 6 | Label Update | Flag | Striped | Blue | Approval |
| 7 | Est. Range of Potential Launch | Bar | Gradient | Blue | Approval |
| 8 | Primary Completion Date (PCD) | Circle | Filled | Gray | Other |
| 9 | Change from Prior Update | Arrow | Filled | Orange | Change |
| 10 | Event No Longer Expected | X | Filled | Red | Change |

### Database Indexes

Indexes on frequently filtered/joined columns:
- `companies.space_id`, `products.space_id`, `trials.space_id`
- `products.company_id`, `trials.product_id`, `trials.therapeutic_area_id`
- `trial_phases.trial_id`, `trial_markers.trial_id`, `trial_markers.marker_type_id`
- `trial_notes.trial_id`
- CT.gov filter columns: `trials.recruitment_status`, `trials.study_type`, `trials.phase`, `trials.intervention_type`

---

## 9. Authentication & Security

### Auth Flow

```
1.  User navigates to /login
2.  Clicks "Sign in with Google"
3.  SupabaseService.signInWithGoogle() opens Google OAuth redirect
4.  User authenticates with Google
5.  Google redirects back to /auth/callback
6.  AuthCallbackComponent: Supabase exchanges auth code for a session
7.  Supabase issues a JWT containing auth.uid() (1-hour expiry, refresh token rotation)
8.  SupabaseService stores session in signals (currentUser, session)
9.  SupabaseService.waitForSession() resolves
10. Angular router guards (authGuard) check currentUser signal
11. onboardingRedirectGuard checks for tenant membership:
    - No tenants -> redirects to /onboarding
    - Has tenants -> checks localStorage for lastTenantId
    - Redirects to /t/{tenantId}/spaces
```

### Row Level Security (RLS)

Every data table has RLS enabled. Policies are enforced at the Postgres level -- bypassing the API layer is not possible.

**Data tables** (`companies`, `products`, `trials`, `trial_phases`, `trial_markers`, `trial_notes`, `therapeutic_areas`) use:
```sql
-- SELECT: user has any access to the space
has_space_access(space_id, ARRAY['owner', 'editor', 'viewer'])

-- INSERT/UPDATE/DELETE: user has write access to the space
has_space_access(space_id, ARRAY['owner', 'editor'])
```

**Marker types** have special rules:
- System types (`is_system = true`) are readable by all authenticated users
- User-created types are scoped to their space with standard space access checks

**Tenant tables** use `is_tenant_member()` checks.

**Bootstrapping**: Special RLS policies allow users to add themselves as the first member when creating a tenant or space (fixes the chicken-and-egg problem).

### Guards

**`authGuard`** -- Async guard that calls `waitForSession()` and redirects to `/login` if no session exists.

**`onboardingRedirectGuard`** -- On the root path `/`, checks if the user has any tenant memberships. If none, redirects to `/onboarding`. If yes, retrieves `lastTenantId` from localStorage (or defaults to first tenant) and redirects to their tenant's `/spaces`.

---

## 10. Multi-Tenant Model

### Hierarchy

```
Tenant (Organization)
  +-- TenantMembers (role: owner | member)
  +-- TenantInvites (7-day expiry invite codes)
  +-- Spaces (Projects)
        +-- SpaceMembers (role: owner | editor | viewer)
        +-- Data (companies, products, trials, ...)
```

### Roles & Permissions

| Role | Scope | Can Do |
|---|---|---|
| Tenant Owner | Tenant | Manage members, create spaces, manage invites, full access to all spaces in the tenant |
| Tenant Member | Tenant | View tenant, join spaces, view assigned spaces |
| Space Owner | Space | Full CRUD on space data, manage space members |
| Space Editor | Space | Create/edit/delete data within the space |
| Space Viewer | Space | Read-only access to space data |

Note: Tenant owners automatically have access to all spaces within their tenant (enforced by `has_space_access()` function).

### Onboarding Flow

New users land at `/onboarding` after first sign-in. The `OnboardingComponent` provides two tabs:

1. **Create Organization**:
   - Text input for organization name
   - Slug auto-generated (lowercase, alphanumeric + hyphens only)
   - Calls `create_tenant()` RPC -- atomically creates tenant + adds caller as owner
   - Stores `lastTenantId` in localStorage
   - Redirects to `/t/{tenantId}/spaces`

2. **Join with Invite Code**:
   - Text input for 8-character invite code
   - Calls `tenantService.joinByCode(code)` -- validates code, checks expiry, adds user as member
   - Stores `lastTenantId` in localStorage
   - Redirects to `/t/{tenantId}/spaces`

### Tenant Settings

The `TenantSettingsComponent` provides:

- **Members table**: lists all members with name, email, role; remove button per member
- **Pending invites table**: shows invite code, email, role, expiration
- **Invite dialog**: email + role dropdown to generate new invite codes

---

## 11. User Guide

### Getting Started

#### Signing In

1. Navigate to the application URL
2. Click **Sign in with Google**
3. Authenticate with your Google account
4. On first sign-in, you'll be taken to the Onboarding screen

#### First-Time Onboarding

If your organization is new to Clint:
1. Click **Create Organization**
2. Enter your organization name
3. You'll land on the Spaces page

If you've been invited to an existing organization:
1. Click **Join with Invite Code**
2. Enter the code provided by your organization admin
3. You'll be added to the organization and directed to its spaces

#### Creating Your First Space

A Space is a workspace for one pipeline or project (e.g., "Oncology Pipeline Q1 2026").

1. On the Spaces page, click **New Space**
2. Enter a name and optional description
3. Click **Create**
4. You'll enter the space and see an empty dashboard

---

### Using the Dashboard

The dashboard is the main view. It shows a timeline grid with your trials.

#### Navigation

The header shows your current **Organization** and **Space** as dropdowns. Click either to switch. Navigation links in the center (Dashboard, Companies, Products, Markers, Therapeutic Areas) are visible when inside a space.

#### Timeline Grid

The grid has three sections:
- **Left panel** -- Company, Product, and Trial labels (sticky on horizontal scroll)
- **Timeline header** -- Date columns scaled to the current zoom level (sticky on vertical scroll)
- **Trial rows** -- Phase bars and event markers for each trial

#### Zoom Controls

Use the zoom buttons to change the timeline granularity:
- **Y** = Yearly (200px/year -- best for 5-10 year views)
- **Q** = Quarterly (600px/year)
- **M** = Monthly (1200px/year)
- **D** = Daily (1460px/year -- best for near-term precision)

#### Filtering

The filter panel provides PrimeNG MultiSelect dropdowns for:
- Companies and products
- Therapeutic areas
- Date range (start/end year)
- Recruitment status (Active, Completed, etc.)
- Study type (Interventional, Observational)
- Phase (P1-P4, Observational)

Filters are sent as arrays to the backend RPC -- empty arrays mean "show all."

#### Reading the Timeline

**Phase Bars** -- colored SVG rectangles with rounded corners showing when each clinical phase runs:
- Slate = Phase 1
- Cyan = Phase 2
- Teal = Phase 3
- Violet = Phase 4
- Amber = Observational

Labels appear inside bars when width allows, otherwise outside.

**Event Markers** -- SVG icons at specific dates. Hover over any marker to see a tooltip with type name, date, and notes. Markers with `end_date` render as range indicators (bar type).

**Notes** -- text annotations displayed below a trial row.

Click any phase bar, marker, or trial name to navigate to the trial detail page.

#### Legend

The **Legend** panel shows all marker types grouped by category with their SVG icon previews. Use it as a reference for what each shape/color combination means.

---

### Managing Data

Access the management screens via the header navigation links.

#### Companies

**Navigate:** Companies link in header

- **Add Company** -- Enter name, optional logo URL and display color
- **Edit Company** -- Click the edit icon on any row
- **Delete Company** -- Click the delete icon (cascading: deletes all linked products and trials)
- Companies are ordered by `display_order`

#### Products

**Navigate:** Products link in header

- **Add Product** -- Enter name, optional generic name, select parent company
- **Edit / Delete** -- Use the action icons on each row
- Products are ordered by `display_order` within their company

#### Trials

**Navigate:** Click a trial name on the dashboard, or navigate from Products

The Trial Detail page provides a comprehensive form with sections:

**Basic info:**
- Name, identifier, sample size, status, notes, therapeutic area

**CT.gov fields (organized by category):**
- Logistics: recruitment status, sponsor type, lead sponsor, collaborators, countries, regions
- Design: study type, phase, allocation, intervention model, masking, primary purpose
- Clinical: conditions, intervention details, outcome measures, rare disease flag
- Eligibility: sex, age range, healthy volunteers, criteria text
- Timeline: start date, completion dates, posting dates
- Regulatory: DMC, FDA regulation, designations, submission type

**Phases tab:**
- View all phases for this trial
- **Add Phase** -- Select phase type (P1-P4, OBS), set start/end dates, optional color and label
- **Edit / Delete** phases

**Markers tab:**
- View all event markers
- **Add Marker** -- Select type, set event date (and optional end date for ranges), add tooltip text
- **Edit / Delete** markers

**Notes tab:**
- View all notes for this trial
- **Add Note** -- Enter free text content
- **Edit / Delete** notes

#### Marker Types

**Navigate:** Markers link in header

You can create custom marker types beyond the 10 system defaults:
1. Click **Add Marker Type**
2. Choose a name, shape (circle, diamond, flag, arrow, bar, x), fill style (filled, outline, striped, gradient), and color
3. Custom markers appear in the legend and are available when adding markers to trials

System marker types (the 10 defaults) cannot be modified or deleted.

#### Therapeutic Areas

**Navigate:** Therapeutic Areas link in header

Manage the list of medical indication categories (name + abbreviation) used to classify trials.

---

### Exporting to PowerPoint

1. Click **Export** button in the dashboard toolbar
2. Configure the export:
   - Zoom level
   - Start/end year
3. Click **Generate** -- the `.pptx` file downloads immediately

The export renders phase bars and markers with visual fidelity matching the dashboard. It runs entirely client-side in your browser; nothing is uploaded to a server.

---

### Organization Settings

**Navigate:** Gear icon in header

Tenant owners can:
- **View members** -- Table showing all members with name, email, and role
- **Remove members** -- Click remove button (with confirmation)
- **Invite members** -- Generate an invite code by entering email and role
- **View pending invites** -- See codes, emails, roles, and expiration dates

---

### Spaces

**Navigate:** Click organization name in header, or navigate to Spaces link

- **Create a new space** -- Each space is an independent pipeline workspace
- **Switch spaces** -- Click a space from the list or use the space dropdown in the header
- Spaces within the same organization share member access rules but have completely separate data
- Your last-visited tenant and space are remembered via localStorage

---

## 12. Developer Guide

### Prerequisites

- Node.js (LTS)
- Angular CLI 19: `npm install -g @angular/cli`
- Supabase CLI: `npm install -g supabase`
- Docker (for local Supabase)

### Initial Setup

```bash
# 1. Clone the repo
git clone <repo-url>
cd clint-v2

# 2. Install frontend dependencies
cd src/client
npm install

# 3. Start local Supabase stack
cd ../../
supabase start
# -> outputs local API URL and anon key

# 4. Configure environment
# Edit src/client/src/environments/environment.ts:
export const environment = {
  production: false,
  supabaseUrl: 'http://localhost:54321',
  supabaseAnonKey: '<anon-key-from-supabase-start>'
};

# 5. Start the dev server
cd src/client
ng serve
# -> http://localhost:4200
```

### Supabase Local Config

`supabase/config.toml` configures:
- **Ports**: API 54321, DB 54322, Studio 54323, Inbucket 54324
- **Auth**: Google OAuth enabled, email signup enabled (confirmations disabled), JWT expiry 3600s, refresh token rotation enabled
- **Migrations**: Auto-run on `supabase start`
- **Seed**: Runs `./seed.sql` after migrations

### Database Commands

```bash
supabase start            # Start local Postgres + Auth stack
supabase stop             # Stop local stack
supabase db reset         # Re-apply all migrations + seed.sql (clean rebuild)
supabase migration new <name>  # Create a new empty migration file
supabase db push          # Push local migrations to remote Supabase project
```

### Adding a Database Migration

1. Create the file: `supabase migration new <short_description>`
   - This creates `supabase/migrations/YYYYMMDDHHmmss_short_description.sql`
2. Write your SQL in the new file
3. Apply it locally: `supabase db reset` (full rebuild) or restart
4. **Never edit an existing migration** -- always create a new one
5. Follow the SQL style guide in `docs/supabase-guides/sql-style-guide.md`

### Supabase SQL Guidelines

Four reference guides in `docs/supabase-guides/`:
- **database-rls-policies.md** -- USING/WITH CHECK syntax, role-based access patterns, performance tips
- **database-functions.md** -- SECURITY INVOKER default, set search_path, typed parameters, trigger examples
- **database-create-migration.md** -- File naming, destructive command comments, RLS requirements
- **sql-style-guide.md** -- snake_case naming, plural table names, query formatting, CTE conventions

### Frontend Development

```bash
cd src/client
ng serve        # Dev server at localhost:4200 (hot reload)
ng build        # Production build -> dist/client/browser/
ng lint         # ESLint
ng test         # Unit tests
```

### Adding a New Feature

1. **Create a migration** if database changes are needed
2. **Add/update models** in `src/app/core/models/`
3. **Add/update services** in `src/app/core/services/`
4. **Create feature components** in `src/app/features/<feature-name>/`
5. **Register the route** in `app.routes.ts` using `loadComponent`
6. Follow the Angular conventions: standalone, `inject()`, signals, new control flow, inline templates

### PrimeNG Usage

Import PrimeNG modules directly in component `imports` arrays:

```typescript
@Component({
  standalone: true,
  imports: [ButtonModule, TableModule, DialogModule, InputTextModule],
  ...
})
```

Use PrimeNG form components over native HTML:
- `pInputText` for text inputs
- `p-select` for dropdowns
- `p-colorpicker` for color selection
- `p-checkbox` for checkboxes
- `p-inputnumber` for numeric inputs
- `pTextarea` for textareas

The custom theme preset (`config/primeng-theme.ts`) configures Aura base with teal primary (11 shade ramp: 50-950) and slate surface neutrals.

### Verification

```bash
cd src/client
ng lint && ng build
```

Both must pass before committing.

### Environment Configuration

The app uses Supabase environment variables defined in `src/environments/environment.ts`. For production, these are baked into the build via Angular's environment system. The production environment points to the hosted Supabase project.

---

## 13. Deployment

### Architecture

- **Frontend** -- Angular SPA deployed to Netlify as a static site
- **Backend** -- Supabase Cloud (managed PostgreSQL, Auth, PostgREST)
- No server-side processes; no custom backend infrastructure

### Netlify Setup

```toml
# netlify.toml
[build]
  base = "src/client"
  command = "ng build"
  publish = "dist/client/browser"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

The catch-all redirect is required for Angular's client-side routing to work correctly on page refresh.

### Build Output

The Angular build produces static files in `dist/client/browser/`. Netlify serves these from its CDN. No SSR is configured -- this is a pure client-side SPA.

### Deploying Schema Changes

```bash
# Push local migrations to remote Supabase project
supabase db push
```

Migrations are applied in timestamp order. This is the only supported way to make schema changes -- never modify the database directly via the Supabase dashboard.

### Rollback

Database rollbacks require creating a new down-migration (reverse SQL). There is no automated rollback -- follow the convention: "never edit existing migrations, always add new ones."

### Demo Data

The pharma demo data (Migration 12) was seeded at migration time -- it ran `seed_pharma_demo()` inline and then dropped the function. For new spaces, the `seed_demo_data(p_space_id)` RPC can populate sample companies, products, and trials for onboarding and testing.

---

*Last updated: 2026-03-21*
