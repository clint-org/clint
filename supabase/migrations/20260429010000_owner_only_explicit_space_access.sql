-- migration: 20260429010000_owner_only_explicit_space_access
-- purpose: collapse the access model to match the actual product shape.
--
-- Background: today tenants and agencies both have owner+member roles, and
-- has_space_access cascades through tenant-owner, tenant-member, agency-owner,
-- and agency-member to grant implicit space access. The product never used
-- the member tier at agency or tenant level (no surface area at those
-- levels) and we want firewalled space access -- agency consultants on
-- engagement A should not see engagement B's data just because their
-- agency parent owns both tenants.
--
-- New model:
--   * agency_members.role: owner only
--   * tenant_members.role: owner only
--   * space_members.role : owner | editor | viewer (unchanged DB-side; UI
--                          will label as Contributor / Reader)
--   * agencies.email_domain (new) optionally locks tenant + agency owner
--                                  inserts to a single email domain
--   * has_space_access: ONLY explicit space_members rows grant access; no
--                       cascade from tenant or agency level. Platform admin
--                       keeps the read-side bypass for support.
--   * provision_tenant: auto-adds the caller as tenant owner so agency
--                       owners don't lock themselves out
--   * new add_tenant_owner(uuid, text) RPC: adds an existing user or holds
--     a tenant_invite (owner role) for an unknown email
--   * new space_invites table + invite_to_space + accept_space_invite for
--     space-level membership of any-domain users (clients live here)
--
-- Existing data: pre-launch, so we wipe non-owner rows from
-- tenant_members and agency_members rather than try to map them. We also
-- backfill -- for each agency owner, add a tenant_members(owner) row for
-- every tenant under that agency, and a space_members(owner) row for every
-- space under those tenants. That preserves visibility for everyone who
-- could see data before the migration.
--
-- affected objects:
--   public.agencies                         (new column email_domain)
--   public.agency_members                   (role tightened, member rows wiped)
--   public.tenant_members                   (role tightened, member rows wiped)
--   public.tenant_invites                   (role tightened to owner)
--   public.space_invites                    (NEW table)
--   public.enforce_member_email_domain      (NEW trigger fn)
--   public.has_space_access                 (rewritten -- explicit-only)
--   public.provision_tenant                 (rewritten -- auto-add owner)
--   public.add_tenant_owner                 (NEW)
--   public.invite_to_space                  (NEW)
--   public.accept_space_invite              (NEW)
--   public.update_agency_branding           (extended -- accepts email_domain)

-- =============================================================================
-- 1. agencies.email_domain + backfill from existing owner email
-- =============================================================================

alter table public.agencies
  add column if not exists email_domain varchar(253);

alter table public.agencies
  drop constraint if exists agencies_email_domain_check;
alter table public.agencies
  add constraint agencies_email_domain_check
    check (email_domain is null or email_domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$');

update public.agencies a
   set email_domain = lower(split_part(u.email, '@', 2))
  from public.agency_members am
  join auth.users u on u.id = am.user_id
 where am.agency_id = a.id
   and am.role = 'owner'
   and a.email_domain is null
   and u.email is not null
   and lower(split_part(u.email, '@', 2)) ~ '^[a-z0-9.-]+\.[a-z]{2,}$';

comment on column public.agencies.email_domain is
  'Optional email-domain lock. When set, agency_members and tenant_members '
  'inserts under this agency must use a user whose email domain matches. '
  'Null = no enforcement (any user can be added).';

-- =============================================================================
-- 2. Backfill tenant_members + space_members from existing agency owners
--    BEFORE wiping non-owner rows -- so existing data stays visible to
--    whoever could see it before.
-- =============================================================================

insert into public.tenant_members (tenant_id, user_id, role)
select t.id, am.user_id, 'owner'
  from public.tenants t
  join public.agency_members am on am.agency_id = t.agency_id
 where am.role = 'owner'
on conflict (tenant_id, user_id) do nothing;

insert into public.space_members (space_id, user_id, role)
select s.id, am.user_id, 'owner'
  from public.spaces s
  join public.tenants t on t.id = s.tenant_id
  join public.agency_members am on am.agency_id = t.agency_id
 where am.role = 'owner'
on conflict (space_id, user_id) do nothing;

-- Existing tenant owners should also be space owners of every space in
-- their tenant (so they can see the data they used to be able to see).
insert into public.space_members (space_id, user_id, role)
select s.id, tm.user_id, 'owner'
  from public.spaces s
  join public.tenant_members tm on tm.tenant_id = s.tenant_id
 where tm.role = 'owner'
on conflict (space_id, user_id) do nothing;

-- =============================================================================
-- 3. Wipe non-owner tenant + agency membership; tighten role constraints
-- =============================================================================

-- Member rows have no surface area in the new model. Pre-launch, so wipe.
delete from public.tenant_members where role <> 'owner';
delete from public.agency_members where role <> 'owner';

-- Tenant invites can only be owner-grade now.
update public.tenant_invites set role = 'owner' where role <> 'owner';

-- Tighten check constraints. Use known auto-named constraints; recreate
-- under stable names so we can manage them later.
alter table public.tenant_members drop constraint if exists tenant_members_role_check;
alter table public.tenant_members
  add constraint tenant_members_role_check check (role = 'owner');

alter table public.agency_members drop constraint if exists agency_members_role_check;
alter table public.agency_members
  add constraint agency_members_role_check check (role = 'owner');

alter table public.tenant_invites drop constraint if exists tenant_invites_role_check;
alter table public.tenant_invites
  add constraint tenant_invites_role_check check (role = 'owner');

-- =============================================================================
-- 4. Domain-enforcement trigger on agency_members + tenant_members
-- =============================================================================

create or replace function public.enforce_member_email_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency_id uuid;
  v_user_email text;
  v_required text;
  v_user_dom text;
begin
  -- Platform admin bypass for break-glass operations.
  if public.is_platform_admin() then
    return new;
  end if;

  if tg_table_name = 'agency_members' then
    v_agency_id := new.agency_id;
  elsif tg_table_name = 'tenant_members' then
    select agency_id into v_agency_id from public.tenants where id = new.tenant_id;
    if v_agency_id is null then
      -- Direct-customer tenant (no agency parent). No enforcement.
      return new;
    end if;
  else
    return new;
  end if;

  select email_domain into v_required from public.agencies where id = v_agency_id;
  if v_required is null then
    return new; -- agency hasn't opted into domain enforcement
  end if;

  select lower(email) into v_user_email from auth.users where id = new.user_id;
  if v_user_email is null then
    return new; -- user lookup failed; let other checks catch it
  end if;

  v_user_dom := split_part(v_user_email, '@', 2);
  if v_user_dom <> v_required then
    raise exception 'User email domain (%) does not match agency domain (%)',
      v_user_dom, v_required
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists agency_members_enforce_domain on public.agency_members;
create trigger agency_members_enforce_domain
  before insert or update of user_id on public.agency_members
  for each row execute function public.enforce_member_email_domain();

drop trigger if exists tenant_members_enforce_domain on public.tenant_members;
create trigger tenant_members_enforce_domain
  before insert or update of user_id on public.tenant_members
  for each row execute function public.enforce_member_email_domain();

-- =============================================================================
-- 5. Rewrite has_space_access -- explicit space_members rows ONLY
-- =============================================================================

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
  v_suspended  boolean;
  v_uid        uuid := auth.uid();
  v_is_write   boolean;
begin
  select s.tenant_id, (t.suspended_at is not null)
    into v_tenant_id, v_suspended
    from public.spaces s
    join public.tenants t on t.id = s.tenant_id
   where s.id = p_space_id;

  if v_tenant_id is null then
    return false;
  end if;

  v_is_write := p_roles is not null and (
    'owner'  = any(p_roles) or
    'editor' = any(p_roles)
  );
  if v_suspended and v_is_write then
    return false;
  end if;

  -- Platform admin: read-only bypass for support.
  if not v_is_write and public.is_platform_admin() then
    return true;
  end if;

  -- Explicit space_members row is the only path.
  return exists (
    select 1 from public.space_members sm
    where sm.space_id = p_space_id
      and sm.user_id  = v_uid
      and (p_roles is null or sm.role = any(p_roles))
  );
end;
$$;

comment on function public.has_space_access(uuid, text[]) is
  'RLS helper. True only when the calling user holds an explicit space_members '
  'row at one of p_roles. No implicit cascade from tenant or agency level -- '
  'tenant/agency owners must add themselves to a space to see its data. Writes '
  'against a suspended tenant always fail. Platform admins get read-only bypass.';

-- =============================================================================
-- 6. provision_tenant: auto-add caller as tenant owner
--    (otherwise the agency owner who provisions a tenant has no path to
--    manage it from the tenant's own settings page)
-- =============================================================================

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

  select max_tenants into v_max_tenants from public.agencies where id = p_agency_id;
  if v_max_tenants is null then
    raise exception 'Agency not found' using errcode = 'P0002';
  end if;
  if v_max_tenants > 0 then
    select count(*) into v_owned_count from public.tenants where agency_id = p_agency_id;
    if v_owned_count >= v_max_tenants then
      raise exception 'Agency tenant limit reached (%)', v_max_tenants using errcode = '53400';
    end if;
  end if;

  if not public.check_subdomain_available(p_subdomain) then
    raise exception 'Subdomain "%" is not available', p_subdomain using errcode = '23505';
  end if;

  v_slug := p_subdomain;

  insert into public.tenants (
    name, slug, agency_id, subdomain,
    app_display_name, logo_url, favicon_url,
    primary_color, email_from_name
  ) values (
    p_name, v_slug, p_agency_id, p_subdomain,
    coalesce(p_brand ->> 'app_display_name', p_name),
    p_brand ->> 'logo_url',
    p_brand ->> 'favicon_url',
    coalesce(p_brand ->> 'primary_color', '#0d9488'),
    coalesce(p_brand ->> 'email_from_name', p_brand ->> 'app_display_name', p_name)
  )
  returning id into v_tenant_id;

  -- Auto-add the caller as tenant owner so they can manage from tenant settings.
  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant_id, v_uid, 'owner')
    on conflict (tenant_id, user_id) do nothing;

  -- Default space.
  insert into public.spaces (tenant_id, name, created_by)
    values (v_tenant_id, 'Workspace', v_uid)
    returning id into v_space_id;

  -- Auto-add caller as space owner so they can see space data.
  insert into public.space_members (space_id, user_id, role)
    values (v_space_id, v_uid, 'owner')
    on conflict (space_id, user_id) do nothing;

  select jsonb_build_object(
    'id', t.id, 'name', t.name, 'subdomain', t.subdomain,
    'agency_id', t.agency_id, 'default_space_id', v_space_id
  ) into v_result
    from public.tenants t where t.id = v_tenant_id;

  return v_result;
end;
$$;

revoke execute on function public.provision_tenant(uuid, text, text, jsonb) from public, anon;
grant  execute on function public.provision_tenant(uuid, text, text, jsonb) to authenticated;

-- =============================================================================
-- 7. add_tenant_owner RPC -- caller is tenant or agency owner, target email
--    must match agency.email_domain when set. Inserts directly when the
--    user already exists; otherwise holds a tenant_invites row.
-- =============================================================================

create or replace function public.add_tenant_owner(
  p_tenant_id uuid,
  p_email     text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_email       text := lower(trim(coalesce(p_email, '')));
  v_agency_id   uuid;
  v_required    text;
  v_user_id     uuid;
  v_invite_code text;
  v_invite_id   uuid;
begin
  if v_uid is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid email' using errcode = 'P0001';
  end if;

  -- is_tenant_member already covers tenant owner + agency owner + platform admin
  if not public.is_tenant_member(p_tenant_id, array['owner']) then
    raise exception 'Insufficient permissions' using errcode = '42501';
  end if;

  select agency_id into v_agency_id from public.tenants where id = p_tenant_id;
  if v_agency_id is not null then
    select email_domain into v_required from public.agencies where id = v_agency_id;
    if v_required is not null
       and split_part(v_email, '@', 2) <> v_required
       and not public.is_platform_admin() then
      raise exception 'Email domain (%) does not match agency domain (%)',
        split_part(v_email, '@', 2), v_required
        using errcode = 'P0001';
    end if;
  end if;

  select id into v_user_id from auth.users where lower(email) = v_email limit 1;

  if v_user_id is not null then
    insert into public.tenant_members (tenant_id, user_id, role)
      values (p_tenant_id, v_user_id, 'owner')
      on conflict (tenant_id, user_id) do nothing;
    return jsonb_build_object('owner_invited', false, 'user_id', v_user_id);
  end if;

  -- 32-char hex code via uuid (no pgcrypto dependency).
  v_invite_code := replace(gen_random_uuid()::text, '-', '');
  insert into public.tenant_invites
    (tenant_id, email, role, invite_code, created_by, expires_at)
    values (p_tenant_id, v_email, 'owner', v_invite_code, v_uid, now() + interval '7 days')
    returning id into v_invite_id;

  return jsonb_build_object(
    'owner_invited', true,
    'invite_id',     v_invite_id,
    'invite_code',   v_invite_code,
    'email',         v_email
  );
end;
$$;

revoke execute on function public.add_tenant_owner(uuid, text) from public, anon;
grant  execute on function public.add_tenant_owner(uuid, text) to authenticated;

comment on function public.add_tenant_owner(uuid, text) is
  'Adds a user as tenant owner. Caller must be tenant owner, agency owner '
  'of the parent agency, or platform admin. Email domain must match '
  'agencies.email_domain when set (platform admin can bypass). If the email '
  'has no auth.users row, holds an invite for code-based acceptance via '
  'accept_invite().';

-- =============================================================================
-- 8. space_invites table + RLS
-- =============================================================================

create table if not exists public.space_invites (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references public.spaces(id) on delete cascade,
  email        text not null,
  role         varchar(20) not null check (role in ('owner', 'editor', 'viewer')),
  invite_code  text not null unique,
  created_by   uuid references auth.users(id) on delete set null,
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id) on delete set null,
  expires_at   timestamptz not null default (now() + interval '7 days'),
  created_at   timestamptz not null default now()
);

create unique index if not exists uq_space_invites_pending_email
  on public.space_invites (space_id, lower(email)) where accepted_at is null;
create index if not exists idx_space_invites_space_id on public.space_invites (space_id);
create index if not exists idx_space_invites_email on public.space_invites (lower(email));

alter table public.space_invites enable row level security;

drop policy if exists "space owners can read invites" on public.space_invites;
create policy "space owners can read invites"
on public.space_invites for select to authenticated
using (
  exists (
    select 1 from public.space_members sm
    where sm.space_id = public.space_invites.space_id
      and sm.user_id  = auth.uid()
      and sm.role     = 'owner'
  )
  or public.is_platform_admin()
);

-- writes only via SECURITY DEFINER RPCs (no insert/update/delete policies)

comment on table public.space_invites is
  'Pending space-level invitations. Mirrors tenant_invites: email + role + '
  'unique invite_code. Code-based acceptance via accept_space_invite(p_code).';

-- =============================================================================
-- 9. invite_to_space + accept_space_invite RPCs
-- =============================================================================

create or replace function public.invite_to_space(
  p_space_id uuid,
  p_email    text,
  p_role     text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_email       text := lower(trim(coalesce(p_email, '')));
  v_user_id     uuid;
  v_invite_id   uuid;
  v_invite_code text;
begin
  if v_uid is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid email' using errcode = 'P0001';
  end if;
  if p_role not in ('owner', 'editor', 'viewer') then
    raise exception 'Invalid role' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.space_members sm
    where sm.space_id = p_space_id
      and sm.user_id  = v_uid
      and sm.role     = 'owner'
  ) and not public.is_platform_admin() then
    raise exception 'Only space owners can invite' using errcode = '42501';
  end if;

  select id into v_user_id from auth.users where lower(email) = v_email limit 1;

  if v_user_id is not null then
    insert into public.space_members (space_id, user_id, role)
      values (p_space_id, v_user_id, p_role)
      on conflict (space_id, user_id) do update set role = excluded.role;
    return jsonb_build_object('invited', false, 'user_id', v_user_id);
  end if;

  -- 32-char hex code via uuid (no pgcrypto dependency).
  v_invite_code := replace(gen_random_uuid()::text, '-', '');
  insert into public.space_invites (space_id, email, role, invite_code, created_by)
    values (p_space_id, v_email, p_role, v_invite_code, v_uid)
    returning id into v_invite_id;

  return jsonb_build_object(
    'invited',     true,
    'invite_id',   v_invite_id,
    'invite_code', v_invite_code,
    'email',       v_email
  );
end;
$$;

revoke execute on function public.invite_to_space(uuid, text, text) from public, anon;
grant  execute on function public.invite_to_space(uuid, text, text) to authenticated;

comment on function public.invite_to_space(uuid, text, text) is
  'Adds or invites a user to a space at owner|editor|viewer. Caller must be '
  'a space owner (or platform admin). Existing users get a space_members row '
  'directly; unknown emails get a space_invites row consumed via '
  'accept_space_invite(p_code). No domain restriction -- spaces can include '
  'client emails on any domain.';

create or replace function public.accept_space_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_invite record;
  v_space  jsonb;
begin
  if v_uid is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if v_email = '' then
    raise exception 'Authenticated session has no email' using errcode = '28000';
  end if;

  select i.id, i.space_id, i.email, i.role, i.accepted_at, i.expires_at
    into v_invite
    from public.space_invites i
   where i.invite_code = p_code;

  if not found then
    raise exception 'Invalid invite code' using errcode = 'P0002';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'Invite already used' using errcode = 'P0001';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'Invite expired' using errcode = 'P0001';
  end if;
  if lower(v_invite.email) <> v_email then
    raise exception 'Invite was sent to a different email address' using errcode = '42501';
  end if;

  insert into public.space_members (space_id, user_id, role)
    values (v_invite.space_id, v_uid, v_invite.role)
    on conflict (space_id, user_id) do update set role = excluded.role;

  update public.space_invites
     set accepted_at = now(), accepted_by = v_uid
   where id = v_invite.id;

  select jsonb_build_object('id', s.id, 'name', s.name, 'tenant_id', s.tenant_id)
    into v_space from public.spaces s where s.id = v_invite.space_id;

  return v_space;
end;
$$;

revoke execute on function public.accept_space_invite(text) from public, anon;
grant  execute on function public.accept_space_invite(text) to authenticated;

-- =============================================================================
-- 10. update_agency_branding -- extend whitelist to include email_domain
--     (the new column added in step 1; agency owners need a path to set it
--     from the agency branding page)
-- =============================================================================

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
  v_color_re   text := '^#[0-9a-fA-F]{6}$';
  v_domain_re  text := '^[a-z0-9.-]+\.[a-z]{2,}$';
  v_brand_keys text[] := array[
    'app_display_name','logo_url','favicon_url','primary_color',
    'contact_email','email_domain'
  ];
  k text;
  v_email_domain text;
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
  if p_branding ? 'email_domain' and (p_branding ->> 'email_domain') is not null then
    v_email_domain := lower(trim(p_branding ->> 'email_domain'));
    if v_email_domain !~ v_domain_re then
      raise exception 'email_domain must be a valid domain (e.g. acme.com)'
        using errcode = 'P0001';
    end if;
  end if;

  update public.agencies
     set app_display_name = coalesce(p_branding ->> 'app_display_name', app_display_name),
         logo_url         = coalesce(p_branding ->> 'logo_url',         logo_url),
         favicon_url      = coalesce(p_branding ->> 'favicon_url',      favicon_url),
         primary_color    = coalesce(p_branding ->> 'primary_color',    primary_color),
         contact_email    = coalesce(p_branding ->> 'contact_email',    contact_email),
         email_domain     = coalesce(v_email_domain,                    email_domain),
         updated_at       = now()
   where id = p_agency_id;

  return jsonb_build_object('id', p_agency_id, 'updated', true);
end;
$$;

revoke execute on function public.update_agency_branding(uuid, jsonb) from public, anon;
grant  execute on function public.update_agency_branding(uuid, jsonb) to authenticated;
