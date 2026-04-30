-- migration: 20260430032945_fix_get_brand_by_host_drop_accent_color
-- purpose: rebuild get_brand_by_host without accent_color references.
--
-- background: 20260429000000_remove_accent_color dropped tenants.accent_color
-- and agencies.accent_color and rewrote get_brand_by_host without them.
-- 20260429230652_brand_include_agency_for_tenants then recreated
-- get_brand_by_host to add the agency descriptor for tenant brands, but
-- copied from the pre-removal source and reintroduced t.accent_color /
-- a.accent_color in the SELECT lists. plpgsql does not resolve column
-- references at function-creation time, so the migration applied cleanly
-- but every runtime call now errors with `column t.accent_color does not
-- exist`. PostgREST surfaces that as a 400 on /rpc/get_brand_by_host,
-- which collapses every host to kind='default' on the client and traps
-- authenticated agency users in a guard loop (admin -> default -> agency
-- redirect -> admin).
--
-- payload contract is preserved from 20260429230652 minus the accent_color
-- field (which was already dropped from the contract by 20260429000000).

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
  v_agency_id   uuid;
  v_agency      jsonb := null;
begin
  if p_host is null or length(trim(p_host)) = 0 then
    return jsonb_build_object('kind', 'default');
  end if;

  -- 1. tenants.custom_domain
  select 'tenant', t.id, coalesce(t.app_display_name, t.name), t.logo_url, t.favicon_url,
         t.primary_color,
         (t.email_self_join_enabled and t.email_domain_allowlist is not null and array_length(t.email_domain_allowlist, 1) > 0),
         (t.suspended_at is not null),
         t.agency_id
    into v_kind, v_id, v_name, v_logo, v_favicon, v_primary, v_self_join, v_suspended, v_agency_id
    from public.tenants t
   where t.custom_domain = p_host
   limit 1;

  if v_kind is null then
    -- 2. agencies.custom_domain
    select 'agency', a.id, a.app_display_name, a.logo_url, a.favicon_url,
           a.primary_color, false, false, null::uuid
      into v_kind, v_id, v_name, v_logo, v_favicon, v_primary, v_self_join, v_suspended, v_agency_id
      from public.agencies a
     where a.custom_domain = p_host
     limit 1;
  end if;

  -- 3. magic 'admin' subdomain --> super-admin host (preserved from
  -- 20260428124819_whitelabel_rpc_get_brand_by_host_super_admin).
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
           (t.suspended_at is not null),
           t.agency_id
      into v_kind, v_id, v_name, v_logo, v_favicon, v_primary, v_self_join, v_suspended, v_agency_id
      from public.tenants t
     where t.subdomain is not null
       and split_part(p_host, '.', 1) = t.subdomain
     limit 1;
  end if;

  if v_kind is null then
    -- 5. agencies.subdomain
    select 'agency', a.id, a.app_display_name, a.logo_url, a.favicon_url,
           a.primary_color, false, false, null::uuid
      into v_kind, v_id, v_name, v_logo, v_favicon, v_primary, v_self_join, v_suspended, v_agency_id
      from public.agencies a
     where split_part(p_host, '.', 1) = a.subdomain
     limit 1;
  end if;

  if v_kind is null then
    return jsonb_build_object('kind', 'default');
  end if;

  -- For tenant brands, fetch the agency descriptor (if the tenant has an
  -- agency). Only name + logo_url are surfaced publicly.
  if v_kind = 'tenant' and v_agency_id is not null then
    select jsonb_build_object(
             'name',     coalesce(a.app_display_name, a.name),
             'logo_url', a.logo_url
           )
      into v_agency
      from public.agencies a
     where a.id = v_agency_id
     limit 1;
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
    'suspended',         v_suspended,
    'agency',            v_agency
  );
end;
$$;

revoke execute on function public.get_brand_by_host(text) from public;
grant  execute on function public.get_brand_by_host(text) to anon, authenticated;
