-- Redefine _seed_demo_events to add asset-lane commercial events and company-band
-- coverage for the unified events timeline.
--
-- What changes vs the prior definition:
--   1. Declare block gains asset id lookups (Wegovy / Zepbound / Attruby, which are
--      entity_type='product' rows in _seed_ids) and an et_leadership constant.
--   2. The existing Attruby commercial-launch Distribution event is re-anchored from
--      the company to the asset (a commercial distribution fact belongs on the asset
--      lane). Its event_sources provenance is preserved unchanged.
--   3. A new block seeds asset-anchored Approval + Distribution events on each asset
--      (so the asset lanes and two-asset comparison have content) plus two company-band
--      Leadership events: one feed-only, one analyst-pinned onto the band.
--
-- These are distinct asset / commercial / leadership milestones, not copies of the
-- trial-anchored regulatory markers in _seed_demo_markers. The existing business-event
-- landscape, multi-source events, and REDEFINE-2 trial events are preserved verbatim.

create or replace function public._seed_demo_events(p_space_id uuid, p_uid uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  c_meridian uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_meridian');
  c_vantage  uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_vantage');
  c_apex     uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_apex');
  c_cascade  uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_cascade');
  c_zenith   uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_zenith');
  c_atlas    uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_atlas');

  -- Asset id lookups (assets are entity_type='product' in _seed_ids). Used to anchor
  -- commercial milestones on the asset lane.
  a_wegovy   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_wegovy');
  a_zepbound uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_zepbound');
  a_attruby  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_attruby');

  -- REDEFINE-2 scoping (Novo Nordisk / CagriSema): trial-anchored business events
  -- so the trial-detail EVENTS panel has content.
  t_redefine_2 uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_redefine_2');

  -- Business event types (unified model). category_id (dropped event_categories)
  -- maps onto these per each event's intent.
  et_strategic   constant uuid := 'a0000000-0000-0000-0000-000000000070';
  et_financial   constant uuid := 'a0000000-0000-0000-0000-000000000060';
  et_distribution constant uuid := 'a0000000-0000-0000-0000-000000000040';
  et_approval    constant uuid := 'a0000000-0000-0000-0000-000000000035';
  et_trial_start constant uuid := 'a0000000-0000-0000-0000-000000000011';
  et_pcd         constant uuid := 'a0000000-0000-0000-0000-000000000008';
  et_topline     constant uuid := 'a0000000-0000-0000-0000-000000000013';

  -- Leadership Change (low default significance): visibility, not significance,
  -- drives the company band for these.
  et_leadership  constant uuid := 'a0000000-0000-0000-0000-000000000050';

  -- Multi-source event ids (captured for the event_sources inserts).
  v_attruby_launch uuid;
  v_lilly_revenue  uuid;
begin
  -- Company-anchored business events (single anchor each: anchor_type='company').
  -- priority 'high' -> significance='high'; 'low' -> null (inherit from type).
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(), p_space_id, p_uid, et_strategic, 'Roche acquires Carmot Therapeutics ($2.7B)',
      'actual', '2023-12-04', 'exact', 'Roche announces acquisition of Carmot Therapeutics for $2.7B upfront, gaining access to CT-388 and CT-996 obesity assets.',
      'high', 'company', c_cascade, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, et_strategic, 'Lilly announces $4.5B manufacturing capacity expansion',
      'actual', '2024-02-23', 'exact', 'Lilly to invest $4.5B in additional incretin manufacturing capacity to meet GLP-1 demand.',
      'high', 'company', c_meridian, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, et_strategic, 'Novo Holdings acquires Catalent ($16.5B)',
      'actual', '2024-02-05', 'exact', 'Novo Holdings acquires Catalent for $16.5B; Novo Nordisk to acquire 3 Catalent fill-finish sites for Wegovy and Ozempic supply.',
      'high', 'company', c_vantage, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, et_strategic, 'Pfizer discontinues danuglipron program',
      'actual', '2023-12-01', 'exact', 'Pfizer halts development of oral GLP-1 small molecule danuglipron after high incidence of adverse events in P2.',
      'high', 'company', c_apex, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, et_financial, 'Viking VK2735 P2 readout drives stock +120%',
      'actual', '2024-02-27', 'exact', 'Viking Therapeutics VK2735 SC P2 obesity readout (~13-15% weight loss at 13 weeks) drives stock price up 120% in single session.',
      'high', 'company', c_zenith, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, et_financial, 'Novo CagriSema misses bar, stock -20%',
      'actual', '2024-12-20', 'exact', 'REDEFINE-1 weight loss of 22.7% below ~25% Street consensus, Novo Nordisk stock drops 20% on disappointment.',
      'high', 'company', c_vantage, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, et_approval, 'Wegovy SELECT label update for CV outcomes',
      'actual', '2024-03-08', 'exact', 'FDA approves Wegovy label expansion to include reduced risk of CV death, MI, and stroke based on SELECT.',
      'high', 'company', c_vantage, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, et_strategic, 'Pfizer pivots cardiometabolic R&D away from oral GLP-1',
      'actual', '2024-01-15', 'exact', 'Following danuglipron discontinuation, Pfizer signals shift in cardiometabolic R&D away from oral GLP-1 small molecules.',
      null, 'company', c_apex, jsonb_build_object('source','analyst'));

  -- Multi-source event A: BridgeBio Attruby commercial launch (Distribution).
  -- Re-anchored company -> asset: a commercial distribution fact belongs on the
  -- asset lane (spec: asset lane hosts approval / launch / LOE / distribution).
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, anchor_type, anchor_id, metadata)
    values (gen_random_uuid(), p_space_id, p_uid, et_distribution, 'BridgeBio Attruby commercial launch',
      'actual', '2024-12-09', 'exact', 'BridgeBio launches Attruby (acoramidis) for ATTR-CM, second-to-market entrant against Pfizer Vyndaqel.',
      'high', 'asset', a_attruby, jsonb_build_object('source','analyst'))
    returning id into v_attruby_launch;
  insert into public.event_sources (event_id, url, label, sort_order) values
    (v_attruby_launch, 'https://bridgebio.com/news/bridgebio-announces-commercial-launch-of-attruby/', 'BridgeBio press release', 0),
    (v_attruby_launch, 'https://investor.bridgebio.com/events/q4-2024-earnings-call-transcript', 'Q4 2024 earnings call transcript', 1);

  -- Multi-source event B: Lilly cardiometabolic franchise revenue (Financial).
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, anchor_type, anchor_id, metadata)
    values (gen_random_uuid(), p_space_id, p_uid, et_financial, 'Lilly Mounjaro/Zepbound combined annual revenue exceeds $15B',
      'actual', '2024-02-06', 'exact', 'Lilly FY2024 earnings: Mounjaro and Zepbound combined revenue exceeds $15B, anchor of cardiometabolic franchise.',
      'high', 'company', c_meridian, jsonb_build_object('source','analyst'))
    returning id into v_lilly_revenue;
  insert into public.event_sources (event_id, url, label, sort_order) values
    (v_lilly_revenue, 'https://investor.lilly.com/news-releases/news-release-details/lilly-reports-fourth-quarter-2024-financial-results', 'Lilly Q4 2024 results press release', 0),
    (v_lilly_revenue, 'https://investor.lilly.com/events-and-presentations/q4-2024-earnings-call-transcript', 'Lilly Q4 2024 earnings call transcript', 1);

  -- REDEFINE-2 trial-anchored business events (Novo CagriSema, obesity + T2D).
  -- One anchor each (anchor_type='trial'); skipped if the trial is absent from
  -- this seed variant. "completes target enrollment" has no enrollment-specific
  -- event_type in the unified model; mapped to Primary Completion as the nearest
  -- trial-progress milestone (demo data, not phase-bar-test-gated).
  if t_redefine_2 is not null then
    insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, anchor_type, anchor_id, metadata) values
      (gen_random_uuid(), p_space_id, p_uid, et_trial_start, 'REDEFINE-2 first participant dosed',
        'actual', '2023-03-20', 'exact', 'Novo Nordisk doses the first participant in REDEFINE-2, the Phase 3 trial of CagriSema in adults with overweight or obesity and type 2 diabetes.',
        null, 'trial', t_redefine_2, jsonb_build_object('source','analyst')),
      (gen_random_uuid(), p_space_id, p_uid, et_pcd, 'REDEFINE-2 completes target enrollment',
        'actual', '2024-08-14', 'exact', 'REDEFINE-2 reaches its target enrollment of roughly 1,200 participants across the CagriSema obesity and type 2 diabetes program.',
        null, 'trial', t_redefine_2, jsonb_build_object('source','analyst')),
      (gen_random_uuid(), p_space_id, p_uid, et_topline, 'REDEFINE-2 topline: CagriSema in type 2 diabetes',
        'actual', '2025-02-10', 'exact', 'REDEFINE-2 topline reports approximately 15.7% mean weight reduction at 68 weeks in participants with type 2 diabetes, ahead of the REDEFINE-1 obesity result and reframing the CagriSema combination thesis.',
        'high', 'trial', t_redefine_2, jsonb_build_object('source','analyst'));
  end if;

  -- =========================================================================
  -- ASSET-LANE COMMERCIAL TIMELINE (feature coverage: asset lanes + comparison).
  -- Each asset gets an asset-anchored Approval (flag) and a later asset-anchored
  -- Distribution (hexagon). anchor_type='asset' is required to render on the
  -- asset lane (no roll-up from trials). The approval-to-distribution gap is
  -- deliberately wide for Wegovy (supply-constrained launch) and narrow for
  -- Zepbound (record-fast ramp) so the two-asset comparison reads at a glance.
  -- These are distinct asset/commercial milestones, not copies of the trial-
  -- anchored regulatory markers in _seed_demo_markers.
  -- =========================================================================
  if a_wegovy is not null then
    insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, anchor_type, anchor_id, metadata) values
      (gen_random_uuid(), p_space_id, p_uid, et_approval, 'Wegovy reaches market in obesity',
        'actual', '2021-06-04', 'exact', 'Semaglutide 2.4 mg cleared for chronic weight management, opening the asset for commercial distribution.',
        'high', 'asset', a_wegovy, jsonb_build_object('source','analyst')),
      (gen_random_uuid(), p_space_id, p_uid, et_distribution, 'Wegovy broad US distribution restored',
        'actual', '2023-05-01', 'exact', 'After roughly two years of supply-constrained rollout, Wegovy returns to broad US pharmacy distribution across all dose strengths.',
        'high', 'asset', a_wegovy, jsonb_build_object('source','analyst'));
  end if;

  if a_zepbound is not null then
    insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, anchor_type, anchor_id, metadata) values
      (gen_random_uuid(), p_space_id, p_uid, et_approval, 'Zepbound reaches market in obesity',
        'actual', '2023-11-08', 'exact', 'Tirzepatide cleared for chronic weight management, opening the asset for commercial distribution.',
        'high', 'asset', a_zepbound, jsonb_build_object('source','analyst')),
      (gen_random_uuid(), p_space_id, p_uid, et_distribution, 'Zepbound broad US distribution',
        'actual', '2024-02-01', 'exact', 'Zepbound reaches broad US pharmacy distribution within roughly three months of clearance, the fastest cardiometabolic launch ramp on record.',
        'high', 'asset', a_zepbound, jsonb_build_object('source','analyst'));
  end if;

  -- Attruby asset-anchored approval to complete its lane (its distribution event
  -- was re-anchored to the asset above). Fast second-to-market entrant.
  if a_attruby is not null then
    insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, anchor_type, anchor_id, metadata) values
      (gen_random_uuid(), p_space_id, p_uid, et_approval, 'Attruby reaches market in ATTR-CM',
        'actual', '2024-11-22', 'exact', 'Acoramidis cleared for ATTR cardiomyopathy, entering a Vyndaqel-saturated market.',
        'high', 'asset', a_attruby, jsonb_build_object('source','analyst'));
  end if;

  -- =========================================================================
  -- COMPANY BAND coverage: a feed-only low-significance leadership event, and a
  -- pinned low-significance event promoted onto the company band. Leadership
  -- Change (a0..050) defaults to low significance, so visibility drives the band.
  -- =========================================================================
  if c_meridian is not null then
    insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, visibility, anchor_type, anchor_id, metadata) values
      (gen_random_uuid(), p_space_id, p_uid, et_leadership, 'Lilly names new chief commercial officer',
        'actual', '2024-02-15', 'exact', 'Leadership change in the Lilly cardiometabolic commercial organization.',
        null, null, 'company', c_meridian, jsonb_build_object('source','analyst'));  -- low sig, feed-only
  end if;

  if c_vantage is not null then
    insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, visibility, anchor_type, anchor_id, metadata) values
      (gen_random_uuid(), p_space_id, p_uid, et_leadership, 'Novo Nordisk announces CEO succession',
        'actual', '2024-08-01', 'exact', 'Analyst-pinned leadership transition at Novo Nordisk during the GLP-1 supply ramp.',
        null, 'pinned', 'company', c_vantage, jsonb_build_object('source','analyst'));  -- low sig, pinned onto band
  end if;
end;
$function$;

-- In-file smoke: data-conditional, self-cleaning, prod-safe. Seeds a scratch space
-- through the producer chain and asserts the new asset-lane and company-band coverage,
-- then removes the scratch space. Skips on a non-seeded db.
do $smoke$
declare
  v_tenant uuid;
  v_uid    uuid;
  v_space  uuid := gen_random_uuid();
  v_asset_pairs int;
  v_pinned int;
  v_feed_leadership int;
  v_hex_asset int;
begin
  select id into v_tenant from public.tenants limit 1;
  select id into v_uid from auth.users limit 1;
  if v_tenant is null or v_uid is null
     or not exists (select 1 from public.spaces where id = '00000000-0000-0000-0000-0000000d0100') then
    raise notice 'seed-demo feature-coverage smoke: skipped on non-seeded db; covered by integration suite';
    return;
  end if;

  insert into public.spaces (id, tenant_id, name, created_by) values (v_space, v_tenant, 'seed-demo coverage smoke', v_uid);

  create temp table if not exists _seed_ids (
    entity_type text not null, key text not null, id uuid not null,
    primary key (entity_type, key)
  ) on commit drop;
  delete from _seed_ids;

  perform public._seed_demo_companies(v_space, v_uid);
  perform public._seed_demo_indications(v_space, v_uid);
  perform public._seed_demo_assets(v_space, v_uid);
  perform public._seed_demo_moa_roa(v_space, v_uid);
  perform public._seed_demo_trials(v_space, v_uid);
  perform public._seed_demo_asset_indications(v_space, v_uid);
  perform public._seed_demo_markers(v_space, v_uid);
  perform public._seed_demo_events(v_space, v_uid);

  -- >= 2 assets with both an asset-anchored Approval and Distribution
  select count(*) into v_asset_pairs from (
    select anchor_id from public.events
    where space_id = v_space and anchor_type = 'asset'
      and event_type_id in ('a0000000-0000-0000-0000-000000000035','a0000000-0000-0000-0000-000000000040')
    group by anchor_id
    having count(distinct event_type_id) = 2
  ) q;
  if v_asset_pairs < 2 then
    raise exception 'coverage smoke: expected >=2 assets with approval+distribution, got %', v_asset_pairs;
  end if;

  select count(*) into v_hex_asset from public.events
   where space_id = v_space and anchor_type = 'asset'
     and event_type_id = 'a0000000-0000-0000-0000-000000000040' and significance = 'high';
  if v_hex_asset < 1 then
    raise exception 'coverage smoke: expected >=1 high-sig asset Distribution, got %', v_hex_asset;
  end if;

  select count(*) into v_pinned from public.events
   where space_id = v_space and anchor_type = 'company' and visibility = 'pinned';
  if v_pinned < 1 then
    raise exception 'coverage smoke: expected >=1 pinned company event, got %', v_pinned;
  end if;

  select count(*) into v_feed_leadership from public.events
   where space_id = v_space and anchor_type = 'company'
     and event_type_id = 'a0000000-0000-0000-0000-000000000050'
     and visibility is null and (significance is null or significance <> 'high');
  if v_feed_leadership < 1 then
    raise exception 'coverage smoke: expected >=1 feed-only leadership event, got %', v_feed_leadership;
  end if;

  delete from public.spaces where id = v_space;
  raise notice 'seed-demo coverage smoke PASS: % asset pairs, % hex asset, % pinned, % feed leadership',
    v_asset_pairs, v_hex_asset, v_pinned, v_feed_leadership;
end;
$smoke$;

notify pgrst, 'reload schema';
