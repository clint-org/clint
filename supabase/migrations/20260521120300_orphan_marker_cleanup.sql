-- migration: 20260521120300_orphan_marker_cleanup
-- purpose: ensure that when the last marker_assignments row for a marker is
--          removed, the parent marker is also removed. addresses cascade
--          safety finding #5 (orphan markers stranded after every trial they
--          were assigned to is deleted). before this trigger a marker
--          assigned only to a deleted trial would persist forever as an
--          unreferenced row in public.markers; nothing in the schema or
--          rls reaches it.
--
--   trigger:
--     public._cleanup_orphan_marker()              trigger fn
--     _cleanup_orphan_marker_trigger               after delete on
--                                                   marker_assignments
--
--   reentrancy with existing flows:
--     - the existing delete_space() rpc
--       (20260503090000_delete_space_rpc.sql) explicitly issues
--       `delete from public.markers where space_id = p_space_id` BEFORE
--       deleting the space row. that statement cascades to
--       marker_assignments (FK on delete cascade), which fires this
--       AFTER DELETE trigger per assignment row. by the time the trigger's
--       `delete from public.markers where id = old.marker_id` runs, the
--       parent marker is either being deleted in the same statement or
--       already gone. postgres treats the trigger-issued delete as a
--       separate statement under the same transaction; the where clause
--       simply matches zero rows when the marker is already removed, so
--       the trigger body is a no-op. no error is raised.
--     - the marker_changes BEFORE DELETE trigger on public.markers
--       (20260502120700_marker_changes_trigger.sql) inspects
--       marker_assignments at audit time to fan out trial_change_events.
--       it fires before this trigger because the cascade hits markers
--       first (BEFORE DELETE) and only then propagates to
--       marker_assignments. so the audit fanout still sees the live
--       assignments; the orphan trigger runs strictly after.
--     - the existing unique (marker_id, trial_id) constraint on
--       marker_assignments means a marker with one remaining assignment
--       row is still actively referenced; only when zero remain do we
--       remove the parent. defensive `exists` short-circuits as soon as
--       the first surviving row is found rather than counting all of
--       them.
--
--   inline smoke test (under begin/rollback envelope) verifies:
--     case A: marker assigned to two trials -> delete one trial; marker
--             survives with one remaining assignment.
--     case B: marker assigned to one trial -> delete the trial; marker
--             is removed.
--     case C: space cascade through delete_space() does not error and
--             leaves no rows behind.
--
--   see docs/superpowers/specs/2026-05-20-cascade-safety-design.md
--   section "#5 orphan marker cleanup".


-- =============================================================================
-- trigger fn: _cleanup_orphan_marker
-- =============================================================================
-- after delete on public.marker_assignments, check whether any sibling
-- assignment rows remain for old.marker_id. if not, drop the parent marker.
-- security definer so the cleanup succeeds regardless of the deleting role
-- (cascade paths run as the migration role; direct unassign actions run as
-- authenticated). search_path empty so all references stay schema-qualified.

create or replace function public._cleanup_orphan_marker()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- only the last assignment removal can orphan a marker. using exists
  -- short-circuits on the first remaining row rather than counting all
  -- of them, which matters for hot markers with many trial assignments.
  if not exists (
    select 1
    from public.marker_assignments
    where marker_id = old.marker_id
  ) then
    -- if the parent marker is already being removed in the enclosing
    -- statement (e.g. delete_space()'s explicit delete-from-markers step),
    -- this where clause matches zero rows and the statement is a safe
    -- no-op. see header comment for the full reentrancy explanation.
    delete from public.markers where id = old.marker_id;
  end if;
  return old;
end;
$$;

revoke execute on function public._cleanup_orphan_marker() from public;

comment on function public._cleanup_orphan_marker() is
  'Internal AFTER DELETE trigger on public.marker_assignments: drops the parent marker when its last assignment is removed. SECURITY DEFINER. Safe under cascade: when the parent marker is being deleted in the same statement (e.g. via delete_space()) the trigger-issued delete simply matches zero rows.';

create trigger _cleanup_orphan_marker_trigger
  after delete on public.marker_assignments
  for each row execute function public._cleanup_orphan_marker();


-- =============================================================================
-- smoke test
-- =============================================================================
-- bootstraps three independent fixtures inside the same do block so each
-- case is hermetic. teardown uses the clint.member_guard_cascade = on
-- bypass to remove member rows under the membership self-protection guards
-- (mirrors the pattern in 20260503090000_delete_space_rpc.sql and
-- 20260521120000_r2_pending_deletes_queue.sql).

do $$
declare
  v_marker_type uuid;
begin
  select id into v_marker_type from public.marker_types where space_id is null limit 1;
  if v_marker_type is null then
    raise exception 'orphan_marker_cleanup smoke FAIL: no global marker_type available';
  end if;

  -- ===========================================================================
  -- case A: marker assigned to TWO trials, delete one trial -> marker lives
  -- ===========================================================================
  declare
    v_user      uuid := gen_random_uuid();
    v_tenant    uuid := gen_random_uuid();
    v_space     uuid := gen_random_uuid();
    v_company   uuid := gen_random_uuid();
    v_product_a uuid := gen_random_uuid();
    v_product_b uuid := gen_random_uuid();
    v_ta        uuid := gen_random_uuid();
    v_trial_a   uuid := gen_random_uuid();
    v_trial_b   uuid := gen_random_uuid();
    v_marker    uuid := gen_random_uuid();
    v_email     text := 'orphan-marker-a-' || gen_random_uuid() || '@example.com';
    v_count     int;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'orphan-a-tenant', 'orphan-a-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role)
      values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'orphan-a-space', v_user);
    insert into public.space_members (space_id, user_id, role)
      values (v_space, v_user, 'owner');
    insert into public.companies (id, space_id, created_by, name)
      values (v_company, v_space, v_user, 'orphan-a-co');
    insert into public.products (id, space_id, created_by, company_id, name)
      values (v_product_a, v_space, v_user, v_company, 'orphan-a-drug-a'),
             (v_product_b, v_space, v_user, v_company, 'orphan-a-drug-b');
    insert into public.therapeutic_areas (id, space_id, created_by, name)
      values (v_ta, v_space, v_user, 'orphan-a-ta');
    insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier)
      values (v_trial_a, v_space, v_user, v_product_a, v_ta, 'orphan-a-trial-a', 'NCT-OA-A'),
             (v_trial_b, v_space, v_user, v_product_b, v_ta, 'orphan-a-trial-b', 'NCT-OA-B');

    -- impersonate the owner so the marker trigger writes a non-null changed_by.
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.markers (id, space_id, marker_type_id, title, event_date, projection, created_by)
      values (v_marker, v_space, v_marker_type, 'orphan-a-marker', current_date, 'actual', v_user);
    insert into public.marker_assignments (marker_id, trial_id)
      values (v_marker, v_trial_a),
             (v_marker, v_trial_b);

    -- delete just one trial. cascade removes its one marker_assignments row;
    -- the orphan trigger fires, finds one remaining assignment, leaves
    -- the marker alone.
    delete from public.trials where id = v_trial_a;

    select count(*)::int into v_count from public.markers where id = v_marker;
    if v_count <> 1 then
      raise exception 'orphan_marker_cleanup smoke FAIL case A: marker should survive, got count %', v_count;
    end if;

    select count(*)::int into v_count from public.marker_assignments where marker_id = v_marker;
    if v_count <> 1 then
      raise exception 'orphan_marker_cleanup smoke FAIL case A: expected 1 remaining assignment, got %', v_count;
    end if;

    raise notice 'orphan_marker_cleanup smoke ok A: marker with two trials survives single-trial delete';

    -- teardown case A. order is: clear member rows first (under the bypass
    -- GUC), then delete the parent (spaces / tenants). The spaces and
    -- tenants AFTER DELETE triggers flip the GUC back to 'off', so any
    -- member-row delete must precede the parent-row delete. Markers and
    -- audit rows are removed first so the spaces cascade is clean.
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', null, true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.markers          where space_id = v_space;
    delete from public.trial_change_events where space_id = v_space;
    delete from public.marker_changes   where space_id = v_space;
    delete from public.space_members    where space_id = v_space;
    delete from public.tenant_members   where tenant_id = v_tenant;
    delete from public.spaces           where id = v_space;
    delete from public.tenants          where id = v_tenant;
    delete from auth.users              where id = v_user;
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  -- ===========================================================================
  -- case B: marker assigned to a single trial, delete the trial -> marker gone
  -- ===========================================================================
  declare
    v_user      uuid := gen_random_uuid();
    v_tenant    uuid := gen_random_uuid();
    v_space     uuid := gen_random_uuid();
    v_company   uuid := gen_random_uuid();
    v_product   uuid := gen_random_uuid();
    v_ta        uuid := gen_random_uuid();
    v_trial     uuid := gen_random_uuid();
    v_marker    uuid := gen_random_uuid();
    v_email     text := 'orphan-marker-b-' || gen_random_uuid() || '@example.com';
    v_count     int;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'orphan-b-tenant', 'orphan-b-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role)
      values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'orphan-b-space', v_user);
    insert into public.space_members (space_id, user_id, role)
      values (v_space, v_user, 'owner');
    insert into public.companies (id, space_id, created_by, name)
      values (v_company, v_space, v_user, 'orphan-b-co');
    insert into public.products (id, space_id, created_by, company_id, name)
      values (v_product, v_space, v_user, v_company, 'orphan-b-drug');
    insert into public.therapeutic_areas (id, space_id, created_by, name)
      values (v_ta, v_space, v_user, 'orphan-b-ta');
    insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier)
      values (v_trial, v_space, v_user, v_product, v_ta, 'orphan-b-trial', 'NCT-OB-1');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.markers (id, space_id, marker_type_id, title, event_date, projection, created_by)
      values (v_marker, v_space, v_marker_type, 'orphan-b-marker', current_date, 'actual', v_user);
    insert into public.marker_assignments (marker_id, trial_id)
      values (v_marker, v_trial);

    -- delete the trial. cascade removes the lone marker_assignments row;
    -- the orphan trigger fires, finds zero remaining assignments,
    -- removes the parent marker.
    delete from public.trials where id = v_trial;

    select count(*)::int into v_count from public.markers where id = v_marker;
    if v_count <> 0 then
      raise exception 'orphan_marker_cleanup smoke FAIL case B: marker should be gone, got count %', v_count;
    end if;

    select count(*)::int into v_count from public.marker_assignments where marker_id = v_marker;
    if v_count <> 0 then
      raise exception 'orphan_marker_cleanup smoke FAIL case B: expected 0 assignments, got %', v_count;
    end if;

    raise notice 'orphan_marker_cleanup smoke ok B: single-trial marker removed when its trial is deleted';

    -- teardown case B. the marker is already gone; sweep the rest.
    -- order matters: member rows before parent rows (same reason as case A).
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', null, true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.trial_change_events where space_id = v_space;
    delete from public.marker_changes   where space_id = v_space;
    delete from public.space_members    where space_id = v_space;
    delete from public.tenant_members   where tenant_id = v_tenant;
    delete from public.spaces           where id = v_space;
    delete from public.tenants          where id = v_tenant;
    delete from auth.users              where id = v_user;
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  -- ===========================================================================
  -- case C: space cascade via delete_space() must not error, must clean up
  -- ===========================================================================
  -- the existing delete_space() rpc deletes markers explicitly before
  -- dropping the space. that cascades into marker_assignments and fires
  -- this trigger, which then tries to delete a parent marker that is
  -- already being removed in the same statement. the where clause matches
  -- zero rows; no exception is raised.
  declare
    v_user      uuid := gen_random_uuid();
    v_tenant    uuid := gen_random_uuid();
    v_space     uuid := gen_random_uuid();
    v_company   uuid := gen_random_uuid();
    v_product   uuid := gen_random_uuid();
    v_ta        uuid := gen_random_uuid();
    v_trial     uuid := gen_random_uuid();
    v_marker    uuid := gen_random_uuid();
    v_email     text := 'orphan-marker-c-' || gen_random_uuid() || '@example.com';
    v_count     int;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'orphan-c-tenant', 'orphan-c-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role)
      values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'orphan-c-space', v_user);
    insert into public.space_members (space_id, user_id, role)
      values (v_space, v_user, 'owner');
    insert into public.companies (id, space_id, created_by, name)
      values (v_company, v_space, v_user, 'orphan-c-co');
    insert into public.products (id, space_id, created_by, company_id, name)
      values (v_product, v_space, v_user, v_company, 'orphan-c-drug');
    insert into public.therapeutic_areas (id, space_id, created_by, name)
      values (v_ta, v_space, v_user, 'orphan-c-ta');
    insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier)
      values (v_trial, v_space, v_user, v_product, v_ta, 'orphan-c-trial', 'NCT-OC-1');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.markers (id, space_id, marker_type_id, title, event_date, projection, created_by)
      values (v_marker, v_space, v_marker_type, 'orphan-c-marker', current_date, 'actual', v_user);
    insert into public.marker_assignments (marker_id, trial_id)
      values (v_marker, v_trial);

    -- run the delete_space() rpc as authenticated so the SECURITY DEFINER
    -- gate is exercised end to end; mirrors the pattern in
    -- 20260503090000_delete_space_rpc.sql.
    set local role authenticated;
    begin
      perform public.delete_space(v_space);
    exception when others then
      reset role;
      raise exception 'orphan_marker_cleanup smoke FAIL case C: delete_space threw % (sqlstate %)',
        sqlerrm, sqlstate;
    end;
    reset role;

    -- space gone.
    select count(*)::int into v_count from public.spaces where id = v_space;
    if v_count <> 0 then
      raise exception 'orphan_marker_cleanup smoke FAIL case C: space row still present';
    end if;
    -- markers gone (the trigger no-op did not block the explicit delete).
    select count(*)::int into v_count from public.markers where id = v_marker;
    if v_count <> 0 then
      raise exception 'orphan_marker_cleanup smoke FAIL case C: marker still present';
    end if;
    -- marker_assignments gone via cascade.
    select count(*)::int into v_count from public.marker_assignments where marker_id = v_marker;
    if v_count <> 0 then
      raise exception 'orphan_marker_cleanup smoke FAIL case C: marker_assignments still present';
    end if;
    -- trial gone via cascade.
    select count(*)::int into v_count from public.trials where id = v_trial;
    if v_count <> 0 then
      raise exception 'orphan_marker_cleanup smoke FAIL case C: trial still present';
    end if;

    raise notice 'orphan_marker_cleanup smoke ok C: space cascade through delete_space() succeeded with trigger present';

    -- teardown case C. the space is already gone; sweep the rest.
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', null, true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.tenant_members   where tenant_id = v_tenant;
    delete from public.tenants          where id = v_tenant;
    delete from auth.users              where id = v_user;
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  raise notice 'orphan_marker_cleanup smoke test: PASS';
end $$;
