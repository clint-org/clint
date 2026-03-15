---
id: spec-2026-004
title: Tenants and Spaces
slug: tenants-and-spaces
status: approved
created: 2026-03-15
updated: 2026-03-15
---

# Tenants and Spaces

## Summary

Introduce multi-tenant organization support with collaborative workspaces. A **tenant** represents an organization (e.g. a pharma company's BD team). A **space** is a workspace within a tenant where team members collaborate on a shared set of companies, products, and clinical trials. All existing data tables shift from per-user ownership (`user_id`) to per-space ownership (`space_id`), and RLS policies are rewritten to check space membership. Users can belong to multiple tenants, and a space picker + URL-based routing determines which space is active.

## Goals

- Enable team collaboration: multiple users can view and edit the same clinical trial data
- Isolate data by space: each space has its own companies, products, trials, phases, markers, notes, therapeutic areas, and user-created marker types
- Support multi-tenant access: a user can be a member of multiple organizations
- Role-based access: tenant-level (owner/member) and space-level (owner/editor/viewer)
- Clean onboarding flow: new users create a tenant or join one via invite code

## Non-Goals

- Billing or subscription management
- Audit logging of data changes (future spec)
- Real-time collaboration (live cursors, conflict resolution)
- SSO/SAML integration (just Google OAuth for now)
- Custom domains per tenant

---

## Architecture Overview

### Data Hierarchy

```
auth.users
  └── tenant_members ──> tenants
                           └── spaces
                                 ├── space_members (role: owner | editor | viewer)
                                 └── data tables:
                                       companies, products, trials,
                                       trial_phases, trial_markers,
                                       trial_notes, therapeutic_areas,
                                       marker_types (user-created)
```

### RLS Strategy

All data tables replace `user_id` checks with space membership checks. **Tenant owners have implicit full access to all spaces in their tenant** without needing explicit space membership.

```sql
-- helper function used by all policies
create function public.has_space_access(p_space_id uuid, p_roles text[] default null)
returns boolean as $$
  select exists (
    -- explicit space membership (optionally filtered by role)
    select 1 from public.space_members sm
    where sm.space_id = p_space_id
      and sm.user_id = auth.uid()
      and (p_roles is null or sm.role = any(p_roles))
  ) or exists (
    -- tenant owner has implicit full access to all spaces
    select 1 from public.spaces s
    join public.tenant_members tm on tm.tenant_id = s.tenant_id
    where s.id = p_space_id
      and tm.user_id = auth.uid()
      and tm.role = 'owner'
  )
$$ language sql security definer stable;

-- example: companies SELECT policy
using ( public.has_space_access(companies.space_id) )

-- example: companies INSERT policy (editors, space owners, or tenant owners)
with check ( public.has_space_access(companies.space_id, array['owner', 'editor']) )
```

Viewers can SELECT but not INSERT/UPDATE/DELETE. Tenant owners bypass space role checks entirely.

### URL Routing

```
/onboarding                    -- create or join tenant (first-time users)
/t/:tenantId/spaces            -- space list for a tenant
/t/:tenantId/s/:spaceId        -- dashboard for a specific space
/t/:tenantId/s/:spaceId/manage/companies    -- manage companies in a space
/t/:tenantId/s/:spaceId/manage/products     -- etc.
/t/:tenantId/settings          -- tenant settings (members, invites)
```

The header shows: tenant name, space picker dropdown, then space-scoped nav links.

---

## Data Model

### New Tables

#### `tenants`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK, default gen_random_uuid()) | |
| name | varchar(255) | Organization name |
| slug | varchar(100) unique | URL-friendly identifier |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### `tenant_members`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| tenant_id | uuid (FK to tenants) | |
| user_id | uuid (FK to auth.users) | |
| role | varchar(20) | 'owner' or 'member' |
| created_at | timestamptz | |

Unique constraint on (tenant_id, user_id).

#### `tenant_invites`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| tenant_id | uuid (FK to tenants) | |
| email | varchar(255) | Invited email |
| role | varchar(20) | Role to assign on accept |
| invite_code | varchar(50) unique | Short code for joining |
| created_by | uuid (FK to auth.users) | Who sent the invite |
| accepted_at | timestamptz | null until accepted |
| expires_at | timestamptz | Invite expiry |
| created_at | timestamptz | |

#### `spaces`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| tenant_id | uuid (FK to tenants) | |
| name | varchar(255) | Space display name |
| description | text | Optional description |
| created_by | uuid (FK to auth.users) | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### `space_members`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| space_id | uuid (FK to spaces) | |
| user_id | uuid (FK to auth.users) | |
| role | varchar(20) | 'owner', 'editor', or 'viewer' |
| created_at | timestamptz | |

Unique constraint on (space_id, user_id).

### Modified Tables

All existing data tables change:
- **Remove** `user_id` column
- **Add** `space_id uuid not null references public.spaces (id)`
- **Add** `created_by uuid not null references auth.users (id)` (for audit, not for RLS)

Tables affected:
- `companies` -- remove user_id, add space_id + created_by
- `products` -- remove user_id, add space_id + created_by
- `therapeutic_areas` -- remove user_id, add space_id + created_by
- `trials` -- remove user_id, add space_id + created_by
- `trial_phases` -- remove user_id, add space_id + created_by
- `trial_markers` -- remove user_id, add space_id + created_by
- `trial_notes` -- remove user_id, add space_id + created_by
- `marker_types` -- user-created types get space_id + created_by; system types keep user_id null and space_id null

### RLS Policy Changes

All existing per-user policies are dropped and replaced with space-membership-based policies:

- **SELECT**: User is a member of the space (any role)
- **INSERT**: User is an owner or editor in the space
- **UPDATE**: User is an owner or editor in the space
- **DELETE**: User is an owner or editor in the space

Special cases:
- `marker_types`: system types (is_system=true, space_id=null) readable by all authenticated users
- `tenants`: readable by tenant members
- `tenant_members`: readable by fellow tenant members
- `spaces`: readable by space members; creatable by tenant owners/members
- `space_members`: readable by space members; manageable by space owners

### Dashboard Function Changes

`get_dashboard_data()` adds `p_space_id uuid` as a required parameter. All queries filter by `space_id` instead of `user_id`. RLS still applies (space membership checked automatically).

---

## Frontend Design

### New Components

- **OnboardingComponent** (`/onboarding`) -- create tenant form or join-by-code form
- **TenantSettingsComponent** (`/t/:tenantId/settings`) -- manage members, invites
- **SpaceListComponent** (`/t/:tenantId/spaces`) -- list/create spaces
- **SpaceSwitcherComponent** -- dropdown in header for switching spaces

### Modified Components

- **HeaderComponent** -- add tenant name, space picker dropdown, adjust nav links to be space-scoped
- **DashboardComponent** -- read spaceId from route, pass to dashboard service
- **All manage components** -- read spaceId from route, pass to services
- **All services** -- accept spaceId parameter, include in queries
- **AuthGuard** -- check that user has tenant membership; redirect to onboarding if not
- **App routing** -- restructure all routes under `/t/:tenantId/s/:spaceId/`

### New Services

- `TenantService` -- CRUD tenants, manage members, send invites
- `SpaceService` -- CRUD spaces, manage space members

---

## Tasks

```yaml
tasks:
  - id: T1
    title: "Database migration - create tenant and space tables"
    description: |
      Create new migration with:
      1. tenants table (id, name, slug, timestamps)
      2. tenant_members table (id, tenant_id, user_id, role, created_at)
         - unique constraint on (tenant_id, user_id)
      3. tenant_invites table (id, tenant_id, email, role, invite_code, created_by, accepted_at, expires_at, created_at)
         - unique constraint on invite_code
      4. spaces table (id, tenant_id, name, description, created_by, timestamps)
      5. space_members table (id, space_id, user_id, role, created_at)
         - unique constraint on (space_id, user_id)
      6. Create helper function has_space_access(p_space_id, p_roles) that checks
         space membership OR tenant owner status (tenant owners have implicit
         full access to all spaces in their tenant)
      7. Enable RLS on all new tables
      8. Add indexes on all foreign key columns
      9. Add RLS policies:
         - tenants: SELECT for tenant members
         - tenant_members: SELECT for fellow tenant members, INSERT/DELETE for tenant owners
         - tenant_invites: SELECT/INSERT/DELETE for tenant owners
         - spaces: SELECT for space members OR tenant owners, INSERT for tenant members
         - space_members: SELECT for space members OR tenant owners,
           INSERT/UPDATE/DELETE for space owners OR tenant owners
    files:
      - create: supabase/migrations/20260315170000_create_tenant_space_tables.sql
    dependencies: []
    verification: "supabase db reset"

  - id: T2
    title: "Database migration - add space_id to all data tables"
    description: |
      Create migration that modifies all existing data tables:
      1. Add space_id (uuid, nullable initially) to: companies, products,
         therapeutic_areas, trials, trial_phases, trial_markers, trial_notes, marker_types
      2. Add created_by (uuid, nullable initially) to same tables
      3. Add foreign key constraints for space_id -> spaces(id) and created_by -> auth.users(id)
      4. Add indexes on space_id columns
      5. Drop old user_id columns (since we're doing a fresh start, no data migration needed)
      6. For marker_types: space_id is nullable (null for system types)
      7. Drop all existing user_id-based RLS policies
      8. Create new space-membership-based RLS policies for all data tables:
         - SELECT: user is a member of the space (any role)
         - INSERT/UPDATE/DELETE: user is owner or editor in the space
         - marker_types special case: system types (is_system=true) readable by all authenticated
      9. Update get_dashboard_data() function:
         - Add p_space_id uuid as required first parameter
         - Replace all user_id filters with space_id = p_space_id
    files:
      - create: supabase/migrations/20260315170100_add_space_id_to_data_tables.sql
    dependencies: [T1]
    verification: "supabase db reset"

  - id: T3
    title: "Update seed data for spaces model"
    description: |
      1. Update seed.sql to work with the new schema:
         - System marker types: no change (space_id = null, user_id removed)
      2. Update seed_demo_data() function:
         - Accept p_space_id uuid parameter
         - Insert demo data with space_id instead of user_id
         - Set created_by = auth.uid()
      3. Push migrations to production: supabase db push
    files:
      - modify: supabase/seed.sql
      - modify: supabase/migrations/20260315163538_seed_demo_data_function.sql
    dependencies: [T2]
    verification: "supabase db reset"

  - id: T4
    title: "Frontend - tenant and space services"
    description: |
      Create Angular services for tenant and space management:
      1. TenantService:
         - createTenant(name, slug): creates tenant + adds current user as owner
         - listMyTenants(): returns tenants the current user belongs to
         - getTenant(id): get single tenant
         - updateTenant(id, data): update name/slug
         - listMembers(tenantId): list tenant members
         - inviteMember(tenantId, email, role): create invite
         - removeMember(tenantId, userId): remove member
         - joinByCode(code): accept invite and join tenant
      2. SpaceService:
         - createSpace(tenantId, name, description): creates space + adds creator as owner
         - listSpaces(tenantId): spaces the user has access to in a tenant
         - getSpace(id): get single space
         - updateSpace(id, data): update name/description
         - deleteSpace(id): delete space
         - listMembers(spaceId): list space members
         - addMember(spaceId, userId, role): add member to space
         - updateMemberRole(spaceId, userId, role): change role
         - removeMember(spaceId, userId): remove from space
      3. Update all existing data services (CompanyService, ProductService,
         TrialService, etc.) to accept spaceId parameter and include
         space_id in all queries
      4. Update DashboardService.getDashboardData() to accept spaceId
      5. Update TypeScript models to include space_id and created_by
    files:
      - create: src/client/src/app/core/services/tenant.service.ts
      - create: src/client/src/app/core/services/space.service.ts
      - modify: src/client/src/app/core/services/company.service.ts
      - modify: src/client/src/app/core/services/product.service.ts
      - modify: src/client/src/app/core/services/trial.service.ts
      - modify: src/client/src/app/core/services/trial-phase.service.ts
      - modify: src/client/src/app/core/services/trial-marker.service.ts
      - modify: src/client/src/app/core/services/trial-note.service.ts
      - modify: src/client/src/app/core/services/marker-type.service.ts
      - modify: src/client/src/app/core/services/therapeutic-area.service.ts
      - modify: src/client/src/app/core/services/dashboard.service.ts
      - modify: src/client/src/app/core/models/company.model.ts
      - modify: src/client/src/app/core/models/product.model.ts
      - modify: src/client/src/app/core/models/trial.model.ts
      - modify: src/client/src/app/core/models/marker.model.ts
      - create: src/client/src/app/core/models/tenant.model.ts
      - create: src/client/src/app/core/models/space.model.ts
    dependencies: [T2]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T5
    title: "Frontend - routing restructure and onboarding"
    description: |
      1. Restructure app routing:
         - /onboarding -- OnboardingComponent (create or join tenant)
         - /t/:tenantId/spaces -- SpaceListComponent
         - /t/:tenantId/s/:spaceId -- DashboardComponent
         - /t/:tenantId/s/:spaceId/manage/* -- all manage routes
         - /t/:tenantId/settings -- TenantSettingsComponent
      2. Create OnboardingComponent:
         - Two tabs/cards: "Create Organization" and "Join with Code"
         - Create form: org name, auto-generates slug
         - Join form: paste invite code
         - After create: redirect to space list
         - After join: redirect to tenant's space list
      3. Update AuthGuard:
         - After auth, check if user has any tenant memberships
         - If no tenants, redirect to /onboarding
         - If one tenant, redirect to that tenant's space list
         - If multiple, redirect to a tenant picker (or last used)
      4. Create a TenantResolver or guard that validates tenant access from URL
      5. Create a SpaceResolver or guard that validates space access from URL
    files:
      - modify: src/client/src/app/app.routes.ts
      - create: src/client/src/app/features/onboarding/onboarding.component.ts
      - modify: src/client/src/app/core/guards/auth.guard.ts
      - create: src/client/src/app/core/guards/tenant.guard.ts
      - create: src/client/src/app/core/guards/space.guard.ts
    dependencies: [T4]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T6
    title: "Frontend - header with tenant/space navigation"
    description: |
      1. Update HeaderComponent:
         - Show tenant name on the left
         - Add space picker dropdown (p-select) showing spaces the user
           can access in the current tenant
         - Space-scoped nav links (Dashboard, Companies, Products, etc.)
           that include tenantId and spaceId in their routerLinks
         - User menu with: email, "Switch Organization", "Sign out"
      2. Create SpaceListComponent:
         - Grid/list of spaces the user has access to
         - "Create Space" button (for tenant members)
         - Each space card shows: name, description, member count, role
         - Click to navigate to /t/:tenantId/s/:spaceId
      3. Update DashboardComponent:
         - Read tenantId and spaceId from ActivatedRoute
         - Pass spaceId to DashboardService
         - Update auto-seed to use spaceId
      4. Update all manage components to read spaceId from route params
         and pass to their respective services
    files:
      - modify: src/client/src/app/core/layout/header.component.ts
      - create: src/client/src/app/features/spaces/space-list.component.ts
      - modify: src/client/src/app/features/dashboard/dashboard.component.ts
      - modify: src/client/src/app/features/dashboard/dashboard.component.html
      - modify: src/client/src/app/features/manage/companies/company-list.component.ts
      - modify: src/client/src/app/features/manage/companies/company-list.component.html
      - modify: src/client/src/app/features/manage/products/product-list.component.ts
      - modify: src/client/src/app/features/manage/products/product-list.component.html
      - modify: src/client/src/app/features/manage/therapeutic-areas/therapeutic-area-list.component.ts
      - modify: src/client/src/app/features/manage/therapeutic-areas/therapeutic-area-list.component.html
      - modify: src/client/src/app/features/manage/marker-types/marker-type-list.component.ts
      - modify: src/client/src/app/features/manage/marker-types/marker-type-list.component.html
      - modify: src/client/src/app/features/manage/trials/trial-detail.component.ts
    dependencies: [T5]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T7
    title: "Frontend - tenant settings and invite management"
    description: |
      1. Create TenantSettingsComponent:
         - Tenant name edit form (owners only)
         - Members table (p-table) showing: name, email, role, actions
         - "Invite Member" button opens dialog with email + role selector
         - Pending invites table showing: email, role, invite code, expiry
         - Remove member button (owners only, can't remove self if last owner)
      2. Wire up invite flow:
         - Owner sends invite (creates tenant_invite with unique code)
         - Invitee enters code on onboarding page
         - System creates tenant_member + auto-adds to default space
    files:
      - create: src/client/src/app/features/tenant-settings/tenant-settings.component.ts
      - create: src/client/src/app/features/tenant-settings/tenant-settings.component.html
      - create: src/client/src/app/features/tenant-settings/invite-dialog.component.ts
    dependencies: [T6]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T8
    title: "Frontend - space member management"
    description: |
      1. Add space member management to each space:
         - "Members" button in the space header or settings
         - Dialog showing current members (p-table): name, email, role
         - Add member: select from tenant members not yet in space + role
         - Change role: dropdown to switch owner/editor/viewer
         - Remove member: button (space owners only)
      2. Space settings: rename, description, delete (space owners only)
    files:
      - create: src/client/src/app/features/spaces/space-members-dialog.component.ts
      - create: src/client/src/app/features/spaces/space-settings-dialog.component.ts
      - modify: src/client/src/app/features/spaces/space-list.component.ts
    dependencies: [T7]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T9
    title: "Deploy and verify"
    description: |
      1. Push all new migrations to production: supabase db push
      2. Redeploy to Netlify: netlify deploy --prod
      3. Playwright verification:
         - Navigate to app, verify redirect to onboarding
         - Create a tenant, verify redirect to space list
         - Create a space, verify redirect to dashboard
         - Verify dashboard loads with empty state
         - Navigate to manage pages, verify they work within space context
         - Verify space picker in header
    files: []
    dependencies: [T8]
    verification: "supabase db push && netlify deploy --prod"
```

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| RLS policy complexity with space membership joins | Use a helper function `is_space_member(space_id, role[])` to DRY up policies |
| Performance of RLS membership checks on every query | Index on (space_id, user_id) in space_members; membership check is a simple EXISTS |
| Breaking all existing services (every service needs spaceId) | Systematic update in T4; all services follow the same pattern |
| Complex routing with nested tenant/space params | Use Angular route resolvers to load tenant/space context once, share via service |
| Invite code security | Short random codes with expiry; rate limiting on join endpoint |
| User belonging to many tenants -- UX confusion | Remember last-used tenant in localStorage; clear tenant/space context in header |

---

## Open Questions

None -- all design decisions resolved during clarification.
