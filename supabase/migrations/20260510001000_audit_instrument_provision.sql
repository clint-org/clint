-- migration: 20260510001000_audit_instrument_provision
-- purpose: Phase 2 audit instrumentation -- rewrites provision_agency and
--   provision_tenant to emit a record_audit_event() call after their existing
--   logic so that every agency/tenant provisioning action produces an audit row.
-- spec: docs/superpowers/specs/2026-05-10-audit-log-design.md (Phase 2 instrumentation)
--
-- The @audit:tier1 marker on the first non-blank line inside each function body
-- is required by the coverage check in Task 14 (Phase 3). Every function with
-- this marker must contain a record_audit_event() call.
--
-- The audit.suppress_trigger GUC set by record_audit_event() prevents the
-- safety-net triggers (Task 7) from double-emitting when provision_tenant
-- inserts into tenant_members as a side effect.

-- =============================================================================
-- 1. provision_agency (latest body: 20260501060000_canonicalize_email.sql)
-- =============================================================================

create or replace function public.provision_agency(
  p_name           text,
  p_slug           text,
  p_subdomain      text,
  p_owner_email    text,
  p_contact_email  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- @audit:tier1
declare
  v_agency_id     uuid;
  v_owner_user_id uuid;
  v_email         text := public.canonicalize_email(p_owner_email);
  v_invited       boolean := false;
  v_result        jsonb;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if not public.is_platform_admin() then
    raise exception 'Platform admin only' using errcode = '42501';
  end if;

  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid owner email' using errcode = 'P0001';
  end if;
  if not public.check_subdomain_available(p_subdomain) then
    raise exception 'Subdomain "%" is not available', p_subdomain
      using errcode = '23505';
  end if;
  if p_slug is null or p_slug !~ '^[a-z][a-z0-9-]{1,99}$' then
    raise exception 'Invalid slug' using errcode = 'P0001';
  end if;

  select u.id into v_owner_user_id
    from auth.users u
   where public.canonicalize_email(u.email) = v_email
   limit 1;

  insert into public.agencies (name, slug, subdomain, app_display_name, contact_email)
    values (p_name, p_slug, p_subdomain, p_name, coalesce(p_contact_email, 'unknown@unknown.invalid'))
    returning id into v_agency_id;

  if v_owner_user_id is not null then
    insert into public.agency_members (agency_id, user_id, role)
      values (v_agency_id, v_owner_user_id, 'owner');
  else
    insert into public.agency_invites (agency_id, email, role, invited_by)
      values (v_agency_id, v_email, 'owner', auth.uid());
    v_invited := true;
  end if;

  select jsonb_build_object(
    'id',               a.id,
    'name',             a.name,
    'slug',             a.slug,
    'subdomain',        a.subdomain,
    'app_display_name', a.app_display_name,
    'created_at',       a.created_at,
    'owner_invited',    v_invited,
    'owner_email',      v_email
  ) into v_result
    from public.agencies a where a.id = v_agency_id;

  -- ===== AUDIT INSTRUMENTATION =====
  perform set_config('audit.actor_role', 'platform_admin', true);
  perform set_config('audit.rpc_name', 'provision_agency', true);
  perform public.record_audit_event(
    'agency.provision', 'rpc', 'agency', v_agency_id,
    v_agency_id, null, null,
    jsonb_build_object(
      'subdomain',      p_subdomain,
      'display_name',   p_name,
      'caller_user_id', auth.uid()
    )
  );

  return v_result;
end;
$$;

revoke execute on function public.provision_agency(text, text, text, text, text) from public, anon;
grant  execute on function public.provision_agency(text, text, text, text, text) to authenticated;

-- =============================================================================
-- 2. provision_tenant (latest body: 20260430230000_provision_tenant_no_default_space.sql)
-- =============================================================================

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
-- @audit:tier1
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

  -- ===== AUDIT INSTRUMENTATION =====
  perform set_config('audit.actor_role',
    case when public.is_platform_admin() then 'platform_admin' else 'agency_owner' end,
    true);
  perform set_config('audit.rpc_name', 'provision_tenant', true);
  perform public.record_audit_event(
    'tenant.provision', 'rpc', 'tenant', v_tenant_id,
    p_agency_id, v_tenant_id, null,
    jsonb_build_object(
      'subdomain',  p_subdomain,
      'name',       p_name,
      'agency_id',  p_agency_id
    )
  );

  return v_result;
end;
$$;

revoke execute on function public.provision_tenant(uuid, text, text, jsonb) from public, anon;
grant  execute on function public.provision_tenant(uuid, text, text, jsonb) to authenticated;
