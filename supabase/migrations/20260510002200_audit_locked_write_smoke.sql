-- migration: 20260510002200_audit_locked_write_smoke
-- purpose: assert direct INSERT/UPDATE/DELETE on audit_events by authenticated
--   and service_role is rejected. the only writers are record_audit_event and
--   redact_user_pii (SECURITY DEFINER). cleans up its own test rows.

do $$
declare
  v_ok boolean;
  v_seed_id uuid;
begin
  -- baseline row inserted via the sanctioned writer
  v_seed_id := public.record_audit_event(
    'lockdown.test', 'system', 'test', null, null, null, null,
    jsonb_build_object('seed', true)
  );

  -- 1. authenticated role: INSERT denied
  set local role authenticated;
  begin
    insert into public.audit_events (action, source, resource_type)
      values ('lockdown.test', 'system', 'test');
    v_ok := false;  -- if we reach here, the insert succeeded — that's a failure
  exception when others then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'LOCKDOWN FAIL #1: authenticated INSERT into audit_events was allowed';
  end if;

  -- 2. service_role: INSERT denied
  set local role service_role;
  begin
    insert into public.audit_events (action, source, resource_type)
      values ('lockdown.test', 'system', 'test');
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'LOCKDOWN FAIL #2: service_role INSERT into audit_events was allowed';
  end if;

  -- 3. authenticated: UPDATE denied
  set local role authenticated;
  begin
    update public.audit_events set actor_email = 'tamper@evil.test' where id = v_seed_id;
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'LOCKDOWN FAIL #3: authenticated UPDATE on audit_events was allowed';
  end if;

  -- 4. service_role: UPDATE denied
  set local role service_role;
  begin
    update public.audit_events set actor_email = 'tamper@evil.test' where id = v_seed_id;
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'LOCKDOWN FAIL #4: service_role UPDATE on audit_events was allowed';
  end if;

  -- 5. authenticated: DELETE denied
  set local role authenticated;
  begin
    delete from public.audit_events where id = v_seed_id;
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'LOCKDOWN FAIL #5: authenticated DELETE on audit_events was allowed';
  end if;

  -- 6. service_role: DELETE denied
  set local role service_role;
  begin
    delete from public.audit_events where id = v_seed_id;
    v_ok := false;
  exception when others then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'LOCKDOWN FAIL #6: service_role DELETE on audit_events was allowed';
  end if;

  -- cleanup as postgres (superuser bypasses GRANT layer)
  delete from public.audit_events where action = 'lockdown.test';

  raise notice 'audit locked write path: PASS (6 negative invariants verified)';
end $$;
