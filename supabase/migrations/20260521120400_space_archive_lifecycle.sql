-- migration: 20260521120400_space_archive_lifecycle
-- purpose: add the space archive tier and split the existing single-step
--          delete_space into a two-stage flow (archive -> permanent delete).
--          addresses cascade-safety finding #1: deleting a populated space
--          today is a single irreversible owner click that purges every
--          dependent row with no recovery path. archive is the cheap,
--          reversible default; permanently_delete_space is gated on the
--          tenant owner (or platform admin) and refuses unless the space
--          has been archived first.
--
--   schema:
--     spaces.archived_at timestamptz null    -- nullable, indefinite archive
--
--   rpcs:
--     public.archive_space(p_space_id uuid)              returns void
--     public.restore_space(p_space_id uuid)              returns void
--     public.permanently_delete_space(p_space_id uuid)   returns jsonb
--
--   all three are SECURITY DEFINER and marked @audit:tier1 -- every call
--   emits a record_audit_event() row (space.archived / space.restored /
--   space.deleted).
--
--   the legacy public.delete_space(uuid) RPC is left intact. historical
--   migration smoke tests in 20260503090000_delete_space_rpc.sql and
--   20260510001400_audit_instrument_spaces.sql still reference it; UI and
--   integration tests migrate to permanently_delete_space in T11/T15.
--
--   role gates:
--     archive_space, restore_space: has_space_access(p_space_id, array['owner'])
--     permanently_delete_space    : is_tenant_member(spaces.tenant_id, array['owner'])
--                                    OR is_platform_admin()
--     permanently_delete_space    : refuses if archived_at is null UNLESS
--                                    caller is platform admin (override).
--
--   inline smoke test covers four role gates (A: space owner, B: tenant
--   owner on archived, C: tenant owner on non-archived, D: platform admin
--   on non-archived) plus audit emission on every successful call.
--
--   see docs/superpowers/specs/2026-05-20-cascade-safety-design.md
--   ("space lifecycle: archive + permanent delete") and the decision-log
--   entry "Archive does not auto-expire to permanent delete" (2026-05-20).


-- =============================================================================
-- 1. spaces.archived_at column
-- =============================================================================

alter table public.spaces
  add column archived_at timestamptz null;

comment on column public.spaces.archived_at is
  'When non-null, the space is archived: hidden from default queries, '
  'read-only in most UI surfaces, and eligible for permanent deletion via '
  'public.permanently_delete_space(). Set by public.archive_space(); '
  'cleared by public.restore_space(). No auto-expiry; archive is '
  'indefinite. See 2026-05-20 cascade-safety design.';

create index idx_spaces_archived_at on public.spaces (archived_at)
  where archived_at is not null;


-- =============================================================================
-- 2. archive_space(p_space_id uuid) -- reversible, space-owner gated
-- =============================================================================

create or replace function public.archive_space(p_space_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
-- @audit:tier1
declare
  v_already_archived boolean;
  v_tenant_id        uuid;
  v_agency_id        uuid;
  v_space_name       text;
begin
  if auth.uid() is null then
    raise exception 'archive_space: must be authenticated'
      using errcode = '28000';
  end if;

  if not public.has_space_access(p_space_id, array['owner']) then
    raise exception 'archive_space: not authorized to archive space %', p_space_id
      using errcode = '42501';
  end if;

  select s.archived_at is not null, s.tenant_id, s.name, t.agency_id
    into v_already_archived, v_tenant_id, v_space_name, v_agency_id
    from public.spaces s
    join public.tenants t on t.id = s.tenant_id
    where s.id = p_space_id;

  if v_already_archived is null then
    raise exception 'archive_space: space % not found', p_space_id
      using errcode = 'P0002';
  end if;

  -- idempotent: already archived is a noop. no second audit row is emitted
  -- so audit history reflects state transitions rather than redundant
  -- owner clicks.
  if v_already_archived then
    return;
  end if;

  update public.spaces
     set archived_at = now()
   where id = p_space_id
     and archived_at is null;

  -- ===== audit instrumentation =====
  perform set_config('audit.actor_role', 'space_owner', true);
  perform set_config('audit.rpc_name', 'archive_space', true);
  perform public.record_audit_event(
    'space.archived', 'rpc', 'space', p_space_id,
    v_agency_id, v_tenant_id, p_space_id,
    jsonb_build_object('name', v_space_name)
  );
end;
$$;

revoke execute on function public.archive_space(uuid) from public;
revoke execute on function public.archive_space(uuid) from anon;
grant  execute on function public.archive_space(uuid) to authenticated;

comment on function public.archive_space(uuid) is
  'Archives a space: sets spaces.archived_at = now(). Reversible via '
  'public.restore_space(). Gated on has_space_access(p_space_id, '
  'array[''owner'']). Noop when the space is already archived. Emits '
  'space.archived audit event on the state transition. SECURITY DEFINER.';


-- =============================================================================
-- 3. restore_space(p_space_id uuid) -- inverse of archive_space
-- =============================================================================

create or replace function public.restore_space(p_space_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
-- @audit:tier1
declare
  v_archived_at timestamptz;
  v_tenant_id   uuid;
  v_agency_id   uuid;
  v_space_name  text;
  v_exists      boolean;
begin
  if auth.uid() is null then
    raise exception 'restore_space: must be authenticated'
      using errcode = '28000';
  end if;

  if not public.has_space_access(p_space_id, array['owner']) then
    raise exception 'restore_space: not authorized to restore space %', p_space_id
      using errcode = '42501';
  end if;

  select true, s.archived_at, s.tenant_id, s.name, t.agency_id
    into v_exists, v_archived_at, v_tenant_id, v_space_name, v_agency_id
    from public.spaces s
    join public.tenants t on t.id = s.tenant_id
    where s.id = p_space_id;

  if v_exists is null then
    raise exception 'restore_space: space % not found', p_space_id
      using errcode = 'P0002';
  end if;

  -- idempotent: not archived is a noop.
  if v_archived_at is null then
    return;
  end if;

  update public.spaces
     set archived_at = null
   where id = p_space_id
     and archived_at is not null;

  -- ===== audit instrumentation =====
  perform set_config('audit.actor_role', 'space_owner', true);
  perform set_config('audit.rpc_name', 'restore_space', true);
  perform public.record_audit_event(
    'space.restored', 'rpc', 'space', p_space_id,
    v_agency_id, v_tenant_id, p_space_id,
    jsonb_build_object('name', v_space_name)
  );
end;
$$;

revoke execute on function public.restore_space(uuid) from public;
revoke execute on function public.restore_space(uuid) from anon;
grant  execute on function public.restore_space(uuid) to authenticated;

comment on function public.restore_space(uuid) is
  'Restores an archived space: clears spaces.archived_at. Gated on '
  'has_space_access(p_space_id, array[''owner'']). Noop when the space is '
  'not archived. Emits space.restored audit event on the state transition. '
  'SECURITY DEFINER.';


-- =============================================================================
-- 4. permanently_delete_space(p_space_id uuid) -- tenant-owner / platform admin
-- =============================================================================
-- captures dependent counts before deletion (for the audit metadata),
-- then mirrors the ordered-delete pattern from the legacy delete_space
-- (markers first, so BEFORE DELETE marker_changes audit rows land while
-- the spaces row still exists; then the space row itself with cascade
-- sweeping the rest).

create or replace function public.permanently_delete_space(p_space_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- @audit:tier1
declare
  v_tenant_id    uuid;
  v_agency_id    uuid;
  v_space_name   text;
  v_archived_at  timestamptz;
  v_is_admin     boolean;
  v_is_owner     boolean;
  v_counts       jsonb;
  v_companies    int;
  v_products     int;
  v_trials       int;
  v_markers      int;
  v_materials    int;
  v_events       int;
  v_pi           int;
  v_marker_types int;
  v_actor_role   text;
begin
  if auth.uid() is null then
    raise exception 'permanently_delete_space: must be authenticated'
      using errcode = '28000';
  end if;

  -- existence + parent linkage for both authz and audit scope.
  select s.tenant_id, s.name, s.archived_at, t.agency_id
    into v_tenant_id, v_space_name, v_archived_at, v_agency_id
    from public.spaces s
    join public.tenants t on t.id = s.tenant_id
    where s.id = p_space_id;

  if v_tenant_id is null then
    raise exception 'permanently_delete_space: space % not found', p_space_id
      using errcode = 'P0002';
  end if;

  v_is_admin := public.is_platform_admin();
  v_is_owner := public.is_tenant_member(v_tenant_id, array['owner']);

  if not (v_is_admin or v_is_owner) then
    raise exception 'permanently_delete_space: not authorized to permanently delete space %', p_space_id
      using errcode = '42501';
  end if;

  -- archive gate: non-admins must archive first; admins override.
  if v_archived_at is null and not v_is_admin then
    raise exception 'permanently_delete_space: space must be archived first (call archive_space)'
      using errcode = '42501';
  end if;

  -- capture dependent counts BEFORE the cascade runs so the audit metadata
  -- reflects what was actually purged. these queries each take the space_id
  -- partial index, so even a populated space is cheap.
  select count(*)::int into v_companies    from public.companies    where space_id = p_space_id;
  select count(*)::int into v_products     from public.products     where space_id = p_space_id;
  select count(*)::int into v_trials       from public.trials       where space_id = p_space_id;
  select count(*)::int into v_markers      from public.markers      where space_id = p_space_id;
  select count(*)::int into v_materials    from public.materials    where space_id = p_space_id;
  select count(*)::int into v_events       from public.events       where space_id = p_space_id;
  select count(*)::int into v_pi           from public.primary_intelligence where space_id = p_space_id;
  select count(*)::int into v_marker_types from public.marker_types where space_id = p_space_id;

  v_counts := jsonb_build_object(
    'name',          v_space_name,
    'companies',     v_companies,
    'products',      v_products,
    'trials',        v_trials,
    'markers',       v_markers,
    'materials',     v_materials,
    'events',        v_events,
    'primary_intelligence', v_pi,
    'marker_types',  v_marker_types,
    'was_archived',  v_archived_at is not null,
    'platform_admin_override', v_is_admin and v_archived_at is null
  );

  -- ordered delete: markers first so the BEFORE DELETE _log_marker_change
  -- trigger writes marker_changes audit rows while the spaces row still
  -- exists (the FK on marker_changes.space_id rejects orphaned inserts).
  -- the existing materials AFTER DELETE trigger (20260521120000) enqueues
  -- every materials.file_path into r2_pending_deletes as the cascade walks.
  delete from public.markers where space_id = p_space_id;
  delete from public.spaces  where id = p_space_id;

  -- ===== audit instrumentation =====
  v_actor_role := case
    when v_is_admin and not v_is_owner then 'platform_admin'
    else 'tenant_owner'
  end;
  perform set_config('audit.actor_role', v_actor_role, true);
  perform set_config('audit.rpc_name', 'permanently_delete_space', true);
  perform public.record_audit_event(
    'space.deleted', 'rpc', 'space', p_space_id,
    v_agency_id, v_tenant_id, p_space_id,
    v_counts
  );

  return v_counts;
end;
$$;

revoke execute on function public.permanently_delete_space(uuid) from public;
revoke execute on function public.permanently_delete_space(uuid) from anon;
grant  execute on function public.permanently_delete_space(uuid) to authenticated;

comment on function public.permanently_delete_space(uuid) is
  'Permanently deletes a space and all of its dependents. Gated on '
  'is_tenant_member(spaces.tenant_id, array[''owner'']) OR '
  'is_platform_admin(). Non-admins must archive the space first '
  '(archived_at not null); platform admins may override. Captures '
  'dependent counts for the audit metadata, then deletes markers '
  'explicitly (BEFORE DELETE marker_changes trigger needs the spaces '
  'row still present) and finally the space row (cascade handles the '
  'rest). Emits space.deleted audit event. Returns the count breakdown '
  'as jsonb. SECURITY DEFINER.';


-- =============================================================================
-- inline smoke test
-- =============================================================================
-- four role gates plus audit emission, all in a single anonymous block so a
-- failure in any gate aborts the migration with a clear message. teardown
-- follows the clint.member_guard_cascade = on bypass pattern from
-- 20260503090000_delete_space_rpc.sql.

do $$
declare
  v_tenant       uuid;
  v_agency       uuid;
  v_space        uuid;
  v_owner        uuid;
  v_owner_email  text;
  v_archived_at  timestamptz;
  v_audit_n      int;
begin
  -- ===========================================================================
  -- ROLE GATE A: space owner (not tenant owner) -- archive/restore succeed,
  --   permanently_delete_space rejects with 42501.
  -- ===========================================================================
  v_owner       := gen_random_uuid();
  v_owner_email := 'archive-smoke-a-' || v_owner || '@example.com';
  v_agency      := gen_random_uuid();
  v_tenant      := gen_random_uuid();
  v_space       := gen_random_uuid();

  insert into auth.users (id, email, instance_id, aud, role)
    values (v_owner, v_owner_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  -- agency-backed tenant so the audit event captures a non-null agency_id.
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency, 'archive-smoke-agency', 'archive-smoke-' || left(v_agency::text, 8),
            'archsmoke-' || left(v_agency::text, 8), 'Archive Smoke', 'ops@example.com');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant, v_agency, 'archive-smoke-tenant',
            'archive-smoke-' || left(v_tenant::text, 8),
            'archsmoke-t-' || left(v_tenant::text, 8),
            'Archive Smoke Tenant');
  -- create the space first (no tenant_members row yet -> v_owner is NOT a
  -- tenant owner). then add a space_members row with role = owner so the
  -- caller is strictly a space owner.
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space, v_tenant, 'archive-smoke-space-a', v_owner);
  insert into public.space_members (space_id, user_id, role)
    values (v_space, v_owner, 'owner');

  -- impersonate v_owner so auth.uid() returns the right value inside the RPC.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated', 'email', v_owner_email)::text,
    true
  );
  set local role authenticated;

  -- archive succeeds. archived_at populates.
  perform public.archive_space(v_space);
  select archived_at into v_archived_at from public.spaces where id = v_space;
  if v_archived_at is null then
    reset role;
    raise exception 'gate A FAIL: archive_space did not set archived_at';
  end if;

  -- audit emitted: exactly one space.archived row for this space.
  select count(*)::int into v_audit_n
    from public.audit_events
    where action = 'space.archived' and resource_id = v_space;
  if v_audit_n <> 1 then
    reset role;
    raise exception 'gate A FAIL: expected 1 space.archived audit row, got %', v_audit_n;
  end if;

  -- restore succeeds. archived_at clears.
  perform public.restore_space(v_space);
  select archived_at into v_archived_at from public.spaces where id = v_space;
  if v_archived_at is not null then
    reset role;
    raise exception 'gate A FAIL: restore_space did not clear archived_at';
  end if;

  select count(*)::int into v_audit_n
    from public.audit_events
    where action = 'space.restored' and resource_id = v_space;
  if v_audit_n <> 1 then
    reset role;
    raise exception 'gate A FAIL: expected 1 space.restored audit row, got %', v_audit_n;
  end if;

  -- archive again so the next call has the right precondition.
  perform public.archive_space(v_space);

  -- permanently_delete_space MUST raise 42501 -- v_owner is a space owner,
  -- not a tenant owner, and not a platform admin.
  begin
    perform public.permanently_delete_space(v_space);
    reset role;
    raise exception 'gate A FAIL: permanently_delete_space should have raised 42501 for space-only owner';
  exception
    when sqlstate '42501' then
      null;  -- expected
    when others then
      reset role;
      raise exception 'gate A FAIL: permanently_delete_space raised wrong sqlstate % (%)',
        sqlstate, sqlerrm;
  end;

  reset role;

  -- teardown gate A.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.space_members  where space_id = v_space;
  delete from public.tenant_members where tenant_id = v_tenant;
  delete from public.spaces         where id = v_space;
  delete from public.tenants        where id = v_tenant;
  delete from public.agencies       where id = v_agency;
  delete from auth.users            where id = v_owner;
  perform set_config('clint.member_guard_cascade', 'off', true);


  -- ===========================================================================
  -- ROLE GATE B: tenant owner on an archived space -- permanently_delete_space
  --   succeeds; row gone; audit row emitted.
  -- ===========================================================================
  v_owner       := gen_random_uuid();
  v_owner_email := 'archive-smoke-b-' || v_owner || '@example.com';
  v_agency      := gen_random_uuid();
  v_tenant      := gen_random_uuid();
  v_space       := gen_random_uuid();

  insert into auth.users (id, email, instance_id, aud, role)
    values (v_owner, v_owner_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency, 'archive-smoke-agency-b', 'archive-smoke-b-' || left(v_agency::text, 8),
            'archsmokeb-' || left(v_agency::text, 8), 'Archive Smoke B', 'ops@example.com');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant, v_agency, 'archive-smoke-tenant-b',
            'archive-smoke-b-' || left(v_tenant::text, 8),
            'archsmokeb-t-' || left(v_tenant::text, 8),
            'Archive Smoke Tenant B');
  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant, v_owner, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space, v_tenant, 'archive-smoke-space-b', v_owner);
  insert into public.space_members (space_id, user_id, role)
    values (v_space, v_owner, 'owner');

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated', 'email', v_owner_email)::text,
    true
  );
  set local role authenticated;

  -- archive first (tenant owner is also space-owner-eligible via
  -- has_space_access).
  perform public.archive_space(v_space);

  -- permanently delete succeeds.
  perform public.permanently_delete_space(v_space);

  reset role;

  -- spaces row is gone.
  if exists (select 1 from public.spaces where id = v_space) then
    raise exception 'gate B FAIL: space row still present after permanently_delete_space';
  end if;

  -- audit emitted: exactly one space.deleted row for this space.
  select count(*)::int into v_audit_n
    from public.audit_events
    where action = 'space.deleted' and resource_id = v_space;
  if v_audit_n <> 1 then
    raise exception 'gate B FAIL: expected 1 space.deleted audit row, got %', v_audit_n;
  end if;

  -- teardown gate B. space already gone; sweep tenant_members + parents.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.tenant_members where tenant_id = v_tenant;
  delete from public.tenants        where id = v_tenant;
  delete from public.agencies       where id = v_agency;
  delete from auth.users            where id = v_owner;
  perform set_config('clint.member_guard_cascade', 'off', true);


  -- ===========================================================================
  -- ROLE GATE C: tenant owner on a non-archived space -- permanently_delete
  --   raises 42501 ("not archived; not platform admin").
  -- ===========================================================================
  v_owner       := gen_random_uuid();
  v_owner_email := 'archive-smoke-c-' || v_owner || '@example.com';
  v_agency      := gen_random_uuid();
  v_tenant      := gen_random_uuid();
  v_space       := gen_random_uuid();

  insert into auth.users (id, email, instance_id, aud, role)
    values (v_owner, v_owner_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency, 'archive-smoke-agency-c', 'archive-smoke-c-' || left(v_agency::text, 8),
            'archsmokec-' || left(v_agency::text, 8), 'Archive Smoke C', 'ops@example.com');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant, v_agency, 'archive-smoke-tenant-c',
            'archive-smoke-c-' || left(v_tenant::text, 8),
            'archsmokec-t-' || left(v_tenant::text, 8),
            'Archive Smoke Tenant C');
  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant, v_owner, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space, v_tenant, 'archive-smoke-space-c', v_owner);
  insert into public.space_members (space_id, user_id, role)
    values (v_space, v_owner, 'owner');

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated', 'email', v_owner_email)::text,
    true
  );
  set local role authenticated;

  begin
    perform public.permanently_delete_space(v_space);
    reset role;
    raise exception 'gate C FAIL: permanently_delete_space should have raised 42501 for non-archived space';
  exception
    when sqlstate '42501' then
      null;  -- expected: space must be archived first
    when others then
      reset role;
      raise exception 'gate C FAIL: permanently_delete_space raised wrong sqlstate % (%)',
        sqlstate, sqlerrm;
  end;

  reset role;

  -- space should still exist (the call refused before deleting anything).
  if not exists (select 1 from public.spaces where id = v_space) then
    raise exception 'gate C FAIL: space row missing after refused permanently_delete_space';
  end if;

  -- teardown gate C.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.space_members  where space_id = v_space;
  delete from public.tenant_members where tenant_id = v_tenant;
  delete from public.spaces         where id = v_space;
  delete from public.tenants        where id = v_tenant;
  delete from public.agencies       where id = v_agency;
  delete from auth.users            where id = v_owner;
  perform set_config('clint.member_guard_cascade', 'off', true);


  -- ===========================================================================
  -- ROLE GATE D: platform admin on a non-archived space -- override succeeds.
  -- ===========================================================================
  v_owner       := gen_random_uuid();
  v_owner_email := 'archive-smoke-d-' || v_owner || '@example.com';
  v_agency      := gen_random_uuid();
  v_tenant      := gen_random_uuid();
  v_space       := gen_random_uuid();

  insert into auth.users (id, email, instance_id, aud, role)
    values (v_owner, v_owner_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  -- promote to platform admin -- bypasses both the tenant-owner gate AND
  -- the archived-first gate.
  insert into public.platform_admins (user_id) values (v_owner);

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency, 'archive-smoke-agency-d', 'archive-smoke-d-' || left(v_agency::text, 8),
            'archsmoked-' || left(v_agency::text, 8), 'Archive Smoke D', 'ops@example.com');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant, v_agency, 'archive-smoke-tenant-d',
            'archive-smoke-d-' || left(v_tenant::text, 8),
            'archsmoked-t-' || left(v_tenant::text, 8),
            'Archive Smoke Tenant D');
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space, v_tenant, 'archive-smoke-space-d', v_owner);
  -- NB: no tenant_members row -- caller has no tenant ownership; only the
  -- platform_admins row authorizes them. archived_at is null; the override
  -- is the only thing that makes this succeed.

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated', 'email', v_owner_email)::text,
    true
  );
  set local role authenticated;

  -- non-archived; succeeds via platform_admin override.
  perform public.permanently_delete_space(v_space);

  reset role;

  if exists (select 1 from public.spaces where id = v_space) then
    raise exception 'gate D FAIL: space row still present after platform-admin permanently_delete_space';
  end if;

  select count(*)::int into v_audit_n
    from public.audit_events
    where action = 'space.deleted' and resource_id = v_space;
  if v_audit_n <> 1 then
    raise exception 'gate D FAIL: expected 1 space.deleted audit row, got %', v_audit_n;
  end if;

  -- teardown gate D.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.platform_admins where user_id = v_owner;
  delete from public.tenants         where id = v_tenant;
  delete from public.agencies        where id = v_agency;
  delete from auth.users             where id = v_owner;
  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'space_archive_lifecycle smoke test: PASS';
end $$;
