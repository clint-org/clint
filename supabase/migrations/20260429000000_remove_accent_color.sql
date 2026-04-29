-- migration: 20260429000000_remove_accent_color
-- purpose: rip out the unused accent_color brand field.
--
-- accent_color was plumbed end-to-end (tenants/agencies columns, validation
-- in update_tenant_branding / update_agency_branding, projection in
-- get_brand_by_host, write in provision_tenant, exposed via
-- BrandContextService.accentColor) but was NEVER consumed at render time --
-- no CSS variable was ever set from it and no template ever read the signal.
-- It was dead UI promising customization that didn't happen.
--
-- This migration recreates each affected function WITHOUT the accent_color
-- references, then drops the column from both tables. Functions are
-- recreated first so a column drop never leaves a function body referencing
-- a missing column at runtime. (plpgsql doesn't hold a hard dependency on
-- columns, but it would fail on first call after the drop.)
--
-- affected objects:
--   public.update_tenant_branding(uuid, jsonb)   -- rewritten
--   public.update_agency_branding(uuid, jsonb)   -- rewritten
--   public.provision_tenant(uuid, text, text, jsonb)  -- rewritten
--   public.get_brand_by_host(text)               -- rewritten
--   public.tenants.accent_color                  -- dropped
--   public.agencies.accent_color                 -- dropped

-- =============================================================================
-- 1. update_tenant_branding: drop accent_color from allowed keys + update
-- =============================================================================

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
    'email_from_name'
  ];
  k text;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;

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

  if p_branding ? 'primary_color' and (p_branding ->> 'primary_color') !~ v_color_re then
    raise exception 'primary_color must be #rrggbb' using errcode = 'P0001';
  end if;

  update public.tenants
     set app_display_name = coalesce(p_branding ->> 'app_display_name', app_display_name),
         logo_url         = coalesce(p_branding ->> 'logo_url',         logo_url),
         favicon_url      = coalesce(p_branding ->> 'favicon_url',      favicon_url),
         primary_color    = coalesce(p_branding ->> 'primary_color',    primary_color),
         email_from_name  = coalesce(p_branding ->> 'email_from_name',  email_from_name),
         updated_at       = now()
   where id = p_tenant_id;

  return jsonb_build_object('id', p_tenant_id, 'updated', true);
end;
$$;

revoke execute on function public.update_tenant_branding(uuid, jsonb) from public, anon;
grant  execute on function public.update_tenant_branding(uuid, jsonb) to authenticated;

-- =============================================================================
-- 2. update_agency_branding: drop accent_color from allowed keys + update
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
  v_color_re  text := '^#[0-9a-fA-F]{6}$';
  v_brand_keys text[] := array[
    'app_display_name','logo_url','favicon_url','primary_color',
    'contact_email'
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

  update public.agencies
     set app_display_name = coalesce(p_branding ->> 'app_display_name', app_display_name),
         logo_url         = coalesce(p_branding ->> 'logo_url',         logo_url),
         favicon_url      = coalesce(p_branding ->> 'favicon_url',      favicon_url),
         primary_color    = coalesce(p_branding ->> 'primary_color',    primary_color),
         contact_email    = coalesce(p_branding ->> 'contact_email',    contact_email),
         updated_at       = now()
   where id = p_agency_id;

  return jsonb_build_object('id', p_agency_id, 'updated', true);
end;
$$;

revoke execute on function public.update_agency_branding(uuid, jsonb) from public, anon;
grant  execute on function public.update_agency_branding(uuid, jsonb) to authenticated;

-- =============================================================================
-- 3. provision_tenant: drop accent_color from insert column list
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

revoke execute on function public.provision_tenant(uuid, text, text, jsonb) from public, anon;
grant  execute on function public.provision_tenant(uuid, text, text, jsonb) to authenticated;

-- =============================================================================
-- 4. get_brand_by_host: drop accent_color from projection
-- =============================================================================

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
  v_self_join boolean := false;
  v_suspended boolean := false;
begin
  if p_host is null or length(trim(p_host)) = 0 then
    return jsonb_build_object('kind', 'default');
  end if;

  -- 1. tenants.custom_domain
  select 'tenant', t.id, coalesce(t.app_display_name, t.name), t.logo_url, t.favicon_url,
         t.primary_color,
         (t.email_self_join_enabled and t.email_domain_allowlist is not null and array_length(t.email_domain_allowlist, 1) > 0),
         (t.suspended_at is not null)
    into v_kind, v_id, v_name, v_logo, v_favicon, v_primary, v_self_join, v_suspended
    from public.tenants t
   where t.custom_domain = p_host
   limit 1;

  if v_kind is null then
    -- 2. agencies.custom_domain
    select 'agency', a.id, a.app_display_name, a.logo_url, a.favicon_url,
           a.primary_color, false, false
      into v_kind, v_id, v_name, v_logo, v_favicon, v_primary, v_self_join, v_suspended
      from public.agencies a
     where a.custom_domain = p_host
     limit 1;
  end if;

  -- 3. magic 'admin' subdomain --> super-admin host
  if v_kind is null
     and split_part(p_host, '.', 1) = 'admin'
     and length(split_part(p_host, '.', 2)) > 0 then
    return jsonb_build_object(
      'kind',           'super-admin',
      'auth_providers', jsonb_build_array('google', 'microsoft'),
      'has_self_join',  false,
      'suspended',      false
    );
  end if;

  if v_kind is null then
    -- 4. tenants.subdomain
    select 'tenant', t.id, coalesce(t.app_display_name, t.name), t.logo_url, t.favicon_url,
           t.primary_color,
           (t.email_self_join_enabled and t.email_domain_allowlist is not null and array_length(t.email_domain_allowlist, 1) > 0),
           (t.suspended_at is not null)
      into v_kind, v_id, v_name, v_logo, v_favicon, v_primary, v_self_join, v_suspended
      from public.tenants t
     where t.subdomain is not null
       and split_part(p_host, '.', 1) = t.subdomain
     limit 1;
  end if;

  if v_kind is null then
    -- 5. agencies.subdomain
    select 'agency', a.id, a.app_display_name, a.logo_url, a.favicon_url,
           a.primary_color, false, false
      into v_kind, v_id, v_name, v_logo, v_favicon, v_primary, v_self_join, v_suspended
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
    'auth_providers',    jsonb_build_array('google', 'microsoft'),
    'has_self_join',     v_self_join,
    'suspended',         v_suspended
  );
end;
$$;

revoke execute on function public.get_brand_by_host(text) from public;
grant  execute on function public.get_brand_by_host(text) to anon, authenticated;

-- =============================================================================
-- 5. drop the columns
-- =============================================================================

alter table public.tenants  drop column if exists accent_color;
alter table public.agencies drop column if exists accent_color;
