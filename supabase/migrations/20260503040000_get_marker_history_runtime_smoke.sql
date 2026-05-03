-- migration: 20260503030000_get_marker_history_runtime_smoke
-- purpose: runtime regression test for get_marker_history(uuid).
--
-- The original migration (20260502120800_change_feed_surface_rpcs.sql)
-- declared the function SECURITY INVOKER and tested it as the postgres
-- superuser, masking the production failure where a join to auth.users
-- raised "permission denied for table users" for every authenticated
-- caller. Migration 20260503020000 flipped the function to SECURITY
-- DEFINER and added a static prosecdef check, but a static check can't
-- catch a future regression that re-introduces the same join issue
-- (e.g. someone adds another auth.users join under SECURITY INVOKER).
--
-- This smoke is purely additive: it provisions a scratch tenant + space +
-- marker + audit row, calls the RPC under an `authenticated` role with a
-- jwt.claim.sub that matches the space owner, asserts the email comes
-- back, and tears everything down. It runs once at db-reset time and
-- raises an exception if the function ever fails for an authenticated
-- space member.

do $$
declare
  v_user        uuid := gen_random_uuid();
  v_tenant      uuid := gen_random_uuid();
  v_space       uuid := gen_random_uuid();
  v_marker_type uuid;
  v_marker      uuid := gen_random_uuid();
  v_email       text := 'marker-history-smoke-' || v_user || '@example.com';
  v_history     jsonb;
begin
  -- pick any global marker_type; seed populates these.
  select id into v_marker_type from public.marker_types where space_id is null limit 1;
  if v_marker_type is null then
    raise exception 'get_marker_history smoke FAIL: no global marker_type available';
  end if;

  -- scratch fixture
  insert into auth.users (id, email, instance_id, aud, role)
    values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  insert into public.tenants (id, name, slug)
    values (v_tenant, 'mh-smoke-tenant', 'mh-smoke-' || left(v_tenant::text, 8));
  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant, v_user, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space, v_tenant, 'mh-smoke-space', v_user);
  insert into public.space_members (space_id, user_id, role)
    values (v_space, v_user, 'owner');
  -- The markers_audit BEFORE trigger writes the 'created' marker_changes
  -- row automatically; no need to insert it explicitly. We need to set the
  -- jwt sub on the connection BEFORE the insert so the trigger captures
  -- v_user as changed_by (otherwise it falls back to NULL or postgres).
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
    true
  );
  insert into public.markers (id, space_id, marker_type_id, title, event_date, projection, created_by)
    values (v_marker, v_space, v_marker_type, 'mh-smoke-marker', current_date, 'actual', v_user);

  -- jwt claim already set above; just escalate to authenticated role
  set local role authenticated;

  begin
    select jsonb_agg(row) into v_history
      from public.get_marker_history(v_marker) row;
  exception when others then
    -- restore role before re-raising so the rollback below works
    reset role;
    raise exception 'get_marker_history smoke FAIL: RPC threw % (sqlstate %)',
      sqlerrm, sqlstate;
  end;

  reset role;
  -- Clear both jwt claim conventions so auth.uid() returns NULL during
  -- teardown -- otherwise the self-removal half of the member-guard
  -- triggers fires (`old.user_id = auth.uid()`) regardless of the
  -- cascade-bypass GUC, since the bypass only short-circuits the
  -- last-owner check, not the self-removal one.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  if v_history is null or jsonb_array_length(v_history) <> 1 then
    raise exception 'get_marker_history smoke FAIL: expected 1 row, got %',
      coalesce(jsonb_array_length(v_history), 0);
  end if;
  if v_history -> 0 ->> 'changed_by_email' is distinct from v_email then
    raise exception 'get_marker_history smoke FAIL: email join broken, got %',
      v_history -> 0 ->> 'changed_by_email';
  end if;
  if v_history -> 0 ->> 'change_type' <> 'created' then
    raise exception 'get_marker_history smoke FAIL: change_type wrong, got %',
      v_history -> 0 ->> 'change_type';
  end if;

  -- teardown. Mirrors the working pattern in
  -- 20260502120800_change_feed_surface_rpcs: explicit member-row deletes
  -- in dependency order, with the bypass GUC set just before so the
  -- last-owner check skips. The cascade chain is shallow at this point
  -- because we've already removed members + spaces explicitly, so
  -- delete-tenants becomes a clean leaf delete.
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.markers        where space_id = v_space;
  delete from public.space_members  where space_id = v_space;
  delete from public.tenant_members where tenant_id = v_tenant;
  delete from public.spaces         where id = v_space;
  delete from public.tenants        where id = v_tenant;
  delete from auth.users            where id = v_user;
  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'get_marker_history runtime smoke test: PASS';
end $$;
