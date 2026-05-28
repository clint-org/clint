-- migration: 20260528100000_update_marker_assignments_rpc
-- purpose: atomic marker-assignment replacement to defeat the orphan-cleanup
--          trigger during analyst edits.
--
-- background:
--   The Angular MarkerService.updateAssignments() used to do
--   `delete from marker_assignments where marker_id = X` followed by
--   `insert into marker_assignments (...)`, each as its own PostgREST request
--   (= its own DB transaction). The AFTER DELETE trigger
--   `_cleanup_orphan_marker` (migration 20260521120300) drops the parent
--   marker the moment its last assignment row is deleted. For any marker
--   with exactly one assignment (which is every CT.gov-derived Trial Start
--   / PCD / Trial End marker, and analyst-added markers attached to a single
--   trial), the DELETE step removes the marker entirely; the subsequent
--   INSERT then fails RLS WITH CHECK because the EXISTS subquery on
--   public.markers comes up empty -- which is the observed
--   "violates row-level security policy for table marker_assignments" error.
--   A second edit attempt against the now-deleted marker returns 0 rows
--   from UPDATE markers, which PostgREST's .single() surfaces as PGRST116
--   "Cannot coerce the result to a single JSON object".
--
--   Wrapping the DELETE and INSERT in a single transaction would NOT help:
--   row-level AFTER triggers see the intermediate state inside the same
--   transaction. The fix has to be ordering -- insert new rows first, then
--   delete the stale ones, so the parent marker always has at least one
--   live assignment.
--
-- design:
--   Single SECURITY DEFINER RPC. INSERTs every row in p_trial_ids
--   (ON CONFLICT DO NOTHING so re-asserting an existing assignment is a
--   no-op), then DELETEs every row whose trial_id is not in the new set.
--   Order is load-bearing.
--
--   Authorization mirrors the markers UPDATE and marker_assignments INSERT
--   RLS policies: caller must hold owner/editor on the marker's space via
--   has_space_access(). Empty p_trial_ids is rejected -- the form already
--   refuses to submit without at least one trial, and allowing an empty
--   set would itself trigger the orphan-cleanup we are fixing.
--
-- not @audit:tier1 -- this RPC is an analyst data edit, not a tier-1
-- governance/admin surface. The marker_changes audit trigger on the parent
-- markers table already records material changes; assignment churn is
-- captured via the trial_change_events feed when relevant.
--
-- callers:
--   - src/client/src/app/core/services/marker.service.ts:updateAssignments()
--
-- related:
--   - 20260412130100_marker_system_redesign.sql        (marker_assignments RLS)
--   - 20260521120300_orphan_marker_cleanup.sql         (the trigger we sidestep)
--   - 20260502120700_marker_changes_trigger.sql        (parent-marker audit)


-- =============================================================================
-- 1. update_marker_assignments
-- =============================================================================

create or replace function public.update_marker_assignments(
  p_marker_id uuid,
  p_trial_ids uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space_id uuid;
  v_trial_id uuid;
begin
  select space_id into v_space_id
    from public.markers
   where id = p_marker_id;

  if v_space_id is null then
    raise exception 'marker not found' using errcode = 'P0002';
  end if;

  if not public.has_space_access(v_space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- An empty set would delete every assignment, and the AFTER DELETE
  -- orphan-cleanup trigger would then drop the parent marker. The form's
  -- canSubmit() refuses an empty selection; we defend the RPC contract too.
  if p_trial_ids is null or array_length(p_trial_ids, 1) is null then
    raise exception 'at least one trial required' using errcode = '22023';
  end if;

  -- Insert-then-prune. INSERTs first guarantee the marker keeps at least
  -- one live assignment at every point, so _cleanup_orphan_marker never
  -- observes a zero-row state for this marker. ON CONFLICT DO NOTHING so
  -- existing assignments (the common case for "edit the title, keep the
  -- same trial") are idempotent no-ops rather than constraint failures.
  foreach v_trial_id in array p_trial_ids
  loop
    insert into public.marker_assignments (marker_id, trial_id)
      values (p_marker_id, v_trial_id)
      on conflict (marker_id, trial_id) do nothing;
  end loop;

  delete from public.marker_assignments
   where marker_id = p_marker_id
     and trial_id <> all(p_trial_ids);
end;
$$;

revoke execute on function public.update_marker_assignments(uuid, uuid[]) from public;
grant  execute on function public.update_marker_assignments(uuid, uuid[]) to authenticated;

comment on function public.update_marker_assignments(uuid, uuid[]) is
  'Atomically replace marker_assignments for a marker. Inserts new assignments first (idempotent), then deletes stale ones, so the AFTER DELETE _cleanup_orphan_marker trigger never observes zero assignments and never drops the parent marker mid-edit. SECURITY DEFINER. Caller must hold owner/editor on the marker''s space; p_trial_ids must be non-empty.';


-- =============================================================================
-- inline smoke tests
-- =============================================================================
-- Mirror the orphan_marker_cleanup smoke (20260521120300) pattern: hermetic
-- fixture per case, impersonate via set_config so trigger-derived audit rows
-- get a non-null changed_by, tear down under the member_guard_cascade GUC.

do $$
declare
  v_marker_type uuid;
begin
  select id into v_marker_type from public.marker_types where space_id is null limit 1;
  if v_marker_type is null then
    raise exception 'update_marker_assignments smoke FAIL: no global marker_type available';
  end if;

  -- ===========================================================================
  -- case A: marker with one assignment -> swap to a different trial.
  -- This is the exact scenario that the old client-side DELETE+INSERT lost
  -- the marker to (CT.gov auto-derived markers have exactly one assignment).
  -- ===========================================================================
  declare
    v_user    uuid := gen_random_uuid();
    v_tenant  uuid := gen_random_uuid();
    v_space   uuid := gen_random_uuid();
    v_company uuid := gen_random_uuid();
    v_asset   uuid := gen_random_uuid();
    v_trial_a uuid := gen_random_uuid();
    v_trial_b uuid := gen_random_uuid();
    v_marker  uuid := gen_random_uuid();
    v_email   text := 'uma-a-' || gen_random_uuid() || '@example.com';
    v_count   int;
    v_t       uuid;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'uma-a-tenant', 'uma-a-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role)
      values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'uma-a-space', v_user);
    insert into public.space_members (space_id, user_id, role)
      values (v_space, v_user, 'owner');
    insert into public.companies (id, space_id, created_by, name)
      values (v_company, v_space, v_user, 'uma-a-co');
    insert into public.assets (id, space_id, created_by, company_id, name)
      values (v_asset, v_space, v_user, v_company, 'uma-a-drug');
    insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
      values (v_trial_a, v_space, v_user, v_asset, 'uma-a-trial-a', 'NCT-UMA-A'),
             (v_trial_b, v_space, v_user, v_asset, 'uma-a-trial-b', 'NCT-UMA-B');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.markers (id, space_id, marker_type_id, title, event_date, projection, created_by)
      values (v_marker, v_space, v_marker_type, 'uma-a-marker', current_date, 'actual', v_user);
    insert into public.marker_assignments (marker_id, trial_id)
      values (v_marker, v_trial_a);

    -- swap the single assignment from trial_a -> trial_b. under the OLD
    -- client-side DELETE+INSERT pattern this would delete the marker mid-flight.
    perform public.update_marker_assignments(v_marker, array[v_trial_b]);

    select count(*)::int into v_count from public.markers where id = v_marker;
    if v_count <> 1 then
      raise exception 'update_marker_assignments smoke FAIL case A: marker should survive single-assignment swap, got count %', v_count;
    end if;

    select count(*)::int into v_count from public.marker_assignments where marker_id = v_marker;
    if v_count <> 1 then
      raise exception 'update_marker_assignments smoke FAIL case A: expected 1 assignment after swap, got %', v_count;
    end if;

    select trial_id into v_t from public.marker_assignments where marker_id = v_marker;
    if v_t <> v_trial_b then
      raise exception 'update_marker_assignments smoke FAIL case A: expected trial_b assignment, got %', v_t;
    end if;

    raise notice 'update_marker_assignments smoke ok A: single-assignment swap preserves the marker';

    perform set_config('request.jwt.claims', '', true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.markers            where space_id = v_space;
    delete from public.trial_change_events where space_id = v_space;
    delete from public.marker_changes     where space_id = v_space;
    delete from public.space_members      where space_id = v_space;
    delete from public.tenant_members     where tenant_id = v_tenant;
    delete from public.spaces             where id = v_space;
    delete from public.tenants            where id = v_tenant;
    delete from auth.users                where id = v_user;
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  -- ===========================================================================
  -- case B: marker with [A, B] -> [B, C]. drop A, keep B, add C.
  -- Mixed add/remove path: verify the new set is exactly what we asked for
  -- and the marker survives.
  -- ===========================================================================
  declare
    v_user    uuid := gen_random_uuid();
    v_tenant  uuid := gen_random_uuid();
    v_space   uuid := gen_random_uuid();
    v_company uuid := gen_random_uuid();
    v_asset   uuid := gen_random_uuid();
    v_trial_a uuid := gen_random_uuid();
    v_trial_b uuid := gen_random_uuid();
    v_trial_c uuid := gen_random_uuid();
    v_marker  uuid := gen_random_uuid();
    v_email   text := 'uma-b-' || gen_random_uuid() || '@example.com';
    v_count   int;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'uma-b-tenant', 'uma-b-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role)
      values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'uma-b-space', v_user);
    insert into public.space_members (space_id, user_id, role)
      values (v_space, v_user, 'owner');
    insert into public.companies (id, space_id, created_by, name)
      values (v_company, v_space, v_user, 'uma-b-co');
    insert into public.assets (id, space_id, created_by, company_id, name)
      values (v_asset, v_space, v_user, v_company, 'uma-b-drug');
    insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
      values (v_trial_a, v_space, v_user, v_asset, 'uma-b-trial-a', 'NCT-UMB-A'),
             (v_trial_b, v_space, v_user, v_asset, 'uma-b-trial-b', 'NCT-UMB-B'),
             (v_trial_c, v_space, v_user, v_asset, 'uma-b-trial-c', 'NCT-UMB-C');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.markers (id, space_id, marker_type_id, title, event_date, projection, created_by)
      values (v_marker, v_space, v_marker_type, 'uma-b-marker', current_date, 'actual', v_user);
    insert into public.marker_assignments (marker_id, trial_id)
      values (v_marker, v_trial_a),
             (v_marker, v_trial_b);

    perform public.update_marker_assignments(v_marker, array[v_trial_b, v_trial_c]);

    select count(*)::int into v_count from public.markers where id = v_marker;
    if v_count <> 1 then
      raise exception 'update_marker_assignments smoke FAIL case B: marker should survive add/remove, got count %', v_count;
    end if;

    select count(*)::int into v_count
      from public.marker_assignments
     where marker_id = v_marker
       and trial_id in (v_trial_b, v_trial_c);
    if v_count <> 2 then
      raise exception 'update_marker_assignments smoke FAIL case B: expected assignments [B, C], got count % for B/C', v_count;
    end if;

    select count(*)::int into v_count
      from public.marker_assignments
     where marker_id = v_marker
       and trial_id = v_trial_a;
    if v_count <> 0 then
      raise exception 'update_marker_assignments smoke FAIL case B: trial_a should be pruned';
    end if;

    raise notice 'update_marker_assignments smoke ok B: add/remove diff converges to the new set';

    perform set_config('request.jwt.claims', '', true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.markers            where space_id = v_space;
    delete from public.trial_change_events where space_id = v_space;
    delete from public.marker_changes     where space_id = v_space;
    delete from public.space_members      where space_id = v_space;
    delete from public.tenant_members     where tenant_id = v_tenant;
    delete from public.spaces             where id = v_space;
    delete from public.tenants            where id = v_tenant;
    delete from auth.users                where id = v_user;
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  -- ===========================================================================
  -- case C: empty p_trial_ids -> 22023, marker untouched.
  -- ===========================================================================
  declare
    v_user    uuid := gen_random_uuid();
    v_tenant  uuid := gen_random_uuid();
    v_space   uuid := gen_random_uuid();
    v_company uuid := gen_random_uuid();
    v_asset   uuid := gen_random_uuid();
    v_trial   uuid := gen_random_uuid();
    v_marker  uuid := gen_random_uuid();
    v_email   text := 'uma-c-' || gen_random_uuid() || '@example.com';
    v_count   int;
    v_caught  boolean := false;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'uma-c-tenant', 'uma-c-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role)
      values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'uma-c-space', v_user);
    insert into public.space_members (space_id, user_id, role)
      values (v_space, v_user, 'owner');
    insert into public.companies (id, space_id, created_by, name)
      values (v_company, v_space, v_user, 'uma-c-co');
    insert into public.assets (id, space_id, created_by, company_id, name)
      values (v_asset, v_space, v_user, v_company, 'uma-c-drug');
    insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
      values (v_trial, v_space, v_user, v_asset, 'uma-c-trial', 'NCT-UMC');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.markers (id, space_id, marker_type_id, title, event_date, projection, created_by)
      values (v_marker, v_space, v_marker_type, 'uma-c-marker', current_date, 'actual', v_user);
    insert into public.marker_assignments (marker_id, trial_id)
      values (v_marker, v_trial);

    begin
      perform public.update_marker_assignments(v_marker, array[]::uuid[]);
    exception when others then
      if sqlstate <> '22023' then
        raise exception 'update_marker_assignments smoke FAIL case C: expected sqlstate 22023, got % (%)', sqlstate, sqlerrm;
      end if;
      v_caught := true;
    end;

    if not v_caught then
      raise exception 'update_marker_assignments smoke FAIL case C: empty array should have raised';
    end if;

    -- marker still alive, original assignment still attached.
    select count(*)::int into v_count from public.markers where id = v_marker;
    if v_count <> 1 then
      raise exception 'update_marker_assignments smoke FAIL case C: marker dropped after rejected call';
    end if;
    select count(*)::int into v_count from public.marker_assignments where marker_id = v_marker;
    if v_count <> 1 then
      raise exception 'update_marker_assignments smoke FAIL case C: assignment count drift, got %', v_count;
    end if;

    raise notice 'update_marker_assignments smoke ok C: empty array rejected, marker untouched';

    perform set_config('request.jwt.claims', '', true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.markers            where space_id = v_space;
    delete from public.trial_change_events where space_id = v_space;
    delete from public.marker_changes     where space_id = v_space;
    delete from public.space_members      where space_id = v_space;
    delete from public.tenant_members     where tenant_id = v_tenant;
    delete from public.spaces             where id = v_space;
    delete from public.tenants            where id = v_tenant;
    delete from auth.users                where id = v_user;
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  -- ===========================================================================
  -- case D: viewer cannot edit -> 42501, marker untouched.
  -- ===========================================================================
  declare
    v_owner   uuid := gen_random_uuid();
    v_viewer  uuid := gen_random_uuid();
    v_tenant  uuid := gen_random_uuid();
    v_space   uuid := gen_random_uuid();
    v_company uuid := gen_random_uuid();
    v_asset   uuid := gen_random_uuid();
    v_trial_a uuid := gen_random_uuid();
    v_trial_b uuid := gen_random_uuid();
    v_marker  uuid := gen_random_uuid();
    v_o_email text := 'uma-d-o-' || gen_random_uuid() || '@example.com';
    v_v_email text := 'uma-d-v-' || gen_random_uuid() || '@example.com';
    v_count   int;
    v_caught  boolean := false;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_owner,  v_o_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
             (v_viewer, v_v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'uma-d-tenant', 'uma-d-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role)
      values (v_tenant, v_owner, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'uma-d-space', v_owner);
    insert into public.space_members (space_id, user_id, role)
      values (v_space, v_owner,  'owner'),
             (v_space, v_viewer, 'viewer');
    insert into public.companies (id, space_id, created_by, name)
      values (v_company, v_space, v_owner, 'uma-d-co');
    insert into public.assets (id, space_id, created_by, company_id, name)
      values (v_asset, v_space, v_owner, v_company, 'uma-d-drug');
    insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
      values (v_trial_a, v_space, v_owner, v_asset, 'uma-d-trial-a', 'NCT-UMD-A'),
             (v_trial_b, v_space, v_owner, v_asset, 'uma-d-trial-b', 'NCT-UMD-B');

    -- owner creates the marker so the audit trigger sees a sane changed_by.
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_owner::text, 'role', 'authenticated', 'email', v_o_email)::text,
      true
    );
    insert into public.markers (id, space_id, marker_type_id, title, event_date, projection, created_by)
      values (v_marker, v_space, v_marker_type, 'uma-d-marker', current_date, 'actual', v_owner);
    insert into public.marker_assignments (marker_id, trial_id)
      values (v_marker, v_trial_a);

    -- now impersonate the viewer and try to swap assignments.
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_viewer::text, 'role', 'authenticated', 'email', v_v_email)::text,
      true
    );

    begin
      perform public.update_marker_assignments(v_marker, array[v_trial_b]);
    exception when others then
      if sqlstate <> '42501' then
        raise exception 'update_marker_assignments smoke FAIL case D: expected sqlstate 42501, got % (%)', sqlstate, sqlerrm;
      end if;
      v_caught := true;
    end;

    if not v_caught then
      raise exception 'update_marker_assignments smoke FAIL case D: viewer call should have raised forbidden';
    end if;

    -- marker untouched.
    select count(*)::int into v_count from public.markers where id = v_marker;
    if v_count <> 1 then
      raise exception 'update_marker_assignments smoke FAIL case D: marker dropped after viewer call';
    end if;
    select count(*)::int into v_count
      from public.marker_assignments
     where marker_id = v_marker and trial_id = v_trial_a;
    if v_count <> 1 then
      raise exception 'update_marker_assignments smoke FAIL case D: original assignment to trial_a was disturbed';
    end if;

    raise notice 'update_marker_assignments smoke ok D: viewer rejected with 42501, marker untouched';

    perform set_config('request.jwt.claims', '', true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.markers            where space_id = v_space;
    delete from public.trial_change_events where space_id = v_space;
    delete from public.marker_changes     where space_id = v_space;
    delete from public.space_members      where space_id = v_space;
    delete from public.tenant_members     where tenant_id = v_tenant;
    delete from public.spaces             where id = v_space;
    delete from public.tenants            where id = v_tenant;
    delete from auth.users                where id in (v_owner, v_viewer);
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  raise notice 'update_marker_assignments smoke test: PASS';
end $$;
