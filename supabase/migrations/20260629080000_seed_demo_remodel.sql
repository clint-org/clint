-- Seed demo data remodel: correct event lanes, dedup, evergreen dates, projection variety.
--
-- This migration re-authors the seed producers so a freshly seeded demo space renders
-- a structurally clean timeline. Bodies are based on the LIVE pg_get_functiondef of each
-- helper; only the rules below change. The competitive landscape (companies, assets,
-- trials, the obesity/cardiometabolic story) and every title/description are preserved
-- except where dedup removes a duplicate fact.
--
-- What changes:
--   1. Anchor model. Regulatory/commercial events (Regulatory Filing a0..032, Approval
--      a0..035, Launch a0..036, Distribution a0..040, LOE a0..020) are re-authored as
--      ASSET-anchored (anchor_type='asset', anchor_id = the product row in _seed_ids,
--      entity_type='product'). Clinical events (Trial Start a0..011, Trial End a0..012,
--      Primary Completion a0..008, Topline Data a0..013) stay TRIAL-anchored. Corporate
--      events (Financial a0..060, Leadership a0..050, Strategic a0..070) stay COMPANY.
--      Where the seed had anchored an event to a trial whose drug differs from the event
--      subject (Verquvo approval on the Entresto trial, Trulicity LOE on the Mounjaro
--      trial) the asset is chosen by the event's real drug, not the trial's drug.
--   2. Dedup. Cross-trial fan-out filings collapse to one asset-anchored event. The
--      "topline expected" inserts in _seed_demo_recent_activity are removed (they
--      duplicated the trial-anchored projected toplines). Semantic duplicates between
--      _seed_demo_markers and _seed_demo_events (Wegovy CV approval, Attruby launch,
--      Wegovy/Zepbound/Attruby "reaches market" approvals, the tirzepatide HFpEF filing)
--      are collapsed to a single canonical event each. No two CURATED events share a
--      title (the structural per-trial 'Trial Start'/'Trial End' phase-bar markers
--      from _create_trial_date_markers keep their generic shared titles by design).
--   3. Evergreen dates. Every event date is authored against a fixed reference constant
--      r = date '2026-06-29' (the dataset's intended "now"). The orchestrator gains a
--      single final pass that shifts the whole space by (current_date - r) so projected
--      events always sit ahead of today and the past/future split is preserved on any
--      run day. Producers never call current_date for an event date (avoids double-shift).
--   4. Projection variety. All four projection tiers (actual / primary / company /
--      forecasted) appear across anchor levels. Zepbound (tirzepatide) carries the full
--      vocabulary on its asset lane. Projected registry primary-completion estimates use
--      'primary'; analyst LOE dates and launch windows use 'forecasted'; company-guided
--      filings/readouts use 'company'.
--   5. Curated corporate visibility. The Roche/Carmot acquisition, the Lilly >$15B
--      revenue beat, a forward Lilly guidance, and one leadership change are pinned;
--      at least two corporate events stay feed-only (visibility null, low/null sig).
--
-- The producers keep their inline SECURITY DEFINER insert pattern (they must work for a
-- platform-admin caller, for whom create_event's write-side has_space_access check fails).
-- They do not call or redefine create_event / update_event / get_event_detail.

-- ===========================================================================
-- 1. _seed_demo_markers
-- ===========================================================================
create or replace function public._seed_demo_markers(p_space_id uuid, p_uid uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  -- Evergreen reference date. Author all dates against r; the orchestrator shifts the
  -- whole space by (current_date - r) so projections stay ahead of today.
  r constant date := date '2026-06-29';

  -- Trial UUIDs (clinical events stay trial-anchored).
  t_surmount_1       uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_surmount_1');
  t_surpass_2        uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_surpass_2');
  t_step_1           uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_step_1');
  t_select           uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_select');
  t_dapa_hf          uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_dapa_hf');
  t_emperor_reduced  uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_emperor_reduced');
  t_explorer_hcm     uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_explorer_hcm');
  t_paradigm_hf      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_paradigm_hf');
  t_attr_act         uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_attr_act');
  t_attribute_cm     uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_attribute_cm');
  t_surmount_mmo     uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_surmount_mmo');
  t_summit           uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_summit');
  t_surmount_osa     uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_surmount_osa');
  t_attain_1         uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_attain_1');
  t_achieve_1        uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_achieve_1');
  t_triumph_1        uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_triumph_1');
  t_flow             uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_flow');
  t_redefine_1       uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_redefine_1');
  t_redefine_2       uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_redefine_2');
  t_soul             uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_soul');
  t_deliver          uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_deliver');
  t_dapa_ckd         uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_dapa_ckd');
  t_emperor_preserved uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_emperor_preserved');
  t_empa_kidney      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_empa_kidney');
  t_empact_mi        uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_empact_mi');
  t_survodutide_p2   uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_survodutide_p2');
  t_fineart_hf       uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_fineart_hf');
  t_sequoia_hcm      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_sequoia_hcm');
  t_maple_hcm        uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_maple_hcm');
  t_acacia_hcm       uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_acacia_hcm');
  t_odyssey_hcm      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_odyssey_hcm');
  t_ct388_p2         uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_ct388_p2');
  t_vk2735_sc_p2     uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_vk2735_sc_p2');
  t_vk2735_oral_p2   uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_vk2735_oral_p2');
  t_maritide_p2      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_maritide_p2');
  t_danuglipron_p2   uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_danuglipron_p2');

  -- Asset UUIDs (assets are entity_type='product' in _seed_ids). Regulatory/commercial
  -- events are authored onto the asset lane (anchor_type='asset').
  a_mounjaro    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_mounjaro');
  a_zepbound    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_zepbound');
  a_wegovy      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_wegovy');
  a_farxiga     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_farxiga');
  a_jardiance   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_jardiance');
  a_camzyos     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_camzyos');
  a_entresto    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_entresto');
  a_vyndaqel    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vyndaqel');
  a_attruby     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_attruby');
  a_verquvo     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_verquvo');
  a_kerendia    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_kerendia');
  a_ozempic     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_ozempic');
  a_aficamten   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_aficamten');
  a_orforglipron uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_orforglipron');
  a_retatrutide uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_retatrutide');
  a_cagrisema   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_cagrisema');
  a_danuglipron uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_danuglipron');
  a_trulicity   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_trulicity');

  -- Named event UUIDs (formerly named markers) registered into _seed_ids at the end for
  -- shape stability; the ids point at real event rows.
  m_summit_topline    uuid := gen_random_uuid();
  m_redefine_1_miss   uuid := gen_random_uuid();
  m_orforglipron_read uuid := gen_random_uuid();
  m_maritide_read     uuid := gen_random_uuid();

  -- metadata.source = 'analyst' marks these as analyst-authored facts.
begin
  -- =========================================================================
  -- TOPLINE DATA READOUTS (PAST). a0..013 "Topline Data". Clinical -> trial.
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(),  p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'SURMOUNT-1 full results published in NEJM', 'actual', '2022-07-21', 'exact', 'Tirzepatide ~22.5% body weight loss at 72 weeks; the obesity efficacy bar was reset.', 'trial', t_surmount_1, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),  p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'STEP 1 full results published in NEJM',     'actual', '2021-03-18', 'exact', 'Semaglutide 2.4 mg achieved 14.9% body weight reduction at week 68.', 'trial', t_step_1, jsonb_build_object('source','analyst')),
    (m_summit_topline,   p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'SUMMIT NEJM publication',                   'actual', '2024-11-16', 'exact', 'First HFpEF outcomes trial in obese patients to show improvement on KCCQ-CSS plus reduced HF events.', 'trial', t_summit, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),  p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'SELECT NEJM publication',                   'actual', '2023-11-11', 'exact', 'Semaglutide reduced 3-point MACE by 20% in obese non-diabetic patients with established CV disease.', 'trial', t_select, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),  p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'FLOW NEJM publication',                     'actual', '2024-05-24', 'exact', 'Semaglutide reduced major kidney disease events by 24% in T2D + CKD.', 'trial', t_flow, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),  p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'SEQUOIA-HCM topline at AHA 2024',            'actual', '2024-11-16', 'exact', 'Aficamten met primary endpoint with significant improvement in pVO2 at week 24.', 'trial', t_sequoia_hcm, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),  p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'FINEARTS-HF positive at ESC 2024',           'actual', '2024-09-01', 'exact', 'Finerenone reduced composite of CV death and total HF events by 16% in HFmrEF/HFpEF.', 'trial', t_fineart_hf, jsonb_build_object('source','analyst')),
    (m_redefine_1_miss,  p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'REDEFINE-1 topline below Street expectations', 'actual', '2024-12-20', 'exact', 'CagriSema delivered 22.7% weight loss vs ~25% Street consensus; combo defense thesis impaired.', 'trial', t_redefine_1, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),  p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'DAPA-HF topline announced',                 'actual', '2019-08-20', 'exact', 'Dapagliflozin reduced CV death or worsening HF by 26% in HFrEF.', 'trial', t_dapa_hf, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),  p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'EMPEROR-Reduced topline announced',         'actual', '2020-08-28', 'exact', 'Empagliflozin reduced primary composite by 25% in HFrEF.', 'trial', t_emperor_reduced, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),  p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'EXPLORER-HCM positive at HFSA 2020',         'actual', '2020-08-29', 'exact', 'Mavacamten met composite primary endpoint in obstructive HCM.', 'trial', t_explorer_hcm, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),  p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'ATTRibute-CM positive topline',              'actual', '2023-07-17', 'exact', 'Acoramidis reduced all-cause mortality and CV hospitalizations vs placebo in ATTR-CM.', 'trial', t_attribute_cm, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),  p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'EMPACT-MI fails primary in post-MI',          'actual', '2024-04-08', 'exact', 'Empagliflozin did not reduce composite of all-cause death or HF hospitalization in post-MI patients without HF.', 'trial', t_empact_mi, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),  p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'ODYSSEY-HCM fails primary in nHCM',          'actual', '2024-10-15', 'exact', 'Mavacamten missed primary endpoint in non-obstructive HCM; limits indication expansion.', 'trial', t_odyssey_hcm, jsonb_build_object('source','analyst')),
    (m_maritide_read,    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'MariTide P2 positive readout',               'actual', '2024-11-26', 'exact', 'Maridebart cafraglutide ~20% weight loss at 52 weeks; GIPR antagonism + GLP-1 agonism validated.', 'trial', t_maritide_p2, jsonb_build_object('source','analyst'));

  -- =========================================================================
  -- TOPLINE DATA READOUTS (PROJECTED). a0..013. Clinical -> trial, 'company'.
  -- A handful are re-dated just ahead of r so the orchestrator shift keeps them
  -- in the near-future upcoming-catalyst window (single source of truth: the
  -- duplicate "topline expected" inserts in _seed_demo_recent_activity are gone).
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(),    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'TRIUMPH-1 topline projected',           'company', '2026-08-15', 'exact', 'Retatrutide P3 obesity readout, expected H2 2026.', 'trial', t_triumph_1, jsonb_build_object('source','analyst')),
    (m_orforglipron_read,  p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'ATTAIN-1 topline projected',            'company', r + 5,  'exact', 'Lilly orforglipron P3 obesity readout.', 'trial', t_attain_1, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'ACHIEVE-1 topline projected',           'company', r + 8,  'exact', 'Lilly orforglipron P3 T2D readout.', 'trial', t_achieve_1, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'MAPLE-HCM topline projected',           'company', r + 45, 'exact', 'Aficamten head-to-head vs metoprolol.', 'trial', t_maple_hcm, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'ACACIA-HCM topline projected',          'company', r + 14, 'exact', 'Aficamten in non-obstructive HCM.', 'trial', t_acacia_hcm, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'SURMOUNT-MMO topline projected',        'company', '2027-10-01', 'exact', 'Tirzepatide CV outcomes trial in obesity.', 'trial', t_surmount_mmo, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'CT-388 P2 final analysis projected',    'company', '2026-03-15', 'exact', 'Roche/Carmot enicepatide obesity P2 final analysis.', 'trial', t_ct388_p2, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'REDEFINE-2 topline projected',          'company', r + 2,  'exact', 'CagriSema P3 in obesity + T2D, follow-on to REDEFINE-1.', 'trial', t_redefine_2, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'VK2735 oral P2 final results projected','company', r + 60, 'exact', 'Viking oral GIP/GLP-1 dual agonist.', 'trial', t_vk2735_oral_p2, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'Survodutide P3 obesity readout projected','company', '2027-04-15', 'exact', 'BI/Zealand GLP-1/glucagon dual agonist P3 confirmatory.', 'trial', t_survodutide_p2, jsonb_build_object('source','analyst'));

  -- =========================================================================
  -- REGULATORY FILINGS (PAST). a0..032. Regulatory -> asset.
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Wegovy SELECT sNDA submitted',     'actual', '2024-01-15', 'exact', 'CV risk reduction label expansion based on SELECT.', 'asset', a_wegovy, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Aficamten NDA submitted',          'actual', '2024-09-30', 'exact', 'Cytokinetics NDA filing for oHCM based on SEQUOIA-HCM.', 'asset', a_aficamten, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Finerenone HFpEF sNDA submitted',  'actual', '2024-09-20', 'exact', 'Bayer label expansion to HFpEF/HFmrEF based on FINEARTS-HF.', 'asset', a_kerendia, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Zepbound OSA sNDA submitted',      'actual', '2024-06-15', 'exact', 'Tirzepatide OSA label expansion based on SURMOUNT-OSA.', 'asset', a_zepbound, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Acoramidis NDA submitted',         'actual', '2024-01-25', 'exact', 'BridgeBio NDA filing for ATTR-CM based on ATTRibute-CM.', 'asset', a_attruby, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Ozempic CKD sNDA submitted',       'actual', '2024-09-15', 'exact', 'Novo label expansion to CKD in T2D based on FLOW.', 'asset', a_ozempic, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Jardiance EMPA-KIDNEY sNDA submitted','actual', '2023-03-14', 'exact', 'BI label expansion to CKD.', 'asset', a_jardiance, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Farxiga DELIVER sNDA submitted',   'actual', '2022-04-15', 'exact', 'AZ label expansion to HFpEF/HFmrEF.', 'asset', a_farxiga, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Mavacamten NDA submitted',         'actual', '2021-08-30', 'exact', 'BMS NDA filing for oHCM based on EXPLORER-HCM.', 'asset', a_camzyos, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Tirzepatide T2D NDA submitted',    'actual', '2021-10-04', 'exact', 'Lilly NDA filing for tirzepatide in T2D, basis for Mounjaro approval.', 'asset', a_mounjaro, jsonb_build_object('source','analyst'));

  -- =========================================================================
  -- REGULATORY FILINGS (PROJECTED). a0..032. Regulatory -> asset.
  -- Company-guided filings use 'company'. Stale (pre-r) dates re-dated ahead of r.
  -- "Tirzepatide HFpEF sNDA projected" dropped: it is the same fact as the
  -- collapsed "Zepbound HFpEF sNDA filing" below (one tirzepatide HFpEF filing).
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Orforglipron NDA projected',         'company', '2026-12-01', 'exact', 'Lilly orforglipron NDA, contingent on ATTAIN-1 / ACHIEVE-1 readouts.', 'asset', a_orforglipron, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Retatrutide NDA projected',          'company', '2027-03-15', 'exact', 'Lilly retatrutide NDA, contingent on TRIUMPH-1.', 'asset', a_retatrutide, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'CagriSema NDA projected',            'company', '2026-09-30', 'exact', 'Novo CagriSema NDA filing despite REDEFINE-1 below-bar miss.', 'asset', a_cagrisema, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Aficamten EU MAA projected',         'company', r + 90, 'exact', 'Cytokinetics EU regulatory filing post-SEQUOIA-HCM.', 'asset', a_aficamten, jsonb_build_object('source','analyst')),
    -- Zepbound full-vocabulary: a primary-sourced projected filing (renders the 'p' tier).
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Zepbound cardiovascular outcomes data filing projected', 'primary', '2028-02-15', 'exact', 'Primary-source-derived projection of a tirzepatide CV outcomes filing following SURMOUNT-MMO.', 'asset', a_zepbound, jsonb_build_object('source','analyst'));

  -- =========================================================================
  -- APPROVALS. a0..035. Regulatory -> asset.
  -- Verquvo approval is anchored to its own asset (the seed had it on the Entresto
  -- trial). "Wegovy FDA approval (CV risk reduction)" dropped: it is the same fact
  -- as "Wegovy SELECT label update for CV outcomes" in _seed_demo_events (kept there).
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Mounjaro FDA approval (T2D)',                'actual', '2022-05-13', 'exact', 'First-in-class GIP/GLP-1 dual agonist approved for T2D.', 'asset', a_mounjaro, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Zepbound FDA approval (chronic weight management)','actual', '2023-11-08', 'exact', 'Tirzepatide approved for chronic weight management in obese adults.', 'asset', a_zepbound, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Zepbound FDA approval (OSA)',                'actual', '2024-12-20', 'exact', 'First drug approved for obstructive sleep apnea in obesity.', 'asset', a_zepbound, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Wegovy FDA approval (obesity)',              'actual', '2021-06-04', 'exact', 'Semaglutide 2.4 mg approved for chronic weight management.', 'asset', a_wegovy, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Farxiga FDA approval (HFrEF)',               'actual', '2020-05-05', 'exact', 'First SGLT2 inhibitor approved for HFrEF.', 'asset', a_farxiga, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Farxiga FDA approval (CKD)',                 'actual', '2021-04-30', 'exact', 'CKD label expansion based on DAPA-CKD.', 'asset', a_farxiga, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Jardiance FDA approval (broad heart failure)','actual', '2022-02-24', 'exact', 'Heart failure indication expanded across the LVEF spectrum.', 'asset', a_jardiance, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Camzyos FDA approval (oHCM)',                'actual', '2022-04-29', 'exact', 'First cardiac myosin inhibitor approved for symptomatic obstructive HCM.', 'asset', a_camzyos, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Entresto FDA approval (HFrEF)',              'actual', '2015-07-07', 'exact', 'First-in-class ARNI approved for HFrEF based on PARADIGM-HF.', 'asset', a_entresto, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Vyndaqel/Vyndamax FDA approval (ATTR-CM)',   'actual', '2019-05-03', 'exact', 'First TTR stabilizer approved for ATTR-CM.', 'asset', a_vyndaqel, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Attruby FDA approval (ATTR-CM)',             'actual', '2024-11-22', 'exact', 'BridgeBio acoramidis approved for ATTR-CM, second-to-market entrant.', 'asset', a_attruby, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Verquvo FDA approval (HFrEF)',               'actual', '2021-01-19', 'exact', 'First sGC stimulator approved for symptomatic chronic HFrEF.', 'asset', a_verquvo, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Kerendia FDA approval (CKD with T2D)',       'actual', '2021-07-09', 'exact', 'First non-steroidal MRA approved for CKD with T2D.', 'asset', a_kerendia, jsonb_build_object('source','analyst'));

  -- =========================================================================
  -- LAUNCHES. a0..036. Commercial -> asset.
  -- "Attruby US launch" dropped: same fact as the multi-source "BridgeBio Attruby
  -- commercial launch" Distribution in _seed_demo_events (kept there with sources).
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000036', 'Mounjaro US launch',         'actual', '2022-06-01', 'exact', 'Lilly tirzepatide commercial launch in T2D.', 'asset', a_mounjaro, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000036', 'Zepbound US launch',         'actual', '2023-12-04', 'exact', 'Tirzepatide obesity launch, fastest US launch ramp on record.', 'asset', a_zepbound, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000036', 'Wegovy US launch',           'actual', '2021-06-22', 'exact', 'Semaglutide 2.4 mg obesity launch.', 'asset', a_wegovy, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000036', 'Camzyos US launch',          'actual', '2022-05-09', 'exact', 'BMS first-in-class oHCM launch.', 'asset', a_camzyos, jsonb_build_object('source','analyst'));

  -- =========================================================================
  -- PRIMARY COMPLETION DATES. a0..008. Clinical -> trial.
  -- Projected registry estimates use 'primary' (CT.gov registry default).
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000008', 'SUMMIT primary completion',         'actual', '2024-07-02', 'exact', 'trial', t_summit, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000008', 'FLOW primary completion',           'actual', '2024-01-09', 'exact', 'trial', t_flow, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000008', 'SURMOUNT-MMO primary completion projected', 'primary', '2027-10-15', 'exact', 'trial', t_surmount_mmo, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000008', 'TRIUMPH-1 primary completion projected',     'primary', r + 30, 'exact', 'trial', t_triumph_1, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000008', 'ACACIA-HCM primary completion projected',    'primary', r + 10, 'exact', 'trial', t_acacia_hcm, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000008', 'CT-388 P2 primary completion',      'actual',  '2025-12-08', 'exact', 'trial', t_ct388_p2, jsonb_build_object('source','analyst'));

  -- =========================================================================
  -- TRIAL STARTS. a0..011. Clinical -> trial.
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000011', 'SURMOUNT-MMO study initiated',  'actual', '2022-10-11', 'exact', 'trial', t_surmount_mmo, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000011', 'TRIUMPH-1 study initiated',     'actual', '2023-07-10', 'exact', 'trial', t_triumph_1, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000011', 'ATTAIN-1 first patient in',     'actual', '2023-06-05', 'exact', 'trial', t_attain_1, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000011', 'CT-388 P2 study initiated',     'actual', '2024-08-16', 'exact', 'trial', t_ct388_p2, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000011', 'VK2735 oral P2 study initiated','actual', '2024-12-18', 'exact', 'trial', t_vk2735_oral_p2, jsonb_build_object('source','analyst'));

  -- =========================================================================
  -- LOSS OF EXCLUSIVITY. a0..020. Regulatory/commercial -> asset.
  -- Trulicity LOE is on its own asset (the seed had it on the Mounjaro trial).
  -- Analyst-projected LOE dates use 'forecasted'. LOE windows/generic entries whose
  -- start has already passed are 'actual' (erosion underway), so they do not render
  -- behind the today line as projected.
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, end_date, description, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000020', 'Entresto US LOE',              'actual',     '2025-07-15', 'exact', null,         'Sacubitril/valsartan US patent expiry.', 'asset', a_entresto, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000020', 'Trulicity US LOE projected',   'forecasted', '2027-12-31', 'exact', null,         'Dulaglutide US patent expiry near horizon.', 'asset', a_trulicity, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000020', 'Vyndaqel/Vyndamax US LOE window','actual',   '2024-12-01', 'exact', '2028-12-31', 'Tafamidis multi-patent expiry window, erosion underway.', 'asset', a_vyndaqel, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000020', 'Jardiance US LOE projected',   'forecasted', '2028-08-15', 'exact', null,         'Empagliflozin US composition-of-matter patent expiry.', 'asset', a_jardiance, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000020', 'Entresto generic entry expected','actual',   '2025-09-01', 'exact', null,         'First generic sacubitril/valsartan launch following LOE.', 'asset', a_entresto, jsonb_build_object('source','analyst')),
    -- Zepbound full-vocabulary: an analyst-forecasted LOE (renders the 'f' tier).
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000020', 'Zepbound US LOE',              'forecasted', '2032-12-31', 'exact', null,         'Analyst-forecasted tirzepatide US composition-of-matter patent expiry.', 'asset', a_zepbound, jsonb_build_object('source','analyst'));

  -- =========================================================================
  -- NO LONGER EXPECTED (FAILURES / DCs). a0..035, no_longer_expected. -> asset.
  -- The Jardiance post-MI item leaves the EMPACT-MI trial topline (finding 4).
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, no_longer_expected, description, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Pfizer danuglipron development discontinued', 'actual', '2023-12-01', 'exact', true, 'Pfizer halted danuglipron after high incidence of adverse events; oral GLP-1 small molecule strategy paused.', 'asset', a_danuglipron, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Camzyos nHCM expansion no longer expected',   'actual', '2024-10-15', 'exact', true, 'ODYSSEY-HCM failed primary; non-obstructive HCM label expansion no longer expected.', 'asset', a_camzyos, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Jardiance post-MI expansion no longer expected','actual','2024-04-08', 'exact', true, 'EMPACT-MI failed primary; post-MI label expansion no longer expected.', 'asset', a_jardiance, jsonb_build_object('source','analyst'));

  -- =========================================================================
  -- RANGE MARKERS (LAUNCH WINDOWS). a0..036, end_date. -> asset.
  -- Windows still ahead of r use 'forecasted'; past windows are 'actual' (launched).
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, end_date, description, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000036', 'Aficamten US launch window',     'actual',     '2025-10-01', 'exact', '2026-03-31', 'US commercial launch window for Cytokinetics aficamten in oHCM.', 'asset', a_aficamten, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000036', 'Finerenone HFpEF launch window', 'actual',     '2025-04-01', 'exact', '2026-06-30', 'Launch window for Kerendia HFpEF/HFmrEF label expansion.', 'asset', a_kerendia, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000036', 'Orforglipron US launch window',  'forecasted', '2027-04-01', 'exact', '2027-12-31', 'Analyst-forecasted US launch window for Lilly orforglipron contingent on approval.', 'asset', a_orforglipron, jsonb_build_object('source','analyst'));

  -- =========================================================================
  -- COLLAPSED MANY-TO-MANY FILINGS. The cross-trial fan-out is gone: each fact is
  -- one asset-anchored event. a0..032 / a0..035 -> asset.
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Zepbound HFpEF sNDA filing (combined SUMMIT + SURMOUNT-1)','company', r + 120, 'exact', 'Tirzepatide HFpEF label expansion combining SUMMIT and SURMOUNT-1 obesity data.', 'asset', a_zepbound, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Semaglutide CKD label expansion (FLOW + SUSTAIN-6)',      'actual',  '2025-01-30', 'exact', 'Ozempic CKD label expansion based on FLOW with supportive SUSTAIN-6 readthrough.', 'asset', a_ozempic, jsonb_build_object('source','analyst'));

  -- Register named event UUIDs for primary intelligence (vestigial; shape stability).
  insert into _seed_ids (entity_type, key, id) values
    ('marker', 'm_summit_topline',    m_summit_topline),
    ('marker', 'm_redefine_1_miss',   m_redefine_1_miss),
    ('marker', 'm_orforglipron_read', m_orforglipron_read),
    ('marker', 'm_maritide_read',     m_maritide_read);
end;
$function$;

-- ===========================================================================
-- 2. _seed_demo_events
-- ===========================================================================
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
      'high', null, 'company', c_meridian, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, et_strategic, 'Novo Holdings acquires Catalent ($16.5B)',
      'actual', '2024-02-05', 'exact', 'Novo Holdings acquires Catalent for $16.5B; Novo Nordisk to acquire 3 Catalent fill-finish sites for Wegovy and Ozempic supply.',
      'high', null, 'company', c_vantage, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, et_strategic, 'Pfizer discontinues danuglipron program',
      'actual', '2023-12-01', 'exact', 'Pfizer halts development of oral GLP-1 small molecule danuglipron after high incidence of adverse events in P2.',
      'high', null, 'company', c_apex, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, et_financial, 'Viking VK2735 P2 readout drives stock +120%',
      'actual', '2024-02-27', 'exact', 'Viking Therapeutics VK2735 SC P2 obesity readout (~13-15% weight loss at 13 weeks) drives stock price up 120% in single session.',
      'high', null, 'company', c_zenith, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, et_financial, 'Novo CagriSema misses bar, stock -20%',
      'actual', '2024-12-20', 'exact', 'REDEFINE-1 weight loss of 22.7% below ~25% Street consensus, Novo Nordisk stock drops 20% on disappointment.',
      'high', null, 'company', c_vantage, jsonb_build_object('source','analyst')),
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
$function$;

-- ===========================================================================
-- 3. _seed_demo_recent_activity
-- ===========================================================================
-- The "topline expected" inserts are removed: they duplicated the trial-anchored
-- projected toplines in _seed_demo_markers (which now sit just ahead of r and feed
-- the upcoming-catalyst widget after the orchestrator shift). The date-slip updates
-- are kept; they move existing projected events by a relative interval (no current_date
-- or r literal needed, so they participate cleanly in the single evergreen shift).
create or replace function public._seed_demo_recent_activity(p_space_id uuid, p_uid uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  t_redefine_2  uuid;
begin
  select id into t_redefine_2 from public.trials where space_id = p_space_id and name = 'REDEFINE-2' limit 1;

  -- Bail out if the realistic cardiometabolic seed wasn't loaded.
  if t_redefine_2 is null then
    return;
  end if;

  -- Slip three existing projected events. The event_changes trigger records the date
  -- edit; get_activity_feed surfaces the change.
  update public.events
     set event_date = (event_date + interval '100 days')::date
   where space_id = p_space_id and title = 'TRIUMPH-1 topline projected';

  update public.events
     set event_date = (event_date + interval '180 days')::date
   where space_id = p_space_id and title = 'SURMOUNT-MMO topline projected';

  update public.events
     set event_date = (event_date + interval '120 days')::date
   where space_id = p_space_id and title = 'CT-388 P2 final analysis projected';
end;
$function$;

-- ===========================================================================
-- 4. _seed_demo_activity_variety
-- ===========================================================================
-- The 12 CT.gov trial_change_events rows and the analyst change rows are kept. The
-- three demo events (m_live, m_finalized, m_doomed) are retained with unique titles
-- and lane-correct anchors: m_live is an asset-anchored Approval (was an Approval on a
-- trial), m_finalized is a trial-anchored Topline, m_doomed (created then deleted) is
-- asset-anchored. Their event dates are authored against r; the trial_change_events
-- payloads stay current_date-relative so they match the post-shift event dates.
create or replace function public._seed_demo_activity_variety(p_space_id uuid, p_uid uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  t_status      uuid; -- REDEFINE-2
  t_date        uuid; -- ATTAIN-1
  t_phase       uuid; -- ACHIEVE-1
  t_enroll      uuid; -- TRIUMPH-1
  t_arms        uuid; -- ACACIA-HCM
  t_intervene   uuid; -- SUMMIT
  t_outcome     uuid; -- SURMOUNT-MMO
  t_sponsor     uuid; -- SELECT
  t_elig        uuid; -- DAPA-HF
  t_withdrawn   uuid; -- ATTR-ACT
  t_finalized   uuid; -- REDEFINE-1 (trial anchor for the projection_finalized demo)

  -- CagriSema asset (REDEFINE-1/2 drug): anchors the asset-lane demo events.
  a_cagrisema   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_cagrisema');

  -- Evergreen reference date.
  r constant date := date '2026-06-29';

  -- A live event for the analyst-side direct-insert activity rows. Hung off CagriSema.
  m_live        uuid := gen_random_uuid();
  -- A throwaway event created then DELETEd.
  m_doomed      uuid := gen_random_uuid();

  -- Event type ids. a0..031 "Full Data" was consolidated into a0..013; mt_full_data
  -- keeps the old id for the inert reclassified payload (passthrough).
  mt_topline_data   constant uuid := 'a0000000-0000-0000-0000-000000000013';
  mt_full_data      constant uuid := 'a0000000-0000-0000-0000-000000000031';
  mt_reg_filing     constant uuid := 'a0000000-0000-0000-0000-000000000032';
  mt_approval       constant uuid := 'a0000000-0000-0000-0000-000000000035';
  mt_launch         constant uuid := 'a0000000-0000-0000-0000-000000000036';

  -- Spaced observed_at slots so the feed sorts intelligibly. Newest first.
  ts_01 timestamptz := now() - interval '5 minutes';
  ts_02 timestamptz := now() - interval '10 minutes';
  ts_03 timestamptz := now() - interval '15 minutes';
  ts_04 timestamptz := now() - interval '20 minutes';
  ts_05 timestamptz := now() - interval '25 minutes';
  ts_06 timestamptz := now() - interval '30 minutes';
  ts_07 timestamptz := now() - interval '35 minutes';
  ts_08 timestamptz := now() - interval '40 minutes';
  ts_09 timestamptz := now() - interval '45 minutes';
  ts_10 timestamptz := now() - interval '50 minutes';
  ts_11 timestamptz := now() - interval '55 minutes';
  ts_12 timestamptz := now() - interval '60 minutes';
  ts_13 timestamptz := now() - interval '65 minutes';
  ts_14 timestamptz := now() - interval '70 minutes';
  ts_15 timestamptz := now() - interval '75 minutes';
  ts_16 timestamptz := now() - interval '80 minutes';
begin
  select id into t_status      from public.trials where space_id = p_space_id and name = 'REDEFINE-2'    limit 1;
  select id into t_date        from public.trials where space_id = p_space_id and name = 'ATTAIN-1'      limit 1;
  select id into t_phase       from public.trials where space_id = p_space_id and name = 'ACHIEVE-1'     limit 1;
  select id into t_enroll      from public.trials where space_id = p_space_id and name = 'TRIUMPH-1'     limit 1;
  select id into t_arms        from public.trials where space_id = p_space_id and name = 'ACACIA-HCM'    limit 1;
  select id into t_intervene   from public.trials where space_id = p_space_id and name = 'SUMMIT'        limit 1;
  select id into t_outcome     from public.trials where space_id = p_space_id and name = 'SURMOUNT-MMO'  limit 1;
  select id into t_sponsor     from public.trials where space_id = p_space_id and name = 'SELECT'        limit 1;
  select id into t_elig        from public.trials where space_id = p_space_id and name = 'DAPA-HF'       limit 1;
  select id into t_withdrawn   from public.trials where space_id = p_space_id and name = 'ATTR-ACT'      limit 1;
  select id into t_finalized   from public.trials where space_id = p_space_id and name = 'REDEFINE-1'    limit 1;

  -- Bail out if the realistic cardiometabolic seed isn't loaded.
  if t_status is null or t_date is null or t_phase is null
     or t_enroll is null or t_arms is null then
    return;
  end if;

  -- Fallbacks for trials that may not exist in older revs of the realistic seed.
  t_intervene := coalesce(t_intervene, t_status);
  t_outcome   := coalesce(t_outcome,   t_status);
  t_sponsor   := coalesce(t_sponsor,   t_status);
  t_elig      := coalesce(t_elig,      t_status);
  t_withdrawn := coalesce(t_withdrawn, t_arms);
  t_finalized := coalesce(t_finalized, t_status);

  -- ---------------------------------------------------------------------------
  -- 12 CT.gov-source change events. payload shape per _classify_change. These are
  -- trial-level detected changes (no event anchor), so event_id stays null.
  -- ---------------------------------------------------------------------------
  insert into public.trial_change_events (
    trial_id, space_id, event_type, source, payload, occurred_at, observed_at
  ) values
  (t_status, p_space_id, 'status_changed', 'ctgov',
   jsonb_build_object('from', 'RECRUITING', 'to', 'ACTIVE_NOT_RECRUITING'),
   ts_01, ts_01),
  (t_date, p_space_id, 'date_moved', 'ctgov',
   jsonb_build_object(
     'which_date', 'primary_completion',
     'from',       '2026-08-15',
     'to',         '2026-11-23',
     'days_diff',  100,
     'direction',  'slip'
   ),
   ts_02, ts_02),
  (t_phase, p_space_id, 'phase_transitioned', 'ctgov',
   jsonb_build_object(
     'from', jsonb_build_array('PHASE2'),
     'to',   jsonb_build_array('PHASE3')
   ),
   ts_03, ts_03),
  (t_enroll, p_space_id, 'enrollment_target_changed', 'ctgov',
   jsonb_build_object('from', 200, 'to', 180, 'percent_change', -10.00),
   ts_04, ts_04),
  (t_arms, p_space_id, 'arm_added', 'ctgov',
   jsonb_build_object(
     'arm_label',   'High-dose CagriSema 2.4mg',
     'arm_type',    'EXPERIMENTAL',
     'description', 'Open-label extension cohort.'
   ),
   ts_05, ts_05),
  (t_arms, p_space_id, 'arm_removed', 'ctgov',
   jsonb_build_object(
     'arm_label', 'Placebo comparator',
     'arm_type',  'PLACEBO_COMPARATOR'
   ),
   ts_06, ts_06),
  (t_intervene, p_space_id, 'intervention_changed', 'ctgov',
   jsonb_build_object(
     'added',   jsonb_build_array(jsonb_build_object('name', 'Tirzepatide 15mg', 'type', 'DRUG')),
     'removed', jsonb_build_array(jsonb_build_object('name', 'Tirzepatide 10mg', 'type', 'DRUG'))
   ),
   ts_07, ts_07),
  (t_outcome, p_space_id, 'outcome_measure_changed', 'ctgov',
   jsonb_build_object(
     'outcome_kind', 'primary',
     'added', jsonb_build_array(jsonb_build_object(
       'measure', 'KCCQ-CSS at week 24',
       'description', 'Kansas City Cardiomyopathy Questionnaire',
       'timeFrame', 'Week 24'
     )),
     'removed', jsonb_build_array(jsonb_build_object(
       'measure', 'Change in LV mass index',
       'description', 'cMRI-derived LV mass index',
       'timeFrame', 'Week 24'
     )),
     'modified', '[]'::jsonb
   ),
   ts_08, ts_08),
  (t_sponsor, p_space_id, 'sponsor_changed', 'ctgov',
   jsonb_build_object('from', 'Novo Nordisk A/S', 'to', 'Sanofi'),
   ts_09, ts_09),
  (t_elig, p_space_id, 'eligibility_criteria_changed', 'ctgov',
   jsonb_build_object('old_length', 800, 'new_length', 1212),
   ts_10, ts_10),
  (t_elig, p_space_id, 'eligibility_changed', 'ctgov',
   jsonb_build_object(
     'which_field', 'minimum_age',
     'from',        '18 Years',
     'to',          '21 Years'
   ),
   ts_11, ts_11),
  (t_withdrawn, p_space_id, 'trial_withdrawn', 'ctgov',
   jsonb_build_object('last_seen_post_date', (current_date - interval '28 days')::date),
   ts_12, ts_12);

  -- ---------------------------------------------------------------------------
  -- Live event for the analyst-side direct-insert activity rows. Asset-anchored
  -- Approval (Approval is an asset-lane type). event_date sits well outside the
  -- upcoming-catalyst window.
  -- ---------------------------------------------------------------------------
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, anchor_type, anchor_id, metadata)
    values (m_live, p_space_id, p_uid, mt_approval, 'REDEFINE-2 PDUFA expected', 'company',
            r + 180, 'exact',
            'Anticipated PDUFA decision following BLA filing.', 'asset', a_cagrisema, jsonb_build_object('source','analyst'));

  -- 4 analyst-source change events on the live event. event_id references the created
  -- event so get_activity_feed resolves the type via events.event_type_id. Payloads
  -- stay current_date-relative so the displayed dates match the post-shift event.
  insert into public.trial_change_events (
    trial_id, space_id, event_type, source, payload, occurred_at, observed_at, event_id
  ) values
  (t_status, p_space_id, 'marker_added', 'analyst',
   jsonb_build_object(
     'event_date',     (current_date + interval '180 days')::date,
     'marker_type_id', mt_approval,
     'projection',     'company'
   ),
   ts_13, ts_13, m_live),
  (t_status, p_space_id, 'marker_updated', 'analyst',
   jsonb_build_object(
     'changed_fields', jsonb_build_array('title')
   ),
   ts_14, ts_14, m_live),
  (t_status, p_space_id, 'marker_reclassified', 'analyst',
   jsonb_build_object(
     'from_type_id', mt_topline_data,
     'to_type_id',   mt_full_data
   ),
   ts_15, ts_15, m_live),
  (t_status, p_space_id, 'date_moved', 'analyst',
   jsonb_build_object(
     'which_date', 'event_date',
     'from',       (current_date + interval '180 days')::date,
     'to',         (current_date + interval '257 days')::date,
     'days_diff',  77,
     'direction',  'slip'
   ),
   ts_16, ts_16, m_live);

  -- projection_finalized on a fresh trial-anchored Topline event (REDEFINE-1 full
  -- readout). Separate from m_live so the live event stays 'company'.
  declare
    m_finalized uuid := gen_random_uuid();
  begin
    insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, anchor_type, anchor_id, metadata)
      values (m_finalized, p_space_id, p_uid, mt_topline_data, 'REDEFINE-1 full readout', 'actual',
              r - 14, 'exact',
              'Full Phase 3 readout published in NEJM.', 'trial', t_finalized, jsonb_build_object('source','analyst'));

    insert into public.trial_change_events (
      trial_id, space_id, event_type, source, payload, occurred_at, observed_at, event_id
    ) values
    (t_status, p_space_id, 'projection_finalized', 'analyst',
     jsonb_build_object(
       'from',       'company',
       'to',         'actual',
       'event_date', (current_date - interval '14 days')::date
     ),
     now() - interval '85 minutes',
     now() - interval '85 minutes',
     m_finalized);
  end;

  -- event_removed demo: create a separate asset-anchored event then DELETE it. With
  -- the marker-audit trigger retired this emits only an event_changes 'deleted' row.
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, anchor_type, anchor_id, metadata)
    values (m_doomed, p_space_id, p_uid, mt_launch, 'REDEFINE-2 launch (deprecated forecast)', 'company',
            r + 365, 'exact',
            'Earlier launch forecast superseded by revised commercial plan.', 'asset', a_cagrisema, jsonb_build_object('source','analyst'));

  delete from public.events where id = m_doomed;
end;
$function$;

-- ===========================================================================
-- 5. seed_demo_data (orchestrator + evergreen shift)
-- ===========================================================================
create or replace function public.seed_demo_data(p_space_id uuid)
 returns void
 language plpgsql
 set search_path to ''
as $function$
declare
  uid uuid := auth.uid();
  existing_count int;
begin
  if uid is null then
    raise exception 'Must be authenticated to seed demo data' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.space_members
     where space_id = p_space_id and user_id = uid and role = 'owner'
  ) and not public.is_platform_admin() then
    raise exception 'Insufficient permissions: must be space owner to seed demo data' using errcode = '42501';
  end if;

  select count(*) into existing_count from public.companies where space_id = p_space_id;
  if existing_count > 0 then return; end if;

  create temp table if not exists _seed_ids (
    entity_type text not null, key text not null, id uuid not null,
    primary key (entity_type, key)
  ) on commit drop;

  perform public._seed_demo_companies(p_space_id, uid);
  perform public._seed_demo_indications(p_space_id, uid);
  perform public._seed_demo_assets(p_space_id, uid);
  perform public._seed_demo_moa_roa(p_space_id, uid);
  perform public._seed_demo_trials(p_space_id, uid);
  perform public._seed_demo_asset_indications(p_space_id, uid);
  perform public._seed_demo_markers(p_space_id, uid);
  perform public._seed_demo_trial_notes(p_space_id, uid);
  perform public._seed_demo_events(p_space_id, uid);
  perform public._seed_demo_primary_intelligence(p_space_id, uid);
  perform public._seed_demo_materials(p_space_id, uid);
  perform public._seed_demo_recent_activity(p_space_id, uid);
  perform public._seed_demo_activity_variety(p_space_id, uid);

  -- phase_type_source still lives on trials; the phase date *_source columns are
  -- dropped (date ownership now lives on the markers via metadata.source).
  update public.trials
     set phase_type_source = case
           when phase_type is null then null
           when identifier is null then 'analyst'
           else 'ctgov'
         end
   where space_id = p_space_id;

  -- Evergreen: shift the whole space so projections stay ahead of today. All
  -- producers author dates against date '2026-06-29' (r), so a single uniform shift
  -- by (current_date - r) preserves the intended past/future split with no double-shift.
  update public.events
     set event_date = current_date + (event_date - date '2026-06-29'),
         end_date   = case when end_date is not null
                           then current_date + (end_date - date '2026-06-29')
                           else null end
   where space_id = p_space_id;
end;
$function$;

-- ===========================================================================
-- In-file smoke: data-conditional, self-cleaning, remote-safe. Seeds a scratch
-- space through the producer chain (bypassing the owner-gated orchestrator, which
-- needs auth.uid()), applies the evergreen shift, asserts the remodel invariants,
-- then removes the scratch space. Skips cleanly on a non-seeded db. Any
-- access-sensitive failure (insufficient_privilege) is caught and treated as a skip
-- so a populated remote dev db push cannot 42501.
-- ===========================================================================
do $smoke$
declare
  v_tenant uuid;
  v_uid    uuid;
  v_space  uuid := gen_random_uuid();
  v_misplaced_asset int;
  v_misplaced_corp  int;
  v_misplaced_clin  int;
  v_dupe_titles     int;
  v_stale           int;
  v_primary_nt      int;
  v_forecasted_nt   int;
  v_full_vocab      int;
  v_pinned          int;
  v_feed_company    int;
begin
  select id into v_tenant from public.tenants limit 1;
  select id into v_uid from auth.users limit 1;
  if v_tenant is null or v_uid is null
     or not exists (select 1 from public.spaces where id = '00000000-0000-0000-0000-0000000d0100') then
    raise notice 'seed-demo remodel smoke: skipped on non-seeded db; covered by integration suite';
    return;
  end if;

  begin
    insert into public.spaces (id, tenant_id, name, created_by) values (v_space, v_tenant, 'seed-demo remodel smoke', v_uid);

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
    perform public._seed_demo_recent_activity(v_space, v_uid);
    perform public._seed_demo_activity_variety(v_space, v_uid);

    -- Apply the same evergreen shift the orchestrator runs, so date assertions hold
    -- on any run day.
    update public.events
       set event_date = current_date + (event_date - date '2026-06-29'),
           end_date   = case when end_date is not null
                             then current_date + (end_date - date '2026-06-29')
                             else null end
     where space_id = v_space;

    -- Lane: asset-lane types (RegFiling/Approval/Launch/Distribution/LOE) only on assets.
    select count(*) into v_misplaced_asset from public.events
     where space_id = v_space
       and event_type_id in (
         'a0000000-0000-0000-0000-000000000032','a0000000-0000-0000-0000-000000000035',
         'a0000000-0000-0000-0000-000000000036','a0000000-0000-0000-0000-000000000040',
         'a0000000-0000-0000-0000-000000000020')
       and anchor_type <> 'asset';
    if v_misplaced_asset > 0 then
      raise exception 'remodel smoke: % asset-lane events not on an asset', v_misplaced_asset;
    end if;

    -- Lane: corporate types (Financial/Leadership/Strategic) only on companies.
    select count(*) into v_misplaced_corp from public.events
     where space_id = v_space
       and event_type_id in (
         'a0000000-0000-0000-0000-000000000060','a0000000-0000-0000-0000-000000000050',
         'a0000000-0000-0000-0000-000000000070')
       and anchor_type <> 'company';
    if v_misplaced_corp > 0 then
      raise exception 'remodel smoke: % corporate events not on a company', v_misplaced_corp;
    end if;

    -- Lane: clinical types (Trial Start/End, Primary Completion, Topline) only on trials.
    select count(*) into v_misplaced_clin from public.events
     where space_id = v_space
       and event_type_id in (
         'a0000000-0000-0000-0000-000000000011','a0000000-0000-0000-0000-000000000012',
         'a0000000-0000-0000-0000-000000000008','a0000000-0000-0000-0000-000000000013')
       and anchor_type <> 'trial';
    if v_misplaced_clin > 0 then
      raise exception 'remodel smoke: % clinical events not on a trial', v_misplaced_clin;
    end if;

    -- Dedup: no two curated events share a title. 'Trial Start'/'Trial End' are the
    -- structural per-trial phase-bar markers from _create_trial_date_markers (one per
    -- trial, generic title by design, shared with the ct.gov sync path), so the phase
    -- bar can derive its span; they are excluded from the curated-fact dedup check.
    select count(*) into v_dupe_titles from (
      select title from public.events
       where space_id = v_space and title not in ('Trial Start','Trial End')
       group by title having count(*) > 1
    ) q;
    if v_dupe_titles > 0 then
      raise exception 'remodel smoke: % duplicate event titles', v_dupe_titles;
    end if;

    -- Evergreen: no projected event dated before today.
    select count(*) into v_stale from public.events
     where space_id = v_space and projection <> 'actual' and event_date < current_date;
    if v_stale > 0 then
      raise exception 'remodel smoke: % projected events dated before today', v_stale;
    end if;

    -- Projection variety on asset/company anchors.
    select count(*) into v_primary_nt from public.events
     where space_id = v_space and anchor_type in ('asset','company') and projection = 'primary';
    if v_primary_nt < 1 then
      raise exception 'remodel smoke: expected >=1 primary asset/company event';
    end if;

    select count(*) into v_forecasted_nt from public.events
     where space_id = v_space and anchor_type in ('asset','company') and projection = 'forecasted';
    if v_forecasted_nt < 1 then
      raise exception 'remodel smoke: expected >=1 forecasted asset/company event';
    end if;

    -- Full vocabulary on at least one asset lane (Zepbound: actual+company+primary+forecasted).
    select count(*) into v_full_vocab from (
      select anchor_id from public.events
      where space_id = v_space and anchor_type = 'asset'
      group by anchor_id
      having count(distinct projection) >= 4
    ) q;
    if v_full_vocab < 1 then
      raise exception 'remodel smoke: expected >=1 asset lane with all four projection tiers';
    end if;

    -- Corporate visibility: >=1 pinned and >=1 feed-only company event.
    select count(*) into v_pinned from public.events
     where space_id = v_space and anchor_type = 'company' and visibility = 'pinned';
    if v_pinned < 1 then
      raise exception 'remodel smoke: expected >=1 pinned company event';
    end if;

    select count(*) into v_feed_company from public.events
     where space_id = v_space and anchor_type = 'company'
       and visibility is null and significance is distinct from 'high';
    if v_feed_company < 1 then
      raise exception 'remodel smoke: expected >=1 feed-only company event';
    end if;

    delete from public.spaces where id = v_space;
    raise notice 'seed-demo remodel smoke PASS: lanes clean, % primary / % forecasted on asset-company, full-vocab assets=%, % pinned, % feed-only',
      v_primary_nt, v_forecasted_nt, v_full_vocab, v_pinned, v_feed_company;
  exception
    when insufficient_privilege then
      delete from public.spaces where id = v_space;
      raise notice 'seed-demo remodel smoke: skipped (insufficient_privilege); covered by integration suite';
  end;
end;
$smoke$;

notify pgrst, 'reload schema';
