-- C5: demo seed producers emit unified events (was: markers / marker_assignments)
--
-- Repoints the four broken demo producers in the seed_demo_data chain onto the
-- unified public.events table. They are SECURITY DEFINER and currently do INLINE
-- inserts; we keep that shape (retargeted to events) rather than routing through
-- create_event, because create_event enforces has_space_access(owner|editor) on
-- auth.uid() and seed_demo_data (INVOKER) is exercised by the role-access test as
-- platform_admin, who is NOT an owner/editor. The DEFINER inline insert bypasses
-- RLS and works for any caller -- same rationale family as the C3/C4 producers.
--
-- System UUIDs are mostly identical (marker_type_id == event_type_id). The event
-- model consolidated three marker types into their surviving same-category type;
-- this migration applies that crosswalk so the new event_type_id values satisfy
-- the events.event_type_id -> event_types(id) FK:
--   a0..031 "Full Data"          -> a0..013 "Topline Data"      (Data category)
--   a0..033 "Submission"         -> a0..032 "Regulatory Filing" (Regulatory)
--   a0..021 "Generic Entry Date" -> a0..020 "LOE Date"          (Loss of Exclusivity)
--
-- Clinical / trial-anchored events get NO source_url (dropped) and NO event_sources
-- (the clinicaltrials.gov registry link is derived by readers). The two multi-source
-- demo events (business events) live in _seed_demo_events.

-- ===========================================================================
-- 1. _seed_demo_markers (the bulk): clinical + regulatory + commercial demo
--    timeline, each marker -> one trial-anchored event (multi-trial markers fan
--    out to one event per trial). No source_url, no marker_assignments.
-- ===========================================================================
create or replace function public._seed_demo_markers(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  -- Trial UUIDs
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

  -- Named event UUIDs (formerly named markers) still registered into _seed_ids at
  -- the end for downstream references. The registration is now vestigial (nothing
  -- reads the 'marker' entity_type keys post-cutover; the primary_intelligence_links
  -- check constraint only allows trial/event/company/asset/product) but kept for
  -- shape stability; the ids point at real event rows.
  m_summit_topline    uuid := gen_random_uuid();
  m_redefine_1_miss   uuid := gen_random_uuid();
  m_orforglipron_read uuid := gen_random_uuid();
  m_maritide_read     uuid := gen_random_uuid();

  -- metadata.source = 'analyst' marks these as analyst-authored facts (matches the
  -- CT.gov-vs-analyst convention so the manage-lock logic stays coherent).
begin
  -- =========================================================================
  -- TOPLINE DATA READOUTS (PAST). a0..031 "Full Data" -> a0..013 "Topline Data".
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
  -- TOPLINE DATA READOUTS (PROJECTED). a0..013 "Topline Data".
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(),    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'TRIUMPH-1 topline projected',           'company', '2026-08-15', 'exact', 'Retatrutide P3 obesity readout, expected H2 2026.', 'trial', t_triumph_1, jsonb_build_object('source','analyst')),
    (m_orforglipron_read,  p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'ATTAIN-1 topline projected',            'company', '2026-06-30', 'exact', 'Lilly orforglipron P3 obesity readout.', 'trial', t_attain_1, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'ACHIEVE-1 topline projected',           'company', '2026-06-15', 'exact', 'Lilly orforglipron P3 T2D readout.', 'trial', t_achieve_1, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'MAPLE-HCM topline projected',           'company', '2025-09-15', 'exact', 'Aficamten head-to-head vs metoprolol; readout already in late 2025 window.', 'trial', t_maple_hcm, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'ACACIA-HCM topline projected',          'company', '2027-06-30', 'exact', 'Aficamten in non-obstructive HCM.', 'trial', t_acacia_hcm, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'SURMOUNT-MMO topline projected',        'company', '2027-10-01', 'exact', 'Tirzepatide CV outcomes trial in obesity.', 'trial', t_surmount_mmo, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'CT-388 P2 final analysis projected',    'company', '2026-03-15', 'exact', 'Roche/Carmot enicepatide obesity P2 final analysis.', 'trial', t_ct388_p2, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'REDEFINE-2 topline projected',          'company', '2026-02-01', 'exact', 'CagriSema P3 in obesity + T2D, follow-on to REDEFINE-1.', 'trial', t_redefine_2, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'VK2735 oral P2 final results projected','company', '2025-08-15', 'exact', 'Viking oral GIP/GLP-1 dual agonist.', 'trial', t_vk2735_oral_p2, jsonb_build_object('source','analyst')),
    (gen_random_uuid(),    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'Survodutide P3 obesity readout projected','company', '2027-04-15', 'exact', 'BI/Zealand GLP-1/glucagon dual agonist P3 confirmatory.', 'trial', t_survodutide_p2, jsonb_build_object('source','analyst'));

  -- =========================================================================
  -- REGULATORY FILINGS (PAST). a0..033 "Submission" -> a0..032 "Regulatory Filing".
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Wegovy SELECT sNDA submitted',     'actual', '2024-01-15', 'exact', 'CV risk reduction label expansion based on SELECT.', 'trial', t_select, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Aficamten NDA submitted',          'actual', '2024-09-30', 'exact', 'Cytokinetics NDA filing for oHCM based on SEQUOIA-HCM.', 'trial', t_sequoia_hcm, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Finerenone HFpEF sNDA submitted',  'actual', '2024-09-20', 'exact', 'Bayer label expansion to HFpEF/HFmrEF based on FINEARTS-HF.', 'trial', t_fineart_hf, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Zepbound OSA sNDA submitted',      'actual', '2024-06-15', 'exact', 'Tirzepatide OSA label expansion based on SURMOUNT-OSA.', 'trial', t_surmount_osa, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Acoramidis NDA submitted',         'actual', '2024-01-25', 'exact', 'BridgeBio NDA filing for ATTR-CM based on ATTRibute-CM.', 'trial', t_attribute_cm, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Ozempic CKD sNDA submitted',       'actual', '2024-09-15', 'exact', 'Novo label expansion to CKD in T2D based on FLOW.', 'trial', t_flow, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Jardiance EMPA-KIDNEY sNDA submitted','actual', '2023-03-14', 'exact', 'BI label expansion to CKD.', 'trial', t_empa_kidney, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Farxiga DELIVER sNDA submitted',   'actual', '2022-04-15', 'exact', 'AZ label expansion to HFpEF/HFmrEF.', 'trial', t_deliver, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Mavacamten NDA submitted',         'actual', '2021-08-30', 'exact', 'BMS NDA filing for oHCM based on EXPLORER-HCM.', 'trial', t_explorer_hcm, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Tirzepatide T2D NDA submitted',    'actual', '2021-10-04', 'exact', 'Lilly NDA filing for tirzepatide in T2D, basis for Mounjaro approval.', 'trial', t_surpass_2, jsonb_build_object('source','analyst'));

  -- =========================================================================
  -- REGULATORY FILINGS (PROJECTED). a0..032 "Regulatory Filing".
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Tirzepatide HFpEF sNDA projected',  'company', '2025-03-15', 'exact', 'Lilly tirzepatide label expansion to HFpEF based on SUMMIT.', 'trial', t_summit, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Orforglipron NDA projected',         'company', '2026-12-01', 'exact', 'Lilly orforglipron NDA, contingent on ATTAIN-1 / ACHIEVE-1 readouts.', 'trial', t_attain_1, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Retatrutide NDA projected',          'company', '2027-03-15', 'exact', 'Lilly retatrutide NDA, contingent on TRIUMPH-1.', 'trial', t_triumph_1, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'CagriSema NDA projected',            'company', '2026-09-30', 'exact', 'Novo CagriSema NDA filing despite REDEFINE-1 below-bar miss.', 'trial', t_redefine_1, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Aficamten EU MAA projected',         'company', '2025-06-30', 'exact', 'Cytokinetics EU regulatory filing post-SEQUOIA-HCM.', 'trial', t_sequoia_hcm, jsonb_build_object('source','analyst'));

  -- =========================================================================
  -- APPROVALS. a0..035 "Approval". (source_url dropped.)
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Mounjaro FDA approval (T2D)',                'actual', '2022-05-13', 'exact', 'First-in-class GIP/GLP-1 dual agonist approved for T2D.', 'trial', t_surpass_2, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Zepbound FDA approval (chronic weight management)','actual', '2023-11-08', 'exact', 'Tirzepatide approved for chronic weight management in obese adults.', 'trial', t_surmount_1, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Zepbound FDA approval (OSA)',                'actual', '2024-12-20', 'exact', 'First drug approved for obstructive sleep apnea in obesity.', 'trial', t_surmount_osa, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Wegovy FDA approval (obesity)',              'actual', '2021-06-04', 'exact', 'Semaglutide 2.4 mg approved for chronic weight management.', 'trial', t_step_1, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Wegovy FDA approval (CV risk reduction)',    'actual', '2024-03-08', 'exact', 'Label expansion to reduce risk of CV death, MI, stroke based on SELECT.', 'trial', t_select, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Farxiga FDA approval (HFrEF)',               'actual', '2020-05-05', 'exact', 'First SGLT2 inhibitor approved for HFrEF.', 'trial', t_dapa_hf, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Farxiga FDA approval (CKD)',                 'actual', '2021-04-30', 'exact', 'CKD label expansion based on DAPA-CKD.', 'trial', t_dapa_ckd, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Jardiance FDA approval (broad heart failure)','actual', '2022-02-24', 'exact', 'Heart failure indication expanded across the LVEF spectrum.', 'trial', t_emperor_preserved, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Camzyos FDA approval (oHCM)',                'actual', '2022-04-29', 'exact', 'First cardiac myosin inhibitor approved for symptomatic obstructive HCM.', 'trial', t_explorer_hcm, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Entresto FDA approval (HFrEF)',              'actual', '2015-07-07', 'exact', 'First-in-class ARNI approved for HFrEF based on PARADIGM-HF.', 'trial', t_paradigm_hf, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Vyndaqel/Vyndamax FDA approval (ATTR-CM)',   'actual', '2019-05-03', 'exact', 'First TTR stabilizer approved for ATTR-CM.', 'trial', t_attr_act, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Attruby FDA approval (ATTR-CM)',             'actual', '2024-11-22', 'exact', 'BridgeBio acoramidis approved for ATTR-CM, second-to-market entrant.', 'trial', t_attribute_cm, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Verquvo FDA approval (HFrEF)',               'actual', '2021-01-19', 'exact', 'First sGC stimulator approved for symptomatic chronic HFrEF.', 'trial', t_paradigm_hf, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Kerendia FDA approval (CKD with T2D)',       'actual', '2021-07-09', 'exact', 'First non-steroidal MRA approved for CKD with T2D.', 'trial', t_fineart_hf, jsonb_build_object('source','analyst'));

  -- Launch markers. a0..036 "Launch".
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000036', 'Mounjaro US launch',         'actual', '2022-06-01', 'exact', 'Lilly tirzepatide commercial launch in T2D.', 'trial', t_surpass_2, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000036', 'Zepbound US launch',         'actual', '2023-12-04', 'exact', 'Tirzepatide obesity launch, fastest US launch ramp on record.', 'trial', t_surmount_1, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000036', 'Wegovy US launch',           'actual', '2021-06-22', 'exact', 'Semaglutide 2.4 mg obesity launch.', 'trial', t_step_1, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000036', 'Camzyos US launch',          'actual', '2022-05-09', 'exact', 'BMS first-in-class oHCM launch.', 'trial', t_explorer_hcm, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000036', 'Attruby US launch',          'actual', '2024-12-09', 'exact', 'BridgeBio ATTR-CM launch into Vyndaqel-saturated market.', 'trial', t_attribute_cm, jsonb_build_object('source','analyst'));

  -- =========================================================================
  -- PRIMARY COMPLETION DATES. a0..008 "Primary Completion". (no description)
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000008', 'SUMMIT primary completion',         'actual', '2024-07-02', 'exact', 'trial', t_summit, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000008', 'FLOW primary completion',           'actual', '2024-01-09', 'exact', 'trial', t_flow, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000008', 'SURMOUNT-MMO primary completion projected', 'company', '2027-10-15', 'exact', 'trial', t_surmount_mmo, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000008', 'TRIUMPH-1 primary completion projected',     'company', '2026-04-15', 'exact', 'trial', t_triumph_1, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000008', 'ACACIA-HCM primary completion projected',    'company', '2026-06-30', 'exact', 'trial', t_acacia_hcm, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000008', 'CT-388 P2 primary completion',      'actual',  '2025-12-08', 'exact', 'trial', t_ct388_p2, jsonb_build_object('source','analyst'));

  -- =========================================================================
  -- TRIAL STARTS. a0..011 "Trial Start". (no description)
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000011', 'SURMOUNT-MMO study initiated',  'actual', '2022-10-11', 'exact', 'trial', t_surmount_mmo, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000011', 'TRIUMPH-1 study initiated',     'actual', '2023-07-10', 'exact', 'trial', t_triumph_1, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000011', 'ATTAIN-1 first patient in',     'actual', '2023-06-05', 'exact', 'trial', t_attain_1, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000011', 'CT-388 P2 study initiated',     'actual', '2024-08-16', 'exact', 'trial', t_ct388_p2, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000011', 'VK2735 oral P2 study initiated','actual', '2024-12-18', 'exact', 'trial', t_vk2735_oral_p2, jsonb_build_object('source','analyst'));

  -- =========================================================================
  -- LOSS OF EXCLUSIVITY / GENERIC ENTRY. a0..020 "LOE Date";
  -- a0..021 "Generic Entry Date" -> a0..020 "LOE Date".
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, end_date, description, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000020', 'Entresto US LOE',              'actual',  '2025-07-15', 'exact', null,         'Sacubitril/valsartan US patent expiry.', 'trial', t_paradigm_hf, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000020', 'Trulicity US LOE projected',   'company', '2027-12-31', 'exact', null,         'Dulaglutide US patent expiry near horizon.', 'trial', t_surpass_2, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000020', 'Vyndaqel/Vyndamax US LOE window','company','2024-12-01', 'exact', '2028-12-31', 'Tafamidis multi-patent expiry window.', 'trial', t_attr_act, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000020', 'Jardiance US LOE projected',   'company', '2028-08-15', 'exact', null,         'Empagliflozin US composition-of-matter patent expiry.', 'trial', t_emperor_reduced, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000020', 'Entresto generic entry expected','company','2025-09-01', 'exact', null,        'First generic sacubitril/valsartan launch projected post-LOE.', 'trial', t_paradigm_hf, jsonb_build_object('source','analyst'));

  -- =========================================================================
  -- NO LONGER EXPECTED (FAILURES / DCs). a0..035 "Approval", no_longer_expected.
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, no_longer_expected, description, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Pfizer danuglipron development discontinued', 'actual', '2023-12-01', 'exact', true, 'Pfizer halted danuglipron after high incidence of adverse events; oral GLP-1 small molecule strategy paused.', 'trial', t_danuglipron_p2, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Camzyos nHCM expansion no longer expected',   'actual', '2024-10-15', 'exact', true, 'ODYSSEY-HCM failed primary; non-obstructive HCM label expansion no longer expected.', 'trial', t_odyssey_hcm, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Jardiance post-MI expansion no longer expected','actual','2024-04-08', 'exact', true, 'EMPACT-MI failed primary; post-MI label expansion no longer expected.', 'trial', t_empact_mi, jsonb_build_object('source','analyst'));

  -- =========================================================================
  -- RANGE MARKERS (LAUNCH WINDOWS). a0..036 "Launch", end_date.
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, end_date, description, anchor_type, anchor_id, metadata) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000036', 'Aficamten US launch window',     'company', '2025-10-01', 'exact', '2026-03-31', 'Anticipated US commercial launch window for Cytokinetics aficamten in oHCM.', 'trial', t_sequoia_hcm, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000036', 'Finerenone HFpEF launch window', 'company', '2025-04-01', 'exact', '2026-06-30', 'Anticipated launch window for Kerendia HFpEF/HFmrEF label expansion.', 'trial', t_fineart_hf, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000036', 'Orforglipron US launch window',  'company', '2027-04-01', 'exact', '2027-12-31', 'Anticipated launch window for Lilly orforglipron contingent on regulatory approval.', 'trial', t_attain_1, jsonb_build_object('source','analyst'));

  -- =========================================================================
  -- MANY-TO-MANY SHARED MARKERS. Events are self-anchored: a marker assigned to
  -- multiple trials fans out to one event per trial (no constraint to preserve).
  -- a0..033 "Submission" -> a0..032 "Regulatory Filing".
  -- =========================================================================
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, anchor_type, anchor_id, metadata) values
    -- "Zepbound HFpEF sNDA filing (combined SUMMIT + SURMOUNT-1)" -> one event per trial
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Zepbound HFpEF sNDA filing (combined SUMMIT + SURMOUNT-1)','company', '2025-04-15', 'exact', 'Tirzepatide HFpEF label expansion combining SUMMIT and SURMOUNT-1 obesity data.', 'trial', t_summit, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Zepbound HFpEF sNDA filing (combined SUMMIT + SURMOUNT-1)','company', '2025-04-15', 'exact', 'Tirzepatide HFpEF label expansion combining SUMMIT and SURMOUNT-1 obesity data.', 'trial', t_surmount_1, jsonb_build_object('source','analyst')),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'Semaglutide CKD label expansion (FLOW + SUSTAIN-6)',      'actual',  '2025-01-30', 'exact', 'Ozempic CKD label expansion based on FLOW with supportive SUSTAIN-6 readthrough.', 'trial', t_flow, jsonb_build_object('source','analyst'));

  -- Register named event UUIDs for primary intelligence (vestigial; see note above).
  insert into _seed_ids (entity_type, key, id) values
    ('marker', 'm_summit_topline',    m_summit_topline),
    ('marker', 'm_redefine_1_miss',   m_redefine_1_miss),
    ('marker', 'm_orforglipron_read', m_orforglipron_read),
    ('marker', 'm_maritide_read',     m_maritide_read);
end;
$function$;

-- ===========================================================================
-- 2. _seed_demo_events: company/asset-anchored business events. event_threads
--    (Stage 3) is out of scope -- threading dropped. Categories -> event_type_id.
--    Two business events carry two labeled event_sources each (multi-source demo).
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
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, significance, anchor_type, anchor_id, metadata)
    values (gen_random_uuid(), p_space_id, p_uid, et_distribution, 'BridgeBio Attruby commercial launch',
      'actual', '2024-12-09', 'exact', 'BridgeBio launches Attruby (acoramidis) for ATTR-CM, second-to-market entrant against Pfizer Vyndaqel.',
      'high', 'company', c_atlas, jsonb_build_object('source','analyst'))
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
end;
$function$;

-- ===========================================================================
-- 3. _seed_demo_recent_activity: upcoming-catalyst widget seed (by-name trials).
--    Markers -> trial-anchored Topline Data events; the three projected-marker
--    slips become events updates.
-- ===========================================================================
create or replace function public._seed_demo_recent_activity(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  t_redefine_2  uuid;
  t_attain_1    uuid;
  t_achieve_1   uuid;
  t_triumph_1   uuid;
  t_acacia_hcm  uuid;

  m_redefine_2  uuid := gen_random_uuid();
  m_attain_1    uuid := gen_random_uuid();
  m_achieve_1   uuid := gen_random_uuid();
  m_triumph_1   uuid := gen_random_uuid();
  m_acacia_hcm  uuid := gen_random_uuid();
begin
  select id into t_redefine_2 from public.trials where space_id = p_space_id and name = 'REDEFINE-2' limit 1;
  select id into t_attain_1   from public.trials where space_id = p_space_id and name = 'ATTAIN-1'   limit 1;
  select id into t_achieve_1  from public.trials where space_id = p_space_id and name = 'ACHIEVE-1'  limit 1;
  select id into t_triumph_1  from public.trials where space_id = p_space_id and name = 'TRIUMPH-1'  limit 1;
  select id into t_acacia_hcm from public.trials where space_id = p_space_id and name = 'ACACIA-HCM' limit 1;

  -- Bail out if the realistic cardiometabolic seed wasn't loaded.
  if t_redefine_2 is null then
    return;
  end if;

  -- ---------------------------------------------------------------------------
  -- Upcoming catalysts (next 14 days). event_type a0..013 = Topline Data.
  -- Trial-anchored events (one anchor each); no marker_assignments.
  -- ---------------------------------------------------------------------------
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, anchor_type, anchor_id, metadata) values
    (m_redefine_2,  p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'REDEFINE-2 topline expected',  'company', (current_date + interval '2 days')::date,  'exact', 'Novo CagriSema P3 in obesity + T2D, follow-on to REDEFINE-1.', 'trial', t_redefine_2, jsonb_build_object('source','analyst')),
    (m_attain_1,    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'ATTAIN-1 topline expected',    'company', (current_date + interval '5 days')::date,  'exact', 'Lilly orforglipron P3 obesity readout.', 'trial', t_attain_1, jsonb_build_object('source','analyst')),
    (m_achieve_1,   p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'ACHIEVE-1 topline expected',   'company', (current_date + interval '8 days')::date,  'exact', 'Lilly orforglipron P3 T2D readout.', 'trial', t_achieve_1, jsonb_build_object('source','analyst')),
    (m_triumph_1,   p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'TRIUMPH-1 topline expected',   'company', (current_date + interval '11 days')::date, 'exact', 'Lilly retatrutide P3 obesity readout.', 'trial', t_triumph_1, jsonb_build_object('source','analyst')),
    (m_acacia_hcm,  p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'ACACIA-HCM topline expected',  'company', (current_date + interval '14 days')::date, 'exact', 'Cytokinetics aficamten in non-obstructive HCM.', 'trial', t_acacia_hcm, jsonb_build_object('source','analyst'));

  -- ---------------------------------------------------------------------------
  -- Slip three existing projected events by >90 days. The event_changes trigger
  -- records the date edit; get_activity_feed surfaces the change. The WHERE that
  -- found markers by title/space now finds the equivalent events.
  -- ---------------------------------------------------------------------------
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
-- 4. _seed_demo_activity_variety: Activity-feed coverage. 12 CT.gov change rows
--    (unchanged), plus analyst events. Markers -> trial-anchored events; the
--    trial_change_events rows that referenced the old marker_id column now carry
--    event_id (A0 rename) pointing at the created event.
-- ===========================================================================
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

  -- A live event for the analyst-side direct-insert activity rows. Hung off
  -- REDEFINE-2. (Formerly a marker; trial_change_events.event_id resolves type.)
  m_live        uuid := gen_random_uuid();
  -- A throwaway event created then DELETEd. NOTE: the old marker-audit trigger
  -- that emitted a 'marker_removed' Activity row on delete was retired (migration
  -- 20260628210000). The events audit trigger (_log_event_change) writes only to
  -- event_changes, not trial_change_events, so this delete now produces an
  -- event_changes 'deleted' audit row and no Activity-feed entry. Kept as a
  -- faithful translation of the original insert+delete; the feed simply no longer
  -- carries a removed-event row (demo-only, not test-gated).
  m_doomed      uuid := gen_random_uuid();

  -- Event type ids seeded by 20260628071012_event_types. a0..031 "Full Data" was
  -- consolidated into a0..013 "Topline Data"; mt_full_data keeps the old id for
  -- the inert reclassified payload (passthrough, nothing reads it) while the
  -- m_finalized event itself is created with the surviving a0..013 type.
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

  -- ---------------------------------------------------------------------------
  -- 12 CT.gov-source change events. payload shape per _classify_change. These
  -- are trial-level detected changes (no event anchor), so event_id stays null.
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
  -- Live event for the analyst-side direct-insert activity rows. event_date sits
  -- well outside the upcoming-catalyst window. Anchored to REDEFINE-2.
  -- ---------------------------------------------------------------------------
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, anchor_type, anchor_id, metadata)
    values (m_live, p_space_id, p_uid, mt_approval, 'REDEFINE-2 PDUFA expected', 'company',
            (current_date + interval '180 days')::date, 'exact',
            'Anticipated PDUFA decision following BLA filing.', 'trial', t_status, jsonb_build_object('source','analyst'));

  -- 4 analyst-source change events on the live event. event_id references the
  -- created event so get_activity_feed resolves the type via events.event_type_id.
  -- Payloads kept byte-stable (passthrough); nothing reads payload.*type_id keys.
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

  -- projection_finalized on a fresh event (separate from m_live so the live
  -- event stays 'company'). a0..031 "Full Data" -> surviving a0..013.
  declare
    m_finalized uuid := gen_random_uuid();
  begin
    insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, anchor_type, anchor_id, metadata)
      values (m_finalized, p_space_id, p_uid, mt_topline_data, 'REDEFINE-1 full readout', 'actual',
              (current_date - interval '14 days')::date, 'exact',
              'Full Phase 3 readout published in NEJM.', 'trial', t_status, jsonb_build_object('source','analyst'));

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

  -- event_removed demo: create a separate event then DELETE it. See the m_doomed
  -- note above -- with the marker-audit trigger retired this no longer emits an
  -- Activity-feed row, only an event_changes 'deleted' audit entry.
  insert into public.events (id, space_id, created_by, event_type_id, title, projection, event_date, date_precision, description, anchor_type, anchor_id, metadata)
    values (m_doomed, p_space_id, p_uid, mt_launch, 'REDEFINE-2 launch (deprecated forecast)', 'company',
            (current_date + interval '365 days')::date, 'exact',
            'Earlier launch forecast superseded by revised commercial plan.', 'trial', t_status, jsonb_build_object('source','analyst'));

  delete from public.events where id = m_doomed;
end;
$function$;

-- ---------------------------------------------------------------------------
-- In-file smoke (data-conditional, self-cleaning, prod-safe). At db reset this
-- migration runs before seed.sql so no users/tenants exist yet -> skip notice.
-- On a populated db (db push) it seeds a scratch space via the full producer
-- chain, asserts events were created, that the two multi-source business events
-- have two event_sources each, that no clinical/markers event carries a
-- source_url, then deletes the scratch space (cascade cleans up).
-- ---------------------------------------------------------------------------
do $smoke$
declare
  v_tenant uuid;
  v_uid    uuid;
  v_space  uuid := gen_random_uuid();
  v_events int;
  v_multi  int;
  v_src_url int;
begin
  select id into v_tenant from public.tenants limit 1;
  select id into v_uid from auth.users limit 1;
  -- Skip on any non-seeded database (local db reset runs migrations before
  -- seed.sql; dev/prod db push has no demo space): the local demo space
  -- 00000000-0000-0000-0000-0000000d0100 is the seeded-marker other smokes use.
  -- The full producer chain is verified by the role-access integration suite;
  -- running a scratch seed during db push is fragile against real data.
  if v_tenant is null or v_uid is null
     or not exists (select 1 from public.spaces where id = '00000000-0000-0000-0000-0000000d0100') then
    raise notice 'C5 smoke: skipped on non-seeded db; producer behavior is covered by the integration suite';
    return;
  end if;

  insert into public.spaces (id, tenant_id, name, created_by) values (v_space, v_tenant, 'C5 smoke scratch', v_uid);

  -- create temp _seed_ids the producers read (seed_demo_data normally provides it)
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

  select count(*) into v_events from public.events where space_id = v_space;
  if v_events = 0 then
    raise exception 'C5 smoke: expected events after seeding, found 0';
  end if;

  -- the two multi-source business events each carry exactly 2 event_sources
  select count(*) into v_multi from (
    select e.id from public.events e
    join public.event_sources s on s.event_id = e.id
    where e.space_id = v_space
    group by e.id
    having count(*) = 2
  ) q;
  if v_multi <> 2 then
    raise exception 'C5 smoke: expected exactly 2 events with 2 event_sources each, found %', v_multi;
  end if;

  -- clinical/markers demo events do not carry a source_url (derived registry link)
  select count(*) into v_src_url from public.events
   where space_id = v_space and anchor_type = 'trial' and source_url is not null;
  if v_src_url <> 0 then
    raise exception 'C5 smoke: expected 0 trial-anchored events with source_url, found %', v_src_url;
  end if;

  delete from public.spaces where id = v_space;
  raise notice 'C5 smoke PASS: % events seeded; 2 multi-source business events; 0 trial-anchored source_url', v_events;
end;
$smoke$;

notify pgrst, 'reload schema';
