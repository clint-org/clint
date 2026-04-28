-- migration: 20260428124819_whitelabel_rpc_get_brand_by_host_super_admin
-- purpose: extend get_brand_by_host so the reserved 'admin' subdomain
--   resolves to kind='super-admin'. fills the production gap left by the
--   original implementation, which only returned tenant/agency/default
--   and made admin.<apex> land on the marketing page in prod (the
--   ?wl_kind= dev override is gated on !environment.production, so it
--   doesn't help once the bundle is built for prod).
--
-- ordering: tenant/agency custom_domain matches still take precedence so
--   a tenant who registered admin.somedomain.com as their custom_domain
--   wins over the magic 'admin' subdomain. the check requires p_host to
--   have at least two segments (a dot with a non-empty second segment) so
--   bare hostnames like 'admin' or 'localhost' don't accidentally match.
--   reserved-subdomain enforcement in provision_tenant / provision_agency
--   already prevents anyone from registering 'admin' as a tenant or
--   agency subdomain.

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
    -- 5. agencies.subdomain
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
  'boolean signal). The reserved subdomain "admin" (e.g. admin.<apex>) '
  'returns kind=super-admin so the platform-owner UI is reachable in prod.';

revoke execute on function public.get_brand_by_host(text) from public;
grant  execute on function public.get_brand_by_host(text) to anon, authenticated;
