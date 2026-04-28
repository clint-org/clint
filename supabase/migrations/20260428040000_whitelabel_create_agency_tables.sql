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
  subdomain         varchar(63)  not null unique check (subdomain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  logo_url          text,
  favicon_url       text,
  app_display_name  varchar(100) not null,
  primary_color     varchar(7)   not null default '#0d9488' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  accent_color      varchar(7) check (accent_color is null or accent_color ~ '^#[0-9a-fA-F]{6}$'),
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

create index idx_agency_members_user_id on public.agency_members (user_id);

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
