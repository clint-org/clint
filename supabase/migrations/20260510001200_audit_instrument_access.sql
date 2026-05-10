-- migration: 20260510001200_audit_instrument_access
-- purpose: Phase 2 audit instrumentation -- rewrites update_tenant_access to emit
--   a record_audit_event() call after its existing logic so that every access-policy
--   change produces an audit row with a full domain allowlist diff and self_join
--   toggle state.
-- spec: docs/superpowers/specs/2026-05-10-audit-log-design.md (Phase 2 instrumentation)
--
-- Authoritative source:
--   update_tenant_access : 20260428041700_whitelabel_rpc_update_tenant_access.sql
--
-- Because p_settings is a JSONB blob with optional keys, BEFORE state is captured
-- only for the fields that are actually being mutated (same conditional pattern as
-- Task 9 branding migration). The SELECT ... FOR UPDATE is inserted at the very top
-- of the body, before any validation, so the diff is atomic with the update.
--
-- The @audit:tier1 marker on the first non-blank line inside the function body
-- is required by the coverage check in Task 14 (Phase 3).

create or replace function public.update_tenant_access(
  p_tenant_id uuid,
  p_settings  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- @audit:tier1
declare
  v_agency_id  uuid;
  v_allowlist  text[];
  v_domain_re  text := '^[a-z0-9.-]+\.[a-z]{2,}$';
  d            text;
  -- BEFORE-state for diff
  v_was_allowlist  text[];
  v_was_self_join  boolean;
  -- diff results
  v_added   text[];
  v_removed text[];
begin
  -- BEFORE state with row lock so the diff is atomic with the update.
  -- Also captures agency_id in a single round-trip.
  select agency_id, email_domain_allowlist, email_self_join_enabled
    into v_agency_id, v_was_allowlist, v_was_self_join
    from public.tenants
   where id = p_tenant_id
     for update;

  if auth.uid() is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;

  if not (
    public.is_tenant_member(p_tenant_id, array['owner'])
    or (v_agency_id is not null and public.is_agency_member(v_agency_id, array['owner']))
    or public.is_platform_admin()
  ) then
    raise exception 'Insufficient permissions' using errcode = '42501';
  end if;

  if p_settings ? 'email_domain_allowlist' then
    v_allowlist := coalesce(
      array(select jsonb_array_elements_text(p_settings -> 'email_domain_allowlist')),
      '{}'::text[]
    );
    foreach d in array v_allowlist loop
      if d !~ v_domain_re then
        raise exception 'Invalid domain in allowlist: %', d using errcode = 'P0001';
      end if;
    end loop;
  end if;

  update public.tenants
     set email_domain_allowlist  = coalesce(v_allowlist, email_domain_allowlist),
         email_self_join_enabled = coalesce((p_settings ->> 'email_self_join_enabled')::boolean, email_self_join_enabled),
         updated_at              = now()
   where id = p_tenant_id;

  -- Compute the allowlist diff (only meaningful when the key was submitted).
  if p_settings ? 'email_domain_allowlist' then
    v_added := coalesce(array(
      select unnest(coalesce(v_allowlist, array[]::text[]))
      except select unnest(coalesce(v_was_allowlist, array[]::text[]))
    ), array[]::text[]);
    v_removed := coalesce(array(
      select unnest(coalesce(v_was_allowlist, array[]::text[]))
      except select unnest(coalesce(v_allowlist, array[]::text[]))
    ), array[]::text[]);
  else
    v_added   := array[]::text[];
    v_removed := array[]::text[];
  end if;

  -- ===== AUDIT INSTRUMENTATION =====
  perform set_config('audit.actor_role',
    case when public.is_platform_admin() then 'platform_admin' else 'tenant_owner' end,
    true);
  perform set_config('audit.rpc_name', 'update_tenant_access', true);
  perform public.record_audit_event(
    'tenant.access_policy_updated', 'rpc', 'access_policy', p_tenant_id,
    v_agency_id, p_tenant_id, null,
    jsonb_build_object(
      'allowlist_added',   v_added,
      'allowlist_removed', v_removed,
      'self_join_was',     v_was_self_join,
      'self_join_now',     coalesce(
        (p_settings ->> 'email_self_join_enabled')::boolean,
        v_was_self_join
      )
    )
  );

  return jsonb_build_object('id', p_tenant_id, 'updated', true);
end;
$$;

comment on function public.update_tenant_access(uuid, jsonb) is
  'Updates email_domain_allowlist and email_self_join_enabled. Validates '
  'each domain matches the simple domain regex. Separate from branding '
  'so access changes are auditable independently.';

revoke execute on function public.update_tenant_access(uuid, jsonb) from public, anon;
grant  execute on function public.update_tenant_access(uuid, jsonb) to authenticated;
