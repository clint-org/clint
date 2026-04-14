-- migration: 20260413120200_seed_events_demo_data
-- purpose: extend seed_demo_data() to insert comprehensive event demo data
--          covering all feature scenarios: every entity level (space, company,
--          product, trial), every category, threads, links, sources, tags,
--          both priorities, and mixed feed with markers.
-- affected objects: public.seed_demo_data (function replaced)
-- notes: appends event insertion to existing function body.
--        event_categories use fixed system UUIDs (e0000000-...).

create or replace function public.seed_demo_data(p_space_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();

  -- ------------------------- companies -------------------------
  c_az    uuid := gen_random_uuid();
  c_lilly uuid := gen_random_uuid();
  c_novo  uuid := gen_random_uuid();
  c_merck uuid := gen_random_uuid();
  c_pfizer uuid := gen_random_uuid();
  c_bayer uuid := gen_random_uuid();
  c_bi    uuid := gen_random_uuid();
  c_sanofi uuid := gen_random_uuid();
  c_gsk   uuid := gen_random_uuid();

  -- ------------------------- products -------------------------
  p_farxiga          uuid := gen_random_uuid();
  p_jardiance        uuid := gen_random_uuid();
  p_mounjaro         uuid := gen_random_uuid();
  p_ozempic          uuid := gen_random_uuid();
  p_az_early         uuid := gen_random_uuid();
  p_lly_early        uuid := gen_random_uuid();
  p_novo_sema_hf     uuid := gen_random_uuid();
  p_novo_early       uuid := gen_random_uuid();
  p_merck_verquvo    uuid := gen_random_uuid();
  p_merck_probe      uuid := gen_random_uuid();
  p_merck_early      uuid := gen_random_uuid();
  p_pfe_vynda        uuid := gen_random_uuid();
  p_pfe_next         uuid := gen_random_uuid();
  p_pfe_early        uuid := gen_random_uuid();
  p_bayer_kerendia   uuid := gen_random_uuid();
  p_bayer_mid        uuid := gen_random_uuid();
  p_bi_alt           uuid := gen_random_uuid();
  p_bi_preclin       uuid := gen_random_uuid();
  p_sanofi_piv       uuid := gen_random_uuid();
  p_sanofi_probe     uuid := gen_random_uuid();
  p_gsk_cand         uuid := gen_random_uuid();
  p_gsk_early        uuid := gen_random_uuid();

  -- ------------------------- therapeutic areas -------------------------
  ta_hf      uuid := gen_random_uuid();
  ta_ckd     uuid := gen_random_uuid();
  ta_t2d     uuid := gen_random_uuid();
  ta_obesity uuid := gen_random_uuid();

  -- ------------------------- existing timeline trials -------------------------
  t1 uuid := gen_random_uuid();
  t2 uuid := gen_random_uuid();
  t3 uuid := gen_random_uuid();
  t4 uuid := gen_random_uuid();
  t5 uuid := gen_random_uuid();
  t6 uuid := gen_random_uuid();
  t7 uuid := gen_random_uuid();
  t8 uuid := gen_random_uuid();

  -- ------------------------- landscape trials (HF) -------------------------
  tl_az_early     uuid := gen_random_uuid();
  tl_lly_early    uuid := gen_random_uuid();
  tl_sema_hf      uuid := gen_random_uuid();
  tl_novo_early   uuid := gen_random_uuid();
  tl_verquvo      uuid := gen_random_uuid();
  tl_merck_probe  uuid := gen_random_uuid();
  tl_merck_early  uuid := gen_random_uuid();
  tl_vynda        uuid := gen_random_uuid();
  tl_pfe_next     uuid := gen_random_uuid();
  tl_pfe_early    uuid := gen_random_uuid();
  tl_kerendia     uuid := gen_random_uuid();
  tl_bayer_mid    uuid := gen_random_uuid();
  tl_bi_alt       uuid := gen_random_uuid();
  tl_bi_preclin   uuid := gen_random_uuid();
  tl_sanofi_piv   uuid := gen_random_uuid();
  tl_sanofi_probe uuid := gen_random_uuid();
  tl_gsk_cand     uuid := gen_random_uuid();
  tl_gsk_early    uuid := gen_random_uuid();

  -- ------------------------- MOAs -------------------------
  moa_sglt2              uuid := gen_random_uuid();
  moa_glp1               uuid := gen_random_uuid();
  moa_glp1_gip           uuid := gen_random_uuid();
  moa_sgc                uuid := gen_random_uuid();
  moa_ttr                uuid := gen_random_uuid();
  moa_nsmra              uuid := gen_random_uuid();
  moa_ns_investigational uuid := gen_random_uuid();
  moa_cardiac_myosin     uuid := gen_random_uuid();

  -- ------------------------- ROAs -------------------------
  roa_oral        uuid := gen_random_uuid();
  roa_iv          uuid := gen_random_uuid();
  roa_sc          uuid := gen_random_uuid();
  roa_inhaled     uuid := gen_random_uuid();
  roa_im          uuid := gen_random_uuid();
  roa_topical     uuid := gen_random_uuid();
  roa_intrathecal uuid := gen_random_uuid();

  -- ------------------------- marker IDs -------------------------
  m_t1_data_reported   uuid := gen_random_uuid();
  m_t1_reg_filing      uuid := gen_random_uuid();
  m_t4_data_reported   uuid := gen_random_uuid();
  m_t4_reg_filing      uuid := gen_random_uuid();
  m_t6_reg_proj        uuid := gen_random_uuid();

  -- ------------------------- event IDs -------------------------
  ev_fda_guidance      uuid := gen_random_uuid();
  ev_lilly_ceo         uuid := gen_random_uuid();
  ev_lilly_interim     uuid := gen_random_uuid();
  ev_lilly_new_ceo     uuid := gen_random_uuid();
  ev_novo_acquisition  uuid := gen_random_uuid();
  ev_pfizer_reorg      uuid := gen_random_uuid();
  ev_az_earnings       uuid := gen_random_uuid();
  ev_bayer_patent      uuid := gen_random_uuid();
  ev_merck_partner     uuid := gen_random_uuid();
  ev_farxiga_mfg       uuid := gen_random_uuid();
  ev_jardiance_label   uuid := gen_random_uuid();
  ev_ozempic_shortage  uuid := gen_random_uuid();
  ev_mounjaro_payer    uuid := gen_random_uuid();
  ev_dapahf_endpoint   uuid := gen_random_uuid();
  ev_emperor_safety    uuid := gen_random_uuid();
  ev_sema_hf_protocol  uuid := gen_random_uuid();
  ev_bi_crl            uuid := gen_random_uuid();
  ev_gsk_divest        uuid := gen_random_uuid();
  ev_sanofi_priority   uuid := gen_random_uuid();
  ev_pfizer_vynda_gen  uuid := gen_random_uuid();

  -- ------------------------- thread IDs -------------------------
  thr_lilly_ceo        uuid := gen_random_uuid();
  thr_ozempic_supply   uuid := gen_random_uuid();

  existing_count int;
begin
  if uid is null then
    raise exception 'Must be authenticated to seed demo data';
  end if;

  select count(*) into existing_count from public.companies where space_id = p_space_id;
  if existing_count > 0 then
    return;
  end if;

  -- ==========================================================================
  -- Companies
  -- ==========================================================================
  insert into public.companies (id, space_id, created_by, name, logo_url, display_order) values
    (c_az,     p_space_id, uid, 'AstraZeneca',           'https://companieslogo.com/img/orig/AZN-e22c80ac.png',    1),
    (c_lilly,  p_space_id, uid, 'Eli Lilly',             'https://companieslogo.com/img/orig/LLY-8c523530.png',    2),
    (c_novo,   p_space_id, uid, 'Novo Nordisk',          'https://companieslogo.com/img/orig/NVO-073a8258.png',    3),
    (c_merck,  p_space_id, uid, 'Merck',                 'https://companieslogo.com/img/orig/MRK-0e4b5967.png',    4),
    (c_pfizer, p_space_id, uid, 'Pfizer',                'https://companieslogo.com/img/orig/PFE-5e21087f.png',    5),
    (c_bayer,  p_space_id, uid, 'Bayer',                 'https://companieslogo.com/img/orig/BAYN.DE-73c01a26.png', 6),
    (c_bi,     p_space_id, uid, 'Boehringer Ingelheim',  null,                                                     7),
    (c_sanofi, p_space_id, uid, 'Sanofi',                'https://companieslogo.com/img/orig/SNY-d3e53e39.png',    8),
    (c_gsk,    p_space_id, uid, 'GSK',                   'https://companieslogo.com/img/orig/GSK-8bceb4f9.png',    9);

  -- ==========================================================================
  -- Therapeutic areas
  -- ==========================================================================
  insert into public.therapeutic_areas (id, space_id, created_by, name, abbreviation) values
    (ta_hf,      p_space_id, uid, 'Heart Failure',          'HF'),
    (ta_ckd,     p_space_id, uid, 'Chronic Kidney Disease', 'CKD'),
    (ta_t2d,     p_space_id, uid, 'Type 2 Diabetes',       'T2D'),
    (ta_obesity, p_space_id, uid, 'Obesity',                'OB');

  -- ==========================================================================
  -- Products
  -- ==========================================================================
  insert into public.products (id, space_id, created_by, company_id, name, generic_name, display_order) values
    (p_farxiga,        p_space_id, uid, c_az,     'Farxiga',          'dapagliflozin',  1),
    (p_az_early,       p_space_id, uid, c_az,     'AZD-Early',        null,             2),
    (p_jardiance,      p_space_id, uid, c_lilly,  'Jardiance',        'empagliflozin',  1),
    (p_mounjaro,       p_space_id, uid, c_lilly,  'Mounjaro',         'tirzepatide',    2),
    (p_lly_early,      p_space_id, uid, c_lilly,  'LY-Early',         null,             3),
    (p_ozempic,        p_space_id, uid, c_novo,   'Ozempic',          'semaglutide',    1),
    (p_novo_sema_hf,   p_space_id, uid, c_novo,   'Semaglutide-HF',   null,             2),
    (p_novo_early,     p_space_id, uid, c_novo,   'NVO-Early',        null,             3),
    (p_merck_verquvo,  p_space_id, uid, c_merck,  'Verquvo',          'vericiguat',     1),
    (p_merck_probe,    p_space_id, uid, c_merck,  'MRK-Probe',        null,             2),
    (p_merck_early,    p_space_id, uid, c_merck,  'MRK-Early',        null,             3),
    (p_pfe_vynda,      p_space_id, uid, c_pfizer, 'Vyndaqel',         'tafamidis',      1),
    (p_pfe_next,       p_space_id, uid, c_pfizer, 'PF-Next',          null,             2),
    (p_pfe_early,      p_space_id, uid, c_pfizer, 'PF-Early',         null,             3),
    (p_bayer_kerendia, p_space_id, uid, c_bayer,  'Kerendia',         'finerenone',     1),
    (p_bayer_mid,      p_space_id, uid, c_bayer,  'BAY-Mid',          null,             2),
    (p_bi_alt,         p_space_id, uid, c_bi,     'BI-Alt',           null,             1),
    (p_bi_preclin,     p_space_id, uid, c_bi,     'BI-Early',         null,             2),
    (p_sanofi_piv,     p_space_id, uid, c_sanofi, 'Sanofi-Pivotal',   null,             1),
    (p_sanofi_probe,   p_space_id, uid, c_sanofi, 'Sanofi-Probe',     null,             2),
    (p_gsk_cand,       p_space_id, uid, c_gsk,    'GSK-Candidate',    null,             1),
    (p_gsk_early,      p_space_id, uid, c_gsk,    'GSK-Early',        null,             2);

  -- ==========================================================================
  -- MOAs
  -- ==========================================================================
  insert into public.mechanisms_of_action (id, space_id, created_by, name, abbreviation, description, display_order) values
    (moa_sglt2,              p_space_id, uid, 'SGLT2 Inhibitor',               'SGLT2i',  'Sodium-glucose co-transporter 2 inhibitor',           1),
    (moa_glp1,               p_space_id, uid, 'GLP-1 Receptor Agonist',        'GLP-1 RA','Glucagon-like peptide-1 receptor agonist',             2),
    (moa_glp1_gip,           p_space_id, uid, 'GLP-1/GIP Dual Agonist',        'GLP-1/GIP','Dual incretin agonist',                              3),
    (moa_sgc,                p_space_id, uid, 'Soluble Guanylate Cyclase Stim', 'sGC',    'Soluble guanylate cyclase stimulator',                 4),
    (moa_ttr,                p_space_id, uid, 'Transthyretin Stabilizer',       'TTR',    'Transthyretin stabilizer for cardiac amyloidosis',     5),
    (moa_nsmra,              p_space_id, uid, 'Non-steroidal MRA',              'nsMRA',  'Non-steroidal mineralocorticoid receptor antagonist',   6),
    (moa_ns_investigational, p_space_id, uid, 'Investigational (undisclosed)',   null,     'Mechanism not yet publicly disclosed',                 7),
    (moa_cardiac_myosin,     p_space_id, uid, 'Cardiac Myosin Inhibitor',       'CMI',    'Cardiac myosin inhibitor for obstructive HCM',         8);

  -- ==========================================================================
  -- ROAs
  -- ==========================================================================
  insert into public.routes_of_administration (id, space_id, created_by, name, display_order) values
    (roa_oral,        p_space_id, uid, 'Oral',           1),
    (roa_iv,          p_space_id, uid, 'Intravenous',    2),
    (roa_sc,          p_space_id, uid, 'Subcutaneous',   3),
    (roa_inhaled,     p_space_id, uid, 'Inhaled',        4),
    (roa_im,          p_space_id, uid, 'Intramuscular',  5),
    (roa_topical,     p_space_id, uid, 'Topical',        6),
    (roa_intrathecal, p_space_id, uid, 'Intrathecal',    7);

  -- ==========================================================================
  -- Product ↔ MOA mappings
  -- ==========================================================================
  insert into public.product_mechanisms_of_action (product_id, moa_id) values
    (p_farxiga,        moa_sglt2),
    (p_jardiance,      moa_sglt2),
    (p_mounjaro,       moa_glp1_gip),
    (p_ozempic,        moa_glp1),
    (p_novo_sema_hf,   moa_glp1),
    (p_merck_verquvo,  moa_sgc),
    (p_pfe_vynda,      moa_ttr),
    (p_bayer_kerendia, moa_nsmra),
    (p_bi_alt,         moa_cardiac_myosin),
    (p_sanofi_piv,     moa_ns_investigational),
    (p_gsk_cand,       moa_ns_investigational);

  -- ==========================================================================
  -- Product ↔ ROA mappings
  -- ==========================================================================
  insert into public.product_routes_of_administration (product_id, roa_id) values
    (p_farxiga,        roa_oral),
    (p_jardiance,      roa_oral),
    (p_mounjaro,       roa_sc),
    (p_ozempic,        roa_sc),
    (p_novo_sema_hf,   roa_oral),
    (p_merck_verquvo,  roa_oral),
    (p_pfe_vynda,      roa_oral),
    (p_bayer_kerendia, roa_oral),
    (p_bi_alt,         roa_oral),
    (p_sanofi_piv,     roa_iv),
    (p_gsk_cand,       roa_sc);

  -- ==========================================================================
  -- Trials (existing timeline)
  -- ==========================================================================
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, phase_type, phase_start_date, phase_end_date) values
    (t1, p_space_id, uid, p_farxiga,   ta_hf,      'DAPA-HF',             'NCT03036124', 4744, 'Completed', 'LAUNCHED',  '2017-02-01', '2025-12-31'),
    (t2, p_space_id, uid, p_farxiga,   ta_ckd,     'DAPA-CKD',            'NCT03036150', 4304, 'Completed', 'P4',        '2017-02-01', '2024-12-31'),
    (t3, p_space_id, uid, p_farxiga,   ta_hf,      'DELIVER',             'NCT03619213', 6263, 'Completed', 'P3',        '2018-08-01', '2024-06-30'),
    (t4, p_space_id, uid, p_jardiance, ta_hf,      'EMPEROR-Preserved',   'NCT03057977', 5988, 'Completed', 'APPROVED',  '2017-03-01', '2025-06-30'),
    (t5, p_space_id, uid, p_jardiance, ta_hf,      'EMPEROR-Reduced',     'NCT03057951', 3730, 'Completed', 'P3',        '2017-03-01', '2024-06-30'),
    (t6, p_space_id, uid, p_jardiance, ta_ckd,     'EMPA-KIDNEY',         'NCT03594110', 6609, 'Completed', 'P3',        '2019-05-01', '2024-12-31'),
    (t7, p_space_id, uid, p_mounjaro,  ta_t2d,     'SURPASS-1',           'NCT03954834', 478,  'Completed', 'P3',        '2019-06-01', '2024-06-30'),
    (t8, p_space_id, uid, p_ozempic,   ta_obesity, 'STEP 1',              'NCT03548935', 1961, 'Completed', 'P3',        '2018-06-01', '2024-06-30');

  -- ==========================================================================
  -- Trials (landscape / HF)
  -- ==========================================================================
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, phase_type, phase_start_date, phase_end_date) values
    (tl_az_early,     p_space_id, uid, p_az_early,       ta_hf, 'AZD-HF-001',       null,            60,   'Recruiting',     'P1',      '2025-01-01', '2026-12-31'),
    (tl_lly_early,    p_space_id, uid, p_lly_early,      ta_hf, 'LY-HF-P1',         null,            45,   'Recruiting',     'P1',      '2025-03-01', '2027-03-31'),
    (tl_sema_hf,      p_space_id, uid, p_novo_sema_hf,   ta_hf, 'SOUL-HF',          'NCT05600530',   9600, 'Recruiting',     'P3',      '2022-11-01', '2026-12-31'),
    (tl_novo_early,   p_space_id, uid, p_novo_early,     ta_hf, 'NVO-HF-P1',        null,            55,   'Not yet recruiting','P1',   '2025-06-01', '2027-06-30'),
    (tl_verquvo,      p_space_id, uid, p_merck_verquvo,  ta_hf, 'VICTORIA',          'NCT02861534',   5050, 'Completed',      'APPROVED','2016-08-01', '2025-06-30'),
    (tl_merck_probe,  p_space_id, uid, p_merck_probe,    ta_hf, 'MRK-HF-P2',        null,            320,  'Recruiting',     'P2',      '2024-01-01', '2026-06-30'),
    (tl_merck_early,  p_space_id, uid, p_merck_early,    ta_hf, 'MRK-HF-P1',        null,            40,   'Not yet recruiting','P1',   '2025-09-01', '2027-09-30'),
    (tl_vynda,        p_space_id, uid, p_pfe_vynda,      ta_hf, 'ATTR-ACT',          'NCT01994889',   441,  'Completed',      'LAUNCHED','2014-01-01', '2025-12-31'),
    (tl_pfe_next,     p_space_id, uid, p_pfe_next,       ta_hf, 'PF-HF-P2',         null,            280,  'Recruiting',     'P2',      '2024-06-01', '2026-09-30'),
    (tl_pfe_early,    p_space_id, uid, p_pfe_early,      ta_hf, 'PF-HF-P1',         null,            36,   'Not yet recruiting','P1',   '2025-07-01', '2027-06-30'),
    (tl_kerendia,     p_space_id, uid, p_bayer_kerendia, ta_hf, 'FINEARTS-HF',       'NCT04435626',   6016, 'Completed',      'P3',      '2020-09-01', '2025-06-30'),
    (tl_bayer_mid,    p_space_id, uid, p_bayer_mid,      ta_hf, 'BAY-HF-P2',        null,            250,  'Recruiting',     'P2',      '2024-03-01', '2026-03-31'),
    (tl_bi_alt,       p_space_id, uid, p_bi_alt,         ta_hf, 'BI-HCM-P3',        null,            800,  'Recruiting',     'P3',      '2023-06-01', '2026-12-31'),
    (tl_bi_preclin,   p_space_id, uid, p_bi_preclin,     ta_hf, 'BI-HF-PRECLIN',    null,            null, 'Not yet recruiting','PRECLIN','2025-01-01','2026-12-31'),
    (tl_sanofi_piv,   p_space_id, uid, p_sanofi_piv,     ta_hf, 'Sanofi-HF-P3',     null,            3000, 'Recruiting',     'P3',      '2023-01-01', '2026-06-30'),
    (tl_sanofi_probe, p_space_id, uid, p_sanofi_probe,   ta_hf, 'Sanofi-HF-P2',     null,            200,  'Completed',      'P2',      '2022-01-01', '2024-12-31'),
    (tl_gsk_cand,     p_space_id, uid, p_gsk_cand,       ta_hf, 'GSK-HF-P2',        null,            350,  'Recruiting',     'P2',      '2024-01-01', '2026-06-30'),
    (tl_gsk_early,    p_space_id, uid, p_gsk_early,      ta_hf, 'GSK-HF-P1',        null,            30,   'Recruiting',     'P1',      '2025-04-01', '2027-04-30');

  -- ==========================================================================
  -- Markers (existing timeline)
  -- ==========================================================================
  -- DAPA-HF markers
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (m_t1_data_reported, p_space_id, uid, 'a0000000-0000-0000-0000-000000000002', 'DAPA-HF results presented at ESC 2019', 'actual', '2019-09-19');
  insert into public.marker_assignments (marker_id, trial_id) values (m_t1_data_reported, t1);

  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (m_t1_reg_filing, p_space_id, uid, 'a0000000-0000-0000-0000-000000000004', 'sNDA filed for HFrEF', 'actual', '2020-01-15');
  insert into public.marker_assignments (marker_id, trial_id) values (m_t1_reg_filing, t1);

  insert into public.markers (space_id, created_by, marker_type_id, title, projection, event_date) values
    (p_space_id, uid, 'a0000000-0000-0000-0000-000000000006', 'FDA approval for HFrEF', 'actual', '2020-05-05');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t1 from public.markers where space_id = p_space_id and title = 'FDA approval for HFrEF';

  -- DELIVER marker
  insert into public.markers (space_id, created_by, marker_type_id, title, projection, event_date) values
    (p_space_id, uid, 'a0000000-0000-0000-0000-000000000002', 'DELIVER primary endpoint met', 'actual', '2022-08-27');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t3 from public.markers where space_id = p_space_id and title = 'DELIVER primary endpoint met';

  -- EMPEROR-Preserved markers
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (m_t4_data_reported, p_space_id, uid, 'a0000000-0000-0000-0000-000000000002', 'EMPEROR-Preserved primary endpoint met', 'actual', '2021-08-27');
  insert into public.marker_assignments (marker_id, trial_id) values (m_t4_data_reported, t4);

  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (m_t4_reg_filing, p_space_id, uid, 'a0000000-0000-0000-0000-000000000004', 'sNDA filed for HFpEF', 'actual', '2022-01-28');
  insert into public.marker_assignments (marker_id, trial_id) values (m_t4_reg_filing, t4);

  insert into public.markers (space_id, created_by, marker_type_id, title, projection, event_date) values
    (p_space_id, uid, 'a0000000-0000-0000-0000-000000000006', 'FDA approval for HFpEF', 'actual', '2022-02-24');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t4 from public.markers where space_id = p_space_id and title = 'FDA approval for HFpEF';

  -- EMPA-KIDNEY markers
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (m_t6_reg_proj, p_space_id, uid, 'a0000000-0000-0000-0000-000000000003', 'EMPA-KIDNEY regulatory filing projected', 'company', '2023-03-15');
  insert into public.marker_assignments (marker_id, trial_id) values (m_t6_reg_proj, t6);

  insert into public.markers (space_id, created_by, marker_type_id, title, projection, event_date) values
    (p_space_id, uid, 'a0000000-0000-0000-0000-000000000002', 'EMPA-KIDNEY stopped early for efficacy', 'actual', '2022-03-18');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t6 from public.markers where space_id = p_space_id and title = 'EMPA-KIDNEY stopped early for efficacy';

  -- SURPASS-1 marker
  insert into public.markers (space_id, created_by, marker_type_id, title, projection, event_date) values
    (p_space_id, uid, 'a0000000-0000-0000-0000-000000000002', 'SURPASS-1 topline results', 'actual', '2021-04-22');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t7 from public.markers where space_id = p_space_id and title = 'SURPASS-1 topline results';

  -- STEP 1 marker
  insert into public.markers (space_id, created_by, marker_type_id, title, projection, event_date) values
    (p_space_id, uid, 'a0000000-0000-0000-0000-000000000002', 'STEP 1 topline results', 'actual', '2021-02-10');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t8 from public.markers where space_id = p_space_id and title = 'STEP 1 topline results';

  -- Landscape trial markers
  insert into public.markers (space_id, created_by, marker_type_id, title, projection, event_date) values
    (p_space_id, uid, 'a0000000-0000-0000-0000-000000000001', 'SOUL-HF topline data expected', 'company', '2026-06-15');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_sema_hf from public.markers where space_id = p_space_id and title = 'SOUL-HF topline data expected';

  insert into public.markers (space_id, created_by, marker_type_id, title, projection, event_date) values
    (p_space_id, uid, 'a0000000-0000-0000-0000-000000000002', 'FINEARTS-HF primary results', 'actual', '2024-09-01');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_kerendia from public.markers where space_id = p_space_id and title = 'FINEARTS-HF primary results';

  insert into public.markers (space_id, created_by, marker_type_id, title, projection, event_date) values
    (p_space_id, uid, 'a0000000-0000-0000-0000-000000000003', 'Kerendia HF regulatory filing projected', 'company', '2025-06-01');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_kerendia from public.markers where space_id = p_space_id and title = 'Kerendia HF regulatory filing projected';

  insert into public.markers (space_id, created_by, marker_type_id, title, projection, event_date) values
    (p_space_id, uid, 'a0000000-0000-0000-0000-000000000001', 'Sanofi Pivotal HF topline data projected', 'company', '2026-03-01');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_sanofi_piv from public.markers where space_id = p_space_id and title = 'Sanofi Pivotal HF topline data projected';

  -- ==========================================================================
  -- Sample marker_notifications
  -- ==========================================================================
  insert into public.marker_notifications (space_id, marker_id, priority, summary, created_by) values
    (p_space_id, m_t1_data_reported, 'high',
      'Farxiga (dapagliflozin) DAPA-HF results presented at ESC 2019 -- positive primary endpoint.',
      uid),
    (p_space_id, m_t4_reg_filing, 'high',
      'Jardiance (empagliflozin) EMPEROR-Preserved sNDA filed for HFpEF -- PDUFA action expected ~Q4 2022.',
      uid),
    (p_space_id, m_t6_reg_proj, 'low',
      'Jardiance EMPA-KIDNEY regulatory filing projection updated to Q1 2023.',
      uid);

  -- ==========================================================================
  -- EVENT THREADS
  -- ==========================================================================
  insert into public.event_threads (id, space_id, title, created_by) values
    (thr_lilly_ceo,    p_space_id, 'Eli Lilly CEO Succession',        uid),
    (thr_ozempic_supply, p_space_id, 'Ozempic Supply Chain Disruption', uid);

  -- ==========================================================================
  -- EVENTS -- comprehensive demo covering every feature
  -- ==========================================================================

  -- ---- SPACE-LEVEL (industry-wide) events ----

  -- Leadership category, high priority
  insert into public.events (id, space_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_fda_guidance, p_space_id,
     'e0000000-0000-0000-0000-000000000002',
     'FDA issues draft guidance on accelerated approval for cardiovascular endpoints',
     '2025-11-15',
     'The FDA released draft guidance revising requirements for accelerated approval in CV indications. The guidance proposes allowing surrogate endpoints such as NT-proBNP reduction as a basis for accelerated approval in heart failure trials, which could significantly shorten development timelines for multiple programs in this landscape.',
     'high',
     array['accelerated approval', 'FDA guidance', 'cardiovascular'],
     uid);

  -- ---- COMPANY-LEVEL events ----

  -- Leadership: Lilly CEO thread (3 events)
  insert into public.events (id, space_id, company_id, category_id, thread_id, thread_order, title, event_date, description, priority, tags, created_by) values
    (ev_lilly_ceo, p_space_id, c_lilly,
     'e0000000-0000-0000-0000-000000000001',
     thr_lilly_ceo, 1,
     'Eli Lilly CEO terminated for cause',
     '2025-09-01',
     'Eli Lilly board of directors voted to terminate the CEO effective immediately citing conduct violations. The departure was unexpected and sent shares down 4% in after-hours trading.',
     'high',
     array['CEO termination', 'board action', 'executive change'],
     uid);

  insert into public.events (id, space_id, company_id, category_id, thread_id, thread_order, title, event_date, description, priority, tags, created_by) values
    (ev_lilly_interim, p_space_id, c_lilly,
     'e0000000-0000-0000-0000-000000000001',
     thr_lilly_ceo, 2,
     'Eli Lilly CFO appointed as interim CEO',
     '2025-09-03',
     'The board appointed the current CFO as interim CEO while a formal search is conducted. The interim CEO signaled continuity in the cardiovascular and obesity pipeline strategy.',
     'low',
     array['interim CEO', 'executive change'],
     uid);

  insert into public.events (id, space_id, company_id, category_id, thread_id, thread_order, title, event_date, description, priority, tags, created_by) values
    (ev_lilly_new_ceo, p_space_id, c_lilly,
     'e0000000-0000-0000-0000-000000000001',
     thr_lilly_ceo, 3,
     'Eli Lilly appoints new CEO from Roche',
     '2025-12-10',
     'Board announces appointment of former Roche Pharma CEO. New leadership expected to accelerate the cardiovascular pipeline and expand the obesity franchise.',
     'high',
     array['CEO appointment', 'executive change', 'Roche'],
     uid);

  -- Strategic: Novo acquisition
  insert into public.events (id, space_id, company_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_novo_acquisition, p_space_id, c_novo,
     'e0000000-0000-0000-0000-000000000004',
     'Novo Nordisk acquires cardiac biotech for $3.2B',
     '2025-10-20',
     'Novo Nordisk announced acquisition of a private biotech with a Phase 2 cardiac myosin inhibitor. The deal is seen as a hedge against emerging competition in the GLP-1 heart failure space.',
     'high',
     array['M&A', 'acquisition', 'cardiac myosin'],
     uid);

  -- Leadership: Pfizer reorg
  insert into public.events (id, space_id, company_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_pfizer_reorg, p_space_id, c_pfizer,
     'e0000000-0000-0000-0000-000000000001',
     'Pfizer announces major R&D reorganization',
     '2025-08-15',
     'Pfizer restructures R&D into three therapeutic pillars. Cardiovascular moves under the "Specialty Care" division. Head of CV R&D departs; replacement to be named.',
     'low',
     array['reorganization', 'R&D leadership', 'specialty care'],
     uid);

  -- Financial: AZ earnings
  insert into public.events (id, space_id, company_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_az_earnings, p_space_id, c_az,
     'e0000000-0000-0000-0000-000000000003',
     'AstraZeneca Q3 earnings: Farxiga franchise beats estimates by 12%',
     '2025-10-28',
     'Q3 2025 earnings report showed Farxiga franchise revenue at $2.1B, beating consensus by 12%. Management raised full-year guidance and highlighted HF as the fastest-growing indication.',
     'low',
     array['earnings', 'Q3 2025', 'revenue beat', 'Farxiga'],
     uid);

  -- Strategic: Bayer patent
  insert into public.events (id, space_id, company_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_bayer_patent, p_space_id, c_bayer,
     'e0000000-0000-0000-0000-000000000004',
     'Bayer granted key patent extension for finerenone (Kerendia)',
     '2025-07-22',
     'USPTO granted Bayer a 2-year patent term extension for finerenone, extending exclusivity to 2031. This delays generic entry and strengthens the commercial outlook for the HF indication expansion.',
     'low',
     array['patent extension', 'IP', 'generic delay'],
     uid);

  -- Strategic: Merck partnership
  insert into public.events (id, space_id, company_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_merck_partner, p_space_id, c_merck,
     'e0000000-0000-0000-0000-000000000004',
     'Merck enters co-development agreement with Alnylam for siRNA heart failure candidate',
     '2025-06-05',
     'Merck and Alnylam announced a co-development deal for an siRNA therapeutic targeting TTR in heart failure. Merck to fund Phase 2 and share 50/50 US rights.',
     'low',
     array['partnership', 'co-development', 'Alnylam', 'siRNA'],
     uid);

  -- ---- PRODUCT-LEVEL events ----

  -- Commercial: Farxiga manufacturing
  insert into public.events (id, space_id, product_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_farxiga_mfg, p_space_id, p_farxiga,
     'e0000000-0000-0000-0000-000000000006',
     'Farxiga manufacturing capacity expansion announced',
     '2025-09-10',
     'AstraZeneca announced a $500M investment in a new manufacturing facility in Ireland for dapagliflozin to meet growing HF demand. Expected online Q2 2027.',
     'low',
     array['manufacturing', 'capacity expansion', 'Ireland'],
     uid);

  -- Regulatory: Jardiance label
  insert into public.events (id, space_id, product_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_jardiance_label, p_space_id, p_jardiance,
     'e0000000-0000-0000-0000-000000000002',
     'FDA advisory committee recommends expanded Jardiance label for CKD',
     '2025-11-02',
     'ADCOM voted 14-2 in favor of expanding the Jardiance label to include CKD as a standalone indication. PDUFA date set for Q1 2026.',
     'high',
     array['ADCOM', 'label expansion', 'CKD', 'PDUFA'],
     uid);

  -- Commercial: Ozempic supply thread
  insert into public.events (id, space_id, product_id, category_id, thread_id, thread_order, title, event_date, description, priority, tags, created_by) values
    (ev_ozempic_shortage, p_space_id, p_ozempic,
     'e0000000-0000-0000-0000-000000000006',
     thr_ozempic_supply, 1,
     'Novo Nordisk confirms Ozempic supply constraints in US market',
     '2025-08-01',
     'Novo Nordisk confirmed that Ozempic supply in the US will be constrained for 3-6 months due to API manufacturing delays at the Kalundborg facility. Some dose strengths unavailable.',
     'high',
     array['supply shortage', 'manufacturing delay', 'Kalundborg'],
     uid);

  -- Commercial: Mounjaro payer
  insert into public.events (id, space_id, product_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_mounjaro_payer, p_space_id, p_mounjaro,
     'e0000000-0000-0000-0000-000000000006',
     'UnitedHealthcare adds Mounjaro to preferred formulary for T2D and obesity',
     '2025-07-15',
     'UHC formulary update effective Jan 2026 adds tirzepatide as preferred brand over semaglutide for both T2D and obesity. Estimated to cover 40M additional lives.',
     'high',
     array['formulary', 'payer decision', 'UnitedHealthcare', 'preferred brand'],
     uid);

  -- ---- TRIAL-LEVEL events ----

  -- Clinical: DAPA-HF endpoint
  insert into public.events (id, space_id, trial_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_dapahf_endpoint, p_space_id, t1,
     'e0000000-0000-0000-0000-000000000005',
     'DAPA-HF post-hoc analysis reveals mortality benefit in NYHA Class IV subgroup',
     '2025-10-05',
     'New post-hoc analysis presented at HFSA 2025 showed statistically significant mortality reduction in NYHA Class IV patients, a subgroup not previously powered to show benefit.',
     'low',
     array['post-hoc analysis', 'mortality', 'NYHA Class IV', 'HFSA 2025'],
     uid);

  -- Clinical: EMPEROR safety signal
  insert into public.events (id, space_id, trial_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_emperor_safety, p_space_id, t4,
     'e0000000-0000-0000-0000-000000000005',
     'EMPEROR-Preserved long-term extension: no new safety signals at 3-year follow-up',
     '2025-09-20',
     'Long-term extension data from EMPEROR-Preserved confirms sustained efficacy and no new safety signals at 3-year follow-up. Published in NEJM.',
     'low',
     array['long-term data', 'safety', 'NEJM', 'extension study'],
     uid);

  -- Clinical: SOUL-HF protocol amendment
  insert into public.events (id, space_id, trial_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_sema_hf_protocol, p_space_id, tl_sema_hf,
     'e0000000-0000-0000-0000-000000000005',
     'SOUL-HF protocol amendment increases sample size by 15%',
     '2025-11-28',
     'Novo Nordisk filed a protocol amendment for SOUL-HF increasing the sample size from 9,600 to 11,000 patients. The amendment extends the expected primary completion date to H2 2027.',
     'high',
     array['protocol amendment', 'sample size increase', 'timeline delay'],
     uid);

  -- Regulatory: BI CRL
  insert into public.events (id, space_id, trial_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_bi_crl, p_space_id, tl_bi_alt,
     'e0000000-0000-0000-0000-000000000002',
     'FDA issues Complete Response Letter for BI cardiac myosin inhibitor',
     '2025-12-18',
     'FDA issued a CRL for BI-Alt citing manufacturing deficiencies at the API facility. No efficacy or safety concerns raised. BI expects to resubmit within 6 months.',
     'high',
     array['CRL', 'complete response letter', 'manufacturing', 'resubmission'],
     uid);

  -- Strategic: GSK divestiture
  insert into public.events (id, space_id, company_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_gsk_divest, p_space_id, c_gsk,
     'e0000000-0000-0000-0000-000000000004',
     'GSK evaluating strategic options for cardiovascular portfolio',
     '2025-11-05',
     'GSK CEO confirmed in earnings call that the company is evaluating strategic options for its early-stage cardiovascular assets, including potential divestiture or out-licensing.',
     'low',
     array['divestiture', 'strategic review', 'portfolio rationalization'],
     uid);

  -- Regulatory: Sanofi priority review
  insert into public.events (id, space_id, trial_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_sanofi_priority, p_space_id, tl_sanofi_piv,
     'e0000000-0000-0000-0000-000000000002',
     'Sanofi granted FDA Breakthrough Therapy designation for HF candidate',
     '2025-10-12',
     'FDA granted Breakthrough Therapy designation to Sanofi-Pivotal for treatment of advanced heart failure based on Phase 2 data showing 40% reduction in HF hospitalization.',
     'high',
     array['breakthrough therapy', 'BTD', 'Phase 2 data'],
     uid);

  -- Commercial: Pfizer Vyndaqel generic threat
  insert into public.events (id, space_id, product_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_pfizer_vynda_gen, p_space_id, p_pfe_vynda,
     'e0000000-0000-0000-0000-000000000006',
     'Teva files ANDA for generic tafamidis; Pfizer initiates patent litigation',
     '2025-08-20',
     'Teva filed an ANDA for generic tafamidis (Vyndaqel). Pfizer initiated patent infringement litigation under Hatch-Waxman, triggering a 30-month stay. Earliest generic entry estimated 2028.',
     'low',
     array['ANDA', 'generic challenge', 'Teva', 'patent litigation', 'Hatch-Waxman'],
     uid);

  -- ==========================================================================
  -- EVENT SOURCES
  -- ==========================================================================
  insert into public.event_sources (event_id, url, label) values
    (ev_fda_guidance,     'https://www.fda.gov/regulatory-information/search-fda-guidance-documents', 'FDA Guidance Documents'),
    (ev_lilly_ceo,        'https://investor.lilly.com/press-releases',    'Lilly Press Release'),
    (ev_lilly_ceo,        'https://www.reuters.com/business/healthcare-pharmaceuticals', 'Reuters Coverage'),
    (ev_lilly_new_ceo,    'https://investor.lilly.com/press-releases',    'Lilly Press Release'),
    (ev_novo_acquisition, 'https://www.novonordisk.com/news-and-media.html', 'Novo Nordisk News'),
    (ev_novo_acquisition, 'https://www.sec.gov/cgi-bin/browse-edgar',       'SEC Filing'),
    (ev_az_earnings,      'https://www.astrazeneca.com/investor-relations.html', 'AZ Investor Relations'),
    (ev_jardiance_label,  'https://www.fda.gov/advisory-committees',       'FDA ADCOM Materials'),
    (ev_ozempic_shortage, 'https://www.fda.gov/drugs/drug-shortages',      'FDA Drug Shortages'),
    (ev_mounjaro_payer,   'https://www.uhc.com/pharmacy-resources',        'UHC Formulary Update'),
    (ev_bi_crl,           'https://www.boehringer-ingelheim.com/press',    'BI Press Release'),
    (ev_sanofi_priority,  'https://www.fda.gov/patients/fast-track-breakthrough-therapy-accelerated-approval-priority-review', 'FDA BTD Announcement'),
    (ev_pfizer_vynda_gen, 'https://www.accessdata.fda.gov/scripts/cder/ob/', 'FDA Orange Book');

  -- ==========================================================================
  -- EVENT LINKS (ad-hoc cross-cutting relationships)
  -- ==========================================================================

  -- Lilly CEO change linked to Pfizer reorg (both leadership disruptions)
  insert into public.event_links (source_event_id, target_event_id, created_by) values
    (ev_lilly_ceo, ev_pfizer_reorg, uid);

  -- Novo acquisition linked to BI CRL (both in cardiac myosin space)
  insert into public.event_links (source_event_id, target_event_id, created_by) values
    (ev_novo_acquisition, ev_bi_crl, uid);

  -- Ozempic shortage linked to Mounjaro payer win (competitive dynamics)
  insert into public.event_links (source_event_id, target_event_id, created_by) values
    (ev_ozempic_shortage, ev_mounjaro_payer, uid);

  -- FDA guidance linked to Sanofi breakthrough (regulatory pathway relevance)
  insert into public.event_links (source_event_id, target_event_id, created_by) values
    (ev_fda_guidance, ev_sanofi_priority, uid);

  -- GSK divestiture linked to Novo acquisition (strategic moves in same space)
  insert into public.event_links (source_event_id, target_event_id, created_by) values
    (ev_gsk_divest, ev_novo_acquisition, uid);

end;
$$;

comment on function public.seed_demo_data(uuid) is
  'Seeds a new space with a rich competitive landscape fixture: nine companies, ~20 products '
  'in the Heart Failure therapeutic area, representative markers, notifications, and a '
  'comprehensive set of events covering all entity levels (space, company, product, trial), '
  'all six event categories, threads, ad-hoc links, sources, tags, and both priorities.';
