-- migration: 20260510001500_audit_instrument_domains
-- purpose: Phase 2 audit instrumentation -- rewrites register_custom_domain to
--   emit a record_audit_event() call after its existing logic, and adds an
--   AFTER INSERT trigger on retired_hostnames so that every custom-domain
--   registration and retirement action produces an audit row.
-- spec: docs/superpowers/specs/2026-05-10-audit-log-design.md (Phase 2 instrumentation)
--
-- The @audit:tier1 marker on the first non-blank line inside the function body
-- is required by the coverage check in Task 14 (Phase 3). Every function with
-- this marker must contain a record_audit_event() call.
--
-- retired_hostnames has no tenant_id / agency_id columns (only hostname,
-- retired_at, released_at, previous_kind, previous_id), so both scope
-- arguments in the trigger call are null.
-- NOTE: function ownership stays as default (postgres). See Task 4 for rationale.

-- =============================================================================
-- 1. register_custom_domain (latest body: 20260428042000_whitelabel_rpc_register_custom_domain.sql)
-- =============================================================================

create or replace function public.register_custom_domain(
  p_tenant_id     uuid,
  p_custom_domain text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
-- @audit:tier1
declare
  v_domain_re text := '^[a-z0-9.-]+\.[a-z]{2,}$';
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if not public.is_platform_admin() then
    raise exception 'Platform admin only' using errcode = '42501';
  end if;
  if p_custom_domain is null or p_custom_domain !~ v_domain_re then
    raise exception 'Invalid domain' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.tenants  where custom_domain = p_custom_domain) then
    raise exception 'Domain already in use' using errcode = '23505';
  end if;
  if exists (select 1 from public.agencies where custom_domain = p_custom_domain) then
    raise exception 'Domain already in use' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.retired_hostnames
     where hostname = p_custom_domain and released_at > now()
  ) then
    raise exception 'Domain is in retirement holdback' using errcode = 'P0001';
  end if;

  update public.tenants
     set custom_domain = p_custom_domain, updated_at = now()
   where id = p_tenant_id;

  perform set_config('audit.actor_role', 'platform_admin', true);
  perform set_config('audit.rpc_name', 'register_custom_domain', true);
  perform public.record_audit_event(
    'custom_domain.registered', 'rpc', 'custom_domain', p_tenant_id,
    (select agency_id from public.tenants where id = p_tenant_id),
    p_tenant_id, null,
    jsonb_build_object('domain', p_custom_domain)
  );

  return jsonb_build_object('id', p_tenant_id, 'custom_domain', p_custom_domain);
end;
$$;

comment on function public.register_custom_domain(uuid, text) is
  'Sets tenants.custom_domain. Platform admin only -- the corresponding '
  'Netlify domain alias and TLS cert are configured manually before '
  'calling this. Validates uniqueness across both tenants and agencies '
  'and checks the retired_hostnames holdback.';

revoke execute on function public.register_custom_domain(uuid, text) from public, anon;
grant  execute on function public.register_custom_domain(uuid, text) to authenticated;

-- =============================================================================
-- 2. _audit_trigger_retired_hostnames -- fires on retired_hostnames INSERT
-- =============================================================================

create or replace function public._audit_trigger_retired_hostnames()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public._audit_trigger_should_skip() then return null; end if;
  perform public.record_audit_event(
    'custom_domain.retired', 'trigger', 'custom_domain', null,
    null, null, null,
    jsonb_build_object('hostname', new.hostname, 'released_at', new.released_at)
  );
  return null;
end;
$$;

create trigger trg_audit_retired_hostnames
  after insert on public.retired_hostnames
  for each row execute function public._audit_trigger_retired_hostnames();
