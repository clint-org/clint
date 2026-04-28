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
