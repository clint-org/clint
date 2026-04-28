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
      raise exception 'Agency tenant limit reached (%)', v_max_tenants using errcode = '53400';
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
