-- 04_record_audit_event
-- Asserts record_audit_event returns a UUID, writes a row with the expected fields,
-- captures actor_user_id from request.jwt.claim.sub, and sets audit.suppress_trigger.
--
-- Predictable UUID prefix: 04xxxxxx-04xx-04xx-04xx-04xxxxxxxxxx

do $$
declare
  v_actor uuid := '04040404-0404-0404-0404-040404040404';
  v_agency uuid := '04040404-0404-0404-0404-040404040405';
  v_tenant uuid := '04040404-0404-0404-0404-040404040406';
  v_returned_id uuid;
  v_suppress    text;
  v_row         public.audit_events%rowtype;
begin
  raise notice '04_record_audit_event: bootstrapping synthetic actor user';

  insert into auth.users (id, email)
    values (v_actor, 'actor@04.test')
    on conflict (id) do nothing;

  raise notice '04_record_audit_event: setting request.jwt.claim.sub to %', v_actor;
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  perform set_config('audit.rpc_name', 'test_rpc', true);

  raise notice '04_record_audit_event: calling record_audit_event and capturing return value';
  v_returned_id := public.record_audit_event(
    'test.record_audit_event',   -- action
    'rpc',                        -- source
    'test_resource',              -- resource_type
    v_actor,                      -- resource_id
    null,                         -- agency_id
    null,                         -- tenant_id
    null,                         -- space_id
    jsonb_build_object('marker', '04_record_audit_event', 'value', 42)
  );

  raise notice '04_record_audit_event: returned UUID %', v_returned_id;

  if v_returned_id is null then
    raise exception 'RECORD FAIL #1: record_audit_event returned null instead of a UUID';
  end if;

  raise notice '04_record_audit_event: verifying row exists in audit_events';
  select * into v_row from public.audit_events where id = v_returned_id;
  if not found then
    raise exception 'RECORD FAIL #2: no row found in audit_events with id %', v_returned_id;
  end if;

  raise notice '04_record_audit_event: verifying action field';
  if v_row.action <> 'test.record_audit_event' then
    raise exception 'RECORD FAIL #3: expected action "test.record_audit_event", got "%"', v_row.action;
  end if;

  raise notice '04_record_audit_event: verifying source field';
  if v_row.source <> 'rpc' then
    raise exception 'RECORD FAIL #4: expected source "rpc", got "%"', v_row.source;
  end if;

  raise notice '04_record_audit_event: verifying rpc_name field';
  if v_row.rpc_name <> 'test_rpc' then
    raise exception 'RECORD FAIL #5: expected rpc_name "test_rpc", got "%"', v_row.rpc_name;
  end if;

  raise notice '04_record_audit_event: verifying resource_type field';
  if v_row.resource_type <> 'test_resource' then
    raise exception 'RECORD FAIL #6: expected resource_type "test_resource", got "%"', v_row.resource_type;
  end if;

  raise notice '04_record_audit_event: verifying actor_user_id captured from request.jwt.claim.sub';
  if v_row.actor_user_id <> v_actor then
    raise exception 'RECORD FAIL #7: expected actor_user_id %, got %', v_actor, v_row.actor_user_id;
  end if;

  raise notice '04_record_audit_event: verifying metadata contents';
  if (v_row.metadata ->> 'marker') <> '04_record_audit_event' then
    raise exception 'RECORD FAIL #8: metadata.marker not persisted correctly, got %', v_row.metadata;
  end if;
  if (v_row.metadata ->> 'value')::int <> 42 then
    raise exception 'RECORD FAIL #9: metadata.value not persisted correctly, got %', v_row.metadata;
  end if;

  raise notice '04_record_audit_event: verifying audit.suppress_trigger GUC was set to the returned id';
  v_suppress := current_setting('audit.suppress_trigger', true);
  if v_suppress is null or v_suppress <> v_returned_id::text then
    raise exception 'RECORD FAIL #10: audit.suppress_trigger expected "%", got "%"', v_returned_id, v_suppress;
  end if;

  -- cleanup as postgres (superuser bypasses GRANT layer)
  raise notice '04_record_audit_event: cleanup';
  perform set_config('request.jwt.claim.sub', '', true);
  delete from public.audit_events where action = 'test.record_audit_event' and actor_user_id = v_actor;
  delete from auth.users where id = v_actor;

  raise notice '04_record_audit_event: PASS (return value, row fields, actor capture, suppress_trigger GUC)';
end $$;
