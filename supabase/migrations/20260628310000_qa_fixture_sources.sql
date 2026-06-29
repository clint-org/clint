-- migration: 20260628310000_qa_fixture_sources
-- purpose: extend seed_events_model_qa with two sources-model additions:
--   1. give the QA trial an NCT identifier so a registry link is derivable
--      for its clinical events (S2 readers call event_registry_url(identifier))
--   2. add 2 labeled event_sources to the Distribution event via p_sources,
--      covering the multi-source business event path for C6 backtests.
--
-- event counts are unchanged (10 events); only identifier + sources rows added.

create or replace function public.seed_events_model_qa(p_space_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid          uuid := auth.uid();

  -- system event_type UUIDs (seeded by event_types migration, stable)
  et_trial_start  uuid := 'a0000000-0000-0000-0000-000000000011';
  et_pcd          uuid := 'a0000000-0000-0000-0000-000000000008';
  et_topline      uuid := 'a0000000-0000-0000-0000-000000000013';
  et_approval     uuid := 'a0000000-0000-0000-0000-000000000035';
  et_regulatory   uuid := 'a0000000-0000-0000-0000-000000000032';
  et_distribution uuid := 'a0000000-0000-0000-0000-000000000040';
  et_loe          uuid := 'a0000000-0000-0000-0000-000000000020';
  et_strategic    uuid := 'a0000000-0000-0000-0000-000000000070';
  et_leadership   uuid := 'a0000000-0000-0000-0000-000000000050';

  v_existing   int;
  v_co1        uuid;
  v_co2        uuid;
  v_asset1     uuid;
  v_asset2     uuid;
  v_trial1     uuid;

  v_topline_id uuid;  -- captured to build the event-citation link
  v_anchor_id  uuid;
  v_pi_id      uuid;
begin
  -- authentication gate
  if v_uid is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if not exists (
      select 1 from public.space_members
       where space_id = p_space_id
         and user_id  = v_uid
         and role     = 'owner'
  ) and not public.is_platform_admin() then
    raise exception 'must be space owner' using errcode = '42501';
  end if;

  -- idempotency: skip if the space already has events
  select count(*) into v_existing from public.events where space_id = p_space_id;
  if v_existing > 0 then return; end if;

  -- -------------------------------------------------------------------------
  -- 1. entity graph: 2 companies, 2 assets, 1 trial on asset1
  --    Direct inserts are safe here because we are SECURITY DEFINER (RLS
  --    bypassed). created_by is always the calling user.
  -- -------------------------------------------------------------------------
  insert into public.companies (space_id, name, created_by, display_order)
  values (p_space_id, 'QA Pharma Alpha', v_uid, 1)
  returning id into v_co1;

  insert into public.companies (space_id, name, created_by, display_order)
  values (p_space_id, 'QA Pharma Beta', v_uid, 2)
  returning id into v_co2;

  insert into public.assets (space_id, company_id, name, created_by, display_order)
  values (p_space_id, v_co1, 'QA Asset Alpha', v_uid, 1)
  returning id into v_asset1;

  insert into public.assets (space_id, company_id, name, created_by, display_order)
  values (p_space_id, v_co2, 'QA Asset Beta', v_uid, 1)
  returning id into v_asset2;

  -- S4: identifier added so event_registry_url(identifier) is non-null for
  --     trial-anchored events; stable fake NCT for deterministic backtest.
  insert into public.trials
    (space_id, asset_id, name, identifier, status, phase, phase_type, study_type, created_by, display_order)
  values
    (p_space_id, v_asset1, 'QA Trial Alpha Phase 3', 'NCT09000001', 'Active', 'Phase 3', 'P3', 'Interventional', v_uid, 1)
  returning id into v_trial1;

  -- trg_trial_assets_bootstrap auto-inserts this; the upsert is a safety net.
  insert into public.trial_assets (trial_id, asset_id, is_primary, source)
  values (v_trial1, v_asset1, true, 'analyst')
  on conflict (trial_id, asset_id) do nothing;

  -- -------------------------------------------------------------------------
  -- 2. events via create_event
  --    create_event is SECURITY DEFINER and authorizes via has_space_access,
  --    which reads auth.uid() out of request.jwt.claims. Spoofing the calling
  --    user's JWT claims is therefore sufficient: auth.uid() resolves to v_uid
  --    and the space-access check passes.
  --    Unlike seed.sql (a top-level DO block) we do NOT use `set local role
  --    authenticated` here. PostgreSQL forbids SET ROLE / SET SESSION
  --    AUTHORIZATION inside a SECURITY DEFINER function body and raises
  --    'cannot set parameter "role" within security-definer function' (42501).
  --    The JWT-claims spoof alone covers everything create_event needs.
  -- -------------------------------------------------------------------------
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text,
    true
  );
  -- trial-anchored: Trial Start, PCD, Topline (cited), Approval
  perform public.create_event(
    p_space_id, et_trial_start,
    'QA trial study initiated', date '2024-01-01',
    'trial', v_trial1,
    'actual', 'year'
  );
  perform public.create_event(
    p_space_id, et_pcd,
    'QA trial primary completion', date '2024-06-01',
    'trial', v_trial1,
    'actual', 'month'
  );
  v_topline_id := public.create_event(
    p_space_id, et_topline,
    'QA trial topline results', date '2024-09-01',
    'trial', v_trial1,
    'actual', 'month'
  );
  perform public.create_event(
    p_space_id, et_approval,
    'QA trial NDA approval', date '2025-03-01',
    'trial', v_trial1,
    'actual', 'month'
  );

  -- asset-anchored: Approval (high-sig), Distribution/hexagon (high-sig)
  perform public.create_event(
    p_space_id, et_approval,
    'QA asset FDA approval', date '2025-03-01',
    'asset', v_asset1,
    'actual', 'month',
    null, 'exact', false, null, null,
    'high'   -- significance (override; Approval default is already high)
  );
  -- S4: p_sources added to cover the multi-source business event path
  perform public.create_event(
    p_space_id, et_distribution,
    'QA commercial distribution launch', date '2025-01-01',
    'asset', v_asset1,
    'actual', 'quarter',
    -- significance null (inherits high from type default)
    p_sources => '[{"url":"https://example.com/qa-distribution-press-release","label":"Press release"},{"url":"https://example.com/qa-q1-earnings-call","label":"Earnings transcript"}]'::jsonb
  );

  -- projected event: Regulatory Filing, Q4 2026 (projection='primary', quarter)
  perform public.create_event(
    p_space_id, et_regulatory,
    'QA projected NDA filing', date '2026-10-01',
    'asset', v_asset1,
    'primary',  -- projection
    'quarter'   -- date_precision
  );

  -- hidden event: LOE Date, visibility='hidden', significance='high'
  perform public.create_event(
    p_space_id, et_loe,
    'QA loss of exclusivity', date '2032-01-01',
    'asset', v_asset1,
    'actual', 'year',
    null, 'exact', false, null, null,
    'high',    -- significance
    'hidden'   -- visibility
  );

  -- company-anchored: Strategic (pinned to band), Leadership (feed-only)
  perform public.create_event(
    p_space_id, et_strategic,
    'QA manufacturing expansion', date '2024-04-01',
    'company', v_co1,
    'actual', 'month',
    null, 'exact', false, null, null,
    null,     -- significance (inherits low from type default)
    'pinned'  -- visibility: promoted onto the company band
  );
  perform public.create_event(
    p_space_id, et_leadership,
    'QA chief commercial officer named', date '2024-02-01',
    'company', v_co1,
    'actual', 'month'
    -- significance null (inherits low), visibility null (feed-only)
  );

  -- -------------------------------------------------------------------------
  -- 3. brief: PI anchor + published primary_intelligence + event-citation link
  --    Direct inserts (SECURITY DEFINER bypasses RLS; last_edited_by = v_uid).
  --    The version-number trigger assigns version_number=1 and published_at.
  -- -------------------------------------------------------------------------
  insert into public.primary_intelligence_anchors
    (space_id, entity_type, entity_id, is_lead, display_order, created_by)
  values (p_space_id, 'trial', v_trial1, true, 0, v_uid)
  returning id into v_anchor_id;

  insert into public.primary_intelligence
    (space_id, anchor_id, state, headline, summary_md, implications_md, last_edited_by)
  values (
    p_space_id, v_anchor_id, 'published',
    'QA brief: topline readout summary',
    'Phase 3 topline data showed statistically significant results.',
    'Watch for regulatory filing in Q4 2026.',
    v_uid
  )
  returning id into v_pi_id;

  -- event-citation link: entity_type='event' enabled by A0 constraint migration
  insert into public.primary_intelligence_links
    (primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order)
  values (
    v_pi_id, 'event', v_topline_id,
    'Evidence', 'cites the topline readout', 0
  );

end $fn$;

grant execute on function public.seed_events_model_qa(uuid) to authenticated;

-- ============================================================================
-- In-file smoke: creates a scratch space, seeds it, asserts the composition
-- (including S4 additions: trial identifier + Distribution sources), then tears
-- everything down. Prod-safe (scratch entities only).
-- ============================================================================
do $$
declare
  v_scratch_uid    uuid;
  v_tenant_id      uuid;
  v_space_id       uuid;
  v_cnt_events     int;
  v_cnt_pinned     int;
  v_cnt_hidden     int;
  v_cnt_proj       int;
  v_cnt_co         int;
  v_cnt_pi_anchors int;
  v_cnt_after      int;

  -- S4 smoke variables
  v_trial_identifier    text;
  v_dist_event_id       uuid;
  v_cnt_dist_sources    int;
  v_topline_event_id    uuid;
  v_cnt_topline_sources int;
begin
  -- scratch auth user
  insert into auth.users (id, email)
  values (
    gen_random_uuid(),
    '_qa_fix_smoke_' || substr(gen_random_uuid()::text, 1, 8) || '@smoke.test'
  )
  returning id into v_scratch_uid;

  -- scratch tenant + space
  insert into public.tenants (name, slug)
  values ('_qa_fix_smoke_tenant_', '_qa-fix-' || substr(v_scratch_uid::text, 1, 8))
  returning id into v_tenant_id;

  insert into public.spaces (tenant_id, name, created_by)
  values (v_tenant_id, '_qa_fix_smoke_space_', v_scratch_uid)
  returning id into v_space_id;

  -- space owner row: required so seed_events_model_qa passes the owner check
  insert into public.space_members (space_id, user_id, role)
  values (v_space_id, v_scratch_uid, 'owner');

  -- spoof JWT so auth.uid() inside seed_events_model_qa returns v_scratch_uid.
  -- No role switch needed: this DO block runs as the migration superuser, which
  -- can call any SECURITY DEFINER function via superuser privilege bypass.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_scratch_uid, 'role', 'authenticated')::text,
    true
  );
  perform public.seed_events_model_qa(v_space_id);

  -- assert composition (unchanged event counts)
  select count(*)       into v_cnt_events     from public.events where space_id = v_space_id;
  select count(*)       into v_cnt_pinned     from public.events where space_id = v_space_id and visibility = 'pinned';
  select count(*)       into v_cnt_hidden     from public.events where space_id = v_space_id and visibility = 'hidden';
  select count(*)       into v_cnt_proj       from public.events where space_id = v_space_id and is_projected;
  select count(*)       into v_cnt_co         from public.companies where space_id = v_space_id;
  select count(*)       into v_cnt_pi_anchors from public.primary_intelligence_anchors where space_id = v_space_id;

  if v_cnt_events     < 9 then
    raise exception 'SMOKE FAIL: expected >=9 events, got %', v_cnt_events;
  end if;
  if v_cnt_pinned    <> 1 then
    raise exception 'SMOKE FAIL: expected 1 pinned event, got %', v_cnt_pinned;
  end if;
  if v_cnt_hidden    <> 1 then
    raise exception 'SMOKE FAIL: expected 1 hidden event, got %', v_cnt_hidden;
  end if;
  if v_cnt_proj      <> 1 then
    raise exception 'SMOKE FAIL: expected 1 projected event, got %', v_cnt_proj;
  end if;
  if v_cnt_co        <> 2 then
    raise exception 'SMOKE FAIL: expected 2 companies, got %', v_cnt_co;
  end if;
  if v_cnt_pi_anchors <> 1 then
    raise exception 'SMOKE FAIL: expected 1 PI anchor, got %', v_cnt_pi_anchors;
  end if;

  -- S4: assert trial has non-null NCT identifier
  select t.identifier
    into v_trial_identifier
    from public.trials t
   where t.space_id = v_space_id
   limit 1;

  if v_trial_identifier is null then
    raise exception 'SMOKE FAIL: QA trial identifier is null; expected NCT09000001';
  end if;

  -- S4: assert Distribution event has exactly 2 event_sources
  select e.id
    into v_dist_event_id
    from public.events e
   where e.space_id = v_space_id
     and e.event_type_id = 'a0000000-0000-0000-0000-000000000040'
     and e.anchor_type   = 'asset'
   limit 1;

  if v_dist_event_id is null then
    raise exception 'SMOKE FAIL: Distribution event not found in scratch space';
  end if;

  select count(*)
    into v_cnt_dist_sources
    from public.event_sources
   where event_id = v_dist_event_id;

  if v_cnt_dist_sources <> 2 then
    raise exception 'SMOKE FAIL: Distribution event expected 2 sources, got %', v_cnt_dist_sources;
  end if;

  -- S4: assert a clinical trial-anchored event (Topline) has 0 event_sources
  select e.id
    into v_topline_event_id
    from public.events e
   where e.space_id = v_space_id
     and e.event_type_id = 'a0000000-0000-0000-0000-000000000013'
     and e.anchor_type   = 'trial'
   limit 1;

  if v_topline_event_id is null then
    raise exception 'SMOKE FAIL: Topline event not found in scratch space';
  end if;

  select count(*)
    into v_cnt_topline_sources
    from public.event_sources
   where event_id = v_topline_event_id;

  if v_cnt_topline_sources <> 0 then
    raise exception 'SMOKE FAIL: Topline (trial-anchored) expected 0 sources, got %', v_cnt_topline_sources;
  end if;

  -- idempotency check: a second call must not insert more events
  perform public.seed_events_model_qa(v_space_id);

  select count(*) into v_cnt_after from public.events where space_id = v_space_id;
  if v_cnt_after <> v_cnt_events then
    raise exception 'SMOKE FAIL: idempotency broken; second call added rows (% -> %)',
      v_cnt_events, v_cnt_after;
  end if;

  -- tear down.
  --
  -- Clear the JWT spoof so auth.uid() returns null during cleanup and
  -- the self-removal guard does not fire on the scratch user.
  perform set_config('request.jwt.claims', '', true);
  -- Bypass the last-owner guard (same GUC the personas wipe and other smoke
  -- tests use). Must be set BEFORE the explicit space_members delete so the
  -- row-level trigger sees the bypass flag.
  perform set_config('clint.member_guard_cascade', 'on', true);
  -- Explicitly delete space_members before the tenant cascade so the member
  -- guard trigger fires while the GUC is 'on'. Relying on the cascade alone
  -- can race the GUC in some PostgreSQL trigger ordering scenarios.
  delete from public.space_members where space_id = v_space_id;
  -- Delete events before the space is gone (event_changes.space_id FK).
  -- event_sources cascade via event_id FK on DELETE CASCADE.
  delete from public.events where space_id = v_space_id;
  -- PI anchors: cascade via space_id handles this, but explicit is clearer.
  delete from public.primary_intelligence_anchors where space_id = v_space_id;
  -- Tenant cascade removes space, companies, assets, trials.
  delete from public.tenants where id = v_tenant_id;
  -- Auth user last (all space-scoped data already gone).
  delete from auth.users where id = v_scratch_uid;
  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'SMOKE PASS: seed_events_model_qa % events, % pinned, % hidden, % projected, % companies, % brief; trial identifier = %, dist sources = %, topline sources = 0',
    v_cnt_events, v_cnt_pinned, v_cnt_hidden, v_cnt_proj, v_cnt_co, v_cnt_pi_anchors,
    v_trial_identifier, v_cnt_dist_sources;
end $$;

notify pgrst, 'reload schema';
