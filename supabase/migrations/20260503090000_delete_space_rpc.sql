-- migration: 20260503090000_delete_space_rpc
-- purpose: provide a delete_space(p_space_id uuid) RPC that ordered-deletes a
--   space safely. Direct `delete from spaces where id = X` from PostgREST
--   fails with FK 23503 on marker_changes_space_id_fkey, because the cascade
--   into markers fires the BEFORE DELETE trigger _log_marker_change, which
--   inserts a 'deleted' audit row into marker_changes referencing the same
--   space_id -- but by the time that insert runs, the spaces row is already
--   gone, so the FK rejects it.
--
--   The hazard is documented at the head of
--   20260502120700_marker_changes_trigger.sql, which calls out:
--     "Any future delete-space flow MUST explicitly DELETE FROM markers WHERE
--      space_id = X first to avoid this. (Spaces are not currently deletable
--      via any RPC, so this is forward-guidance only.)"
--   This migration is that flow.
--
-- order: (1) delete from markers where space_id = X -- fires the trigger
--   while spaces row still exists, so audit rows insert cleanly; (2) delete
--   from spaces where id = X -- cascade handles space_members, companies,
--   products, trials, marker_assignments (already empty), trial_change_events,
--   marker_changes, marker_types (space-scoped), etc.
--
-- security: SECURITY DEFINER, gated on has_space_access(p_space_id,
--   array['owner']) -- mirrors the existing RLS policy "space owners and
--   tenant owners can delete spaces" on public.spaces. Returns void.
--   Raises 42501 when the caller is not authorized, P0002 when the space
--   is missing.

create or replace function public.delete_space(p_space_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
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

  -- Step 1: delete markers explicitly. The BEFORE DELETE trigger
  -- _log_marker_change inserts marker_changes audit rows referencing
  -- p_space_id; the spaces row must still exist for that FK to hold.
  delete from public.markers where space_id = p_space_id;

  -- Step 2: delete the space. Cascade cleans up everything else
  -- (space_members, companies, products, trials, trial_change_events,
  -- marker_changes, marker_types, etc.).
  delete from public.spaces where id = p_space_id;
end;
$$;

revoke execute on function public.delete_space(uuid) from public;
revoke execute on function public.delete_space(uuid) from anon;
grant  execute on function public.delete_space(uuid) to authenticated;

comment on function public.delete_space(uuid) is
  'Authorized delete of a space. Deletes markers first (so the BEFORE DELETE marker trigger writes its audit rows while the spaces row still exists), then deletes the space (cascade handles the rest). Gated on has_space_access(p_space_id, array[''owner'']). SECURITY DEFINER.';

-- =============================================================================
-- smoke test: bootstrap a fixture with an owner, marker, marker_assignment,
-- and trial; impersonate the owner; call delete_space; verify the space and
-- its dependents are gone.
--
do $$
declare
  v_user        uuid := gen_random_uuid();
  v_tenant      uuid := gen_random_uuid();
  v_space       uuid := gen_random_uuid();
  v_company     uuid := gen_random_uuid();
  v_product     uuid := gen_random_uuid();
  v_ta          uuid := gen_random_uuid();
  v_trial       uuid := gen_random_uuid();
  v_marker      uuid := gen_random_uuid();
  v_marker_type uuid;
  v_email       text := 'delete-space-smoke-' || v_user || '@example.com';
  v_remaining   int;
begin
  select id into v_marker_type from public.marker_types where space_id is null limit 1;
  if v_marker_type is null then
    raise exception 'delete_space smoke FAIL: no global marker_type available';
  end if;

  insert into auth.users (id, email, instance_id, aud, role)
    values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  insert into public.tenants (id, name, slug)
    values (v_tenant, 'ds-smoke-tenant', 'ds-smoke-' || left(v_tenant::text, 8));
  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant, v_user, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space, v_tenant, 'ds-smoke-space', v_user);
  insert into public.space_members (space_id, user_id, role)
    values (v_space, v_user, 'owner');
  insert into public.companies (id, space_id, created_by, name)
    values (v_company, v_space, v_user, 'ds-smoke-co');
  insert into public.products (id, space_id, created_by, company_id, name)
    values (v_product, v_space, v_user, v_company, 'ds-smoke-drug');
  insert into public.therapeutic_areas (id, space_id, created_by, name)
    values (v_ta, v_space, v_user, 'ds-smoke-ta');
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier)
    values (v_trial, v_space, v_user, v_product, v_ta, 'ds-smoke-trial', 'NCT-DS-SMOKE');

  -- impersonate the owner so auth.uid() matches and the trigger writes a
  -- non-null changed_by; needed for has_space_access() to pass.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
    true
  );

  insert into public.markers (id, space_id, marker_type_id, title, event_date, projection, created_by)
    values (v_marker, v_space, v_marker_type, 'ds-smoke-marker', current_date, 'actual', v_user);
  insert into public.marker_assignments (marker_id, trial_id)
    values (v_marker, v_trial);

  -- escalate to authenticated to exercise the RLS path.
  set local role authenticated;
  begin
    perform public.delete_space(v_space);
  exception when others then
    reset role;
    raise exception 'delete_space smoke FAIL: RPC threw % (sqlstate %)',
      sqlerrm, sqlstate;
  end;
  reset role;

  -- spaces row gone.
  select count(*) into v_remaining from public.spaces where id = v_space;
  if v_remaining <> 0 then
    raise exception 'delete_space smoke FAIL: space row still present after delete';
  end if;

  -- cascade swept dependents.
  select count(*) into v_remaining from public.markers where space_id = v_space;
  if v_remaining <> 0 then
    raise exception 'delete_space smoke FAIL: markers still present after delete';
  end if;
  select count(*) into v_remaining from public.companies where space_id = v_space;
  if v_remaining <> 0 then
    raise exception 'delete_space smoke FAIL: companies still present after delete';
  end if;
  select count(*) into v_remaining from public.trials where space_id = v_space;
  if v_remaining <> 0 then
    raise exception 'delete_space smoke FAIL: trials still present after delete';
  end if;
  select count(*) into v_remaining from public.marker_changes where space_id = v_space;
  if v_remaining <> 0 then
    raise exception 'delete_space smoke FAIL: marker_changes still present after delete';
  end if;
  select count(*) into v_remaining from public.trial_change_events where space_id = v_space;
  if v_remaining <> 0 then
    raise exception 'delete_space smoke FAIL: trial_change_events still present after delete';
  end if;

  -- not-found path: a second call must raise P0002.
  set local role authenticated;
  begin
    perform public.delete_space(v_space);
    reset role;
    raise exception 'delete_space smoke FAIL: second call should have raised P0002';
  exception
    when sqlstate 'P0002' then
      reset role;
    when others then
      reset role;
      raise exception 'delete_space smoke FAIL: second call raised wrong sqlstate % (%)',
        sqlstate, sqlerrm;
  end;

  -- unauthorized path: a fresh user with no membership must hit 42501.
  declare
    v_user2  uuid := gen_random_uuid();
    v_email2 text := 'delete-space-smoke-2-' || v_user || '@example.com';
    v_space2 uuid := gen_random_uuid();
    v_tenant2 uuid := gen_random_uuid();
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user2, v_email2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant2, 'ds-smoke-tenant-2', 'ds-smoke2-' || left(v_tenant2::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role)
      values (v_tenant2, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space2, v_tenant2, 'ds-smoke-space-2', v_user);
    insert into public.space_members (space_id, user_id, role)
      values (v_space2, v_user, 'owner');

    -- now switch jwt to v_user2 (no membership of v_space2) and try.
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user2::text, 'role', 'authenticated', 'email', v_email2)::text,
      true
    );
    set local role authenticated;
    begin
      perform public.delete_space(v_space2);
      reset role;
      raise exception 'delete_space smoke FAIL: unauthorized call should have raised 42501';
    exception
      when sqlstate '42501' then
        reset role;
      when others then
        reset role;
        raise exception 'delete_space smoke FAIL: unauthorized call raised wrong sqlstate % (%)',
          sqlstate, sqlerrm;
    end;

    -- teardown the second fixture. The cascade through tenants would flip
    -- the GUC off mid-walk (the spaces_member_guard_cascade_end AFTER trigger
    -- fires before space_members rows are processed under cascade), so do the
    -- member-row deletes explicitly with the bypass GUC on top-level. This
    -- mirrors the working teardown pattern in
    -- 20260502120800_change_feed_surface_rpcs.
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', null, true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.space_members  where space_id = v_space2;
    delete from public.tenant_members where tenant_id = v_tenant2;
    delete from public.spaces         where id = v_space2;
    delete from public.tenants        where id = v_tenant2;
    delete from auth.users            where id = v_user2;
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  -- final teardown for the primary fixture. v_space is already gone (the
  -- main RPC call deleted it), so we just sweep tenant_members + tenants +
  -- the user. Same explicit-bypass pattern as above.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.tenant_members where tenant_id = v_tenant;
  delete from public.tenants        where id = v_tenant;
  delete from auth.users            where id = v_user;
  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'delete_space rpc smoke test: PASS';
end $$;
