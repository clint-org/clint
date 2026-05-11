-- 03_locked_write_path
-- Asserts direct INSERT/UPDATE/DELETE on audit_events is denied for both
-- authenticated and service_role. Also asserts record_audit_event() succeeds
-- as the only sanctioned write path.

do $$
declare
  v_ok      boolean;
  v_seed_id uuid;
begin
  raise notice '03_locked_write_path: seeding one row via the sanctioned writer (record_audit_event)';

  -- use the sanctioned writer to establish a seed row for UPDATE/DELETE tests
  v_seed_id := public.record_audit_event(
    'lockpath.test', 'system', 'test', null, null, null, null,
    jsonb_build_object('test_file', '03_locked_write_path')
  );

  raise notice '03_locked_write_path: record_audit_event returned %, verifying row exists', v_seed_id;
  if not exists (select 1 from public.audit_events where id = v_seed_id) then
    raise exception 'LOCKPATH FAIL: seeded row % not found after record_audit_event', v_seed_id;
  end if;

  -- 1. authenticated INSERT denied
  raise notice '03_locked_write_path: [1/6] checking authenticated INSERT is denied';
  v_ok := false;
  set local role authenticated;
  begin
    insert into public.audit_events (action, source, resource_type)
      values ('lockpath.test', 'system', 'test');
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'LOCKPATH FAIL #1: authenticated INSERT into audit_events was allowed';
  end if;

  -- 2. service_role INSERT denied
  raise notice '03_locked_write_path: [2/6] checking service_role INSERT is denied';
  v_ok := false;
  set local role service_role;
  begin
    insert into public.audit_events (action, source, resource_type)
      values ('lockpath.test', 'system', 'test');
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'LOCKPATH FAIL #2: service_role INSERT into audit_events was allowed';
  end if;

  -- 3. authenticated UPDATE denied
  raise notice '03_locked_write_path: [3/6] checking authenticated UPDATE is denied';
  v_ok := false;
  set local role authenticated;
  begin
    update public.audit_events set actor_email = 'tamper@evil.test' where id = v_seed_id;
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'LOCKPATH FAIL #3: authenticated UPDATE on audit_events was allowed';
  end if;

  -- 4. service_role UPDATE denied
  raise notice '03_locked_write_path: [4/6] checking service_role UPDATE is denied';
  v_ok := false;
  set local role service_role;
  begin
    update public.audit_events set actor_email = 'tamper@evil.test' where id = v_seed_id;
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'LOCKPATH FAIL #4: service_role UPDATE on audit_events was allowed';
  end if;

  -- 5. authenticated DELETE denied
  raise notice '03_locked_write_path: [5/6] checking authenticated DELETE is denied';
  v_ok := false;
  set local role authenticated;
  begin
    delete from public.audit_events where id = v_seed_id;
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'LOCKPATH FAIL #5: authenticated DELETE on audit_events was allowed';
  end if;

  -- 6. service_role DELETE denied
  raise notice '03_locked_write_path: [6/6] checking service_role DELETE is denied';
  v_ok := false;
  set local role service_role;
  begin
    delete from public.audit_events where id = v_seed_id;
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'LOCKPATH FAIL #6: service_role DELETE on audit_events was allowed';
  end if;

  -- cleanup as postgres (superuser bypasses GRANT layer)
  delete from public.audit_events where action = 'lockpath.test';

  raise notice '03_locked_write_path: PASS (6 negative invariants verified; record_audit_event succeeded)';
end $$;
