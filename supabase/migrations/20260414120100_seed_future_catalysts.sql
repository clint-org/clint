-- migration: 20260414120100_seed_future_catalysts
-- purpose: add future-dated markers to seed_demo_data so the Key Catalysts
--          page has data to display. Appends a block of upcoming markers
--          across multiple trials and marker categories.
-- affected objects: public.seed_demo_data (function replaced)

-- We re-create the entire function. The body is identical to the previous
-- version (20260412130300) with an additional block at the end that inserts
-- future-dated markers for the Key Catalysts page.

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
  p_novo_early       uuid := gen_random_uuid();
  p_merck_probe      uuid := gen_random_uuid();
  p_merck_early      uuid := gen_random_uuid();
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
  moa_mra                uuid := gen_random_uuid();
  moa_ttr                uuid := gen_random_uuid();
  moa_undisclosed        uuid := gen_random_uuid();

  -- ------------------------- ROAs -------------------------
  roa_oral   uuid := gen_random_uuid();
  roa_sc     uuid := gen_random_uuid();
  roa_iv     uuid := gen_random_uuid();

  -- marker IDs referenced by marker_assignments and notifications
  m_t1_data_reported uuid := gen_random_uuid();
  m_t1_reg_filing    uuid := gen_random_uuid();
  m_t4_data_reported uuid := gen_random_uuid();
  m_t4_reg_filing    uuid := gen_random_uuid();
  m_t6_reg_proj      uuid := gen_random_uuid();

begin
  -- ==========================================================================
  -- Companies
  -- ==========================================================================
  insert into public.companies (id, space_id, created_by, name, logo_url, display_order) values
    (c_az,     p_space_id, uid, 'AstraZeneca',        'https://cdn.brandfetch.io/astrazeneca.com/w/512/h/512/logo',    1),
    (c_lilly,  p_space_id, uid, 'Eli Lilly',          'https://cdn.brandfetch.io/lilly.com/w/512/h/512/logo',          2),
    (c_novo,   p_space_id, uid, 'Novo Nordisk',       'https://cdn.brandfetch.io/novonordisk.com/w/512/h/512/logo',    3),
    (c_merck,  p_space_id, uid, 'Merck',              'https://cdn.brandfetch.io/merck.com/w/512/h/512/logo',          4),
    (c_pfizer, p_space_id, uid, 'Pfizer',             'https://cdn.brandfetch.io/pfizer.com/w/512/h/512/logo',         5),
    (c_bayer,  p_space_id, uid, 'Bayer',              'https://cdn.brandfetch.io/bayer.com/w/512/h/512/logo',          6),
    (c_bi,     p_space_id, uid, 'Boehringer Ingelheim','https://cdn.brandfetch.io/boehringer-ingelheim.com/w/512/h/512/logo', 7),
    (c_sanofi, p_space_id, uid, 'Sanofi',             'https://cdn.brandfetch.io/sanofi.com/w/512/h/512/logo',         8),
    (c_gsk,    p_space_id, uid, 'GSK',                'https://cdn.brandfetch.io/gsk.com/w/512/h/512/logo',            9);

  -- ==========================================================================
  -- Products
  -- ==========================================================================
  insert into public.products (id, space_id, created_by, company_id, name, generic_name, display_order) values
    (p_farxiga,        p_space_id, uid, c_az,     'Farxiga',        'Dapagliflozin',  1),
    (p_jardiance,      p_space_id, uid, c_lilly,  'Jardiance',      'Empagliflozin',  2),
    (p_mounjaro,       p_space_id, uid, c_lilly,  'Mounjaro',       'Tirzepatide',    3),
    (p_ozempic,        p_space_id, uid, c_novo,   'Ozempic',        'Semaglutide',    4),
    (p_az_early,       p_space_id, uid, c_az,     'AZD4831',        null,             5),
    (p_lly_early,      p_space_id, uid, c_lilly,  'LY-Early',       null,             6),
    (p_novo_early,     p_space_id, uid, c_novo,   'Novo-Early',     null,             7),
    (p_merck_probe,    p_space_id, uid, c_merck,  'MRK-Probe',      null,             8),
    (p_merck_early,    p_space_id, uid, c_merck,  'MRK-Early',      null,             9),
    (p_pfe_next,       p_space_id, uid, c_pfizer, 'PF-Next',        null,            10),
    (p_pfe_early,      p_space_id, uid, c_pfizer, 'PF-Early',       null,            11),
    (p_bayer_kerendia, p_space_id, uid, c_bayer,  'Kerendia',       'Finerenone',    12),
    (p_bayer_mid,      p_space_id, uid, c_bayer,  'BAY-Mid',        null,            13),
    (p_bi_alt,         p_space_id, uid, c_bi,     'BI-Alt',         null,            14),
    (p_bi_preclin,     p_space_id, uid, c_bi,     'BI-Early',       null,            15),
    (p_sanofi_piv,     p_space_id, uid, c_sanofi, 'Sanofi-Piv',     null,            16),
    (p_sanofi_probe,   p_space_id, uid, c_sanofi, 'Sanofi-Probe',   null,            17),
    (p_gsk_cand,       p_space_id, uid, c_gsk,    'GSK-Cand',       null,            18),
    (p_gsk_early,      p_space_id, uid, c_gsk,    'GSK-Early',      null,            19);

  -- ==========================================================================
  -- Therapeutic Areas
  -- ==========================================================================
  insert into public.therapeutic_areas (id, space_id, created_by, name, abbreviation) values
    (ta_hf,      p_space_id, uid, 'Heart Failure',     'HF'),
    (ta_ckd,     p_space_id, uid, 'Chronic Kidney Disease', 'CKD'),
    (ta_t2d,     p_space_id, uid, 'Type 2 Diabetes',   'T2D'),
    (ta_obesity, p_space_id, uid, 'Obesity',            'OB');

  -- ==========================================================================
  -- MOAs
  -- ==========================================================================
  insert into public.mechanisms_of_action (id, space_id, created_by, name, abbreviation) values
    (moa_sglt2,       p_space_id, uid, 'SGLT2 Inhibitor',        'SGLT2i'),
    (moa_glp1,        p_space_id, uid, 'GLP-1 Receptor Agonist', 'GLP-1 RA'),
    (moa_glp1_gip,    p_space_id, uid, 'GLP-1/GIP Dual Agonist', 'GLP-1/GIP'),
    (moa_sgc,         p_space_id, uid, 'sGC Stimulator',         'sGC'),
    (moa_mra,         p_space_id, uid, 'Mineralocorticoid Receptor Antagonist', 'MRA'),
    (moa_ttr,         p_space_id, uid, 'TTR Stabilizer',         'TTR'),
    (moa_undisclosed, p_space_id, uid, 'Undisclosed',             null);

  -- product-MOA links
  insert into public.product_mechanisms_of_action (product_id, moa_id) values
    (p_farxiga,   moa_sglt2),
    (p_jardiance, moa_sglt2),
    (p_mounjaro,  moa_glp1_gip),
    (p_ozempic,   moa_glp1),
    (p_bayer_kerendia, moa_mra);

  -- ==========================================================================
  -- ROAs
  -- ==========================================================================
  insert into public.routes_of_administration (id, space_id, created_by, name, abbreviation) values
    (roa_oral, p_space_id, uid, 'Oral',          'PO'),
    (roa_sc,   p_space_id, uid, 'Subcutaneous',  'SC'),
    (roa_iv,   p_space_id, uid, 'Intravenous',   'IV');

  -- product-ROA links
  insert into public.product_routes_of_administration (product_id, roa_id) values
    (p_farxiga,   roa_oral),
    (p_jardiance, roa_oral),
    (p_mounjaro,  roa_sc),
    (p_ozempic,   roa_sc),
    (p_bayer_kerendia, roa_oral);

  -- ==========================================================================
  -- Trials (existing timeline)
  -- ==========================================================================
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order, phase, start_date, primary_completion_date) values
    (t1, p_space_id, uid, p_farxiga,   ta_hf,  'DAPA-HF',              'NCT03036124', 4744,  'Completed',  1, 'P3',  '2017-04-18', '2019-09-30'),
    (t2, p_space_id, uid, p_farxiga,   ta_ckd, 'DAPA-CKD',             'NCT03036150', 4304,  'Completed',  2, 'P3',  '2017-02-02', '2020-06-30'),
    (t3, p_space_id, uid, p_farxiga,   ta_hf,  'DELIVER',              'NCT03619213', 6263,  'Completed',  3, 'P3',  '2018-08-06', '2022-05-31'),
    (t4, p_space_id, uid, p_jardiance, ta_hf,  'EMPEROR-Preserved',    'NCT03057977', 5988,  'Completed',  4, 'P3',  '2017-03-28', '2021-04-30'),
    (t5, p_space_id, uid, p_jardiance, ta_hf,  'EMPEROR-Reduced',      'NCT03057951', 3730,  'Completed',  5, 'P3',  '2017-06-06', '2020-05-31'),
    (t6, p_space_id, uid, p_jardiance, ta_ckd, 'EMPA-KIDNEY',          'NCT03594110', 6609,  'Completed',  6, 'P3',  '2019-05-15', '2022-11-30'),
    (t7, p_space_id, uid, p_mounjaro,  ta_t2d, 'SURPASS-2',            'NCT03987919', 1879,  'Completed',  7, 'P3',  '2019-09-25', '2021-02-15'),
    (t8, p_space_id, uid, p_ozempic,   ta_obesity, 'STEP 1',           'NCT03548935', 1961,  'Completed',  8, 'P3',  '2018-06-04', '2020-10-31');

  -- ==========================================================================
  -- Trials (landscape -- HF competitive landscape)
  -- ==========================================================================
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order, phase, start_date, primary_completion_date) values
    (tl_az_early,     p_space_id, uid, p_az_early,       ta_hf, 'AZ-Early HF',          null,            80,  'Active',    1, 'P1',       '2025-01-01', null),
    (tl_lly_early,    p_space_id, uid, p_lly_early,      ta_hf, 'LY-Early HF',          null,            60,  'Active',    1, 'P1',       '2024-09-01', null),
    (tl_sema_hf,      p_space_id, uid, p_ozempic,        ta_hf, 'SELECT-HF',            'NCT04916470', 5000,  'Active',    1, 'P3',       '2021-09-01', null),
    (tl_novo_early,   p_space_id, uid, p_novo_early,     ta_hf, 'Novo-Early HF',        null,            45,  'Active',    1, 'PRECLIN',  '2025-06-01', null),
    (tl_verquvo,      p_space_id, uid, p_merck_probe,    ta_hf, 'VICTORIA',             'NCT02861534', 5050,  'Completed', 1, 'APPROVED', '2016-12-01', null),
    (tl_merck_probe,  p_space_id, uid, p_merck_probe,    ta_hf, 'MRK-Probe HF',         null,          3000,  'Active',    1, 'P3',       '2022-06-01', null),
    (tl_merck_early,  p_space_id, uid, p_merck_early,    ta_hf, 'MRK-Early HF',         null,           200,  'Active',    1, 'P2',       '2024-05-01', null),
    (tl_vynda,        p_space_id, uid, p_pfe_next,       ta_hf, 'ATTR-ACT',             'NCT01994889', 441,   'Completed', 1, 'LAUNCHED', '2014-01-01', null),
    (tl_pfe_next,     p_space_id, uid, p_pfe_next,       ta_hf, 'PF-Next HF',           null,          2000,  'Active',    1, 'P3',       '2023-03-01', null),
    (tl_pfe_early,    p_space_id, uid, p_pfe_early,      ta_hf, 'PF-Early HF',          null,           150,  'Active',    1, 'P1',       '2024-01-01', null),
    (tl_kerendia,     p_space_id, uid, p_bayer_kerendia, ta_hf, 'FINEARTS-HF',         'NCT04435626', 6016,  'Completed', 1, 'APPROVED', '2021-07-09', null),
    (tl_bayer_mid,    p_space_id, uid, p_bayer_mid,      ta_hf, 'BAY-Mid HF',          null,          2400,  'Active',    1, 'P3',       '2023-02-01', null),
    (tl_bi_alt,       p_space_id, uid, p_bi_alt,         ta_hf, 'BI-Alt HF',           null,           900,  'Active',    1, 'P2',       '2023-10-01', null),
    (tl_bi_preclin,   p_space_id, uid, p_bi_preclin,     ta_hf, 'BI-Early HF',         null,            40,  'Active',    1, 'PRECLIN',  '2025-02-01', null),
    (tl_sanofi_piv,   p_space_id, uid, p_sanofi_piv,     ta_hf, 'Sanofi Pivotal HF',   null,          3200,  'Active',    1, 'P3',       '2021-06-01', null),
    (tl_sanofi_probe, p_space_id, uid, p_sanofi_probe,   ta_hf, 'Sanofi Probe HF',     null,          1400,  'Active',    1, 'P2',       '2023-04-01', null),
    (tl_gsk_cand,     p_space_id, uid, p_gsk_cand,       ta_hf, 'GSK Candidate HF',    null,           180,  'Active',    1, 'P1',       '2024-03-01', null),
    (tl_gsk_early,    p_space_id, uid, p_gsk_early,      ta_hf, 'GSK Early HF',        null,            50,  'Active',    1, 'PRECLIN',  '2025-04-01', null);

  -- ==========================================================================
  -- Markers for existing timeline trials
  -- projection = 'company' replaces is_projected = true
  -- projection = 'actual'  replaces is_projected = false
  -- ==========================================================================

  -- t1: DAPA-HF markers
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, end_date) values
    (m_t1_data_reported, p_space_id, uid,
      'a0000000-0000-0000-0000-000000000002', 'DAPA-HF primary results presented at ESC 2019',    'actual',  '2019-09-19', null),
    (m_t1_reg_filing,    p_space_id, uid,
      'a0000000-0000-0000-0000-000000000004', 'sNDA submitted to FDA for HFrEF',                  'actual',  '2020-05-05', null),
    (gen_random_uuid(),  p_space_id, uid,
      'a0000000-0000-0000-0000-000000000008', 'Primary completion',                               'actual',  '2019-09-30', null),
    (gen_random_uuid(),  p_space_id, uid,
      'a0000000-0000-0000-0000-000000000009', 'Primary completion date moved earlier from Q4 to Q3 2019', 'actual', '2019-06-01', null);

  insert into public.marker_assignments (marker_id, trial_id) values
    (m_t1_data_reported, t1),
    (m_t1_reg_filing,    t1),
    ((select id from public.markers where space_id = p_space_id and title = 'Primary completion' and event_date = '2019-09-30'), t1),
    ((select id from public.markers where space_id = p_space_id and title = 'Primary completion date moved earlier from Q4 to Q3 2019'), t1);

  -- t2: DAPA-CKD markers
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, end_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000002', 'DAPA-CKD top-line results announced',         'actual',  '2020-09-24', null),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000004', 'sNDA submitted for CKD',                      'actual',  '2021-02-15', null),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000008', 'DAPA-CKD primary completion',                 'actual',  '2020-06-30', null);

  insert into public.marker_assignments (marker_id, trial_id)
    select id, t2 from public.markers
    where space_id = p_space_id
      and title in (
        'DAPA-CKD top-line results announced',
        'sNDA submitted for CKD',
        'DAPA-CKD primary completion'
      );

  -- t4: EMPEROR-Preserved markers
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, end_date) values
    (m_t4_data_reported, p_space_id, uid,
      'a0000000-0000-0000-0000-000000000002', 'EMPEROR-Preserved results presented at ESC 2021',  'actual',  '2021-08-27', null),
    (m_t4_reg_filing,    p_space_id, uid,
      'a0000000-0000-0000-0000-000000000004', 'sNDA submitted for HFpEF',                         'actual',  '2022-02-24', null);

  insert into public.marker_assignments (marker_id, trial_id) values
    (m_t4_data_reported, t4),
    (m_t4_reg_filing,    t4);

  -- t6: EMPA-KIDNEY markers
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, end_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000002', 'EMPA-KIDNEY results presented at ASN 2022',   'actual',  '2022-11-04', null),
    (m_t6_reg_proj,     p_space_id, uid,
      'a0000000-0000-0000-0000-000000000004', 'EMPA-KIDNEY regulatory filing projected',     'company', '2023-01-15', null);

  insert into public.marker_assignments (marker_id, trial_id)
    select id, t6 from public.markers
    where space_id = p_space_id
      and title in (
        'EMPA-KIDNEY results presented at ASN 2022',
        'EMPA-KIDNEY regulatory filing projected'
      );

  -- ==========================================================================
  -- Markers for landscape trials (historical)
  -- ==========================================================================

  -- tl_sema_hf: SELECT-HF
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000001', 'SELECT-HF enrollment complete',        'actual', '2024-03-15');

  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_sema_hf from public.markers
    where space_id = p_space_id
      and title = 'SELECT-HF enrollment complete';

  -- tl_kerendia: FINEARTS-HF
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000013', 'FINEARTS-HF topline data', 'actual', '2024-05-13'),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000032', 'Kerendia sNDA submitted for HFmrEF/HFpEF', 'actual', '2024-09-20');

  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_kerendia from public.markers
    where space_id = p_space_id
      and title in (
        'FINEARTS-HF topline data',
        'Kerendia sNDA submitted for HFmrEF/HFpEF'
      );

  -- ==========================================================================
  -- FUTURE-DATED CATALYSTS
  -- Upcoming markers across multiple trials for the Key Catalysts page.
  -- All dates are relative to mid-2026 onward.
  -- ==========================================================================

  -- SELECT-HF (Novo/Semaglutide): upcoming data + regulatory
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000013', 'SELECT-HF topline data readout',            'company', '2026-04-18'),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000008', 'SELECT-HF primary completion date',          'company', '2026-06-15'),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000032', 'Ozempic HF sNDA filing projected',           'company', '2026-09-01');

  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_sema_hf from public.markers
    where space_id = p_space_id
      and title in (
        'SELECT-HF topline data readout',
        'SELECT-HF primary completion date',
        'Ozempic HF sNDA filing projected'
      );

  -- MRK-Probe HF (Merck): upcoming data
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000030', 'MRK-Probe interim analysis at AHA 2026',     'company', '2026-05-10'),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000013', 'MRK-Probe P3 topline results projected',     'company', '2026-11-01');

  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_merck_probe from public.markers
    where space_id = p_space_id
      and title in (
        'MRK-Probe interim analysis at AHA 2026',
        'MRK-Probe P3 topline results projected'
      );

  -- Sanofi Pivotal HF: upcoming data + regulatory
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000013', 'Sanofi Pivotal HF topline results',          'company', '2026-07-15'),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000032', 'Sanofi HF regulatory filing projected',      'company', '2027-01-15');

  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_sanofi_piv from public.markers
    where space_id = p_space_id
      and title in (
        'Sanofi Pivotal HF topline results',
        'Sanofi HF regulatory filing projected'
      );

  -- PF-Next HF (Pfizer): upcoming data
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000030', 'PF-Next interim data at ESC 2026',           'company', '2026-04-28'),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000008', 'PF-Next primary completion projected',       'company', '2026-12-01');

  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_pfe_next from public.markers
    where space_id = p_space_id
      and title in (
        'PF-Next interim data at ESC 2026',
        'PF-Next primary completion projected'
      );

  -- BAY-Mid HF (Bayer): upcoming regulatory + approval
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000033', 'BAY-Mid NDA submission projected',            'company', '2026-05-20'),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000034', 'BAY-Mid FDA acceptance projected',             'company', '2026-08-01'),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000035', 'BAY-Mid PDUFA date projected',                'company', '2027-03-01');

  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_bayer_mid from public.markers
    where space_id = p_space_id
      and title in (
        'BAY-Mid NDA submission projected',
        'BAY-Mid FDA acceptance projected',
        'BAY-Mid PDUFA date projected'
      );

  -- BI-Alt HF (Boehringer Ingelheim): upcoming data
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000013', 'BI-Alt P2 topline data projected',            'company', '2026-06-01');

  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_bi_alt from public.markers
    where space_id = p_space_id
      and title = 'BI-Alt P2 topline data projected';

  -- Kerendia (Bayer): LOE
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000020', 'Kerendia US patent expiry',                   'actual',  '2027-07-15');

  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_kerendia from public.markers
    where space_id = p_space_id
      and title = 'Kerendia US patent expiry';

  -- GSK Candidate HF: upcoming Phase 1 completion
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000008', 'GSK Candidate P1 completion projected',      'company', '2026-09-30');

  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_gsk_cand from public.markers
    where space_id = p_space_id
      and title = 'GSK Candidate P1 completion projected';

  -- Farxiga (AZ): LOE
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000020', 'Farxiga US LOE projected',                   'actual',  '2027-10-01'),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000021', 'Farxiga generic entry expected',              'company', '2027-12-01');

  insert into public.marker_assignments (marker_id, trial_id)
    select id, t1 from public.markers
    where space_id = p_space_id
      and title in (
        'Farxiga US LOE projected',
        'Farxiga generic entry expected'
      );

  -- ==========================================================================
  -- Marker notifications (keep existing pattern)
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

end;
$$;
