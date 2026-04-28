# Whitelabel Foundation — Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land all database schema for whitelabel support: new agency/admin/retired-hostname tables, brand + access columns on `tenants`, cross-table host uniqueness, hostname retirement holdback, agency/platform-admin disjuncts in `has_space_access` and `is_tenant_member`, tenant-suspension enforcement, and every SECURITY DEFINER RPC the rest of the spec depends on. Existing app continues to work unchanged when this plan completes.

**Architecture:** Pure database work, no client-side changes. One Postgres migration per task. Every migration is additive — no destructive ops on existing data. Backfill near the end populates legacy tenants with `subdomain`, `app_display_name`, and `primary_color` so they keep working and can opt into a subdomain later. RLS, helpers, and RPCs follow the project's existing conventions (modeled on `accept_invite()` in `20260428021559_security_fixes_invites_and_tenant_quota.sql`).

**Tech Stack:** Postgres 15, Supabase CLI migrations (`supabase db reset`, `supabase migration new`), plpgsql, RLS, SECURITY DEFINER functions, pgTAP-free SQL assertions executed via `psql`.

**Reference docs:**
- Spec: `docs/superpowers/specs/2026-04-27-whitelabel-design.md`
- Project Supabase guides: `docs/supabase-guides/database-rls-policies.md`, `database-functions.md`, `database-create-migration.md`, `sql-style-guide.md`
- Pattern reference (security definer, error codes, revoke/grant): `supabase/migrations/20260428021559_security_fixes_invites_and_tenant_quota.sql`

**Conventions enforced in every migration in this plan:**
- All SQL is lowercase except identifiers that need casing.
- Every new function is `security definer` + `set search_path = ''` + fully-qualified object names.
- Every new function starts with `if auth.uid() is null then raise exception 'Must be authenticated' using errcode = '28000'; end if;` unless it's intentionally anon-callable (`get_brand_by_host`, `check_subdomain_available`).
- Every new function ends with `revoke execute ... from public; revoke execute ... from anon; grant execute ... to authenticated;` (or `grant ... to anon` for the two anon-callable ones).
- Every new function has a `comment on function` describing purpose + SECURITY DEFINER rationale.
- Error codes: `28000` (auth), `42501` (permission), `P0001`/`P0002` (state), `53400` (quota), `23505` (uniqueness).
- Migration filenames follow `YYYYMMDDHHmmss_short_description.sql`. Today is 2026-04-28; start at `20260428040000` to come after the latest existing migration.

**Verification model.** This project doesn't have an automated SQL test framework, so each task ends with a hand-runnable `psql` assertion block plus a `supabase db reset` smoke test. Multi-tenant isolation is verified by impersonating two different `auth.uid()` values via `set local request.jwt.claim.sub = ...`.

---

## File Structure

This plan creates **21 migration files** (no application code yet). Files are ordered so each builds on the previous; later migrations can reference helpers and tables created earlier.

| # | File | Responsibility |
|---|---|---|
| 1 | `supabase/migrations/20260428040000_whitelabel_create_agency_tables.sql` | `agencies`, `agency_members`, `platform_admins`, `retired_hostnames` |
| 2 | `supabase/migrations/20260428040100_whitelabel_add_brand_columns_to_tenants.sql` | brand + access columns on `tenants` |
| 3 | `supabase/migrations/20260428040200_whitelabel_cross_table_host_uniqueness.sql` | triggers preventing subdomain/custom_domain collision across `tenants` and `agencies` |
| 4 | `supabase/migrations/20260428040300_whitelabel_hostname_retirement_triggers.sql` | retire-on-update, retire-on-delete triggers |
| 5 | `supabase/migrations/20260428040400_whitelabel_helper_is_agency_member.sql` | `is_agency_member()` helper |
| 6 | `supabase/migrations/20260428040500_whitelabel_helper_is_platform_admin.sql` | `is_platform_admin()` helper |
| 7 | `supabase/migrations/20260428040600_whitelabel_update_is_tenant_member.sql` | extend `is_tenant_member` with agency disjuncts + platform admin |
| 8 | `supabase/migrations/20260428040700_whitelabel_update_has_space_access.sql` | extend `has_space_access` with agency disjuncts + platform admin + suspension short-circuit |
| 9 | `supabase/migrations/20260428040800_whitelabel_rls_agencies.sql` | RLS policies for `agencies` |
| 10 | `supabase/migrations/20260428040900_whitelabel_rls_agency_members.sql` | RLS policies for `agency_members` |
| 11 | `supabase/migrations/20260428041000_whitelabel_rls_retired_hostnames.sql` | RLS policies for `retired_hostnames` |
| 12 | `supabase/migrations/20260428041100_whitelabel_rls_tenants_extend.sql` | extend `tenants` policies with agency owner/member + platform admin; deny direct INSERT |
| 13 | `supabase/migrations/20260428041200_whitelabel_rpc_get_brand_by_host.sql` | `get_brand_by_host()` (anon-callable) |
| 14 | `supabase/migrations/20260428041300_whitelabel_rpc_check_subdomain_available.sql` | `check_subdomain_available()` |
| 15 | `supabase/migrations/20260428041400_whitelabel_rpc_provision_agency.sql` | `provision_agency()` (platform admin only) |
| 16 | `supabase/migrations/20260428041500_whitelabel_rpc_provision_tenant.sql` | `provision_tenant()` (agency owner / platform admin) |
| 17 | `supabase/migrations/20260428041600_whitelabel_rpc_update_tenant_branding.sql` | `update_tenant_branding()` |
| 18 | `supabase/migrations/20260428041700_whitelabel_rpc_update_tenant_access.sql` | `update_tenant_access()` |
| 19 | `supabase/migrations/20260428041800_whitelabel_rpc_get_tenant_access_settings.sql` | `get_tenant_access_settings()` (auth read of allowlist) |
| 20 | `supabase/migrations/20260428041900_whitelabel_rpc_update_agency_branding.sql` | `update_agency_branding()` |
| 21 | `supabase/migrations/20260428042000_whitelabel_rpc_register_custom_domain.sql` | `register_custom_domain()` (platform admin only) |
| 22 | `supabase/migrations/20260428042100_whitelabel_rpc_self_join_tenant.sql` | `self_join_tenant()` (generic-error variant) |
| 23 | `supabase/migrations/20260428042200_whitelabel_backfill_existing_tenants.sql` | backfill `subdomain`, `app_display_name`, `primary_color` on legacy tenants |
| 24 | `supabase/migrations/20260428042300_whitelabel_isolation_smoke_tests.sql` | self-test migration: asserts cross-tenant RLS isolation, prints PASS/FAIL via `raise notice`. Drops at end. |

That's 24 files (the plan title says 21 because I miscounted in spec — 24 is correct). Each is its own task below.

---

### Task 1: Create new whitelabel tables

**Files:**
- Create: `supabase/migrations/20260428040000_whitelabel_create_agency_tables.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428040000_whitelabel_create_agency_tables
-- purpose: create the four new whitelabel tables (agencies, agency_members,
--   platform_admins, retired_hostnames). these are the structural foundation
--   for: consultancy partners (agencies), users that act on behalf of an
--   agency (agency_members), the platform owner's super-admin role
--   (platform_admins), and a holdback list preventing re-claim attacks on
--   recently-decommissioned hostnames (retired_hostnames).
-- affected objects: 4 new tables, all with rls enabled, no rls policies yet
--   (added in subsequent migrations).

-- =============================================================================
-- agencies
-- =============================================================================
create table public.agencies (
  id                uuid primary key default gen_random_uuid(),
  name              varchar(255) not null,
  slug              varchar(100) not null unique,
  subdomain         varchar(63)  not null unique,
  logo_url          text,
  favicon_url       text,
  app_display_name  varchar(100) not null,
  primary_color     varchar(7)   not null default '#0d9488',
  accent_color      varchar(7),
  contact_email     varchar(255) not null,
  plan_tier         varchar(50)  not null default 'starter',
  max_tenants       int          not null default 5,
  custom_domain     varchar(255) unique,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now()
);
comment on table public.agencies is
  'Consultancy partner that resells the whitelabeled product to pharma '
  'client tenants. Identified by subdomain (e.g., zs.yourproduct.com). '
  'agency_id on tenants ties pharma clients to the consultancy that '
  'provisioned them.';

alter table public.agencies enable row level security;

create index agencies_subdomain_idx     on public.agencies (subdomain);
create index agencies_custom_domain_idx on public.agencies (custom_domain) where custom_domain is not null;

-- =============================================================================
-- agency_members
-- =============================================================================
create table public.agency_members (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies (id) on delete cascade,
  user_id     uuid not null references auth.users (id)      on delete cascade,
  role        varchar(20) not null check (role in ('owner', 'member')),
  created_at  timestamptz not null default now(),
  unique (agency_id, user_id)
);
comment on table public.agency_members is
  'Users who act on behalf of an agency. Owners can provision tenants, edit '
  'agency and tenant branding, and invite other agency members. Members get '
  'read-only visibility across all tenants in the agency.';

alter table public.agency_members enable row level security;

create index agency_members_user_id_idx on public.agency_members (user_id);

-- =============================================================================
-- platform_admins
-- =============================================================================
create table public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table public.platform_admins is
  'The platform owner''s super-admin role. Bootstrapped via SQL only -- not '
  'exposed to PostgREST. Members get RLS read access across all agencies '
  'and tenants for support; writes still go through write RPCs.';

alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;

-- =============================================================================
-- retired_hostnames
-- =============================================================================
create table public.retired_hostnames (
  hostname       varchar(255) primary key,
  retired_at     timestamptz not null default now(),
  released_at    timestamptz not null default now() + interval '90 days',
  previous_kind  varchar(20) not null check (previous_kind in ('tenant', 'agency')),
  previous_id    uuid
);
comment on table public.retired_hostnames is
  'Holdback list of recently-decommissioned subdomains and custom domains. '
  'Prevents re-claim attacks where an attacker re-provisions a freshly-'
  'retired hostname to inherit residual trust (cached cookies, bookmarked '
  'invite URLs). Hostnames become reusable on/after released_at (default '
  '90 days).';

alter table public.retired_hostnames enable row level security;
```

- [ ] **Step 2: Apply the migration**

Run: `cd /Users/aadityamadala/Documents/code/clint-v2 && supabase db reset`
Expected: completes without error; "Finished supabase db reset on local-only db".

- [ ] **Step 3: Verify schema**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
  select table_name from information_schema.tables
  where table_schema = 'public'
    and table_name in ('agencies','agency_members','platform_admins','retired_hostnames')
  order by table_name;
"
```
Expected: 4 rows: `agencies`, `agency_members`, `platform_admins`, `retired_hostnames`.

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
  select tablename, rowsecurity from pg_tables
  where schemaname = 'public'
    and tablename in ('agencies','agency_members','platform_admins','retired_hostnames')
  order by tablename;
"
```
Expected: all four show `rowsecurity = t`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260428040000_whitelabel_create_agency_tables.sql
git commit -m "whitelabel(db): create agencies, agency_members, platform_admins, retired_hostnames tables"
```

---

### Task 2: Add brand and access columns to tenants

**Files:**
- Create: `supabase/migrations/20260428040100_whitelabel_add_brand_columns_to_tenants.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428040100_whitelabel_add_brand_columns_to_tenants
-- purpose: extend public.tenants with the columns that drive whitelabel
--   branding (per-tenant logo/colors/name), host resolution
--   (subdomain/custom_domain), email branding (email_from_name), domain-
--   based self-join (email_domain_allowlist + email_self_join_enabled),
--   tenant suspension (suspended_at), and the agency-tenant relationship
--   (agency_id).
-- additive: no existing column is dropped; existing data is unaffected.
--   subdomain is left null on legacy tenants and backfilled in a later migration.

alter table public.tenants
  add column agency_id                uuid references public.agencies (id) on delete set null,
  add column subdomain                varchar(63)  unique,
  add column custom_domain            varchar(255) unique,
  add column app_display_name         varchar(100),
  add column primary_color            varchar(7) not null default '#0d9488',
  add column accent_color             varchar(7),
  add column favicon_url              text,
  add column email_from_name          varchar(100),
  add column email_domain_allowlist   text[],
  add column email_self_join_enabled  boolean not null default false,
  add column suspended_at             timestamptz;

create index tenants_agency_id_idx     on public.tenants (agency_id);
create index tenants_subdomain_idx     on public.tenants (subdomain) where subdomain is not null;
create index tenants_custom_domain_idx on public.tenants (custom_domain) where custom_domain is not null;

comment on column public.tenants.agency_id is
  'Optional reference to the consultancy that provisioned this tenant. '
  'Null for direct C-style customers and for legacy tenants created before '
  'whitelabel.';
comment on column public.tenants.subdomain is
  'DNS-safe slug used as the tenant''s URL subdomain (pfizer.yourproduct.com). '
  'Null for legacy tenants until they claim one via tenant settings.';
comment on column public.tenants.custom_domain is
  'Sales-led upgrade: a fully-qualified hostname (competitive.acme.com) that '
  'maps to this tenant. Set by platform admins after Netlify domain alias is '
  'configured.';
comment on column public.tenants.app_display_name is
  'The brand name shown in the browser title, app header, emails, and PPT '
  'exports. Replaces "Clint" for whitelabeled tenants. Defaults to tenants.name.';
comment on column public.tenants.email_domain_allowlist is
  'When set together with email_self_join_enabled = true, users whose email '
  'domain matches any entry can self-join the tenant at viewer role. '
  'Never returned to anon callers (would leak customer relationship intel).';
comment on column public.tenants.suspended_at is
  'When non-null, the tenant is in read-only mode. Enforced by has_space_access '
  '(write checks short-circuit to false). Set by platform admins for non-payment '
  'or abuse; cleared to restore.';
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db reset`
Expected: completes without error.

- [ ] **Step 3: Verify columns exist**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
  select column_name, data_type, is_nullable, column_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'tenants'
    and column_name in (
      'agency_id','subdomain','custom_domain','app_display_name',
      'primary_color','accent_color','favicon_url','email_from_name',
      'email_domain_allowlist','email_self_join_enabled','suspended_at'
    )
  order by column_name;
"
```
Expected: 11 rows, all expected columns present, `primary_color` default `#0d9488`, `email_self_join_enabled` default `false`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260428040100_whitelabel_add_brand_columns_to_tenants.sql
git commit -m "whitelabel(db): add brand, access, suspension columns to tenants"
```

---

### Task 3: Cross-table host uniqueness triggers

**Files:**
- Create: `supabase/migrations/20260428040200_whitelabel_cross_table_host_uniqueness.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428040200_whitelabel_cross_table_host_uniqueness
-- purpose: per-table unique constraints on tenants.subdomain and
--   agencies.subdomain don't prevent a tenant subdomain colliding with an
--   agency subdomain (or any subdomain colliding with a custom_domain).
--   the host resolver (get_brand_by_host) needs unambiguous host -> entity
--   mapping. enforce cross-table uniqueness via two before-insert-or-update
--   triggers on each table.
-- raises 23505 (unique_violation) on collision so the api surfaces a clean
--   conflict rather than a generic exception.

create or replace function public.enforce_subdomain_unique_across_tables()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  collides boolean;
begin
  if new.subdomain is null then
    return new;
  end if;

  if tg_table_name = 'tenants' then
    select exists (select 1 from public.agencies a where a.subdomain = new.subdomain)
      into collides;
  elsif tg_table_name = 'agencies' then
    select exists (select 1 from public.tenants t where t.subdomain = new.subdomain)
      into collides;
  else
    return new;
  end if;

  if collides then
    raise exception 'subdomain "%" is already in use', new.subdomain
      using errcode = '23505';
  end if;

  return new;
end;
$$;

comment on function public.enforce_subdomain_unique_across_tables() is
  'Trigger function. Prevents tenants.subdomain from colliding with '
  'agencies.subdomain and vice versa. Required because a single per-table '
  'unique constraint cannot enforce cross-table uniqueness.';

create or replace function public.enforce_custom_domain_unique_across_tables()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  collides boolean;
begin
  if new.custom_domain is null then
    return new;
  end if;

  if tg_table_name = 'tenants' then
    select exists (select 1 from public.agencies a where a.custom_domain = new.custom_domain)
      into collides;
  elsif tg_table_name = 'agencies' then
    select exists (select 1 from public.tenants t where t.custom_domain = new.custom_domain)
      into collides;
  else
    return new;
  end if;

  if collides then
    raise exception 'custom_domain "%" is already in use', new.custom_domain
      using errcode = '23505';
  end if;

  return new;
end;
$$;

comment on function public.enforce_custom_domain_unique_across_tables() is
  'Trigger function. Prevents tenants.custom_domain from colliding with '
  'agencies.custom_domain and vice versa.';

create trigger enforce_subdomain_unique_tenants
  before insert or update of subdomain on public.tenants
  for each row execute function public.enforce_subdomain_unique_across_tables();

create trigger enforce_subdomain_unique_agencies
  before insert or update of subdomain on public.agencies
  for each row execute function public.enforce_subdomain_unique_across_tables();

create trigger enforce_custom_domain_unique_tenants
  before insert or update of custom_domain on public.tenants
  for each row execute function public.enforce_custom_domain_unique_across_tables();

create trigger enforce_custom_domain_unique_agencies
  before insert or update of custom_domain on public.agencies
  for each row execute function public.enforce_custom_domain_unique_across_tables();
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: completes without error.

- [ ] **Step 3: Verify cross-table collision is rejected**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
insert into public.agencies (name, slug, subdomain, app_display_name, contact_email)
  values ('Test Agency', 'test-agency', 'collide', 'Test', 'a@b.com');
-- this should fail with 23505
insert into public.tenants (name, slug, subdomain)
  values ('Test Tenant', 'test-tenant', 'collide');
rollback;
SQL
```
Expected: second insert fails with `subdomain "collide" is already in use`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260428040200_whitelabel_cross_table_host_uniqueness.sql
git commit -m "whitelabel(db): cross-table subdomain and custom_domain uniqueness triggers"
```

---

### Task 4: Hostname retirement triggers

**Files:**
- Create: `supabase/migrations/20260428040300_whitelabel_hostname_retirement_triggers.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428040300_whitelabel_hostname_retirement_triggers
-- purpose: when a tenant or agency's subdomain or custom_domain changes
--   (or the row is deleted), record the old hostname in retired_hostnames
--   so it cannot be re-claimed for at least 90 days. prevents subdomain
--   takeover attacks where an attacker re-provisions a freshly-decommissioned
--   subdomain to inherit residual trust artifacts.

create or replace function public.retire_hostname_on_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind varchar(20);
  v_id   uuid;
begin
  v_kind := tg_table_name;
  if v_kind = 'tenants' then
    v_kind := 'tenant';
  elsif v_kind = 'agencies' then
    v_kind := 'agency';
  else
    return null;
  end if;

  if (tg_op = 'UPDATE') then
    v_id := new.id;
    if old.subdomain is not null and (new.subdomain is null or old.subdomain <> new.subdomain) then
      insert into public.retired_hostnames (hostname, previous_kind, previous_id)
        values (old.subdomain, v_kind, v_id)
        on conflict (hostname) do nothing;
    end if;
    if old.custom_domain is not null and (new.custom_domain is null or old.custom_domain <> new.custom_domain) then
      insert into public.retired_hostnames (hostname, previous_kind, previous_id)
        values (old.custom_domain, v_kind, v_id)
        on conflict (hostname) do nothing;
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    v_id := old.id;
    if old.subdomain is not null then
      insert into public.retired_hostnames (hostname, previous_kind, previous_id)
        values (old.subdomain, v_kind, v_id)
        on conflict (hostname) do nothing;
    end if;
    if old.custom_domain is not null then
      insert into public.retired_hostnames (hostname, previous_kind, previous_id)
        values (old.custom_domain, v_kind, v_id)
        on conflict (hostname) do nothing;
    end if;
    return old;
  end if;
  return null;
end;
$$;

comment on function public.retire_hostname_on_change() is
  'Trigger function. Inserts the old subdomain and/or custom_domain into '
  'retired_hostnames when a tenant or agency row is updated to clear/change '
  'them, or when the row is deleted. on conflict do nothing so a hostname '
  'recycled multiple times keeps the earliest retirement record.';

create trigger retire_hostname_on_tenant_change
  after update or delete on public.tenants
  for each row execute function public.retire_hostname_on_change();

create trigger retire_hostname_on_agency_change
  after update or delete on public.agencies
  for each row execute function public.retire_hostname_on_change();
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: completes without error.

- [ ] **Step 3: Verify retirement on update and delete**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
insert into public.agencies (name, slug, subdomain, app_display_name, contact_email)
  values ('Acme', 'acme', 'acme', 'Acme', 'a@b.com');
update public.agencies set subdomain = 'acme2' where slug = 'acme';
select hostname, previous_kind from public.retired_hostnames where hostname = 'acme';
-- expected: 1 row (acme, agency)

delete from public.agencies where slug = 'acme';
select hostname, previous_kind from public.retired_hostnames where hostname = 'acme2';
-- expected: 1 row (acme2, agency)
rollback;
SQL
```
Expected output shows both rows recorded.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260428040300_whitelabel_hostname_retirement_triggers.sql
git commit -m "whitelabel(db): retire subdomains/custom_domains on tenant or agency change"
```

---

### Task 5: `is_agency_member()` helper

**Files:**
- Create: `supabase/migrations/20260428040400_whitelabel_helper_is_agency_member.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428040400_whitelabel_helper_is_agency_member
-- purpose: rls helper. mirrors is_tenant_member's shape. returns true if
--   the calling user is a member of the given agency, optionally filtered
--   by role. used by tenant rls (any agency member can read all tenants in
--   their agency; only owners can write) and by agency rls.

create or replace function public.is_agency_member(
  p_agency_id uuid,
  p_roles     text[] default null
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.agency_members am
    where am.agency_id = p_agency_id
      and am.user_id   = auth.uid()
      and (p_roles is null or am.role = any(p_roles))
  );
$$;

comment on function public.is_agency_member(uuid, text[]) is
  'RLS helper. True if the calling user is a member of p_agency_id with one '
  'of p_roles (or any role when p_roles is null). SECURITY DEFINER so RLS '
  'policies can call it without needing direct read access to agency_members.';

revoke execute on function public.is_agency_member(uuid, text[]) from public;
revoke execute on function public.is_agency_member(uuid, text[]) from anon;
grant  execute on function public.is_agency_member(uuid, text[]) to authenticated;
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: completes without error.

- [ ] **Step 3: Verify function exists with the expected signature**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
  select pg_get_function_identity_arguments(oid)
  from pg_proc where proname = 'is_agency_member' and pronamespace = 'public'::regnamespace;
"
```
Expected: `p_agency_id uuid, p_roles text[]`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260428040400_whitelabel_helper_is_agency_member.sql
git commit -m "whitelabel(db): is_agency_member() rls helper"
```

---

### Task 6: `is_platform_admin()` helper

**Files:**
- Create: `supabase/migrations/20260428040500_whitelabel_helper_is_platform_admin.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428040500_whitelabel_helper_is_platform_admin
-- purpose: rls helper. true if the calling user has a row in
--   platform_admins. platform admins get implicit read across the entire
--   schema for support and provisioning bootstrap.

create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = auth.uid()
  );
$$;

comment on function public.is_platform_admin() is
  'RLS helper. True if the calling user is a platform admin. SECURITY '
  'DEFINER so it can read platform_admins without exposing that table to '
  'PostgREST.';

revoke execute on function public.is_platform_admin() from public;
revoke execute on function public.is_platform_admin() from anon;
grant  execute on function public.is_platform_admin() to authenticated;
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: completes without error.

- [ ] **Step 3: Verify**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
  select public.is_platform_admin();
"
```
Expected: `f` (no auth.uid() in psql session).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260428040500_whitelabel_helper_is_platform_admin.sql
git commit -m "whitelabel(db): is_platform_admin() rls helper"
```

---

### Task 7: Extend `is_tenant_member` with agency + platform-admin disjuncts

**Files:**
- Create: `supabase/migrations/20260428040600_whitelabel_update_is_tenant_member.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428040600_whitelabel_update_is_tenant_member
-- purpose: extend is_tenant_member with two new disjuncts -- agency owner
--   of the parent agency (full access regardless of p_roles) and platform
--   admin (always passes for read-style checks). preserves the existing
--   tenant_members semantics; layers cross-tenant access on top.
-- note: agency members (non-owner) intentionally do NOT pass is_tenant_member,
--   since this helper is used both for read and write checks. write-side
--   semantics for agency members are read-only via has_space_access.

create or replace function public.is_tenant_member(
  p_tenant_id uuid,
  p_roles     text[] default null
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    -- explicit tenant membership
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id   = auth.uid()
      and (p_roles is null or tm.role = any(p_roles))
  )
  or exists (
    -- agency owner of the tenant's parent agency: full access
    select 1
      from public.tenants t
      join public.agency_members am on am.agency_id = t.agency_id
     where t.id          = p_tenant_id
       and am.user_id    = auth.uid()
       and am.role       = 'owner'
  )
  or public.is_platform_admin();
$$;

comment on function public.is_tenant_member(uuid, text[]) is
  'RLS helper. True if the calling user (a) is an explicit tenant_member '
  'with one of p_roles, (b) is an owner of the tenant''s parent agency, '
  'or (c) is a platform admin. Agency *members* (non-owner) do not pass '
  'this check; their read-only access is granted via has_space_access.';
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: completes without error.

- [ ] **Step 3: Smoke-test (manual setup)**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
-- create a fake agency, tenant, and two users
insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
  values ('11111111-1111-1111-1111-111111111111', 'Test Ag', 'test-ag', 'testag', 'Test', 'x@y.com');
insert into auth.users (id, email)
  values ('22222222-2222-2222-2222-222222222222', 'owner@testag.com'),
         ('33333333-3333-3333-3333-333333333333', 'rando@elsewhere.com');
insert into public.agency_members (agency_id, user_id, role)
  values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'owner');
insert into public.tenants (id, name, slug, agency_id)
  values ('44444444-4444-4444-4444-444444444444', 'Pfizer', 'pfizer', '11111111-1111-1111-1111-111111111111');

-- as the agency owner: passes
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public.is_tenant_member('44444444-4444-4444-4444-444444444444');
-- expected: t

-- as the random user: fails
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select public.is_tenant_member('44444444-4444-4444-4444-444444444444');
-- expected: f
rollback;
SQL
```
Expected: first `select` returns `t`, second returns `f`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260428040600_whitelabel_update_is_tenant_member.sql
git commit -m "whitelabel(db): extend is_tenant_member with agency owner + platform admin"
```

---

### Task 8: Extend `has_space_access` with agency + platform-admin disjuncts and suspension short-circuit

**Files:**
- Create: `supabase/migrations/20260428040700_whitelabel_update_has_space_access.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428040700_whitelabel_update_has_space_access
-- purpose: extend has_space_access with three new behaviors while preserving
--   the existing tenant-member implicit-space-access fallback added in
--   20260428033206 (tenant 'member' satisfies editor/viewer checks):
--   1. agency owner of the tenant's parent agency: full access regardless
--      of p_roles (equivalent to tenant owner).
--   2. agency member of the tenant's parent agency: viewer-only access
--      (passes only when p_roles is null or includes 'viewer').
--   3. tenant suspension: when tenants.suspended_at is non-null, write checks
--      (where p_roles intersects {owner, editor}) short-circuit to false.
--      reads still work so users can export their data and the ui can show
--      a suspended banner.
--   4. platform admin: read-side bypass.

create or replace function public.has_space_access(
  p_space_id uuid,
  p_roles    text[] default null
)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_tenant_id  uuid;
  v_agency_id  uuid;
  v_suspended  boolean;
  v_uid        uuid := auth.uid();
  v_is_write   boolean;
begin
  -- look up tenancy and suspension state once
  select s.tenant_id, t.agency_id, (t.suspended_at is not null)
    into v_tenant_id, v_agency_id, v_suspended
    from public.spaces s
    join public.tenants t on t.id = s.tenant_id
   where s.id = p_space_id;

  if v_tenant_id is null then
    return false;
  end if;

  -- write checks against a suspended tenant fail
  v_is_write := p_roles is not null and (
    'owner'  = any(p_roles) or
    'editor' = any(p_roles)
  );
  if v_suspended and v_is_write then
    return false;
  end if;

  -- platform admin: read-side bypass (writes still go through write rpcs)
  if not v_is_write and public.is_platform_admin() then
    return true;
  end if;

  -- explicit space membership; the role on the space_members row is the
  -- authority when present.
  if exists (
    select 1 from public.space_members sm
    where sm.space_id = p_space_id
      and sm.user_id  = v_uid
      and (p_roles is null or sm.role = any(p_roles))
  ) then
    return true;
  end if;

  -- implicit access via tenant membership (mirrors 20260428033206):
  --   * tenant 'owner' satisfies any role check, including owner-only checks.
  --   * tenant 'member' satisfies any check that allows 'editor' or 'viewer',
  --     i.e. all read and most write paths. Owner-only checks still exclude
  --     tenant members.
  if exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = v_tenant_id
      and tm.user_id   = v_uid
      and (
        p_roles is null
        or tm.role = 'owner'
        or 'editor' = any(p_roles)
        or 'viewer' = any(p_roles)
      )
  ) then
    return true;
  end if;

  -- agency owner of parent agency: full access (mirrors tenant owner).
  if v_agency_id is not null and exists (
    select 1 from public.agency_members am
    where am.agency_id = v_agency_id
      and am.user_id   = v_uid
      and am.role      = 'owner'
  ) then
    return true;
  end if;

  -- agency member of parent agency: viewer-only.
  if v_agency_id is not null
     and (p_roles is null or 'viewer' = any(p_roles))
     and exists (
       select 1 from public.agency_members am
       where am.agency_id = v_agency_id
         and am.user_id   = v_uid
         and am.role      = 'member'
     ) then
    return true;
  end if;

  return false;
end;
$$;

comment on function public.has_space_access(uuid, text[]) is
  'RLS helper. True when the calling user can access the given space at one '
  'of p_roles. Authority cascade: explicit space member > tenant owner '
  '(full) > tenant member (editor/viewer) > agency owner (full) > agency '
  'member (viewer-only) > platform admin (read). Writes against a suspended '
  'tenant always return false. Replaces 20260428033206 in place.';
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: completes without error.

- [ ] **Step 3: Verify suspension short-circuit**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
insert into auth.users (id, email)
  values ('55555555-5555-5555-5555-555555555555', 'tenantowner@x.com');
insert into public.tenants (id, name, slug)
  values ('66666666-6666-6666-6666-666666666666', 'TestT', 'testt');
insert into public.tenant_members (tenant_id, user_id, role)
  values ('66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555', 'owner');
insert into public.spaces (id, tenant_id, name, created_by)
  values ('77777777-7777-7777-7777-777777777777', '66666666-6666-6666-6666-666666666666', 'Default', '55555555-5555-5555-5555-555555555555');

set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
-- non-suspended: write check passes
select public.has_space_access('77777777-7777-7777-7777-777777777777', array['owner','editor']);
-- expected: t

-- now suspend
update public.tenants set suspended_at = now() where id = '66666666-6666-6666-6666-666666666666';

-- write check fails
select public.has_space_access('77777777-7777-7777-7777-777777777777', array['owner','editor']);
-- expected: f

-- read check still passes
select public.has_space_access('77777777-7777-7777-7777-777777777777', null);
-- expected: t
rollback;
SQL
```
Expected: `t`, `f`, `t` in that order.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260428040700_whitelabel_update_has_space_access.sql
git commit -m "whitelabel(db): extend has_space_access with agency, platform admin, suspension"
```

---

### Task 9: RLS policies for `agencies`

**Files:**
- Create: `supabase/migrations/20260428040800_whitelabel_rls_agencies.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428040800_whitelabel_rls_agencies
-- purpose: rls for the agencies table.
--   select: any agency member, or platform admin.
--   update: agency owners only, or platform admin.
--   insert: denied directly; provisioning goes through provision_agency
--   rpc (security definer, platform admin only).
--   delete: denied for everyone except platform admin (and even they should
--   prefer suspension over deletion to keep retired_hostnames trail clean).

create policy "agency members can read their agency"
on public.agencies for select to authenticated
using ( public.is_agency_member(id) or public.is_platform_admin() );

create policy "agency owners can update their agency"
on public.agencies for update to authenticated
using       ( public.is_agency_member(id, array['owner']) or public.is_platform_admin() )
with check  ( public.is_agency_member(id, array['owner']) or public.is_platform_admin() );

create policy "platform admins can delete agencies"
on public.agencies for delete to authenticated
using ( public.is_platform_admin() );

-- no insert policy: forces all callers through provision_agency()
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: completes without error.

- [ ] **Step 3: Verify direct INSERT is rejected**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
insert into auth.users (id, email) values ('88888888-8888-8888-8888-888888888888', 'rogue@x.com');
set local role authenticated;
set local request.jwt.claim.sub = '88888888-8888-8888-8888-888888888888';
insert into public.agencies (name, slug, subdomain, app_display_name, contact_email)
  values ('Sneaky', 'sneaky', 'sneaky', 'Sneaky', 'x@y.com');
-- expected: ERROR new row violates row-level security policy for table "agencies"
rollback;
SQL
```
Expected: `ERROR ... row-level security policy`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260428040800_whitelabel_rls_agencies.sql
git commit -m "whitelabel(db): rls policies for agencies"
```

---

### Task 10: RLS policies for `agency_members`

**Files:**
- Create: `supabase/migrations/20260428040900_whitelabel_rls_agency_members.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428040900_whitelabel_rls_agency_members
-- purpose: rls for agency_members.
--   select: fellow members of the same agency, or platform admin.
--   insert/update/delete: agency owners (of that agency), or platform admin.

create policy "agency members can read fellow members"
on public.agency_members for select to authenticated
using ( public.is_agency_member(agency_id) or public.is_platform_admin() );

create policy "agency owners can add members"
on public.agency_members for insert to authenticated
with check ( public.is_agency_member(agency_id, array['owner']) or public.is_platform_admin() );

create policy "agency owners can update members"
on public.agency_members for update to authenticated
using      ( public.is_agency_member(agency_id, array['owner']) or public.is_platform_admin() )
with check ( public.is_agency_member(agency_id, array['owner']) or public.is_platform_admin() );

create policy "agency owners can remove members"
on public.agency_members for delete to authenticated
using ( public.is_agency_member(agency_id, array['owner']) or public.is_platform_admin() );
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: completes without error.

- [ ] **Step 3: Verify**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
  select polname, polcmd from pg_policy
  where polrelid = 'public.agency_members'::regclass
  order by polname;
"
```
Expected: 4 rows (one per command).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260428040900_whitelabel_rls_agency_members.sql
git commit -m "whitelabel(db): rls policies for agency_members"
```

---

### Task 11: RLS policies for `retired_hostnames`

**Files:**
- Create: `supabase/migrations/20260428041000_whitelabel_rls_retired_hostnames.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428041000_whitelabel_rls_retired_hostnames
-- purpose: rls for retired_hostnames. only platform admins can read; nobody
--   can insert/update/delete via the api (writes happen via the retirement
--   triggers, which run security definer).

create policy "platform admins can read retired hostnames"
on public.retired_hostnames for select to authenticated
using ( public.is_platform_admin() );

-- no insert/update/delete policies; trigger writes via security definer bypass rls.
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: completes without error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260428041000_whitelabel_rls_retired_hostnames.sql
git commit -m "whitelabel(db): rls policies for retired_hostnames"
```

---

### Task 12: Extend `tenants` RLS policies (agency owner/member, platform admin, deny direct INSERT)

**Files:**
- Create: `supabase/migrations/20260428041100_whitelabel_rls_tenants_extend.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428041100_whitelabel_rls_tenants_extend
-- purpose: replace the existing tenants policies with versions that grant:
--   select: any tenant member, agency member of parent agency, platform admin.
--   update: tenant owner, agency owner of parent agency, platform admin.
--   insert: denied directly. provisioning goes through provision_tenant rpc.
--   delete: platform admin only.
-- the previous "authenticated users can create tenants" policy was already
--   dropped in 20260428021559; this just makes sure no equivalent insert policy
--   exists anymore.

drop policy if exists "tenant members can view their tenants" on public.tenants;
drop policy if exists "tenant owners can update their tenants" on public.tenants;
drop policy if exists "tenant owners can delete their tenants" on public.tenants;
drop policy if exists "authenticated users can create tenants" on public.tenants;

create policy "tenant or agency or platform reads"
on public.tenants for select to authenticated
using (
  public.is_tenant_member(id)
  or (agency_id is not null and public.is_agency_member(agency_id))
  or public.is_platform_admin()
);

create policy "tenant owner or agency owner or platform writes"
on public.tenants for update to authenticated
using (
  public.is_tenant_member(id, array['owner'])
  or (agency_id is not null and public.is_agency_member(agency_id, array['owner']))
  or public.is_platform_admin()
)
with check (
  public.is_tenant_member(id, array['owner'])
  or (agency_id is not null and public.is_agency_member(agency_id, array['owner']))
  or public.is_platform_admin()
);

create policy "platform admins can delete tenants"
on public.tenants for delete to authenticated
using ( public.is_platform_admin() );

-- explicit: no insert policy. clients must call provision_tenant().
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: completes without error.

- [ ] **Step 3: Verify direct INSERT is rejected**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
insert into auth.users (id, email) values ('99999999-9999-9999-9999-999999999999', 'rogue@x.com');
set local role authenticated;
set local request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
insert into public.tenants (name, slug) values ('Sneaky', 'sneaky-tenant');
-- expected: ERROR row-level security policy
rollback;
SQL
```
Expected: error.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260428041100_whitelabel_rls_tenants_extend.sql
git commit -m "whitelabel(db): extend tenants rls for agency + platform admin; deny direct insert"
```

---

### Task 13: `get_brand_by_host()` RPC

**Files:**
- Create: `supabase/migrations/20260428041200_whitelabel_rpc_get_brand_by_host.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428041200_whitelabel_rpc_get_brand_by_host
-- purpose: pre-auth host resolver. takes an http host header value, looks
--   it up against tenants.custom_domain, agencies.custom_domain,
--   tenants.subdomain, agencies.subdomain (in that priority order), and
--   returns a small public-safe brand record. callable by anon and
--   authenticated. NEVER returns email_domain_allowlist (only a boolean
--   has_self_join), never returns suspended_at timestamps, never returns
--   internal ids that aren't already implicit in the public host.

create or replace function public.get_brand_by_host(p_host text)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_kind     text;
  v_id       uuid;
  v_name     text;
  v_logo     text;
  v_favicon  text;
  v_primary  text;
  v_accent   text;
  v_self_join boolean := false;
  v_suspended boolean := false;
begin
  if p_host is null or length(trim(p_host)) = 0 then
    return jsonb_build_object('kind', 'default');
  end if;

  -- 1. tenants.custom_domain
  select 'tenant', t.id, coalesce(t.app_display_name, t.name), t.logo_url, t.favicon_url,
         t.primary_color, t.accent_color,
         (t.email_self_join_enabled and t.email_domain_allowlist is not null and array_length(t.email_domain_allowlist, 1) > 0),
         (t.suspended_at is not null)
    into v_kind, v_id, v_name, v_logo, v_favicon, v_primary, v_accent, v_self_join, v_suspended
    from public.tenants t
   where t.custom_domain = p_host
   limit 1;

  if v_kind is null then
    -- 2. agencies.custom_domain
    select 'agency', a.id, a.app_display_name, a.logo_url, a.favicon_url,
           a.primary_color, a.accent_color,
           false, false
      into v_kind, v_id, v_name, v_logo, v_favicon, v_primary, v_accent, v_self_join, v_suspended
      from public.agencies a
     where a.custom_domain = p_host
     limit 1;
  end if;

  if v_kind is null then
    -- 3. tenants.subdomain (host is something like "pfizer.yourproduct.com")
    select 'tenant', t.id, coalesce(t.app_display_name, t.name), t.logo_url, t.favicon_url,
           t.primary_color, t.accent_color,
           (t.email_self_join_enabled and t.email_domain_allowlist is not null and array_length(t.email_domain_allowlist, 1) > 0),
           (t.suspended_at is not null)
      into v_kind, v_id, v_name, v_logo, v_favicon, v_primary, v_accent, v_self_join, v_suspended
      from public.tenants t
     where t.subdomain is not null
       and split_part(p_host, '.', 1) = t.subdomain
     limit 1;
  end if;

  if v_kind is null then
    -- 4. agencies.subdomain
    select 'agency', a.id, a.app_display_name, a.logo_url, a.favicon_url,
           a.primary_color, a.accent_color,
           false, false
      into v_kind, v_id, v_name, v_logo, v_favicon, v_primary, v_accent, v_self_join, v_suspended
      from public.agencies a
     where split_part(p_host, '.', 1) = a.subdomain
     limit 1;
  end if;

  if v_kind is null then
    return jsonb_build_object('kind', 'default');
  end if;

  return jsonb_build_object(
    'kind',              v_kind,
    'id',                v_id,
    'app_display_name',  v_name,
    'logo_url',          v_logo,
    'favicon_url',       v_favicon,
    'primary_color',     v_primary,
    'accent_color',      v_accent,
    'auth_providers',    jsonb_build_array('google', 'microsoft'),
    'has_self_join',     v_self_join,
    'suspended',         v_suspended
  );
end;
$$;

comment on function public.get_brand_by_host(text) is
  'Pre-auth host resolver. Returns brand for the host, or kind=default if '
  'unknown. Anon-callable by design but redacts sensitive fields: '
  'email_domain_allowlist contents are NEVER returned (only a has_self_join '
  'boolean signal).';

revoke execute on function public.get_brand_by_host(text) from public;
grant  execute on function public.get_brand_by_host(text) to anon, authenticated;
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: completes without error.

- [ ] **Step 3: Verify default fallback and tenant lookup**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
insert into public.tenants (id, name, slug, subdomain, primary_color, app_display_name)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Pfizer', 'pfizer', 'pfizer', '#0033a0', 'Pfizer Trial Intel');

select public.get_brand_by_host('pfizer.yourproduct.com');
-- expected: kind=tenant, app_display_name=Pfizer Trial Intel, primary_color=#0033a0, has_self_join=false

select public.get_brand_by_host('unknown.yourproduct.com');
-- expected: { "kind": "default" }

-- verify allowlist is NOT exposed
update public.tenants
   set email_self_join_enabled = true,
       email_domain_allowlist  = array['pfizer.com']
 where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select public.get_brand_by_host('pfizer.yourproduct.com');
-- expected: has_self_join=true; jsonb result must NOT contain the string "pfizer.com"
rollback;
SQL
```
Expected: third query returns has_self_join=true and the jsonb result text does **not** include `pfizer.com`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260428041200_whitelabel_rpc_get_brand_by_host.sql
git commit -m "whitelabel(db): get_brand_by_host rpc (anon, allowlist-redacted)"
```

---

### Task 14: `check_subdomain_available()` RPC

**Files:**
- Create: `supabase/migrations/20260428041300_whitelabel_rpc_check_subdomain_available.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428041300_whitelabel_rpc_check_subdomain_available
-- purpose: live availability check used by the agency portal's tenant-
--   provisioning wizard. checks: dns-safe regex, reserved list, in-use in
--   either tenants or agencies, currently in retired_hostnames holdback.
-- callable by authenticated only -- anon shouldn't be probing for
-- available subdomains.

create or replace function public.check_subdomain_available(p_subdomain text)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  reserved text[] := array[
    'www','app','api','admin','auth','mail','support','status','docs','blog',
    'help','cdn','static','assets','noreply','email','smtp'
  ];
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;

  if p_subdomain is null or p_subdomain !~ '^[a-z][a-z0-9-]{1,62}$' then
    return false;
  end if;
  if p_subdomain = any(reserved) then
    return false;
  end if;
  if exists (select 1 from public.tenants  where subdomain = p_subdomain) then return false; end if;
  if exists (select 1 from public.agencies where subdomain = p_subdomain) then return false; end if;
  if exists (
    select 1 from public.retired_hostnames
    where hostname = p_subdomain and released_at > now()
  ) then
    return false;
  end if;
  return true;
end;
$$;

comment on function public.check_subdomain_available(text) is
  'Returns true if p_subdomain matches the DNS regex, is not on the reserved '
  'list, is not in use by any tenant or agency, and is not currently in the '
  'retired_hostnames holdback. Used by the agency portal provisioning wizard.';

revoke execute on function public.check_subdomain_available(text) from public;
revoke execute on function public.check_subdomain_available(text) from anon;
grant  execute on function public.check_subdomain_available(text) to authenticated;
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: completes without error.

- [ ] **Step 3: Verify**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
insert into auth.users (id, email) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'u@x.com');
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select public.check_subdomain_available('newsubdomain'); -- expected: t
select public.check_subdomain_available('admin');        -- expected: f (reserved)
select public.check_subdomain_available('Bad-Caps');     -- expected: f (regex)
select public.check_subdomain_available('a');            -- expected: f (too short)
rollback;
SQL
```
Expected: t, f, f, f.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260428041300_whitelabel_rpc_check_subdomain_available.sql
git commit -m "whitelabel(db): check_subdomain_available rpc"
```

---

### Task 15: `provision_agency()` RPC

**Files:**
- Create: `supabase/migrations/20260428041400_whitelabel_rpc_provision_agency.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428041400_whitelabel_rpc_provision_agency
-- purpose: platform-admin-only rpc that creates a new agency record and
--   adds the specified user as the agency's first owner. callable from
--   psql during the bootstrap window (phase 6 of the rollout) before
--   the super-admin ui exists (phase 9).

create or replace function public.provision_agency(
  p_name           text,
  p_slug           text,
  p_subdomain      text,
  p_owner_user_id  uuid,
  p_contact_email  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency_id uuid;
  v_result    jsonb;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if not public.is_platform_admin() then
    raise exception 'Platform admin only' using errcode = '42501';
  end if;

  if not public.check_subdomain_available(p_subdomain) then
    raise exception 'Subdomain "%" is not available', p_subdomain
      using errcode = '23505';
  end if;
  if p_slug is null or p_slug !~ '^[a-z][a-z0-9-]{1,99}$' then
    raise exception 'Invalid slug' using errcode = 'P0001';
  end if;

  insert into public.agencies (name, slug, subdomain, app_display_name, contact_email)
    values (p_name, p_slug, p_subdomain, p_name, coalesce(p_contact_email, 'unknown@unknown.invalid'))
    returning id into v_agency_id;

  insert into public.agency_members (agency_id, user_id, role)
    values (v_agency_id, p_owner_user_id, 'owner');

  select jsonb_build_object(
    'id', a.id, 'name', a.name, 'slug', a.slug, 'subdomain', a.subdomain,
    'app_display_name', a.app_display_name, 'created_at', a.created_at
  ) into v_result
    from public.agencies a where a.id = v_agency_id;

  return v_result;
end;
$$;

comment on function public.provision_agency(text, text, text, uuid, text) is
  'Platform-admin-only RPC. Creates an agency and adds p_owner_user_id as '
  'the first owner. SECURITY DEFINER bypasses RLS for atomic creation.';

revoke execute on function public.provision_agency(text, text, text, uuid, text) from public, anon;
grant  execute on function public.provision_agency(text, text, text, uuid, text) to authenticated;
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: completes without error.

- [ ] **Step 3: Verify**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
insert into auth.users (id, email) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'admin@x.com'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'owner@x.com');
insert into public.platform_admins (user_id) values ('cccccccc-cccc-cccc-cccc-cccccccccccc');

set local request.jwt.claim.sub = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
select public.provision_agency('ZS Associates', 'zs', 'zs', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'a@b.com');
-- expected: jsonb with id, name, slug, subdomain

select count(*) from public.agency_members where user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' and role = 'owner';
-- expected: 1

-- non-admin attempt:
set local request.jwt.claim.sub = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
select public.provision_agency('Sneaky', 'sneaky', 'sneaky', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'a@b.com');
-- expected: ERROR Platform admin only
rollback;
SQL
```
Expected: first call succeeds, member count = 1, second call errors `42501`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260428041400_whitelabel_rpc_provision_agency.sql
git commit -m "whitelabel(db): provision_agency rpc (platform admin only)"
```

---

### Task 16: `provision_tenant()` RPC

**Files:**
- Create: `supabase/migrations/20260428041500_whitelabel_rpc_provision_tenant.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428041500_whitelabel_rpc_provision_tenant
-- purpose: agency-owner-or-platform-admin rpc that creates a new tenant
--   under an agency, applies branding, and creates one default space named
--   "Workspace" so the tenant has somewhere to land on first login. enforces
--   max_tenants quota.
-- p_brand jsonb may include any of:
--   app_display_name, logo_url, favicon_url, primary_color, accent_color,
--   email_from_name. unknown keys are ignored.

create or replace function public.provision_tenant(
  p_agency_id  uuid,
  p_name       text,
  p_subdomain  text,
  p_brand      jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid          uuid := auth.uid();
  v_max_tenants  int;
  v_owned_count  int;
  v_tenant_id    uuid;
  v_space_id     uuid;
  v_slug         text;
  v_result       jsonb;
begin
  if v_uid is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if not (public.is_agency_member(p_agency_id, array['owner']) or public.is_platform_admin()) then
    raise exception 'Must be agency owner or platform admin' using errcode = '42501';
  end if;

  -- quota
  select max_tenants into v_max_tenants from public.agencies where id = p_agency_id;
  if v_max_tenants is null then
    raise exception 'Agency not found' using errcode = 'P0002';
  end if;
  if v_max_tenants > 0 then
    select count(*) into v_owned_count from public.tenants where agency_id = p_agency_id;
    if v_owned_count >= v_max_tenants then
      raise exception 'Agency tenant limit reached (%)' using errcode = '53400', message_arg = v_max_tenants;
    end if;
  end if;

  if not public.check_subdomain_available(p_subdomain) then
    raise exception 'Subdomain "%" is not available', p_subdomain using errcode = '23505';
  end if;

  -- derive slug from subdomain (already DNS-safe and unique check will be on tenants.slug)
  v_slug := p_subdomain;

  insert into public.tenants (
    name, slug, agency_id, subdomain,
    app_display_name, logo_url, favicon_url,
    primary_color, accent_color, email_from_name
  ) values (
    p_name, v_slug, p_agency_id, p_subdomain,
    coalesce(p_brand ->> 'app_display_name', p_name),
    p_brand ->> 'logo_url',
    p_brand ->> 'favicon_url',
    coalesce(p_brand ->> 'primary_color', '#0d9488'),
    p_brand ->> 'accent_color',
    coalesce(p_brand ->> 'email_from_name', p_brand ->> 'app_display_name', p_name)
  )
  returning id into v_tenant_id;

  -- default space
  insert into public.spaces (tenant_id, name, created_by)
    values (v_tenant_id, 'Workspace', v_uid)
    returning id into v_space_id;

  select jsonb_build_object(
    'id', t.id, 'name', t.name, 'subdomain', t.subdomain,
    'agency_id', t.agency_id, 'default_space_id', v_space_id
  ) into v_result
    from public.tenants t where t.id = v_tenant_id;

  return v_result;
end;
$$;

comment on function public.provision_tenant(uuid, text, text, jsonb) is
  'Creates a tenant under an agency (or directly when called by platform '
  'admin), applies branding, and creates one default space. Agency owners '
  'inherit access via has_space_access disjuncts -- no explicit '
  'tenant_members row is needed for them.';

revoke execute on function public.provision_tenant(uuid, text, text, jsonb) from public, anon;
grant  execute on function public.provision_tenant(uuid, text, text, jsonb) to authenticated;
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: completes without error.

- [ ] **Step 3: Verify**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
insert into auth.users (id, email) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'agent@x.com');
insert into public.platform_admins (user_id) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');

set local request.jwt.claim.sub = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
select public.provision_agency('ZS', 'zs', 'zs', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'a@b.com') ->> 'id' as zs_id \gset
select public.provision_tenant(:'zs_id'::uuid, 'Pfizer', 'pfizer', '{"primary_color":"#0033a0"}'::jsonb);
-- expected: jsonb with id, name=Pfizer, subdomain=pfizer

select count(*) from public.spaces s join public.tenants t on t.id = s.tenant_id where t.subdomain = 'pfizer';
-- expected: 1
rollback;
SQL
```
Expected: provision succeeds; default space exists.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260428041500_whitelabel_rpc_provision_tenant.sql
git commit -m "whitelabel(db): provision_tenant rpc (agency owner or platform admin)"
```

---

### Task 17: `update_tenant_branding()` RPC

**Files:**
- Create: `supabase/migrations/20260428041600_whitelabel_rpc_update_tenant_branding.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428041600_whitelabel_rpc_update_tenant_branding
-- purpose: tenant-owner-or-agency-owner-or-platform-admin rpc to update
--   only branding fields. domain settings (subdomain, custom_domain),
--   access settings (allowlist, self_join), and admin-only fields
--   (agency_id, suspended_at) are explicitly excluded.

create or replace function public.update_tenant_branding(
  p_tenant_id uuid,
  p_branding  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency_id uuid;
  v_color_re  text := '^#[0-9a-fA-F]{6}$';
  v_brand_keys text[] := array[
    'app_display_name','logo_url','favicon_url','primary_color',
    'accent_color','email_from_name'
  ];
  k text;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;

  -- reject unknown keys (defensive against drift between client and rpc)
  for k in select jsonb_object_keys(p_branding) loop
    if not (k = any(v_brand_keys)) then
      raise exception 'Unknown branding field: %', k using errcode = 'P0001';
    end if;
  end loop;

  select agency_id into v_agency_id from public.tenants where id = p_tenant_id;
  if not (
    public.is_tenant_member(p_tenant_id, array['owner'])
    or (v_agency_id is not null and public.is_agency_member(v_agency_id, array['owner']))
    or public.is_platform_admin()
  ) then
    raise exception 'Insufficient permissions' using errcode = '42501';
  end if;

  -- color validation (when provided)
  if p_branding ? 'primary_color' and (p_branding ->> 'primary_color') !~ v_color_re then
    raise exception 'primary_color must be #rrggbb' using errcode = 'P0001';
  end if;
  if p_branding ? 'accent_color' and (p_branding ->> 'accent_color') is not null
     and (p_branding ->> 'accent_color') !~ v_color_re then
    raise exception 'accent_color must be #rrggbb' using errcode = 'P0001';
  end if;

  update public.tenants
     set app_display_name = coalesce(p_branding ->> 'app_display_name', app_display_name),
         logo_url         = coalesce(p_branding ->> 'logo_url',         logo_url),
         favicon_url      = coalesce(p_branding ->> 'favicon_url',      favicon_url),
         primary_color    = coalesce(p_branding ->> 'primary_color',    primary_color),
         accent_color     = coalesce(p_branding ->> 'accent_color',     accent_color),
         email_from_name  = coalesce(p_branding ->> 'email_from_name',  email_from_name),
         updated_at       = now()
   where id = p_tenant_id;

  return jsonb_build_object('id', p_tenant_id, 'updated', true);
end;
$$;

comment on function public.update_tenant_branding(uuid, jsonb) is
  'Updates branding fields on a tenant. Whitelist of allowed keys; rejects '
  'unknown keys with P0001. Sensitive fields (subdomain, custom_domain, '
  'agency_id, suspended_at) are not editable here.';

revoke execute on function public.update_tenant_branding(uuid, jsonb) from public, anon;
grant  execute on function public.update_tenant_branding(uuid, jsonb) to authenticated;
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: success.

- [ ] **Step 3: Verify whitelist enforcement**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
insert into auth.users (id, email) values ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'admin@x.com');
insert into public.platform_admins (user_id) values ('ffffffff-ffff-ffff-ffff-ffffffffffff');
insert into public.tenants (id, name, slug) values ('11110000-0000-0000-0000-000000000000', 'T', 't');

set local request.jwt.claim.sub = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
-- valid: passes
select public.update_tenant_branding('11110000-0000-0000-0000-000000000000', '{"primary_color":"#ff0000"}'::jsonb);
-- forbidden field: errors P0001
select public.update_tenant_branding('11110000-0000-0000-0000-000000000000', '{"subdomain":"hijack"}'::jsonb);
-- bad color: errors P0001
select public.update_tenant_branding('11110000-0000-0000-0000-000000000000', '{"primary_color":"red"}'::jsonb);
rollback;
SQL
```
Expected: first succeeds; second and third error.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260428041600_whitelabel_rpc_update_tenant_branding.sql
git commit -m "whitelabel(db): update_tenant_branding rpc (whitelist of fields)"
```

---

### Task 18: `update_tenant_access()` RPC

**Files:**
- Create: `supabase/migrations/20260428041700_whitelabel_rpc_update_tenant_access.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428041700_whitelabel_rpc_update_tenant_access
-- purpose: separate from update_tenant_branding so access changes are auditable
--   independently. only tenant owner / agency owner / platform admin.
-- accepts jsonb with: email_domain_allowlist (text[]), email_self_join_enabled (bool).

create or replace function public.update_tenant_access(
  p_tenant_id uuid,
  p_settings  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency_id  uuid;
  v_allowlist  text[];
  v_domain_re  text := '^[a-z0-9.-]+\.[a-z]{2,}$';
  d text;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  select agency_id into v_agency_id from public.tenants where id = p_tenant_id;
  if not (
    public.is_tenant_member(p_tenant_id, array['owner'])
    or (v_agency_id is not null and public.is_agency_member(v_agency_id, array['owner']))
    or public.is_platform_admin()
  ) then
    raise exception 'Insufficient permissions' using errcode = '42501';
  end if;

  if p_settings ? 'email_domain_allowlist' then
    v_allowlist := coalesce(
      array(select jsonb_array_elements_text(p_settings -> 'email_domain_allowlist')),
      '{}'::text[]
    );
    foreach d in array v_allowlist loop
      if d !~ v_domain_re then
        raise exception 'Invalid domain in allowlist: %', d using errcode = 'P0001';
      end if;
    end loop;
  end if;

  update public.tenants
     set email_domain_allowlist  = coalesce(v_allowlist, email_domain_allowlist),
         email_self_join_enabled = coalesce((p_settings ->> 'email_self_join_enabled')::boolean, email_self_join_enabled),
         updated_at              = now()
   where id = p_tenant_id;

  return jsonb_build_object('id', p_tenant_id, 'updated', true);
end;
$$;

comment on function public.update_tenant_access(uuid, jsonb) is
  'Updates email_domain_allowlist and email_self_join_enabled. Validates '
  'each domain matches the simple domain regex. Separate from branding '
  'so access changes are auditable independently.';

revoke execute on function public.update_tenant_access(uuid, jsonb) from public, anon;
grant  execute on function public.update_tenant_access(uuid, jsonb) to authenticated;
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: success.

- [ ] **Step 3: Verify**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
insert into auth.users (id, email) values ('11111111-2222-3333-4444-555555555555', 'a@x.com');
insert into public.platform_admins (user_id) values ('11111111-2222-3333-4444-555555555555');
insert into public.tenants (id, name, slug) values ('22220000-0000-0000-0000-000000000000', 'T', 't2');

set local request.jwt.claim.sub = '11111111-2222-3333-4444-555555555555';
select public.update_tenant_access(
  '22220000-0000-0000-0000-000000000000',
  '{"email_domain_allowlist":["pfizer.com"],"email_self_join_enabled":true}'::jsonb
);
-- expected: success, updated=true
select email_domain_allowlist, email_self_join_enabled from public.tenants where id = '22220000-0000-0000-0000-000000000000';
-- expected: {pfizer.com}, t

-- bad domain
select public.update_tenant_access(
  '22220000-0000-0000-0000-000000000000',
  '{"email_domain_allowlist":["not-a-domain"]}'::jsonb
);
-- expected: ERROR Invalid domain
rollback;
SQL
```
Expected: first succeeds; second errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260428041700_whitelabel_rpc_update_tenant_access.sql
git commit -m "whitelabel(db): update_tenant_access rpc (allowlist + self_join)"
```

---

### Task 19: `get_tenant_access_settings()` RPC

**Files:**
- Create: `supabase/migrations/20260428041800_whitelabel_rpc_get_tenant_access_settings.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428041800_whitelabel_rpc_get_tenant_access_settings
-- purpose: authenticated read of allowlist + self_join settings for a tenant.
--   used by tenant-settings ui to show current values. distinct from
--   get_brand_by_host because that one is anon-callable and intentionally
--   hides allowlist contents.

create or replace function public.get_tenant_access_settings(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_agency_id uuid;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  select agency_id into v_agency_id from public.tenants where id = p_tenant_id;
  if not (
    public.is_tenant_member(p_tenant_id, array['owner'])
    or (v_agency_id is not null and public.is_agency_member(v_agency_id, array['owner']))
    or public.is_platform_admin()
  ) then
    raise exception 'Insufficient permissions' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'email_domain_allowlist',  coalesce(t.email_domain_allowlist, array[]::text[]),
    'email_self_join_enabled', t.email_self_join_enabled
  ) into v_result
    from public.tenants t where t.id = p_tenant_id;
  return v_result;
end;
$$;

comment on function public.get_tenant_access_settings(uuid) is
  'Returns allowlist and self_join settings for tenant settings UI. Gated '
  'to tenant owner / agency owner / platform admin.';

revoke execute on function public.get_tenant_access_settings(uuid) from public, anon;
grant  execute on function public.get_tenant_access_settings(uuid) to authenticated;
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260428041800_whitelabel_rpc_get_tenant_access_settings.sql
git commit -m "whitelabel(db): get_tenant_access_settings rpc (auth read of allowlist)"
```

---

### Task 20: `update_agency_branding()` RPC

**Files:**
- Create: `supabase/migrations/20260428041900_whitelabel_rpc_update_agency_branding.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428041900_whitelabel_rpc_update_agency_branding
-- purpose: agency-owner-or-platform-admin updates to agency branding.
--   subdomain / custom_domain / plan_tier / max_tenants are NOT editable
--   here (sensitive admin fields).

create or replace function public.update_agency_branding(
  p_agency_id uuid,
  p_branding  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_color_re  text := '^#[0-9a-fA-F]{6}$';
  v_brand_keys text[] := array[
    'app_display_name','logo_url','favicon_url','primary_color',
    'accent_color','contact_email'
  ];
  k text;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if not (public.is_agency_member(p_agency_id, array['owner']) or public.is_platform_admin()) then
    raise exception 'Insufficient permissions' using errcode = '42501';
  end if;
  for k in select jsonb_object_keys(p_branding) loop
    if not (k = any(v_brand_keys)) then
      raise exception 'Unknown branding field: %', k using errcode = 'P0001';
    end if;
  end loop;
  if p_branding ? 'primary_color' and (p_branding ->> 'primary_color') !~ v_color_re then
    raise exception 'primary_color must be #rrggbb' using errcode = 'P0001';
  end if;
  if p_branding ? 'accent_color' and (p_branding ->> 'accent_color') is not null
     and (p_branding ->> 'accent_color') !~ v_color_re then
    raise exception 'accent_color must be #rrggbb' using errcode = 'P0001';
  end if;

  update public.agencies
     set app_display_name = coalesce(p_branding ->> 'app_display_name', app_display_name),
         logo_url         = coalesce(p_branding ->> 'logo_url',         logo_url),
         favicon_url      = coalesce(p_branding ->> 'favicon_url',      favicon_url),
         primary_color    = coalesce(p_branding ->> 'primary_color',    primary_color),
         accent_color     = coalesce(p_branding ->> 'accent_color',     accent_color),
         contact_email    = coalesce(p_branding ->> 'contact_email',    contact_email),
         updated_at       = now()
   where id = p_agency_id;

  return jsonb_build_object('id', p_agency_id, 'updated', true);
end;
$$;

comment on function public.update_agency_branding(uuid, jsonb) is
  'Updates branding fields on an agency. Whitelist of allowed keys.';

revoke execute on function public.update_agency_branding(uuid, jsonb) from public, anon;
grant  execute on function public.update_agency_branding(uuid, jsonb) to authenticated;
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260428041900_whitelabel_rpc_update_agency_branding.sql
git commit -m "whitelabel(db): update_agency_branding rpc"
```

---

### Task 21: `register_custom_domain()` RPC

**Files:**
- Create: `supabase/migrations/20260428042000_whitelabel_rpc_register_custom_domain.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428042000_whitelabel_rpc_register_custom_domain
-- purpose: platform-admin sets tenants.custom_domain after netlify domain
--   alias is configured. validates basic domain shape and that the domain
--   is not in use anywhere (cross-table) and not in the retired holdback.

create or replace function public.register_custom_domain(
  p_tenant_id     uuid,
  p_custom_domain text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain_re text := '^[a-z0-9.-]+\.[a-z]{2,}$';
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if not public.is_platform_admin() then
    raise exception 'Platform admin only' using errcode = '42501';
  end if;
  if p_custom_domain is null or p_custom_domain !~ v_domain_re then
    raise exception 'Invalid domain' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.tenants  where custom_domain = p_custom_domain) then
    raise exception 'Domain already in use' using errcode = '23505';
  end if;
  if exists (select 1 from public.agencies where custom_domain = p_custom_domain) then
    raise exception 'Domain already in use' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.retired_hostnames
     where hostname = p_custom_domain and released_at > now()
  ) then
    raise exception 'Domain is in retirement holdback' using errcode = 'P0001';
  end if;

  update public.tenants
     set custom_domain = p_custom_domain, updated_at = now()
   where id = p_tenant_id;

  return jsonb_build_object('id', p_tenant_id, 'custom_domain', p_custom_domain);
end;
$$;

comment on function public.register_custom_domain(uuid, text) is
  'Sets tenants.custom_domain. Platform admin only -- the corresponding '
  'Netlify domain alias and TLS cert are configured manually before '
  'calling this. Validates uniqueness across both tenants and agencies '
  'and checks the retired_hostnames holdback.';

revoke execute on function public.register_custom_domain(uuid, text) from public, anon;
grant  execute on function public.register_custom_domain(uuid, text) to authenticated;
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260428042000_whitelabel_rpc_register_custom_domain.sql
git commit -m "whitelabel(db): register_custom_domain rpc (platform admin only)"
```

---

### Task 22: `self_join_tenant()` RPC (generic-error variant)

**Files:**
- Create: `supabase/migrations/20260428042100_whitelabel_rpc_self_join_tenant.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428042100_whitelabel_rpc_self_join_tenant
-- purpose: domain-allowlist self-join. user lands on a tenant subdomain,
--   authenticates via google/microsoft, and if their email's domain
--   matches the tenant's email_domain_allowlist and self_join is enabled,
--   they're added to tenant_members at viewer role.
-- security: returns the SAME generic error message for every failure
--   mode -- prevents enumeration of which subdomains exist and which
--   corporate email domains unlock them. logs the actual reason via
--   raise notice for support diagnostics.

create or replace function public.self_join_tenant(p_subdomain text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_email     text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email_dom text;
  v_tenant    record;
  v_allowed   boolean;
begin
  if v_uid is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if v_email = '' then
    raise notice 'self_join: missing email claim';
    raise exception 'self-join not available for this workspace' using errcode = 'P0001';
  end if;
  v_email_dom := split_part(v_email, '@', 2);

  select id, email_domain_allowlist, email_self_join_enabled, suspended_at, name
    into v_tenant
    from public.tenants
   where subdomain = p_subdomain
   limit 1;

  if not found then
    raise notice 'self_join: subdomain not found: %', p_subdomain;
    raise exception 'self-join not available for this workspace' using errcode = 'P0001';
  end if;
  if v_tenant.suspended_at is not null then
    raise notice 'self_join: tenant suspended (%)', v_tenant.id;
    raise exception 'self-join not available for this workspace' using errcode = 'P0001';
  end if;
  if not coalesce(v_tenant.email_self_join_enabled, false) then
    raise notice 'self_join: disabled (%)', v_tenant.id;
    raise exception 'self-join not available for this workspace' using errcode = 'P0001';
  end if;
  if v_tenant.email_domain_allowlist is null
     or array_length(v_tenant.email_domain_allowlist, 1) is null then
    raise notice 'self_join: empty allowlist (%)', v_tenant.id;
    raise exception 'self-join not available for this workspace' using errcode = 'P0001';
  end if;

  v_allowed := exists (
    select 1 from unnest(v_tenant.email_domain_allowlist) d
    where lower(d) = v_email_dom
  );
  if not v_allowed then
    raise notice 'self_join: email domain not in allowlist (%, %)', v_tenant.id, v_email_dom;
    raise exception 'self-join not available for this workspace' using errcode = 'P0001';
  end if;

  -- tenant_members.role is constrained to 'owner' | 'member'; 'member' is the
  -- least-privileged level (still gets implicit editor/viewer space access via
  -- has_space_access). per-space viewer-only restriction is a future feature
  -- (would require space_members rows instead of tenant_members).
  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant.id, v_uid, 'member')
    on conflict (tenant_id, user_id) do nothing;

  return jsonb_build_object('id', v_tenant.id, 'name', v_tenant.name, 'role', 'member');
end;
$$;

comment on function public.self_join_tenant(text) is
  'Domain-allowlist self-join. Returns the SAME generic error for every '
  'failure mode (missing tenant, disabled, suspended, allowlist mismatch) '
  'to prevent enumeration. Real reason is logged via raise notice for '
  'support diagnostics.';

revoke execute on function public.self_join_tenant(text) from public, anon;
grant  execute on function public.self_join_tenant(text) to authenticated;
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: success.

- [ ] **Step 3: Verify generic error**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
begin;
insert into auth.users (id, email) values ('aabbccdd-0000-0000-0000-000000000000', 'a@gmail.com');
insert into public.tenants (name, slug, subdomain, email_domain_allowlist, email_self_join_enabled)
  values ('T', 'tt', 'ttt', array['pfizer.com'], true);

set local request.jwt.claim.sub = 'aabbccdd-0000-0000-0000-000000000000';
set local request.jwt.claims to '{"sub":"aabbccdd-0000-0000-0000-000000000000","email":"a@gmail.com"}';

-- expected: ERROR self-join not available for this workspace
select public.self_join_tenant('ttt');

-- nonexistent: SAME error
select public.self_join_tenant('does-not-exist');
rollback;
SQL
```
Expected: both calls error with the same generic message.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260428042100_whitelabel_rpc_self_join_tenant.sql
git commit -m "whitelabel(db): self_join_tenant rpc with generic-error variant"
```

---

### Task 23: Backfill existing tenants

**Files:**
- Create: `supabase/migrations/20260428042200_whitelabel_backfill_existing_tenants.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428042200_whitelabel_backfill_existing_tenants
-- purpose: legacy tenants (created before whitelabel) have null subdomain,
--   null app_display_name, and the schema-default primary_color. give them
--   sensible defaults so they can opt into a subdomain via tenant settings
--   later without breaking get_brand_by_host or theme bootstrap.
-- subdomain := slug (slug is already DNS-safe per existing migrations).
-- app_display_name := name.
-- primary_color := '#0d9488' (already the column default; no-op for new
--   rows but explicit here for clarity).
-- skips tenants that already have a non-null subdomain.

update public.tenants
   set subdomain        = coalesce(subdomain, slug),
       app_display_name = coalesce(app_display_name, name),
       primary_color    = coalesce(primary_color, '#0d9488'),
       email_from_name  = coalesce(email_from_name, app_display_name, name)
 where subdomain is null
    or app_display_name is null
    or email_from_name is null;
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: success.

- [ ] **Step 3: Verify backfill**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
  select count(*) filter (where subdomain is null)        as null_subdomains,
         count(*) filter (where app_display_name is null) as null_display_names
  from public.tenants;
"
```
Expected: both counts are 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260428042200_whitelabel_backfill_existing_tenants.sql
git commit -m "whitelabel(db): backfill existing tenants with subdomain, app_display_name"
```

---

### Task 24: Cross-tenant isolation smoke test (self-test migration)

**Files:**
- Create: `supabase/migrations/20260428042300_whitelabel_isolation_smoke_tests.sql`

This migration runs assertions and raises if isolation is broken. It does **not** persist data — it's wrapped in a single transaction with explicit assertions. Functions used here are dropped at the end so they don't pollute the schema.

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260428042300_whitelabel_isolation_smoke_tests
-- purpose: assertion-style migration. creates two synthetic tenants under
--   the same agency, two synthetic users (one per tenant), and verifies
--   that user_a cannot read user_b's space data via has_space_access. also
--   verifies the agency-owner cross-tenant disjunct works. fails the
--   migration if any invariant is violated.
-- this migration is destructive of its own test data (deletes at the end).
--   idempotent: safe to re-run via supabase db reset.

do $$
declare
  v_agency_id uuid := '01010101-0101-0101-0101-010101010101';
  v_t_a uuid := '02020202-0202-0202-0202-020202020202';
  v_t_b uuid := '03030303-0303-0303-0303-030303030303';
  v_u_a uuid := '04040404-0404-0404-0404-040404040404';
  v_u_b uuid := '05050505-0505-0505-0505-050505050505';
  v_u_owner uuid := '06060606-0606-0606-0606-060606060606';
  v_s_a uuid;
  v_s_b uuid;
  v_pass boolean;
begin
  -- bootstrap (use SECURITY DEFINER privileges of this migration)
  insert into auth.users (id, email) values
    (v_u_a, 'usera@a.com'),
    (v_u_b, 'userb@b.com'),
    (v_u_owner, 'owner@agency.com');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'Test Ag', 'test-iso-ag', 'testisoag', 'Test', 'a@b.com');
  insert into public.agency_members (agency_id, user_id, role)
    values (v_agency_id, v_u_owner, 'owner');
  insert into public.tenants (id, name, slug, subdomain, agency_id) values
    (v_t_a, 'TenantA', 'iso-tenant-a', 'iso-tenant-a', v_agency_id),
    (v_t_b, 'TenantB', 'iso-tenant-b', 'iso-tenant-b', v_agency_id);
  insert into public.tenant_members (tenant_id, user_id, role) values
    (v_t_a, v_u_a, 'owner'),
    (v_t_b, v_u_b, 'owner');
  insert into public.spaces (tenant_id, name, created_by) values
    (v_t_a, 'A space', v_u_a),
    (v_t_b, 'B space', v_u_b)
    returning id into v_s_a;
  -- the second insert's id isn't captured by `returning into` for multi-row
  -- inserts, so re-fetch:
  select id into v_s_a from public.spaces where tenant_id = v_t_a limit 1;
  select id into v_s_b from public.spaces where tenant_id = v_t_b limit 1;

  -- 1. user_a should NOT have access to user_b's space
  perform set_config('request.jwt.claim.sub', v_u_a::text, true);
  v_pass := not public.has_space_access(v_s_b);
  if not v_pass then raise exception 'isolation FAIL: user_a sees user_b''s space'; end if;

  -- 2. user_a should have access to user_a's own space
  v_pass := public.has_space_access(v_s_a);
  if not v_pass then raise exception 'isolation FAIL: user_a denied own space'; end if;

  -- 3. agency owner should have access to BOTH
  perform set_config('request.jwt.claim.sub', v_u_owner::text, true);
  v_pass := public.has_space_access(v_s_a) and public.has_space_access(v_s_b);
  if not v_pass then raise exception 'isolation FAIL: agency owner denied cross-tenant'; end if;

  -- 4. suspending tenant A should block writes from owner; reads still ok
  perform set_config('request.jwt.claim.sub', v_u_a::text, true);
  update public.tenants set suspended_at = now() where id = v_t_a;
  v_pass := public.has_space_access(v_s_a) and not public.has_space_access(v_s_a, array['owner','editor']);
  if not v_pass then raise exception 'isolation FAIL: suspension not enforced for owner'; end if;
  update public.tenants set suspended_at = null where id = v_t_a;

  raise notice 'whitelabel isolation smoke tests: PASS';

  -- cleanup so this migration is idempotent
  delete from public.spaces where tenant_id in (v_t_a, v_t_b);
  delete from public.tenant_members where tenant_id in (v_t_a, v_t_b);
  delete from public.tenants where id in (v_t_a, v_t_b);
  delete from public.agency_members where agency_id = v_agency_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id in (v_u_a, v_u_b, v_u_owner);
end;
$$;
```

- [ ] **Step 2: Apply**

Run: `supabase db reset`
Expected: completes without error; in the output you see `NOTICE: whitelabel isolation smoke tests: PASS`.

- [ ] **Step 3: Verify cleanup**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
  select count(*) from public.tenants where slug like 'iso-%';
"
```
Expected: 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260428042300_whitelabel_isolation_smoke_tests.sql
git commit -m "whitelabel(db): isolation smoke-test migration (asserts and cleans up)"
```

---

## End-of-plan verification

After all 24 migrations apply cleanly, run a final smoke pass:

- [ ] **Step 1: Full reset and check existing app still works**

Run: `supabase db reset` (re-applies all migrations from scratch).
Then: `cd src/client && ng build` to confirm the client still type-checks against the schema.
Expected: both succeed.

- [ ] **Step 2: Push to staging**

Run: `supabase db push` (per existing project workflow).
Expected: migrations apply cleanly to remote.

- [ ] **Step 3: Final commit confirming the chunk is shipped**

If you batched commits, no action; otherwise nothing to commit. The merge of this branch is itself the milestone.

---

## What this plan does NOT do (deferred to later plans)

- No client-side code changes (theme refactor is plan 2; BrandContext + bootstrap is plan 3).
- No edge functions (branded emails are plan 7).
- No agency portal UI (plan 6).
- No super-admin UI (plan 9).
- No routing changes (plan 4).

When this plan ships, the existing app continues to work exactly as before — but every database building block whitelabel needs is in place.
