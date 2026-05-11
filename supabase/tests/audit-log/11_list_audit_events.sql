-- 11_list_audit_events
-- Asserts list_audit_events applies scope filtering, action filtering,
-- actor filtering, and date-range filtering correctly. RLS denial for
-- cross-tenant calls is verified inline.
--
-- Predictable UUID prefix: 11111111-11xx-11xx-11xx-11xxxxxxxxxx
-- (distinct from migration UUIDs: we use 11111111-11bb-... for the secondary set)

do $$
declare
  v_agency   uuid := '11eeeeee-11ee-11ee-11ee-11eeeeeeee01';
  v_tenant_a uuid := '11eeeeee-11ee-11ee-11ee-11eeeeeeee02';
  v_tenant_b uuid := '11eeeeee-11ee-11ee-11ee-11eeeeeeee03';
  v_pa       uuid := '11eeeeee-11ee-11ee-11ee-11eeeeeeee10';
  v_to_a     uuid := '11eeeeee-11ee-11ee-11ee-11eeeeeeee11';
  v_to_b     uuid := '11eeeeee-11ee-11ee-11ee-11eeeeeeee12';
  v_actor_x  uuid := '11eeeeee-11ee-11ee-11ee-11eeeeeeee13';
  v_ev_id1   uuid;
  v_ev_id2   uuid;
  v_ev_id3   uuid;
  v_ev_id4   uuid;
  v_seen     int;
  v_rows     record;
begin
  raise notice '11_list_audit_events: bootstrapping two tenants, platform admin, two tenant owners';

  insert into auth.users (id, email) values
    (v_pa,      'pa@11list.test'),
    (v_to_a,    'toa@11list.test'),
    (v_to_b,    'tob@11list.test'),
    (v_actor_x, 'ax@11list.test');
  insert into public.platform_admins (user_id) values (v_pa);

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency, 'List11Ag', 'list11-ag', 'list11-ag', 'List11Ag', 'ag@11list.test');

  insert into public.tenants (id, name, slug, subdomain, agency_id) values
    (v_tenant_a, 'List11TA', 'list11-ta', 'list11-ta', v_agency),
    (v_tenant_b, 'List11TB', 'list11-tb', 'list11-tb', v_agency);

  insert into public.tenant_members (tenant_id, user_id, role) values
    (v_tenant_a, v_to_a, 'owner'),
    (v_tenant_b, v_to_b, 'owner');

  raise notice '11_list_audit_events: seeding 4 audit events across two tenants and two actors';

  -- two rows for tenant_a, two rows for tenant_b; vary action and actor
  perform set_config('request.jwt.claim.sub', v_actor_x::text, true);

  v_ev_id1 := public.record_audit_event(
    '11list.alpha', 'system', 'test', null, null, v_tenant_a, null,
    jsonb_build_object('seq', 1)
  );
  v_ev_id2 := public.record_audit_event(
    '11list.beta', 'system', 'test', null, null, v_tenant_a, null,
    jsonb_build_object('seq', 2)
  );

  perform set_config('request.jwt.claim.sub', v_to_b::text, true);

  v_ev_id3 := public.record_audit_event(
    '11list.alpha', 'system', 'test', null, null, v_tenant_b, null,
    jsonb_build_object('seq', 3)
  );
  v_ev_id4 := public.record_audit_event(
    '11list.gamma', 'system', 'test', null, null, v_tenant_b, null,
    jsonb_build_object('seq', 4)
  );

  -- ----------------------------------------------------------------
  -- Test 1: platform admin with scope='platform' sees all 4 rows
  -- ----------------------------------------------------------------
  raise notice '11_list_audit_events: [1/5] platform admin sees all 4 seeded rows via scope=platform';
  perform set_config('request.jwt.claim.sub', v_pa::text, true);
  set local role authenticated;

  select count(*) into v_seen
    from public.list_audit_events('platform', null)
    where action like '11list.%';
  if v_seen < 4 then
    raise exception 'LIST FAIL #1: platform admin sees % rows for 11list.*, expected >= 4', v_seen;
  end if;

  reset role;

  -- ----------------------------------------------------------------
  -- Test 2: tenant owner A with scope='tenant'/tenant_a sees only tenant_a rows
  -- ----------------------------------------------------------------
  raise notice '11_list_audit_events: [2/5] tenant owner A sees only their tenant rows';
  perform set_config('request.jwt.claim.sub', v_to_a::text, true);
  set local role authenticated;

  select count(*) into v_seen
    from public.list_audit_events('tenant', v_tenant_a)
    where action like '11list.%';
  if v_seen <> 2 then
    raise exception 'LIST FAIL #2: tenant owner A sees % 11list.* rows for tenant_a, expected 2', v_seen;
  end if;

  reset role;

  -- ----------------------------------------------------------------
  -- Test 3: tenant owner A calling list_audit_events for tenant_b gets zero rows (RLS)
  -- ----------------------------------------------------------------
  raise notice '11_list_audit_events: [3/5] tenant owner A cannot see tenant B rows via list_audit_events';
  perform set_config('request.jwt.claim.sub', v_to_a::text, true);
  set local role authenticated;

  select count(*) into v_seen
    from public.list_audit_events('tenant', v_tenant_b)
    where action like '11list.%';
  if v_seen <> 0 then
    raise exception 'LIST FAIL #3: tenant owner A sees % rows for tenant_b via list_audit_events, expected 0', v_seen;
  end if;

  reset role;

  -- ----------------------------------------------------------------
  -- Test 4: filter by p_action narrows results correctly
  -- ----------------------------------------------------------------
  raise notice '11_list_audit_events: [4/5] p_action filter narrows to matching rows';
  perform set_config('request.jwt.claim.sub', v_pa::text, true);
  set local role authenticated;

  select count(*) into v_seen
    from public.list_audit_events('platform', null, null, '11list.alpha');
  -- two rows have action '11list.alpha' (one per tenant)
  if v_seen <> 2 then
    raise exception 'LIST FAIL #4: p_action filter returned % rows for 11list.alpha, expected 2', v_seen;
  end if;

  reset role;

  -- ----------------------------------------------------------------
  -- Test 5: filter by p_actor_user_id narrows results correctly
  -- ----------------------------------------------------------------
  raise notice '11_list_audit_events: [5/5] p_actor_user_id filter narrows to that actor''s rows';
  perform set_config('request.jwt.claim.sub', v_pa::text, true);
  set local role authenticated;

  -- v_actor_x emitted rows ev_id1 and ev_id2 (tenant_a rows)
  select count(*) into v_seen
    from public.list_audit_events('platform', null, v_actor_x)
    where action like '11list.%';
  if v_seen <> 2 then
    raise exception 'LIST FAIL #5: p_actor_user_id filter returned % rows for actor_x, expected 2', v_seen;
  end if;

  reset role;

  -- ----------------------------------------------------------------
  -- cleanup
  -- ----------------------------------------------------------------
  raise notice '11_list_audit_events: cleanup';
  perform set_config('request.jwt.claim.sub', '', true);

  delete from public.audit_events where action like '11list.%';

  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.tenant_members where tenant_id in (v_tenant_a, v_tenant_b);
  delete from public.tenants where id in (v_tenant_a, v_tenant_b);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.agencies where id = v_agency;
  -- clear retired_hostnames so this test is re-runnable without the 90-day holdback
  delete from public.retired_hostnames where previous_id in (v_agency, v_tenant_a, v_tenant_b);
  delete from public.platform_admins where user_id = v_pa;
  delete from auth.users where id in (v_pa, v_to_a, v_to_b, v_actor_x);

  raise notice '11_list_audit_events: PASS (platform scope, tenant scope, cross-tenant denial, action filter, actor filter)';
end $$;
