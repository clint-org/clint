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
  add column subdomain                varchar(63)  unique check (subdomain is null or subdomain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  add column custom_domain            varchar(255) unique,
  add column app_display_name         varchar(100),
  add column primary_color            varchar(7) not null default '#0d9488' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  add column accent_color             varchar(7) check (accent_color is null or accent_color ~ '^#[0-9a-fA-F]{6}$'),
  add column favicon_url              text,
  add column email_from_name          varchar(100),
  add column email_domain_allowlist   text[],
  add column email_self_join_enabled  boolean not null default false,
  add column suspended_at             timestamptz;

create index idx_tenants_agency_id on public.tenants (agency_id);

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
