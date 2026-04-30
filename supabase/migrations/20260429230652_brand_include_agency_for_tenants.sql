-- migration: 20260429230652_brand_include_agency_for_tenants
-- purpose: extend get_brand_by_host so tenant brands also surface a small
--   public-safe agency descriptor (name + logo_url). this lets the login
--   screen and the app shell display "intelligence delivered by {agency}"
--   framing on tenant hosts -- the value prop is that the agency is the
--   analyst behind the workspace, even though the chrome inside the app
--   stays tenant-branded.
-- payload contract: previous fields unchanged; adds top-level
--   `agency: { name, logo_url } | null`. agency is null for kind != 'tenant'
--   and also null when a tenant has no agency_id (legacy direct-provisioned
--   tenants -- agency_id is on delete set null per agency-tables migration).
-- security: anon-callable. agency.name is shown publicly today on the
--   agency portal subdomain itself, so it's not a new disclosure. logo_url
--   is already a public asset. no other agency fields are returned.

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
  v_agency_id   uuid;
  v_agency_name text;
  v_agency_logo text;
  v_agency      jsonb := null;
begin
  if p_host is null or length(trim(p_host)) = 0 then
    return jsonb_build_object('kind', 'default');
  end if;

  -- 1. tenants.custom_domain
  select 'tenant', t.id, coalesce(t.app_display_name, t.name), t.logo_url, t.favicon_url,
         t.primary_color, t.accent_color,
         (t.email_self_join_enabled and t.email_domain_allowlist is not null and array_length(t.email_domain_allowlist, 1) > 0),
         (t.suspended_at is not null),
         t.agency_id
    into v_kind, v_id, v_name, v_logo, v_favicon, v_primary, v_accent, v_self_join, v_suspended, v_agency_id
    from public.tenants t
   where t.custom_domain = p_host
   limit 1;

  if v_kind is null then
    -- 2. agencies.custom_domain
    select 'agency', a.id, a.app_display_name, a.logo_url, a.favicon_url,
           a.primary_color, a.accent_color,
           false, false, null::uuid
      into v_kind, v_id, v_name, v_logo, v_favicon, v_primary, v_accent, v_self_join, v_suspended, v_agency_id
      from public.agencies a
     where a.custom_domain = p_host
     limit 1;
  end if;

  if v_kind is null then
    -- 3. tenants.subdomain (host is something like "pfizer.yourproduct.com")
    select 'tenant', t.id, coalesce(t.app_display_name, t.name), t.logo_url, t.favicon_url,
           t.primary_color, t.accent_color,
           (t.email_self_join_enabled and t.email_domain_allowlist is not null and array_length(t.email_domain_allowlist, 1) > 0),
           (t.suspended_at is not null),
           t.agency_id
      into v_kind, v_id, v_name, v_logo, v_favicon, v_primary, v_accent, v_self_join, v_suspended, v_agency_id
      from public.tenants t
     where t.subdomain is not null
       and split_part(p_host, '.', 1) = t.subdomain
     limit 1;
  end if;

  if v_kind is null then
    -- 4. agencies.subdomain
    select 'agency', a.id, a.app_display_name, a.logo_url, a.favicon_url,
           a.primary_color, a.accent_color,
           false, false, null::uuid
      into v_kind, v_id, v_name, v_logo, v_favicon, v_primary, v_accent, v_self_join, v_suspended, v_agency_id
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
    'accent_color',      v_accent,
    'auth_providers',    jsonb_build_array('google', 'microsoft'),
    'has_self_join',     v_self_join,
    'suspended',         v_suspended,
    'agency',            v_agency
  );
end;
$$;

comment on function public.get_brand_by_host(text) is
  'Pre-auth host resolver. Returns brand for the host, or kind=default if '
  'unknown. For tenant brands, surfaces an agency descriptor '
  '({ name, logo_url } | null) for "intelligence delivered by {agency}" '
  'framing in the UI. Anon-callable by design but redacts sensitive fields: '
  'email_domain_allowlist contents are NEVER returned (only a has_self_join '
  'boolean signal); no agency contact_email or member counts.';

revoke execute on function public.get_brand_by_host(text) from public;
grant  execute on function public.get_brand_by_host(text) to anon, authenticated;
