-- migration: 20260510001100_audit_instrument_branding
-- purpose: Phase 2 audit instrumentation -- rewrites update_tenant_branding and
--   update_agency_branding to emit a record_audit_event() call after their
--   existing logic so that every branding change produces an audit row.
-- spec: docs/superpowers/specs/2026-05-10-audit-log-design.md (Phase 2 instrumentation)
--
-- Authoritative sources:
--   update_tenant_branding : 20260429000000_remove_accent_color.sql
--   update_agency_branding : 20260429010000_owner_only_explicit_space_access.sql
--
-- Both functions accept p_branding jsonb; individual fields are applied only when
-- their key is present in the JSON object (p_branding ? 'key'). v_changed_fields
-- is built by checking key presence so callers passing only a subset of fields
-- see only those fields listed in the audit event.
--
-- The @audit:tier1 marker on the first non-blank line inside each function body
-- is required by the coverage check in Task 14 (Phase 3). Every function with
-- this marker must contain a record_audit_event() call.

-- =============================================================================
-- 1. update_tenant_branding (latest body: 20260429000000_remove_accent_color.sql)
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
-- @audit:tier1
declare
  v_agency_id      uuid;
  v_color_re       text := '^#[0-9a-fA-F]{6}$';
  v_brand_keys     text[] := array[
    'app_display_name','logo_url','favicon_url','primary_color',
    'email_from_name'
  ];
  k                text;
  v_changed_fields text[] := array[]::text[];
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

  -- Collect the names of fields that were actually submitted for mutation.
  if p_branding ? 'app_display_name' then v_changed_fields := v_changed_fields || array['app_display_name']; end if;
  if p_branding ? 'logo_url'         then v_changed_fields := v_changed_fields || array['logo_url'];         end if;
  if p_branding ? 'favicon_url'      then v_changed_fields := v_changed_fields || array['favicon_url'];      end if;
  if p_branding ? 'primary_color'    then v_changed_fields := v_changed_fields || array['primary_color'];    end if;
  if p_branding ? 'email_from_name'  then v_changed_fields := v_changed_fields || array['email_from_name'];  end if;

  -- ===== AUDIT INSTRUMENTATION =====
  perform set_config('audit.actor_role',
    case when public.is_platform_admin() then 'platform_admin' else 'agency_owner' end,
    true);
  perform set_config('audit.rpc_name', 'update_tenant_branding', true);
  perform public.record_audit_event(
    'tenant.branding_updated', 'rpc', 'tenant', p_tenant_id,
    (select agency_id from public.tenants where id = p_tenant_id), p_tenant_id, null,
    jsonb_build_object('changed_fields', v_changed_fields)
  );

  return jsonb_build_object('id', p_tenant_id, 'updated', true);
end;
$$;

revoke execute on function public.update_tenant_branding(uuid, jsonb) from public, anon;
grant  execute on function public.update_tenant_branding(uuid, jsonb) to authenticated;

-- =============================================================================
-- 2. update_agency_branding (latest body: 20260429010000_owner_only_explicit_space_access.sql)
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
-- @audit:tier1
declare
  v_color_re       text := '^#[0-9a-fA-F]{6}$';
  v_domain_re      text := '^[a-z0-9.-]+\.[a-z]{2,}$';
  v_brand_keys     text[] := array[
    'app_display_name','logo_url','favicon_url','primary_color',
    'contact_email','email_domain'
  ];
  k                text;
  v_email_domain   text;
  v_changed_fields text[] := array[]::text[];
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

  -- Collect the names of fields that were actually submitted for mutation.
  if p_branding ? 'app_display_name' then v_changed_fields := v_changed_fields || array['app_display_name']; end if;
  if p_branding ? 'logo_url'         then v_changed_fields := v_changed_fields || array['logo_url'];         end if;
  if p_branding ? 'favicon_url'      then v_changed_fields := v_changed_fields || array['favicon_url'];      end if;
  if p_branding ? 'primary_color'    then v_changed_fields := v_changed_fields || array['primary_color'];    end if;
  if p_branding ? 'contact_email'    then v_changed_fields := v_changed_fields || array['contact_email'];    end if;
  if p_branding ? 'email_domain'     then v_changed_fields := v_changed_fields || array['email_domain'];     end if;

  -- ===== AUDIT INSTRUMENTATION =====
  perform set_config('audit.actor_role',
    case when public.is_platform_admin() then 'platform_admin' else 'agency_owner' end,
    true);
  perform set_config('audit.rpc_name', 'update_agency_branding', true);
  perform public.record_audit_event(
    'agency.branding_updated', 'rpc', 'agency', p_agency_id,
    p_agency_id, null, null,
    jsonb_build_object('changed_fields', v_changed_fields)
  );

  return jsonb_build_object('id', p_agency_id, 'updated', true);
end;
$$;

revoke execute on function public.update_agency_branding(uuid, jsonb) from public, anon;
grant  execute on function public.update_agency_branding(uuid, jsonb) to authenticated;
