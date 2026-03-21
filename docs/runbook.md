# Clint — Clinical Trial Status Dashboard: Runbook

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

**Clint** is a web-based clinical trial status dashboard built for pharmaceutical executives and business development teams. It provides a structured, interactive timeline view of drug development pipelines — organized by company, product, and therapeutic area — with configurable zoom levels, event markers, and filtering capabilities.

The dashboard replaces static PowerPoint-based tracking workflows with a live, collaborative, data-driven application that supports multiple organizations and teams.

---

## 2. Motivation

### The Problem

Pharmaceutical BD teams and executives track competitive clinical trial landscapes using manually maintained PowerPoint slides. This approach has fundamental limitations:

- **Stale data** — slides are only as current as the last manual update
- **No collaboration** — multiple teams maintain separate versions
- **Poor interactivity** — no filtering, zooming, or drill-down
- **Limited scalability** — adding companies or trials requires slide redesign
- **No audit trail** — changes are invisible and untracked

### The Solution

Clint provides a purpose-built web application that mirrors the familiar visual language of the PowerPoint format (timeline grid, phase bars, event markers) while adding:

- Real-time collaborative data management
- Flexible filtering and zoom
- Multi-tenant isolation so different organizations each have their own data
- PowerPoint export for stakeholders who still need slides

### Design Principles

The product follows **Clinical Precision** as its core design personality — inspired by medical journals and regulatory documents. The UI prioritizes:

- **Visual parsability** over decoration — data density without noise
- **Markers pop** — the events executives scan for are the primary visual element
- **Phase bars as backdrop** — subtle context, not the focus
- **Teal + Slate palette** — clinical and precise, not generic

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
Tailwind CSS      4.x
Supabase JS       2.49
pptxgenjs         4.0.1
FontAwesome Free  7.2
Node.js           (LTS)
PostgreSQL        15+ (via Supabase)
```

---

## 4. Features

### 4.1 Timeline Dashboard

The primary view of the application. Displays a grid where rows represent clinical trials and columns represent time. The grid is organized hierarchically:

```
Company
  └── Product
        └── Trial (with phase bars and event markers)
```

**Phase Bars** — horizontal bands that span the timeline for each trial phase. Color-coded by phase type:
- **Phase 1** — Muted slate (early/exploratory)
- **Phase 2** — Cyan/teal (building evidence)
- **Phase 3** — Teal/hero color (pivotal trials)
- **Phase 4** — Violet (post-approval)
- **Observational** — Amber (caution-adjacent)

**Event Markers** — icons placed at specific dates on the timeline. 10 system-provided marker types plus custom user-defined types. Shapes include circles, diamonds, flags, arrows, bars, and X marks — each with color coding by category:
- Green circles — Data events
- Red diamonds — Regulatory events
- Blue flags/bars — Approval/Launch events
- Orange/red arrows/X — Change/status events

**Notes** — free-text annotations attached to trials, displayed inline.

### 4.2 Timeline Zoom

Four zoom levels let users control the time granularity:

| Zoom | Column Width | Use Case |
|---|---|---|
| Yearly | Each column = 1 year | 5–10 year pipelines |
| Quarterly | Each column = 1 quarter | 2–3 year views |
| Monthly | Each column = 1 month | Near-term tracking |
| Daily | Each column = 1 day | Precise event placement |

### 4.3 Filtering

The filter panel lets users narrow the dashboard to:

- **Companies** — show only selected companies
- **Products** — show only selected products
- **Therapeutic Areas** — filter by medical indication (Oncology, Cardiology, etc.)
- **Date Range** — clamp the visible timeline window
- **Recruitment Status** — Active, Completed, Suspended, etc.
- **Study Type** — Interventional, Observational, Expanded Access
- **Phase** — P1, P2, P3, P4, Observational

### 4.4 Legend

A grouped reference panel showing all marker types with their icons and labels. Organized by category. Collapsible for more dashboard space.

### 4.5 Data Management

A full CRUD interface for managing all data within a space:

| Section | What You Manage |
|---|---|
| Companies | Pharma/biotech company records (name, description, color) |
| Products | Drug/therapy products linked to a company |
| Trials | Clinical studies with all metadata + CT.gov dimensions |
| Trial Phases | Phase records with type, start date, end date |
| Trial Markers | Event markers placed on the timeline |
| Trial Notes | Free-text annotations on trials |
| Marker Types | Custom marker types beyond the 10 system defaults |
| Therapeutic Areas | Medical indication categories |

### 4.6 PowerPoint Export

Generates a `.pptx` file replicating the dashboard view using `pptxgenjs`. Users can configure:

- Title slide content
- Which trials to include
- Date range for the export
- Zoom level

The export runs entirely client-side — no file is sent to a server.

### 4.7 CT.gov Dimensions

Trials can store 40+ fields from the ClinicalTrials.gov data model, including:

- Study design (allocation, masking, intervention model)
- Primary and secondary outcome measures
- Eligibility criteria (age, sex, healthy volunteers)
- Enrollment figures and status
- FDA designations and DMC information
- All CT.gov date fields (start, completion, posted, last update)
- Regulatory tracking (submission type, last sync timestamp)

This allows the platform to eventually sync directly from ClinicalTrials.gov while also serving as a standalone data entry system.

### 4.8 Multi-Tenant Workspaces

The application supports multiple organizations (tenants) and multiple projects within each organization (spaces):

- Each **tenant** represents an organization (e.g., a pharma company or consulting firm)
- Each **space** within a tenant is a separate project/pipeline workspace
- Members can be invited to tenants and spaces with role-based permissions
- Data is fully isolated between spaces — no cross-tenant data leakage

### 4.9 Authentication

Google OAuth via Supabase Auth. Users sign in with their Google account; no password management required. Auth state is managed in the Angular frontend via a reactive signal in `SupabaseService`.

---

## 5. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Browser (User)                             │
│                                                                     │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │              Angular 19 SPA (src/client/)                    │  │
│   │                                                              │  │
│   │  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │  │
│   │  │  Dashboard  │  │    Manage    │  │  Auth / Onboard   │  │  │
│   │  │  (timeline) │  │  (CRUD UI)   │  │  (login, spaces)  │  │  │
│   │  └─────────────┘  └──────────────┘  └───────────────────┘  │  │
│   │                                                              │  │
│   │  Services layer: SupabaseService, DashboardService, etc.    │  │
│   └──────────────────────────────────────────────────────────────┘  │
│                         │  Supabase JS Client                       │
└─────────────────────────┼───────────────────────────────────────────┘
                          │ HTTPS
┌─────────────────────────▼───────────────────────────────────────────┐
│                         Supabase (Cloud)                            │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │   PostgREST  │  │     Auth     │  │       PostgreSQL 15       │  │
│  │  (auto REST  │  │  (Google     │  │                          │  │
│  │   from schema│  │   OAuth)     │  │  Tables, Functions, RLS  │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. User signs in with Google → Supabase Auth issues a JWT
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
  src/app/
    app.component.ts          # Root component: header + router-outlet
    app.routes.ts             # Route definitions (lazy-loaded)
    app.config.ts             # App-level providers (router, animations, PrimeNG)
    core/
      guards/
        auth.guard.ts         # authGuard + onboardingRedirectGuard
      layout/
        header.component.ts   # Navigation: logo, tenant/space switcher, user menu
      models/                 # TypeScript interfaces for all domain entities
      services/               # All business logic and API calls
    features/
      auth/                   # login.component, auth-callback.component
      dashboard/              # Main timeline grid (31 sub-components)
      manage/                 # CRUD UIs for all entities
      spaces/                 # Space list and creation
      onboarding/             # Create org / join with invite code
      tenant-settings/        # Tenant management and member invites
    shared/
      components/svg-icons/   # 6 SVG shape components for markers
    config/
      primeng-theme.ts        # Aura preset, teal primary, slate surface
```

### Angular Conventions

The frontend strictly follows Angular 19 patterns:

- **Standalone components only** — no NgModules anywhere
- **`inject()` for DI** — not constructor injection
- **Signals for state** — `signal()`, `computed()`, `effect()`, `resource()`
- **New control flow** — `@if`, `@for`, `@switch` (not `*ngIf`, `*ngFor`)
- **Lazy loading** — all feature routes use `loadComponent` / `loadChildren`
- **Lean components** — business logic belongs in services, not components

### Routing

All routes are lazy-loaded. The route hierarchy:

```
/login                              → LoginComponent
/auth/callback                      → AuthCallbackComponent
/onboarding                         → OnboardingComponent (authGuard)
/t/:tenantId/
  spaces                            → SpaceListComponent
  settings                          → TenantSettingsComponent
  s/:spaceId/
    (empty)                         → DashboardComponent
    manage/companies                → CompanyListComponent
    manage/products                 → ProductListComponent
    manage/trials/:id               → TrialDetailComponent
    manage/marker-types             → MarkerTypeListComponent
    manage/therapeutic-areas        → TherapeuticAreaListComponent
/                                   → onboardingRedirectGuard (auto-redirect)
/**                                 → redirects to /
```

### Services

| Service | Responsibility |
|---|---|
| `SupabaseService` | Supabase client init, auth state (session, currentUser signals), Google sign-in/out |
| `DashboardService` | Calls `get_dashboard_data()` RPC, maps response to typed models, seed demo data |
| `TenantService` | Tenant CRUD, member management, invite creation/acceptance |
| `SpaceService` | Space CRUD, member management, role updates |
| `CompanyService` | Company CRUD within a space |
| `ProductService` | Product CRUD linked to a company |
| `TrialService` | Trial CRUD with all CT.gov dimension fields |
| `TrialPhaseService` | Phase records (type, start/end dates) on a trial |
| `TrialMarkerService` | Event markers placed on trial timelines |
| `TrialNoteService` | Free-text annotations on trials |
| `MarkerTypeService` | Custom marker type CRUD (system types are read-only) |
| `TherapeuticAreaService` | Therapeutic area CRUD |
| `TimelineService` | Date calculations, phase bar rendering, zoom utilities |
| `PptxExportService` | Client-side PowerPoint generation via pptxgenjs |
| `CtgovSyncService` | CT.gov trial data sync (reads ClinicalTrials.gov API) |

### Dashboard Component Hierarchy

```
DashboardComponent               # Orchestrates state, filters, loading
  FilterPanelComponent           # Collapsible filter sidebar
  ZoomControlComponent           # Yearly/quarterly/monthly/daily toggle
  LegendComponent                # Marker type reference grouped by category
  ExportDialogComponent          # PowerPoint export dialog
  DashboardGridComponent         # The timeline table
    GridHeaderComponent          # Column headers (date labels)
    RowLabelComponent            # Left column: company/product/trial labels
    TrialRowComponent            # One row per trial (phase bars + markers)
      PhaseBarComponent          # Horizontal phase bar for one phase
      MarkerComponent            # Single event marker icon at a date
        MarkerTooltipComponent   # Hover tooltip with marker details
    RowNotesComponent            # Notes display below a trial row
```

### Key Component: DashboardComponent

The root dashboard component uses Angular signals extensively:

- `filtersSignal` — reactive filter state
- `dashboardResource` — `resource()` that reloads when filters change
- `zoomLevel` — signal driving column width calculations
- `computed()` — derived lists for filter options (unique companies, etc.)
- `effect()` — syncs filter state to URL query params

### Models

Nine TypeScript interfaces define the domain:

```typescript
Company       { id, space_id, name, description, color, created_by, created_at, updated_at }
Product       { id, space_id, company_id, name, description, created_by, ... }
Trial         { id, space_id, product_id, name, recruitment_status, study_type, ... (40+ CT.gov fields) }
TrialPhase    { id, trial_id, phase, start_date, end_date, ... }
TrialMarker   { id, trial_id, marker_type_id, date, label, ... }
TrialNote     { id, trial_id, content, ... }
MarkerType    { id, space_id, name, icon, shape, fill_style, color, is_system, display_order }
Space         { id, tenant_id, name, description, created_by, ... }
Tenant        { id, name, slug, ... }

// Aggregate
DashboardData { companies: CompanyWithData[], timeline: TimelineConfig }
```

---

## 7. Backend Architecture

The backend is entirely managed by Supabase — no custom server code.

### Supabase Services Used

| Service | Purpose |
|---|---|
| PostgreSQL | Primary data store for all application data |
| PostgREST | Auto-generated REST API from the Postgres schema; used for CRUD operations |
| Supabase Auth | JWT-based auth with Google OAuth provider |
| Supabase JS | Client library used by Angular to call all backend APIs |

### Database Functions (RPCs)

**`get_dashboard_data(p_space_id, p_company_ids, p_product_ids, p_therapeutic_area_ids, p_date_from, p_date_to, p_recruitment_statuses, p_study_types, p_phases)`**

The single most important function. Accepts a space ID and optional filter arrays, and returns a single nested JSON object:

```
{
  companies: [
    {
      id, name, color,
      products: [
        {
          id, name,
          trials: [
            {
              id, name, therapeutic_area, recruitment_status, study_type,
              phases: [...],
              markers: [...],
              notes: [...]
            }
          ]
        }
      ]
    }
  ],
  timeline: { min_date, max_date }
}
```

This eliminates N+1 query problems. The entire dashboard renders from a single RPC call.

**`create_tenant(p_name, p_slug)`**

Creates a new tenant record and adds the calling user as the owner in `tenant_members` in a single transaction.

**`create_space(p_tenant_id, p_name, p_description)`**

Creates a new space and adds the calling user as the space owner.

**`seed_demo_data(p_space_id)`**

Populates a space with pharmaceutical demo data — companies, products, trials, phases, and markers — for onboarding and testing.

**`has_space_access(p_space_id, p_roles)`**

Helper function used in RLS policies. Returns true if the calling user is either:
- A member of the space with one of the given roles, or
- The owner of the parent tenant

**`is_tenant_member(p_tenant_id, p_roles)`**

Helper for tenant-level RLS. Returns true if the calling user has the specified role in the tenant.

### Views

**`space_members_view`** — Joins `space_members` with `auth.users` metadata to expose display name and email alongside membership records.

**`tenant_members_view`** — Same as above for tenant membership.

---

## 8. Database Schema

All schema changes are in `supabase/migrations/` as timestamped SQL files. The current schema is built from 16 migrations.

### Core Data Tables

```sql
-- Organizations that own pharma pipelines
companies (
  id            uuid PRIMARY KEY,
  space_id      uuid REFERENCES spaces(id),
  name          text NOT NULL,
  description   text,
  color         text,
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz,
  updated_at    timestamptz
)

-- Drug/therapy products belonging to a company
products (
  id            uuid PRIMARY KEY,
  space_id      uuid REFERENCES spaces(id),
  company_id    uuid REFERENCES companies(id),
  name          text NOT NULL,
  description   text,
  created_by    uuid,
  ...
)

-- Clinical trial entries
trials (
  id                        uuid PRIMARY KEY,
  space_id                  uuid,
  product_id                uuid REFERENCES products(id),
  name                      text NOT NULL,
  -- CT.gov dimensions (40+ fields):
  recruitment_status        text,
  study_type                text,
  phase                     text,
  sponsor_type              text,
  lead_sponsor              text,
  conditions                text[],
  intervention_type         text,
  intervention_name         text,
  primary_outcome_measures  jsonb,
  secondary_outcome_measures jsonb,
  eligibility_sex           text,
  eligibility_min_age       text,
  eligibility_max_age       text,
  is_rare_disease           boolean,
  has_dmc                   boolean,
  is_fda_regulated_drug     boolean,
  fda_designations          text[],
  ctgov_last_synced_at      timestamptz,
  -- ... (many more fields)
  created_by    uuid,
  created_at    timestamptz,
  updated_at    timestamptz
)

-- Individual phases (P1, P2, P3, P4, OBS) within a trial
trial_phases (
  id            uuid PRIMARY KEY,
  trial_id      uuid REFERENCES trials(id),
  phase         text NOT NULL,  -- 'P1'|'P2'|'P3'|'P4'|'OBS'
  start_date    date,
  end_date      date,
  is_projected  boolean,
  created_by    uuid,
  ...
)

-- Event markers placed on the timeline
trial_markers (
  id              uuid PRIMARY KEY,
  trial_id        uuid REFERENCES trials(id),
  marker_type_id  uuid REFERENCES marker_types(id),
  date            date NOT NULL,
  label           text,
  notes           text,
  is_projected    boolean,
  created_by      uuid,
  ...
)

-- Free-text notes on trials
trial_notes (
  id          uuid PRIMARY KEY,
  trial_id    uuid REFERENCES trials(id),
  content     text NOT NULL,
  created_by  uuid,
  ...
)

-- Marker type definitions (10 system + custom user types)
marker_types (
  id            uuid PRIMARY KEY,
  space_id      uuid,           -- null for system types
  created_by    uuid,           -- null for system types
  name          text NOT NULL,
  icon          text,
  shape         text,           -- 'circle'|'diamond'|'flag'|'arrow'|'bar'|'x'
  fill_style    text,           -- 'filled'|'outline'|'striped'|'gradient'
  color         text,           -- hex color
  is_system     boolean,
  display_order int
)

-- Therapeutic area classifications
therapeutic_areas (
  id        uuid PRIMARY KEY,
  space_id  uuid,
  name      text NOT NULL,
  ...
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
  created_at  timestamptz
)

-- Organization membership with roles
tenant_members (
  tenant_id   uuid REFERENCES tenants(id),
  user_id     uuid REFERENCES auth.users(id),
  role        text,  -- 'owner' | 'member'
  joined_at   timestamptz,
  PRIMARY KEY (tenant_id, user_id)
)

-- Invite codes for joining tenants
tenant_invites (
  id          uuid PRIMARY KEY,
  tenant_id   uuid REFERENCES tenants(id),
  code        text UNIQUE,
  created_by  uuid,
  expires_at  timestamptz,  -- 7 days from creation
  used_by     uuid,
  used_at     timestamptz
)

-- Project workspaces within a tenant
spaces (
  id          uuid PRIMARY KEY,
  tenant_id   uuid REFERENCES tenants(id),
  name        text NOT NULL,
  description text,
  created_by  uuid,
  created_at  timestamptz
)

-- Space membership with roles
space_members (
  space_id    uuid REFERENCES spaces(id),
  user_id     uuid REFERENCES auth.users(id),
  role        text,  -- 'owner' | 'editor' | 'viewer'
  joined_at   timestamptz,
  PRIMARY KEY (space_id, user_id)
)
```

### System Marker Types

10 marker types are pre-seeded and available in all spaces:

| # | Name | Shape | Fill | Color |
|---|---|---|---|---|
| 1 | Projected Data Reported | Circle | Outline | Green |
| 2 | Data Reported | Circle | Filled | Green |
| 3 | Projected Regulatory Filing | Diamond | Outline | Red |
| 4 | Submitted Regulatory Filing | Diamond | Filled | Red |
| 5 | Label Projected Approval/Launch | Flag | Outline | Blue |
| 6 | Label Update | Flag | Striped | Blue |
| 7 | Est. Range of Potential Launch | Bar | Gradient | Blue |
| 8 | Primary Completion Date (PCD) | Circle | Filled | Gray |
| 9 | Change from Prior Update | Arrow | Filled | Orange |
| 10 | Event No Longer Expected | X | Filled | Red |

---

## 9. Authentication & Security

### Auth Flow

```
1. User navigates to /login
2. Clicks "Sign in with Google"
3. SupabaseService.signInWithGoogle() opens Google OAuth popup/redirect
4. User authenticates with Google
5. Google redirects back to /auth/callback
6. AuthCallbackComponent exchanges the auth code for a session
7. Supabase issues a JWT containing auth.uid()
8. SupabaseService stores session in a signal (reactive)
9. Angular router guards (authGuard) check session.currentUser signal
10. onboardingRedirectGuard checks for tenant membership; redirects to /onboarding if none
```

### Row Level Security (RLS)

Every data table has RLS enabled. Policies are enforced at the Postgres level — bypassing the API layer is not possible.

**Data tables** (`companies`, `products`, `trials`, etc.) use:
```sql
-- SELECT: user has any access to the space
has_space_access(space_id, ARRAY['owner', 'editor', 'viewer'])

-- INSERT/UPDATE/DELETE: user has write access to the space
has_space_access(space_id, ARRAY['owner', 'editor'])
```

**Marker types** have special rules:
- System types (`is_system = true`) are readable by all authenticated users
- User-created types are scoped to their space with standard space access

**Tenant tables** use `is_tenant_member()` checks.

### Guards

**`authGuard`** — Redirects unauthenticated users to `/login`.

**`onboardingRedirectGuard`** — On the root path `/`, checks if the user has any tenant memberships. If none, redirects to `/onboarding`. If yes, redirects to their first tenant's `/spaces`.

---

## 10. Multi-Tenant Model

### Hierarchy

```
Tenant (Organization)
  ├── TenantMembers (role: owner | member)
  ├── TenantInvites (7-day expiry join codes)
  └── Spaces (Projects)
        ├── SpaceMembers (role: owner | editor | viewer)
        └── Data (companies, products, trials, ...)
```

### Roles & Permissions

| Role | Scope | Can Do |
|---|---|---|
| Tenant Owner | Tenant | Manage members, create spaces, manage invites, delete tenant |
| Tenant Member | Tenant | View tenant, accept spaces invites |
| Space Owner | Space | Full CRUD on space data, manage space members |
| Space Editor | Space | Create/edit/delete data within the space |
| Space Viewer | Space | Read-only access to space data |

### Onboarding Flow

New users land at `/onboarding` after first sign-in. They can either:
1. **Create a new organization** — provide a name → `create_tenant()` RPC runs → they become the tenant owner → redirected to create first space
2. **Join with invite code** — enter a code → `tenant_invites` is validated → they become a tenant member → redirected to the tenant's spaces

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

The header shows your current **Organization** and **Space**. Click either to switch.

#### Timeline Grid

The grid has three sections:
- **Left panel** — Company, Product, and Trial labels. Click a company or product to expand/collapse.
- **Timeline header** — Date columns scaled to the current zoom level
- **Trial rows** — Phase bars and event markers for each trial

#### Zoom Controls

Use the zoom buttons in the top-right to change the timeline granularity:
- **Y** = Yearly (best for 5–10 year views)
- **Q** = Quarterly
- **M** = Monthly
- **D** = Daily (best for near-term precision)

#### Filtering

Click **Filters** to expand the filter panel on the left. You can filter by:
- Companies and products
- Therapeutic areas
- Date range
- Recruitment status (Active, Completed, etc.)
- Study type (Interventional, Observational)
- Phase (P1–P4, Observational)

Click **Clear All** to reset all filters.

#### Reading the Timeline

**Phase Bars** — colored horizontal bands showing when each clinical phase runs:
- Slate = Phase 1
- Teal/Cyan = Phase 2
- Teal (hero) = Phase 3
- Violet = Phase 4
- Amber = Observational

**Event Markers** — icons at specific dates. Hover over any marker to see details (type, date, label, notes).

**Notes** — text annotations displayed below a trial row.

#### Legend

The **Legend** panel (bottom or side) shows all marker types grouped by category. Use it as a reference for what each icon means.

---

### Managing Data

Access the management screens via the top navigation menu.

#### Companies

**Navigate:** Menu → Companies

- **Add Company** — Enter name, optional description and color
- **Edit Company** — Click the edit icon on any row
- **Delete Company** — Click the delete icon (this also deletes all linked products and trials)

#### Products

**Navigate:** Menu → Products

- **Add Product** — Enter name and select the parent company
- **Edit / Delete** — Use the action icons on each row

#### Trials

**Navigate:** Click a trial name on the dashboard, or Menu → Trials → select a trial

The Trial Detail page has tabs:

**Details tab:**
- Basic info (name, therapeutic area, recruitment status, study type)
- CT.gov fields (sponsor, conditions, intervention, outcomes, eligibility, etc.)

**Phases tab:**
- View all phases for this trial
- **Add Phase** — Select phase type (P1–P4, OBS), set start/end dates
- **Edit / Delete** phases

**Markers tab:**
- View all event markers
- **Add Marker** — Select type, set date, add label and notes
- **Edit / Delete** markers

**Notes tab:**
- View all notes for this trial
- **Add Note** — Enter free text
- **Edit / Delete** notes

#### Marker Types

**Navigate:** Menu → Marker Types

You can create custom marker types beyond the 10 system defaults:
1. Click **Add Marker Type**
2. Choose a name, shape (circle, diamond, flag, arrow, bar, x), fill style, and color
3. Custom markers appear in the legend and are available when adding markers to trials

System marker types (the 10 defaults) cannot be modified or deleted.

#### Therapeutic Areas

**Navigate:** Menu → Therapeutic Areas

Manage the list of medical indication categories used to classify trials.

---

### Exporting to PowerPoint

1. Click **Export** button in the dashboard toolbar
2. Configure the export:
   - Presentation title
   - Date range
   - Which trials to include
3. Click **Generate** — the `.pptx` file downloads immediately

The export runs locally in your browser; nothing is uploaded to a server.

---

### Organization Settings

**Navigate:** Menu → Settings (gear icon)

Tenant owners can:
- **Rename the organization**
- **Invite members** — Generate an invite code (valid 7 days) to share with new users
- **Manage members** — View all members and remove them if needed

---

### Spaces

**Navigate:** Click organization name in the header → Spaces

- **Create a new space** — Each space is an independent pipeline workspace
- **Switch spaces** — Click a space from the list
- Spaces within the same organization share member access rules but have completely separate data

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
cd clint

# 2. Install frontend dependencies
cd src/client
npm install

# 3. Start local Supabase stack
cd ../../
supabase start
# → outputs local API URL and anon key

# 4. Configure environment
# Create src/client/src/environments/environment.ts:
export const environment = {
  supabaseUrl: 'http://localhost:54321',
  supabaseKey: '<anon-key-from-supabase-start>'
};

# 5. Start the dev server
cd src/client
ng serve
# → http://localhost:4200
```

### Database Commands

```bash
supabase start           # Start local Postgres + Auth stack
supabase stop            # Stop local stack
supabase db reset        # Re-apply all migrations + seed.sql (clean rebuild)
supabase migration new <name>  # Create a new empty migration file
supabase db push         # Push local migrations to remote Supabase project
```

### Adding a Database Migration

1. Create the file: `supabase migration new <short_description>`
   - This creates `supabase/migrations/YYYYMMDDHHmmss_short_description.sql`
2. Write your SQL in the new file
3. Apply it locally: `supabase db reset` (full rebuild) or `supabase db push` (incremental)
4. **Never edit an existing migration** — always create a new one

Follow the SQL style guide in `docs/supabase-guides/sql-style-guide.md`.

### Frontend Development

```bash
cd src/client
ng serve        # Dev server at localhost:4200
ng build        # Production build
ng lint         # ESLint
ng test         # Unit tests
```

### Adding a New Feature

1. **Create a migration** if database changes are needed
2. **Add/update models** in `src/app/core/models/`
3. **Add/update services** in `src/app/core/services/`
4. **Create feature components** in `src/app/features/<feature-name>/`
5. **Register the route** in `app.routes.ts` using `loadComponent`
6. Follow the Angular conventions: standalone, `inject()`, signals, new control flow

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

### Verification

```bash
cd src/client
ng lint && ng build
```

Both must pass before committing.

### Environment Configuration

The app uses Supabase environment variables set at build time. For local dev, configure in `src/environments/environment.ts`. For production, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in Netlify environment variables.

---

## 13. Deployment

### Architecture

- **Frontend** — Angular SPA deployed to Netlify as a static site
- **Backend** — Supabase Cloud (managed PostgreSQL, Auth, PostgREST)
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

### Production Environment Variables

Set in Netlify dashboard (Site settings → Environment variables):

```
SUPABASE_URL       = https://<project-ref>.supabase.co
SUPABASE_ANON_KEY  = <project-anon-key>
```

### Deploying Schema Changes

```bash
# Push local migrations to remote Supabase project
supabase db push
```

Migrations are applied in timestamp order. This is the only supported way to make schema changes — never modify the database directly via the Supabase dashboard.

### Rollback

Database rollbacks require creating a new down-migration (reverse SQL). There is no automated rollback — follow the convention: "never edit existing migrations, always add new ones."

---

*Last updated: 2026-03-21*
