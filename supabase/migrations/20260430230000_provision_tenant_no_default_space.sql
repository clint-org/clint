-- Stop auto-creating a default "Workspace" space at tenant provision time.
--
-- Under the agency-managed model, each space is a real engagement (e.g.
-- "Survodutide Pipeline Q2 2026"), named by the analyst doing the work. The
-- generic auto-created "Workspace" carries no information, locks the
-- caller of provision_tenant as space owner regardless of who actually runs
-- the engagement, and creates a confusing UX for tenant owners who see a
-- "Workspace" they can't access.
--
-- New behavior:
--   provision_tenant creates the tenant + adds the caller as
--   tenant_members.role='owner' only. Spaces are created explicitly later via
--   create_space(). The spaces-list page already has a "No spaces yet" empty
--   state with a Create-space CTA, so the UX degrades gracefully.
--
-- Existing tenants with auto-created "Workspace" rows are unaffected by this
-- migration; the cleanup of test artifacts is handled separately.

create or replace function public.provision_tenant(
  p_agency_id uuid,
  p_name text,
  p_subdomain text,
  p_brand jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_max_tenants int;
  v_owned_count int;
  v_tenant_id uuid;
  v_slug text;
  v_result jsonb;
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
    app_display_name, logo_url, favicon_url, primary_color, email_from_name
  ) values (
    p_name, v_slug, p_agency_id, p_subdomain,
    coalesce(p_brand ->> 'app_display_name', p_name),
    p_brand ->> 'logo_url',
    p_brand ->> 'favicon_url',
    coalesce(p_brand ->> 'primary_color', '#0d9488'),
    coalesce(p_brand ->> 'email_from_name', p_brand ->> 'app_display_name', p_name)
  ) returning id into v_tenant_id;
  -- Auto-add the caller as tenant owner so they can manage from tenant settings.
  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant_id, v_uid, 'owner')
    on conflict (tenant_id, user_id) do nothing;
  -- NOTE: no longer auto-creates a default "Workspace" space. Spaces are
  -- created explicitly later via create_space().
  select jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'subdomain', t.subdomain,
    'agency_id', t.agency_id
  ) into v_result
  from public.tenants t where t.id = v_tenant_id;
  return v_result;
end;
$$;
