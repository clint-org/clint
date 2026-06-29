-- Curate the demo corporate band so it reads cleanly (spec section 5).
--
-- The company band surfaces an event when it is pinned OR high significance
-- (dashboard-grid: band events are pre-filtered to pinned-or-high; feed-only
-- never gets a glyph). The seed left five corporate events at significance
-- 'high' with visibility null, so they surfaced on the band implicitly,
-- crowding it beyond the "pin the high-impact ones, leave the rest feed-only"
-- intent. This makes the band explicit and leaner:
--   pinned (band): Roche/Carmot M&A, Novo/Catalent M&A, Lilly >$15B revenue,
--                  Lilly forward guidance, Novo CEO succession.
--   feed-only:     Lilly $4.5B capacity, Pfizer danuglipron, Viking +120%,
--                  Novo CagriSema -20%, Pfizer pivot, Lilly CCO.
-- After this no corporate event surfaces implicitly: every band event is
-- visibility='pinned'. Only _seed_demo_events changes; significance/visibility
-- only. Body is the live pg_get_functiondef, the five tuples are the only edit.
-- Affects future seed_demo_data calls (new demo spaces); existing spaces are
-- unchanged until re-seeded.

CREATE OR REPLACE FUNCTION public._seed_demo_events(p_space_id uuid, p_uid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c_meridian uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_meridian');
  c_vantage  uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_vantage');
  c_apex     uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_apex');
  c_cascade  uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_cascade');
  c_zenith   uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_zenith');
  c_atlas    uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_atlas');

  -- Asset id lookups (entity_type='product'). Commercial milestones anchor on the asset.
  a_wegovy   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_wegovy');
  a_zepbound uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_zepbound');
  a_attruby  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_attruby');

  -- REDEFINE-2 scoping (Novo Nordisk / CagriSema): trial-anchored business events.
  t_redefine_2 uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_redefine_2');

  -- Evergreen reference date.
  r constant date := date '2026-06-29';

  -- Business event types (unified model).
  et_strategic   constant uuid := 'a0000000-0000-0000-0000-000000000070';
  et_financial   constant uuid := 'a0000000-0000-0000-0000-000000000060';
  et_distribution constant uuid := 'a0000000-0000-0000-0000-000000000040';
  et_approval    constant uuid := 'a0000000-0000-0000-0000-000000000035';
  et_trial_start constant uuid := 'a0000000-0000-0000-0000-000000000011';
  et_pcd         constant uuid := 'a0000000-0000-0000-0000-000000000008';
  et_topline     constant uuid := 'a0000000-0000-0000-0000-000000000013';

  -- Leadership Change (low default significance): visibility drives the company band.
  et_leadership  constant uuid := 'a0000000-0000-0000-0000-000000000050';

  -- Multi-source event ids (captured for the event_sources inserts).
  v_attruby_launch uuid;
  v_lilly_revenue  uuid;
begin
  -- =========================================================================
  -- CORPORATE COMPANY-BAND EVENTS (anchor_type='company'). Curated visibility:
  -- the Roche/Carmot acquisition and the >$15B Lilly beat (below) are pinned; a
  -- forward Lilly guidance (below) is the projected company-band tier; two events
  -- stay feed-only (visibility null, low/null significance).
  -- The "Wegovy SELECT label update" Approval is no longer here: it is an asset
  -- regulatory event, re-anchored to the Wegovy asset further down.
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, visibility, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(), p_space_id, p_uid, et_strategic, 'Roche acquires Carmot Therapeutics ($2.7B)',
      'actual', '2023-12-04', 'exact', 'Roche announces acquisition of Carmot Therapeutics for $2.7B upfront, gaining access to CT-388 and CT-996 obesity assets.',
      'high', 'pinned', 'company', c_cascade, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, et_strategic, 'Lilly announces $4.5B manufacturing capacity expansion',
      'actual', '2024-02-23', 'exact', 'Lilly to invest $4.5B in additional incretin manufacturing capacity to meet GLP-1 demand.',
      'low', null, 'company', c_meridian, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, et_strategic, 'Novo Holdings acquires Catalent ($16.5B)',
      'actual', '2024-02-05', 'exact', 'Novo Holdings acquires Catalent for $16.5B; Novo Nordisk to acquire 3 Catalent fill-finish sites for Wegovy and Ozempic supply.',
      'high', 'pinned', 'company', c_vantage, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, et_strategic, 'Pfizer discontinues danuglipron program',
      'actual', '2023-12-01', 'exact', 'Pfizer halts development of oral GLP-1 small molecule danuglipron after high incidence of adverse events in P2.',
      'low', null, 'company', c_apex, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, et_financial, 'Viking VK2735 P2 readout drives stock +120%',
      'actual', '2024-02-27', 'exact', 'Viking Therapeutics VK2735 SC P2 obesity readout (~13-15% weight loss at 13 weeks) drives stock price up 120% in single session.',
      'low', null, 'company', c_zenith, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, et_financial, 'Novo CagriSema misses bar, stock -20%',
      'actual', '2024-12-20', 'exact', 'REDEFINE-1 weight loss of 22.7% below ~25% Street consensus, Novo Nordisk stock drops 20% on disappointment.',
      'low', null, 'company', c_vantage, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, et_strategic, 'Pfizer pivots cardiometabolic R&D away from oral GLP-1',
      'actual', '2024-01-15', 'exact', 'Following danuglipron discontinuation, Pfizer signals shift in cardiometabolic R&D away from oral GLP-1 small molecules.',
      null, null, 'company', c_apex, jsonb_build_object('source','analyst')),  -- feed-only
    (gen_random_uuid(), p_space_id, p_uid, et_financial, 'Lilly raises full-year incretin revenue guidance',
      'company', r + 90, 'exact', 'Lilly guides full-year incretin franchise revenue above prior consensus; forward company-guided financial outlook.',
      'high', 'pinned', 'company', c_meridian, jsonb_build_object('source','analyst'));  -- projected company-band tier

  -- Multi-source event A: BridgeBio Attruby commercial launch (Distribution, asset).
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, anchor_type, anchor_id, metadata)
    values (gen_random_uuid(), p_space_id, p_uid, et_distribution, 'BridgeBio Attruby commercial launch',
      'actual', '2024-12-09', 'exact', 'BridgeBio launches Attruby (acoramidis) for ATTR-CM, second-to-market entrant against Pfizer Vyndaqel.',
      'high', 'asset', a_attruby, jsonb_build_object('source','analyst'))
    returning id into v_attruby_launch;
  insert into public.event_sources (event_id, url, label, sort_order) values
    (v_attruby_launch, 'https://bridgebio.com/news/bridgebio-announces-commercial-launch-of-attruby/', 'BridgeBio press release', 0),
    (v_attruby_launch, 'https://investor.bridgebio.com/events/q4-2024-earnings-call-transcript', 'Q4 2024 earnings call transcript', 1);

  -- Multi-source event B: Lilly cardiometabolic franchise revenue (Financial, pinned).
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, visibility, anchor_type, anchor_id, metadata)
    values (gen_random_uuid(), p_space_id, p_uid, et_financial, 'Lilly Mounjaro/Zepbound combined annual revenue exceeds $15B',
      'actual', '2024-02-06', 'exact', 'Lilly FY2024 earnings: Mounjaro and Zepbound combined revenue exceeds $15B, anchor of cardiometabolic franchise.',
      'high', 'pinned', 'company', c_meridian, jsonb_build_object('source','analyst'))
    returning id into v_lilly_revenue;
  insert into public.event_sources (event_id, url, label, sort_order) values
    (v_lilly_revenue, 'https://investor.lilly.com/news-releases/news-release-details/lilly-reports-fourth-quarter-2024-financial-results', 'Lilly Q4 2024 results press release', 0),
    (v_lilly_revenue, 'https://investor.lilly.com/events-and-presentations/q4-2024-earnings-call-transcript', 'Lilly Q4 2024 earnings call transcript', 1);

  -- Re-anchored Approval: the Wegovy SELECT CV label is an asset regulatory event.
  if a_wegovy is not null then
    insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, anchor_type, anchor_id, metadata) values
      (gen_random_uuid(), p_space_id, p_uid, et_approval, 'Wegovy SELECT label update for CV outcomes',
        'actual', '2024-03-08', 'exact', 'FDA approves Wegovy label expansion to include reduced risk of CV death, MI, and stroke based on SELECT.',
        'high', 'asset', a_wegovy, jsonb_build_object('source','analyst'));
  end if;

  -- REDEFINE-2 trial-anchored business events (Novo CagriSema). Clinical -> trial.
  -- Trial Start for REDEFINE-2 is emitted by _create_trial_date_markers; no descriptive
  -- trial-start insert here to avoid a double marker on the lane.
  if t_redefine_2 is not null then
    insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, anchor_type, anchor_id, metadata) values
      (gen_random_uuid(), p_space_id, p_uid, et_pcd, 'REDEFINE-2 completes target enrollment',
        'actual', '2024-08-14', 'exact', 'REDEFINE-2 reaches its target enrollment of roughly 1,200 participants across the CagriSema obesity and type 2 diabetes program.',
        null, 'trial', t_redefine_2, jsonb_build_object('source','analyst')),
      (gen_random_uuid(), p_space_id, p_uid, et_topline, 'REDEFINE-2 topline: CagriSema in type 2 diabetes',
        'actual', '2025-02-10', 'exact', 'REDEFINE-2 topline reports approximately 15.7% mean weight reduction at 68 weeks in participants with type 2 diabetes, ahead of the REDEFINE-1 obesity result and reframing the CagriSema combination thesis.',
        'high', 'trial', t_redefine_2, jsonb_build_object('source','analyst'));
  end if;

  -- =========================================================================
  -- ASSET-LANE DISTRIBUTION EVENTS. anchor_type='asset'. These are distinct
  -- commercial-distribution facts, not copies of the asset approvals/launches in
  -- _seed_demo_markers (the earlier "X reaches market" approval copies are removed;
  -- approvals now live once, in _seed_demo_markers). The approval-to-distribution
  -- gap is wide for Wegovy (supply-constrained) and narrow for Zepbound (fast ramp).
  -- =========================================================================
  if a_wegovy is not null then
    insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, anchor_type, anchor_id, metadata) values
      (gen_random_uuid(), p_space_id, p_uid, et_distribution, 'Wegovy broad US distribution restored',
        'actual', '2023-05-01', 'exact', 'After roughly two years of supply-constrained rollout, Wegovy returns to broad US pharmacy distribution across all dose strengths.',
        'high', 'asset', a_wegovy, jsonb_build_object('source','analyst'));
  end if;

  if a_zepbound is not null then
    insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, anchor_type, anchor_id, metadata) values
      (gen_random_uuid(), p_space_id, p_uid, et_distribution, 'Zepbound broad US distribution',
        'actual', '2024-02-01', 'exact', 'Zepbound reaches broad US pharmacy distribution within roughly three months of clearance, the fastest cardiometabolic launch ramp on record.',
        'high', 'asset', a_zepbound, jsonb_build_object('source','analyst'));
  end if;

  -- =========================================================================
  -- COMPANY BAND coverage: a feed-only low-significance leadership event, and a
  -- pinned leadership event promoted onto the company band.
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
$function$

;

notify pgrst, 'reload schema';
