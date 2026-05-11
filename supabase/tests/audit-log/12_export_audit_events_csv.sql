-- 12_export_audit_events_csv
-- Asserts export_audit_events_csv returns a non-empty CSV string with the correct
-- header row, and that the row count matches the seeded data.
-- Uses a very specific action filter ('12csv.seed.test') to isolate seeded rows.
--
-- Predictable UUID prefix: 12cccccc-12cc-12cc-12cc-12ccccccccxx

do $$
declare
  v_pa     uuid := '12cccccc-12cc-12cc-12cc-12cccccc0001';
  v_csv    text;
  v_lines  text[];
  v_line1  text;
  v_expected_header text;
  v_data_count int;
  v_seen   int;
begin
  raise notice '12_export_audit_events_csv: bootstrapping platform admin user';

  insert into auth.users (id, email)
    values (v_pa, 'pa@12csv.test')
    on conflict (id) do nothing;
  insert into public.platform_admins (user_id) values (v_pa)
    on conflict (user_id) do nothing;

  raise notice '12_export_audit_events_csv: seeding 3 audit rows with unique action filter';

  perform set_config('request.jwt.claim.sub', v_pa::text, true);

  perform public.record_audit_event('12csv.seed.test', 'system', 'test', null, null, null, null, '{}'::jsonb);
  perform public.record_audit_event('12csv.seed.test', 'system', 'test', null, null, null, null, '{}'::jsonb);
  perform public.record_audit_event('12csv.seed.test', 'system', 'test', null, null, null, null, '{}'::jsonb);

  -- confirm seeded rows are in the table before calling export
  select count(*) into v_seen from public.audit_events where action = '12csv.seed.test';
  if v_seen <> 3 then
    raise exception 'CSV FAIL #0: expected 3 seeded rows, found % (record_audit_event issue)', v_seen;
  end if;

  -- ----------------------------------------------------------------
  -- Test 1: export_audit_events_csv returns non-empty text as platform admin
  -- ----------------------------------------------------------------
  raise notice '12_export_audit_events_csv: [1/3] calling export_audit_events_csv as platform admin with action filter';

  set local role authenticated;

  v_csv := public.export_audit_events_csv(
    'platform',         -- p_scope_kind
    null,               -- p_scope_id
    null,               -- p_actor_user_id
    '12csv.seed.test',  -- p_action (tight filter to only our rows)
    null,               -- p_from
    null                -- p_to
  );

  reset role;

  if v_csv is null or length(v_csv) = 0 then
    raise exception 'CSV FAIL #1: export_audit_events_csv returned null or empty string';
  end if;

  raise notice '12_export_audit_events_csv: CSV returned (% bytes)', length(v_csv);

  -- ----------------------------------------------------------------
  -- Test 2: first line is the expected CSV header
  -- ----------------------------------------------------------------
  raise notice '12_export_audit_events_csv: [2/3] verifying CSV header row';

  v_expected_header := 'occurred_at,action,source,rpc_name,actor_user_id,actor_email,actor_role,actor_ip,actor_user_agent,request_id,agency_id,tenant_id,space_id,resource_type,resource_id,metadata';

  -- split on newline and grab first element
  v_lines := string_to_array(v_csv, E'\n');
  v_line1 := v_lines[1];

  if v_line1 <> v_expected_header then
    raise exception 'CSV FAIL #2: header mismatch. Expected:% Got:%', v_expected_header, v_line1;
  end if;

  -- ----------------------------------------------------------------
  -- Test 3: data rows count matches seeded count
  -- lines array: [header, row1, row2, row3, trailing_empty_string_from_final_newline]
  -- so array_length should be 5 (4 non-empty + 1 trailing empty due to E'\n' at end)
  -- data rows = array_length - 2 (header + trailing empty)
  -- ----------------------------------------------------------------
  raise notice '12_export_audit_events_csv: [3/3] verifying data row count equals 3 seeded rows';

  -- count non-empty lines after header
  select count(*) into v_data_count
    from unnest(v_lines) as ln
    where ln <> '' and ln <> v_expected_header;

  if v_data_count <> 3 then
    raise exception 'CSV FAIL #3: expected 3 data rows, got % (total lines: %)', v_data_count, array_length(v_lines, 1);
  end if;

  -- ----------------------------------------------------------------
  -- cleanup
  -- ----------------------------------------------------------------
  raise notice '12_export_audit_events_csv: cleanup';
  perform set_config('request.jwt.claim.sub', '', true);

  delete from public.audit_events where action = '12csv.seed.test';
  delete from public.platform_admins where user_id = v_pa;
  delete from auth.users where id = v_pa;

  raise notice '12_export_audit_events_csv: PASS (non-empty CSV, correct header, 3 data rows)';
end $$;
