-- migration: 20260510001400_audit_instrument_spaces
-- purpose: Phase 2 audit instrumentation -- rewrites create_space and delete_space
--   to emit a record_audit_event() call so every space creation/deletion produces
--   an audit row.
-- spec: docs/superpowers/specs/2026-05-10-audit-log-design.md (Phase 2 instrumentation)
--
-- The @audit:tier1 marker on the first non-blank line inside each function body
-- is required by the coverage check in Task 14 (Phase 3). Every function with
-- this marker must contain a record_audit_event() call.
--
-- NOTE: function ownership stays as default (postgres). See Task 4 for rationale.

-- =============================================================================
-- 1. create_space (latest body: 20260315191402_create_tenant_function.sql)
-- =============================================================================

create or replace function public.create_space(
  p_tenant_id uuid,
  p_name text,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
-- @audit:tier1
declare
  uid uuid := auth.uid();
  new_space_id uuid;
  result jsonb;
begin
  if uid is null then
    raise exception 'Must be authenticated';
  end if;

  -- verify user is a tenant member
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id and user_id = uid
  ) then
    raise exception 'Not a member of this tenant';
  end if;

  insert into public.spaces (tenant_id, name, description, created_by)
  values (p_tenant_id, p_name, p_description, uid)
  returning id into new_space_id;

  insert into public.space_members (space_id, user_id, role)
  values (new_space_id, uid, 'owner');

  select jsonb_build_object(
    'id', s.id,
    'tenant_id', s.tenant_id,
    'name', s.name,
    'description', s.description,
    'created_by', s.created_by,
    'created_at', s.created_at,
    'updated_at', s.updated_at
  ) into result
  from public.spaces s
  where s.id = new_space_id;

  -- ===== AUDIT INSTRUMENTATION =====
  perform set_config('audit.actor_role', 'tenant_owner', true);
  perform set_config('audit.rpc_name', 'create_space', true);
  perform public.record_audit_event(
    'space.created', 'rpc', 'space', new_space_id,
    (select t.agency_id from public.tenants t where t.id = p_tenant_id),
    p_tenant_id, new_space_id,
    jsonb_build_object('name', p_name)
  );

  return result;
end
$$;

-- =============================================================================
-- 2. delete_space (latest body: 20260503090000_delete_space_rpc.sql)
-- =============================================================================

create or replace function public.delete_space(p_space_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
-- @audit:tier1
declare
  v_exists boolean;
  v_tenant_id uuid;
  v_agency_id uuid;
  v_space_name text;
begin
  select exists (select 1 from public.spaces where id = p_space_id)
    into v_exists;
  if not v_exists then
    raise exception 'delete_space: space % not found', p_space_id
      using errcode = 'P0002';
  end if;

  if not public.has_space_access(p_space_id, array['owner']) then
    raise exception 'delete_space: not authorized to delete space %', p_space_id
      using errcode = '42501';
  end if;

  -- capture context BEFORE deletion so it's available after the rows are gone
  select s.tenant_id, s.name, t.agency_id
    into v_tenant_id, v_space_name, v_agency_id
    from public.spaces s
    join public.tenants t on t.id = s.tenant_id
    where s.id = p_space_id;

  -- Step 1: delete markers explicitly. The BEFORE DELETE trigger
  -- _log_marker_change inserts marker_changes audit rows referencing
  -- p_space_id; the spaces row must still exist for that FK to hold.
  delete from public.markers where space_id = p_space_id;

  -- Step 2: delete the space. Cascade cleans up everything else
  -- (space_members, companies, products, trials, trial_change_events,
  -- marker_changes, marker_types, etc.).
  delete from public.spaces where id = p_space_id;

  -- ===== AUDIT INSTRUMENTATION =====
  perform set_config('audit.actor_role', 'tenant_owner', true);
  perform set_config('audit.rpc_name', 'delete_space', true);
  perform public.record_audit_event(
    'space.deleted', 'rpc', 'space', p_space_id,
    v_agency_id, v_tenant_id, p_space_id,
    jsonb_build_object('name', v_space_name)
  );
end
$$;

revoke execute on function public.delete_space(uuid) from public;
revoke execute on function public.delete_space(uuid) from anon;
grant  execute on function public.delete_space(uuid) to authenticated;

comment on function public.delete_space(uuid) is
  'Authorized delete of a space. Deletes markers first (so the BEFORE DELETE marker trigger writes its audit rows while the spaces row still exists), then deletes the space (cascade handles the rest). Gated on has_space_access(p_space_id, array[''owner'']). SECURITY DEFINER. Emits space.deleted audit event.';
