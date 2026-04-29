# Database Schema

[Back to index](README.md)

---

All schema changes are in `supabase/migrations/` as timestamped SQL files.

## Migration History

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
| 17-28 | `20260411*`--`20260412*` | Landscape RPCs, MOA/ROA, positioning, marker system redesign |
| 29 | `20260413120000_events_system.sql` | Events tables: event_categories, event_threads, events, event_sources, event_links |
| 30 | `20260413120100_events_rpc_functions.sql` | Events RPCs: get_events_page_data, get_event_detail, get_event_thread, get_space_tags |
| 31 | `20260413120200_seed_events_demo_data.sql` | Updates seed_demo_data() with 20 events, threads, links, sources |
| 32 | `20260414023709_marker_visual_redesign.sql` | Adds inner_mark to marker_types, consolidates 21 types to 12 active, adds no_longer_expected to markers |
| 33 | `20260414120000_key_catalysts_rpc.sql` | Key Catalysts RPCs: get_key_catalysts (forward-looking marker feed), get_catalyst_detail (enriched single-marker view with trial context + related events) |
| 34 | `20260414210000_add_tenant_logo_url.sql` | Adds logo_url column to tenants, creates tenant-logos storage bucket with owner/member RLS policies |
| 35 | `20260415120000_seed_pharma_tenants.sql` | Updates `handle_new_user` trigger to create pharma-themed tenants (Boehringer Ingelheim, Azurity Pharmaceuticals) with pipeline-named spaces; back-fills existing users |
| 36 | `20260415180000_catalyst_detail_add_projection_logo.sql` | Updates `get_catalyst_detail` RPC to return `projection`, `no_longer_expected`, `company_logo_url`, and `marker_type_inner_mark` fields from markers/companies/marker_types |
| 37 | `20260415190000_unified_landscape_data_layer.sql` | Adds `category_id` to `get_dashboard_data` marker_type jsonb output; drops `get_key_catalysts` RPC (catalysts now derived client-side from dashboard data) |
| 38 | `20260416120000_fix_positioning_trial_phases.sql` | Fixes `get_positioning_data` to use `trials.phase_type` instead of dropped `trial_phases` table |
| 39 | `20260428021559_security_fixes_invites_and_tenant_quota.sql` | Security audit fixes: drops permissive `using (true)` SELECT on `tenant_invites`; adds owner-only UPDATE policy; new `accept_invite(p_code)` SECURITY DEFINER RPC validates code+email and consumes invite atomically; drops direct `tenants` INSERT policy and adds 25-tenant per-user quota inside `create_tenant` |
| 40 | `20260428030352_fix_member_views_auth_users_access.sql` | Fixes `tenant_members_view` / `space_members_view` failing with `42501 permission denied for table users`. Drops `security_invoker = true` so the views can read `auth.users` as owner, and moves the access check into the view body via `is_tenant_member()` / `has_space_access()` (both SECURITY DEFINER helpers that key off `auth.uid()`) |
| 41 | `20260428031938_disable_auto_provision_add_demo_rpc.sql` | Replaces `handle_new_user()` trigger body with a no-op so signups no longer auto-create Boehringer Ingelheim + Azurity tenants. New `provision_demo_workspace()` SECURITY DEFINER RPC creates the same demo orgs on demand for the calling user (idempotent). Frontend exposes this via the new `/provision-demo` route |
| 42 | `20260428033206_tenant_members_implicit_space_access.sql` | Extends `has_space_access()` so tenant members get implicit access to all spaces in their tenant. Tenant `owner` satisfies any role check (unchanged); tenant `member` satisfies `editor`/`viewer` checks (so they can read + write data but not admin the space). Explicit `space_members` rows still take precedence |
| 43-66 | `20260428040000`-`20260428042300_whitelabel_*.sql` | Whitelabel foundation schema (24 migrations). New tables: `agencies`, `agency_members`, `platform_admins`, `retired_hostnames`. Brand + access columns on `tenants`. Cross-table host uniqueness triggers, hostname retirement triggers. Helpers: `is_agency_member`, `is_platform_admin`. Extended `is_tenant_member` and `has_space_access` with agency / platform-admin disjuncts and tenant-suspension short-circuit. RLS on new tables; `tenants` policies extended for agency owner/member + platform admin; direct `tenants` INSERT denied. RPCs: `get_brand_by_host`, `check_subdomain_available`, `provision_agency`, `provision_tenant`, `update_tenant_branding`, `update_tenant_access`, `get_tenant_access_settings`, `update_agency_branding`, `register_custom_domain`, `self_join_tenant`. Backfill of legacy tenants (`subdomain = slug`, `app_display_name = name`, `primary_color = '#0d9488'`). Cross-tenant isolation smoke-test migration |
| 67 | `20260428060000_agency_members_view.sql` | `agency_members_view` joining `agency_members` + `auth.users` (mirrors `tenant_members_view` pattern; SECURITY INVOKER) |
| 68 | `20260428200000_lookup_user_by_email.sql` | `lookup_user_by_email(p_email)` SECURITY DEFINER RPC for agency add-member and super-admin provision-agency UX. Caller must be a platform admin or own at least one agency. Returns `found: true` + user_id + display_name, or `found: false`; never raises on missing email |
| 69 | `20260428193905_agency_owner_invite_flow.sql` | Lets super-admins provision an agency for an owner who has not yet signed in. New `agency_invites` table (id, agency_id, email, role, invited_by, expires_at, accepted_at/by) with a partial unique index on `(agency_id, lower(email)) where accepted_at is null` and an email-lookup index used by the trigger. RLS: platform admins read all, agency owners read their own; writes only via SECURITY DEFINER. `provision_agency` signature changes from `p_owner_user_id uuid` to `p_owner_email text` — if the email matches an existing user, inserts `agency_members` directly; otherwise inserts `agency_invites` and returns `owner_invited: true`. `handle_new_user` body changes from no-op to a small consumer that scans `agency_invites` matching the new user's lower(email) and promotes any non-expired pending rows to `agency_members`. Tenant invites still go through the explicit code-based `accept_invite()` flow |
| 70 | `20260428202453_delete_agency_rpc.sql` | `delete_agency(p_agency_id uuid)` SECURITY DEFINER RPC for the super-admin trash action. Cascades to `agency_members` and `agency_invites` via existing FKs; refuses with `foreign_key_violation` if any `tenants` row still references the agency (tenants are `on delete set null` and we don't want silent orphaning). Returns counts of removed members and invites. NOTE: original commit comment claimed to skip `retired_hostnames` holdback — that was wrong (the AFTER DELETE trigger on agencies still fires); migration 71 corrects the function comment and adds the explicit release path |
| 71 | `20260428203608_release_retired_hostname_rpc.sql` | `release_retired_hostname(p_hostname text)` SECURITY DEFINER RPC for super-admin override of the 90-day holdback. Deletes the row from `retired_hostnames` so the hostname is immediately re-claimable. Raises `P0002` on unknown hostname (no silent no-op on typos). Use after a deliberate super-admin `delete_agency` / `delete_tenant` when you need to reuse the subdomain. Customer decommissions should keep the holdback (prevents takeover via stale session cookies, bookmarked links). Also corrects the misleading doc comment on `delete_agency` |
| 72 | `20260428215813_fix_agency_members_view_and_contact_email.sql` | Recreates `agency_members_view` without `security_invoker = true`, with an inline `is_agency_member()` / `is_platform_admin()` WHERE clause — same fix migration 40 applied to `tenant_members_view` and `space_members_view`. Previously the view tried to read `auth.users` as the calling `authenticated` role, failed with 42501, and the agency service silently fell back to raw `agency_members` so the Members table rendered "--" for name and the user_id under email. `provision_agency` now defaults `contact_email` to `p_owner_email` when not supplied, instead of writing the literal placeholder `unknown@unknown.invalid` (which surfaced verbatim on the branding page). Backfills any existing agencies still holding the placeholder using the owner row from `agency_members` |
| 73 | `20260428220000_member_self_protection_guards.sql` | Defense-in-depth row triggers on `tenant_members`, `space_members`, and `agency_members` that block (a) deletes targeting `auth.uid()`'s own membership row -- another member must remove you -- and (b) any DELETE or role UPDATE that would leave the parent entity with zero owners. Errors raise as `42501` with a user-readable message. Cascading deletes from `tenants`, `spaces`, `agencies`, and `auth.users` still work via statement-level BEFORE/AFTER DELETE triggers on each parent that flip a transaction-local `clint.member_guard_cascade` flag; the row-level guard short-circuits when that flag is `'on'`. The agency-members UI already hid these controls for self -- this migration extends the same protection to tenant and space members and makes the rule authoritative regardless of client. |

## Core Data Tables

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

-- Marker type definitions (12 active system types + custom user types)
marker_types (
  id            uuid PRIMARY KEY,
  space_id      uuid,              -- null for system types
  created_by    uuid,              -- null for system types
  category_id   uuid REFERENCES marker_categories(id),
  name          text NOT NULL,
  shape         text,              -- 'circle'|'diamond'|'flag'|'triangle'|'square'|'dashed-line'
  fill_style    text,              -- 'filled'|'outline'|'striped'|'gradient'
  color         text,              -- hex color
  inner_mark    text DEFAULT 'none', -- 'dot'|'dash'|'check'|'x'|'none'
  is_system     boolean,
  display_order integer,           -- -1 for archived types
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

## Multi-Tenant Tables

```sql
-- Consultancy partners (optional parent of tenants)
agencies (
  id                uuid PRIMARY KEY,
  name              varchar(255) NOT NULL,
  slug              varchar(100) UNIQUE NOT NULL,
  subdomain         varchar(63)  UNIQUE NOT NULL,    -- DNS-safe ^[a-z][a-z0-9-]{1,62}$
  logo_url          text,
  favicon_url       text,
  app_display_name  varchar(100) NOT NULL,
  primary_color     varchar(7)   NOT NULL DEFAULT '#0d9488',
  accent_color      varchar(7),
  contact_email     varchar(255) NOT NULL,
  plan_tier         varchar(50)  NOT NULL DEFAULT 'starter',  -- 'starter'|'growth'|'enterprise'
  max_tenants       int          NOT NULL DEFAULT 5,           -- 0 = unlimited
  custom_domain     varchar(255) UNIQUE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
)

-- Users acting on behalf of an agency
agency_members (
  id          uuid PRIMARY KEY,
  agency_id   uuid REFERENCES agencies(id) ON DELETE CASCADE NOT NULL,
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role        varchar(20) NOT NULL CHECK (role IN ('owner','member')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, user_id)
)

-- Platform owner's super-admin role; bootstrapped via SQL only
platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
)
-- Not exposed via PostgREST: revoke all on public.platform_admins from anon, authenticated;

-- Holdback list of recently-decommissioned subdomains and custom domains
retired_hostnames (
  hostname       varchar(255) PRIMARY KEY,
  retired_at     timestamptz NOT NULL DEFAULT now(),
  released_at    timestamptz NOT NULL DEFAULT now() + interval '90 days',
  previous_kind  varchar(20) NOT NULL CHECK (previous_kind IN ('tenant','agency')),
  previous_id    uuid                                             -- soft reference; original row may be gone
)

-- Top-level pharma client organizations (whitelabel-extended)
tenants (
  id                       uuid PRIMARY KEY,
  name                     text NOT NULL,
  slug                     text UNIQUE,
  logo_url                 text,
  -- whitelabel: optional agency parent
  agency_id                uuid REFERENCES agencies(id),       -- null = direct customer
  -- whitelabel: host identity
  subdomain                varchar(63)  UNIQUE,                 -- required for live tenants; null for legacy apex customers
  custom_domain            varchar(255) UNIQUE,                 -- set by super-admin (sales-led upgrade)
  -- whitelabel: brand fields
  app_display_name         varchar(100),                        -- defaults to name
  primary_color            varchar(7)   DEFAULT '#0d9488',
  accent_color             varchar(7),
  favicon_url              text,
  email_from_name          varchar(100),                        -- defaults to app_display_name
  -- whitelabel: access control
  email_domain_allowlist   text[],                              -- when set, only these email domains can self-join
  email_self_join_enabled  boolean DEFAULT false,
  -- whitelabel: lifecycle
  suspended_at             timestamptz,                         -- read-only mode for non-payment / abuse
  created_by               uuid,
  created_at               timestamptz,
  updated_at               timestamptz
)

-- Organization membership with roles (constraint: 'owner' | 'member' only — never 'viewer')
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
-- Database webhook on INSERT triggers send-invite-email Edge Function (configured in Supabase Dashboard)

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

### Whitelabel Indexes

- `tenants(subdomain)` unique partial where `subdomain is not null`
- `tenants(custom_domain)` unique partial where `custom_domain is not null`
- `agencies(subdomain)` unique
- `agencies(custom_domain)` unique partial where `custom_domain is not null`
- `tenants(agency_id)` btree
- `agency_members(user_id)` btree
- `agencies_subdomain_idx`, `agencies_custom_domain_idx` for host-resolution lookups

### Cross-Table Host Uniqueness Triggers

Per-table unique constraints don't prevent a `tenants.subdomain` colliding with an `agencies.subdomain` (or any subdomain colliding with a custom domain across tables). Two `BEFORE INSERT OR UPDATE` triggers enforce this:

- `enforce_subdomain_unique_across_tables` — on both `tenants` and `agencies`. Raises if `NEW.subdomain` exists in the *other* table.
- `enforce_custom_domain_unique_across_tables` — on both `tenants` and `agencies`. Raises if `NEW.custom_domain` exists in the *other* table.

The reserved-list check stays in the RPCs (`provision_tenant`, `provision_agency`, `register_custom_domain`).

### Hostname Retirement Triggers

When a tenant or agency is decommissioned, its old hostnames are inserted into `retired_hostnames` with a 90-day default hold:

- `AFTER UPDATE OF subdomain` — when `OLD.subdomain IS NOT NULL` and changed, insert old value
- `AFTER UPDATE OF custom_domain` — same shape for custom domains
- `AFTER DELETE` — insert both subdomain and custom_domain (if present) on tenant or agency deletion

`provision_tenant`, `provision_agency`, and `register_custom_domain` reject any hostname present in `retired_hostnames` where `released_at > now()`. Entries age out automatically — no nightly job required.

### Reserved Subdomain List

Hardcoded in `provision_tenant` / `provision_agency` validation. Subdomains rejected at provisioning time:

```
www app api admin auth mail support status docs blog help
cdn static assets noreply email smtp
```

This list is a **security control**, not just UX. With cookie-based session storage scoped to `Domain=.<apex>`, all subdomains share the session. Allowing a tenant to register `auth` or `admin` would let them host a phishing page that has access to authenticated cookies.

## System Marker Types

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

## Indexes

Indexes on frequently filtered/joined columns:
- `companies.space_id`, `products.space_id`, `trials.space_id`
- `products.company_id`, `trials.product_id`, `trials.therapeutic_area_id`
- `trial_phases.trial_id`, `trial_markers.trial_id`, `trial_markers.marker_type_id`
- `trial_notes.trial_id`
- CT.gov filter columns: `trials.recruitment_status`, `trials.study_type`, `trials.phase`, `trials.intervention_type`
