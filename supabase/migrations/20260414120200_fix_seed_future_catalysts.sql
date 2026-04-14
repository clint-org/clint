-- migration: 20260414120200_fix_seed_future_catalysts
-- purpose: restore public.seed_demo_data() to the correct implementation from
--          20260412130300_update_seed_demo_for_marker_redesign and append
--          future-dated catalyst markers for the Key Catalysts page.
--          The previous migration 20260414120100 replaced the function with a
--          broken version (wrong column names, missing products, missing MOAs/ROAs).
-- affected objects: public.seed_demo_data (function replaced)

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
  -- kept for referencing in marker_notifications below
  m_t1_data_reported   uuid := gen_random_uuid();
  m_t1_reg_filing      uuid := gen_random_uuid();
  m_t4_data_reported   uuid := gen_random_uuid();
  m_t4_reg_filing      uuid := gen_random_uuid();
  m_t6_reg_proj        uuid := gen_random_uuid();

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
    (c_az,     p_space_id, uid, 'AstraZeneca',          'https://cdn.brandfetch.io/idJpLuJVA4/theme/dark/symbol.svg?c=1bxid64Mup7aczewSAYMX&t=1677288655682', 1),
    (c_lilly,  p_space_id, uid, 'Eli Lilly',            'https://cdn.brandfetch.io/idxr899feu/theme/dark/logo.svg?c=1bxid64Mup7aczewSAYMX&t=1667576418707',  2),
    (c_novo,   p_space_id, uid, 'Novo Nordisk',         'https://cdn.brandfetch.io/idzG7CuQEI/theme/dark/logo.svg?c=1bxid64Mup7aczewSAYMX&t=1668424247400',  3),
    (c_merck,  p_space_id, uid, 'Merck',                null, 4),
    (c_pfizer, p_space_id, uid, 'Pfizer',               null, 5),
    (c_bayer,  p_space_id, uid, 'Bayer',                null, 6),
    (c_bi,     p_space_id, uid, 'Boehringer Ingelheim', null, 7),
    (c_sanofi, p_space_id, uid, 'Sanofi',               null, 8),
    (c_gsk,    p_space_id, uid, 'GSK',                  null, 9);

  -- ==========================================================================
  -- Therapeutic areas
  -- ==========================================================================
  insert into public.therapeutic_areas (id, space_id, created_by, name, abbreviation) values
    (ta_hf,      p_space_id, uid, 'Heart Failure',         'HF'),
    (ta_ckd,     p_space_id, uid, 'Chronic Kidney Disease','CKD'),
    (ta_t2d,     p_space_id, uid, 'Type 2 Diabetes',       'T2D'),
    (ta_obesity, p_space_id, uid, 'Obesity',               'OB');

  -- ==========================================================================
  -- Products
  -- ==========================================================================
  insert into public.products (id, space_id, created_by, company_id, name, generic_name, display_order) values
    (p_farxiga,        p_space_id, uid, c_az,     'Farxiga',          'dapagliflozin', 1),
    (p_jardiance,      p_space_id, uid, c_lilly,  'Jardiance',        'empagliflozin', 1),
    (p_mounjaro,       p_space_id, uid, c_lilly,  'Mounjaro',         'tirzepatide',   2),
    (p_ozempic,        p_space_id, uid, c_novo,   'Ozempic',          'semaglutide',   1),
    (p_az_early,       p_space_id, uid, c_az,     'AZD-Early',        null,            2),
    (p_lly_early,      p_space_id, uid, c_lilly,  'LY-Early',         null,            3),
    (p_novo_sema_hf,   p_space_id, uid, c_novo,   'Semaglutide-HF',   'semaglutide',   2),
    (p_novo_early,     p_space_id, uid, c_novo,   'NVO-Early',        null,            3),
    (p_merck_verquvo,  p_space_id, uid, c_merck,  'Verquvo',          'vericiguat',    1),
    (p_merck_probe,    p_space_id, uid, c_merck,  'MRK-Probe',        null,            2),
    (p_merck_early,    p_space_id, uid, c_merck,  'MRK-Early',        null,            3),
    (p_pfe_vynda,      p_space_id, uid, c_pfizer, 'Vyndaqel',         'tafamidis',     1),
    (p_pfe_next,       p_space_id, uid, c_pfizer, 'PF-Next',          null,            2),
    (p_pfe_early,      p_space_id, uid, c_pfizer, 'PF-Early',         null,            3),
    (p_bayer_kerendia, p_space_id, uid, c_bayer,  'Kerendia',         'finerenone',    1),
    (p_bayer_mid,      p_space_id, uid, c_bayer,  'BAY-Mid',          null,            2),
    (p_bi_alt,         p_space_id, uid, c_bi,     'BI-Alt',           null,            1),
    (p_bi_preclin,     p_space_id, uid, c_bi,     'BI-Early',         null,            2),
    (p_sanofi_piv,     p_space_id, uid, c_sanofi, 'Sanofi-Pivotal',   null,            1),
    (p_sanofi_probe,   p_space_id, uid, c_sanofi, 'Sanofi-Probe',     null,            2),
    (p_gsk_cand,       p_space_id, uid, c_gsk,    'GSK-Candidate',    null,            1),
    (p_gsk_early,      p_space_id, uid, c_gsk,    'GSK-Early',        null,            2);

  -- ==========================================================================
  -- Mechanisms of action
  -- ==========================================================================
  insert into public.mechanisms_of_action (id, space_id, created_by, name, description, display_order) values
    (moa_sglt2,              p_space_id, uid, 'SGLT2 inhibitor',              'Blocks sodium-glucose co-transporter 2 in the kidney.', 1),
    (moa_glp1,               p_space_id, uid, 'GLP-1 agonist',               'Activates the GLP-1 receptor to increase insulin secretion.', 2),
    (moa_glp1_gip,           p_space_id, uid, 'GIP/GLP-1 dual agonist',      'Dual activation of GIP and GLP-1 receptors.', 3),
    (moa_sgc,                p_space_id, uid, 'sGC stimulator',              'Stimulates soluble guanylate cyclase to increase cGMP.', 4),
    (moa_ttr,                p_space_id, uid, 'TTR stabilizer',              'Stabilizes the transthyretin tetramer to prevent amyloid formation.', 5),
    (moa_nsmra,              p_space_id, uid, 'Non-steroidal MRA',           'Non-steroidal mineralocorticoid receptor antagonist.', 6),
    (moa_cardiac_myosin,     p_space_id, uid, 'Cardiac myosin modulator',    'Modulates cardiac myosin to improve contractility.', 7),
    (moa_ns_investigational, p_space_id, uid, 'Investigational (undisclosed)','Early-stage asset, target not yet disclosed.', 99);

  -- ==========================================================================
  -- Routes of administration
  -- ==========================================================================
  insert into public.routes_of_administration (id, space_id, created_by, name, abbreviation, display_order) values
    (roa_oral,        p_space_id, uid, 'Oral',          'PO',  1),
    (roa_iv,          p_space_id, uid, 'Intravenous',   'IV',  2),
    (roa_sc,          p_space_id, uid, 'Subcutaneous',  'SC',  3),
    (roa_inhaled,     p_space_id, uid, 'Inhaled',       'INH', 4),
    (roa_im,          p_space_id, uid, 'Intramuscular', 'IM',  5),
    (roa_topical,     p_space_id, uid, 'Topical',       'TOP', 6),
    (roa_intrathecal, p_space_id, uid, 'Intrathecal',   'IT',  7);

  -- ==========================================================================
  -- Product <-> MOA assignments
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
    (p_az_early,       moa_cardiac_myosin),
    (p_lly_early,      moa_cardiac_myosin),
    (p_novo_early,     moa_ns_investigational),
    (p_merck_probe,    moa_ns_investigational),
    (p_merck_early,    moa_ns_investigational),
    (p_pfe_next,       moa_sgc),
    (p_pfe_early,      moa_ns_investigational),
    (p_bayer_mid,      moa_nsmra),
    (p_bi_alt,         moa_ns_investigational),
    (p_bi_preclin,     moa_ns_investigational),
    (p_sanofi_piv,     moa_cardiac_myosin),
    (p_sanofi_probe,   moa_ns_investigational),
    (p_gsk_cand,       moa_ns_investigational),
    (p_gsk_early,      moa_ns_investigational);

  -- ==========================================================================
  -- Product <-> ROA assignments
  -- ==========================================================================
  insert into public.product_routes_of_administration (product_id, roa_id) values
    (p_farxiga,        roa_oral),
    (p_jardiance,      roa_oral),
    (p_merck_verquvo,  roa_oral),
    (p_pfe_vynda,      roa_oral),
    (p_bayer_kerendia, roa_oral),
    (p_az_early,       roa_oral),
    (p_lly_early,      roa_oral),
    (p_pfe_next,       roa_oral),
    (p_pfe_early,      roa_oral),
    (p_bayer_mid,      roa_oral),
    (p_bi_alt,         roa_oral),
    (p_bi_preclin,     roa_oral),
    (p_sanofi_piv,     roa_oral),
    (p_sanofi_probe,   roa_oral),
    (p_mounjaro,       roa_sc),
    (p_ozempic,        roa_sc),
    (p_novo_sema_hf,   roa_sc),
    (p_novo_early,     roa_sc),
    (p_mounjaro,       roa_oral),
    (p_merck_probe,    roa_iv),
    (p_merck_early,    roa_iv),
    (p_gsk_cand,       roa_inhaled),
    (p_gsk_early,      roa_inhaled),
    (p_bi_preclin,     roa_im),
    (p_sanofi_probe,   roa_topical),
    (p_bayer_mid,      roa_intrathecal);

  -- ==========================================================================
  -- Existing timeline trials
  -- Phase data is stored directly on the trial row using the highest/latest
  -- development phase. Trials that were approved or launched carry those
  -- phases; all others carry their active clinical phase.
  -- ==========================================================================
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order,
    phase_type, phase_start_date, phase_end_date) values
    -- t1: DAPA-HF -- reached approval/launch in 2020 (HFrEF)
    (t1, p_space_id, uid, p_farxiga,  ta_hf,      'DAPA-HF',              'NCT03036124', 4744, 'Completed', 1,  'LAUNCHED',  '2020-05-05', null),
    -- t2: DAPA-CKD -- P4 post-approval follow-up
    (t2, p_space_id, uid, p_farxiga,  ta_ckd,     'DAPA-CKD',             'NCT03036150', 4304, 'Completed', 2,  'P4',        '2021-06-01', '2024-12-31'),
    -- t3: DELIVER -- completed P3
    (t3, p_space_id, uid, p_farxiga,  ta_hf,      'DELIVER',              'NCT03619213', 6263, 'Completed', 3,  'P3',        '2018-08-01', '2022-05-31'),
    -- t4: EMPEROR-Preserved -- approved for HFpEF in 2022
    (t4, p_space_id, uid, p_jardiance, ta_hf,     'EMPEROR-Preserved',    'NCT03057977', 5988, 'Completed', 1,  'APPROVED',  '2022-02-24', null),
    -- t5: EMPEROR-Reduced -- completed P3
    (t5, p_space_id, uid, p_jardiance, ta_hf,     'EMPEROR-Reduced',      'NCT03057951', 3730, 'Completed', 2,  'P3',        '2017-03-01', '2020-06-30'),
    -- t6: EMPA-KIDNEY -- completed P3
    (t6, p_space_id, uid, p_jardiance, ta_ckd,    'EMPA-KIDNEY',          'NCT03594110', 6609, 'Completed', 3,  'P3',        '2019-05-01', '2022-11-30'),
    -- t7: SURPASS-1 -- completed P3
    (t7, p_space_id, uid, p_mounjaro, ta_t2d,     'SURPASS-1',            'NCT03954834',  478, 'Completed', 1,  'P3',        '2019-06-01', '2021-05-31'),
    -- t8: STEP 1 -- completed P3
    (t8, p_space_id, uid, p_ozempic,  ta_obesity, 'STEP 1',               'NCT03548935', 1961, 'Completed', 1,  'P3',        '2018-06-01', '2021-03-31');

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

  -- t3: DELIVER markers
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, end_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000001', 'DELIVER results expected at ESC 2022',        'company', '2022-08-01', null),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000002', 'DELIVER results presented at ESC 2022',       'actual',  '2022-08-26', null),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000008', 'DELIVER primary completion',                  'actual',  '2022-05-31', null);

  insert into public.marker_assignments (marker_id, trial_id)
    select id, t3 from public.markers
    where space_id = p_space_id
      and title in (
        'DELIVER results expected at ESC 2022',
        'DELIVER results presented at ESC 2022',
        'DELIVER primary completion'
      );

  -- t4: EMPEROR-Preserved markers
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, end_date) values
    (m_t4_data_reported, p_space_id, uid,
      'a0000000-0000-0000-0000-000000000002', 'EMPEROR-Preserved results presented at ESC 2021',  'actual',  '2021-08-27', null),
    (m_t4_reg_filing,    p_space_id, uid,
      'a0000000-0000-0000-0000-000000000004', 'sNDA submitted for HFpEF',                         'actual',  '2022-02-24', null),
    (gen_random_uuid(),  p_space_id, uid,
      'a0000000-0000-0000-0000-000000000005', 'FDA approval for HFpEF projected',                 'company', '2022-10-01', null),
    (gen_random_uuid(),  p_space_id, uid,
      'a0000000-0000-0000-0000-000000000006', 'Label updated to include HFpEF indication',        'actual',  '2022-06-15', null);

  insert into public.marker_assignments (marker_id, trial_id) values
    (m_t4_data_reported, t4),
    (m_t4_reg_filing,    t4),
    ((select id from public.markers where space_id = p_space_id and title = 'FDA approval for HFpEF projected'), t4),
    ((select id from public.markers where space_id = p_space_id and title = 'Label updated to include HFpEF indication'), t4);

  -- t5: EMPEROR-Reduced markers
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, end_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000002', 'EMPEROR-Reduced results presented at ESC 2020',    'actual',  '2020-06-29', null),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000004', 'sNDA submitted for HFrEF',                         'actual',  '2020-11-15', null),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000008', 'EMPEROR-Reduced primary completion',               'actual',  '2020-06-30', null),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000010', 'Planned pediatric filing no longer expected',       'actual',  '2021-06-01', null);

  insert into public.marker_assignments (marker_id, trial_id)
    select id, t5 from public.markers
    where space_id = p_space_id
      and title in (
        'EMPEROR-Reduced results presented at ESC 2020',
        'sNDA submitted for HFrEF',
        'EMPEROR-Reduced primary completion',
        'Planned pediatric filing no longer expected'
      );

  -- t6: EMPA-KIDNEY markers
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, end_date) values
    (gen_random_uuid(),  p_space_id, uid,
      'a0000000-0000-0000-0000-000000000002', 'EMPA-KIDNEY results presented at ASN 2022',        'actual',  '2022-11-04', null),
    (m_t6_reg_proj,      p_space_id, uid,
      'a0000000-0000-0000-0000-000000000003', 'EMPA-KIDNEY regulatory filing projected',          'company', '2023-03-01', null),
    (gen_random_uuid(),  p_space_id, uid,
      'a0000000-0000-0000-0000-000000000007', 'Estimated CKD launch window',                      'company', '2023-06-01', '2024-03-31');

  insert into public.marker_assignments (marker_id, trial_id)
    select id, t6 from public.markers
    where space_id = p_space_id
      and title in (
        'EMPA-KIDNEY results presented at ASN 2022',
        'EMPA-KIDNEY regulatory filing projected',
        'Estimated CKD launch window'
      );

  -- t7: SURPASS-1 markers
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, end_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000002', 'SURPASS-1 top-line results announced',             'actual',  '2021-05-28', null),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000004', 'Mounjaro NDA submitted to FDA',                    'actual',  '2022-05-13', null);

  insert into public.marker_assignments (marker_id, trial_id)
    select id, t7 from public.markers
    where space_id = p_space_id
      and title in (
        'SURPASS-1 top-line results announced',
        'Mounjaro NDA submitted to FDA'
      );

  -- t8: STEP 1 markers
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, end_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000002', 'STEP 1 published in NEJM',                        'actual',  '2021-02-10', null),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000004', 'sNDA submitted for obesity (Wegovy)',              'actual',  '2021-12-04', null),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000005', 'FDA approval for obesity projected',               'company', '2022-06-01', null);

  insert into public.marker_assignments (marker_id, trial_id)
    select id, t8 from public.markers
    where space_id = p_space_id
      and title in (
        'STEP 1 published in NEJM',
        'sNDA submitted for obesity (Wegovy)',
        'FDA approval for obesity projected'
      );

  -- ==========================================================================
  -- Trial notes
  -- ==========================================================================
  insert into public.trial_notes (id, space_id, created_by, trial_id, content) values
    (gen_random_uuid(), p_space_id, uid, t1, 'Landmark trial establishing SGLT2i in HFrEF. Changed treatment guidelines.'),
    (gen_random_uuid(), p_space_id, uid, t2, 'First SGLT2i approved for CKD regardless of diabetes status.'),
    (gen_random_uuid(), p_space_id, uid, t4, 'First positive trial for HFpEF. Major unmet need addressed.'),
    (gen_random_uuid(), p_space_id, uid, t8, 'Demonstrated ~15% body weight reduction. Pivotal for obesity indication.');

  -- ==========================================================================
  -- Landscape trials (Heart Failure)
  -- Each trial carries a single phase_type representing its highest/current
  -- development stage. Trials with multiple historical phases are reduced to
  -- the latest phase that represents their competitive position.
  -- ==========================================================================
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order,
    phase_type, phase_start_date, phase_end_date) values
    (tl_az_early,     p_space_id, uid, p_az_early,       ta_hf, 'AZD-Early HF',        null,           120,  'Active',    1, 'PRECLIN',  '2025-06-01', null),
    (tl_lly_early,    p_space_id, uid, p_lly_early,      ta_hf, 'LY-Early HF',         null,            80,  'Active',    1, 'P1',       '2024-02-01', null),
    (tl_sema_hf,      p_space_id, uid, p_novo_sema_hf,   ta_hf, 'SELECT-HF',           'NCT04826393', 4500,  'Active',    1, 'P3',       '2022-01-01', null),
    (tl_novo_early,   p_space_id, uid, p_novo_early,     ta_hf, 'NVO-Probe HF',        null,            90,  'Active',    1, 'P2',       '2024-01-01', null),
    (tl_verquvo,      p_space_id, uid, p_merck_verquvo,  ta_hf, 'VICTORIA',            'NCT02861534', 5050,  'Completed', 1, 'APPROVED', '2021-01-19', null),
    (tl_merck_probe,  p_space_id, uid, p_merck_probe,    ta_hf, 'MRK-Probe HF',        null,          2000,  'Active',    1, 'P3',       '2022-09-01', null),
    (tl_merck_early,  p_space_id, uid, p_merck_early,    ta_hf, 'MRK-Early HF',        null,            60,  'Active',    1, 'P1',       '2024-09-01', null),
    (tl_vynda,        p_space_id, uid, p_pfe_vynda,      ta_hf, 'ATTR-ACT',            'NCT01994889',  441,  'Completed', 1, 'LAUNCHED', '2019-06-01', null),
    (tl_pfe_next,     p_space_id, uid, p_pfe_next,       ta_hf, 'PF-Next HF',          null,          1200,  'Active',    1, 'P2',       '2023-06-01', null),
    (tl_pfe_early,    p_space_id, uid, p_pfe_early,      ta_hf, 'PF-Early HF',         null,           150,  'Active',    1, 'P1',       '2024-01-01', null),
    (tl_kerendia,     p_space_id, uid, p_bayer_kerendia, ta_hf, 'FINEARTS-HF',         'NCT04435626', 6016,  'Completed', 1, 'APPROVED', '2021-07-09', null),
    (tl_bayer_mid,    p_space_id, uid, p_bayer_mid,      ta_hf, 'BAY-Mid HF',          null,          2400,  'Active',    1, 'P3',       '2023-02-01', null),
    (tl_bi_alt,       p_space_id, uid, p_bi_alt,         ta_hf, 'BI-Alt HF',           null,           900,  'Active',    1, 'P2',       '2023-10-01', null),
    (tl_bi_preclin,   p_space_id, uid, p_bi_preclin,     ta_hf, 'BI-Early HF',         null,            40,  'Active',    1, 'PRECLIN',  '2025-02-01', null),
    (tl_sanofi_piv,   p_space_id, uid, p_sanofi_piv,     ta_hf, 'Sanofi Pivotal HF',   null,          3200,  'Active',    1, 'P3',       '2021-06-01', null),
    (tl_sanofi_probe, p_space_id, uid, p_sanofi_probe,   ta_hf, 'Sanofi Probe HF',     null,          1400,  'Active',    1, 'P2',       '2023-04-01', null),
    (tl_gsk_cand,     p_space_id, uid, p_gsk_cand,       ta_hf, 'GSK Candidate HF',    null,           180,  'Active',    1, 'P1',       '2024-03-01', null),
    (tl_gsk_early,    p_space_id, uid, p_gsk_early,      ta_hf, 'GSK Early HF',        null,            50,  'Active',    1, 'PRECLIN',  '2025-04-01', null);

  -- ==========================================================================
  -- Markers for landscape trials
  -- A representative selection so each trial has at least one data marker.
  -- ==========================================================================

  -- tl_sema_hf: SELECT-HF (P3 active)
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000001', 'SELECT-HF topline results projected',   'company', '2025-12-01'),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000008', 'SELECT-HF primary completion projected','company', '2026-06-01');

  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_sema_hf from public.markers
    where space_id = p_space_id
      and title in (
        'SELECT-HF topline results projected',
        'SELECT-HF primary completion projected'
      );

  -- tl_verquvo: VICTORIA (Approved)
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000002', 'VICTORIA data reported',  'actual', '2019-11-10'),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000004', 'Verquvo NDA submitted',   'actual', '2020-08-15');

  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_verquvo from public.markers
    where space_id = p_space_id
      and title in (
        'VICTORIA data reported',
        'Verquvo NDA submitted'
      );

  -- tl_vynda: ATTR-ACT (Launched)
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000002', 'ATTR-ACT data reported',  'actual', '2018-09-01'),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000019', 'Vyndaqel US launch',       'actual', '2019-06-01');

  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_vynda from public.markers
    where space_id = p_space_id
      and title in (
        'ATTR-ACT data reported',
        'Vyndaqel US launch'
      );

  -- tl_kerendia: FINEARTS-HF (Approved)
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000013', 'FINEARTS-HF topline data', 'actual', '2024-05-13'),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000016', 'Kerendia sNDA submitted for HFmrEF/HFpEF', 'actual', '2024-09-20');

  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_kerendia from public.markers
    where space_id = p_space_id
      and title in (
        'FINEARTS-HF topline data',
        'Kerendia sNDA submitted for HFmrEF/HFpEF'
      );

  -- tl_merck_probe: MRK-Probe HF (P3 active)
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000001', 'MRK-Probe topline data projected', 'company', '2025-09-01');

  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_merck_probe from public.markers
    where space_id = p_space_id
      and title = 'MRK-Probe topline data projected';

  -- tl_sanofi_piv: Sanofi Pivotal HF (P3 active)
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000001', 'Sanofi Pivotal HF topline data projected', 'company', '2026-03-01');

  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_sanofi_piv from public.markers
    where space_id = p_space_id
      and title = 'Sanofi Pivotal HF topline data projected';

  -- ==========================================================================
  -- FUTURE-DATED CATALYSTS
  -- Upcoming markers for the Key Catalysts page.
  -- ==========================================================================

  -- SELECT-HF (Novo/Semaglutide): upcoming data + regulatory
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000013', 'SELECT-HF topline data readout',            'company', '2026-04-18'),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000032', 'Ozempic HF sNDA filing projected',           'company', '2026-09-01');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_sema_hf from public.markers
    where space_id = p_space_id and title in ('SELECT-HF topline data readout','Ozempic HF sNDA filing projected');

  -- MRK-Probe HF (Merck): upcoming data
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000030', 'MRK-Probe interim analysis at AHA 2026',     'company', '2026-05-10'),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000013', 'MRK-Probe P3 topline results projected',     'company', '2026-11-01');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_merck_probe from public.markers
    where space_id = p_space_id and title in ('MRK-Probe interim analysis at AHA 2026','MRK-Probe P3 topline results projected');

  -- Sanofi Pivotal HF: upcoming data + regulatory
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000013', 'Sanofi Pivotal HF topline results',          'company', '2026-07-15'),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000032', 'Sanofi HF regulatory filing projected',      'company', '2027-01-15');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_sanofi_piv from public.markers
    where space_id = p_space_id and title in ('Sanofi Pivotal HF topline results','Sanofi HF regulatory filing projected');

  -- PF-Next HF (Pfizer): upcoming data
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000030', 'PF-Next interim data at ESC 2026',           'company', '2026-04-28'),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000008', 'PF-Next primary completion projected',       'company', '2026-12-01');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_pfe_next from public.markers
    where space_id = p_space_id and title in ('PF-Next interim data at ESC 2026','PF-Next primary completion projected');

  -- BAY-Mid HF (Bayer): regulatory + approval
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000033', 'BAY-Mid NDA submission projected',            'company', '2026-05-20'),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000034', 'BAY-Mid FDA acceptance projected',             'company', '2026-08-01'),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000035', 'BAY-Mid PDUFA date projected',                'company', '2027-03-01');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_bayer_mid from public.markers
    where space_id = p_space_id and title in ('BAY-Mid NDA submission projected','BAY-Mid FDA acceptance projected','BAY-Mid PDUFA date projected');

  -- BI-Alt HF: upcoming data
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000013', 'BI-Alt P2 topline data projected',            'company', '2026-06-01');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_bi_alt from public.markers
    where space_id = p_space_id and title = 'BI-Alt P2 topline data projected';

  -- Kerendia (Bayer): LOE
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000020', 'Kerendia US patent expiry',                   'actual',  '2027-07-15');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_kerendia from public.markers
    where space_id = p_space_id and title = 'Kerendia US patent expiry';

  -- GSK Candidate HF: Phase 1 completion
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000008', 'GSK Candidate P1 completion projected',      'company', '2026-09-30');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, tl_gsk_cand from public.markers
    where space_id = p_space_id and title = 'GSK Candidate P1 completion projected';

  -- Farxiga (AZ): LOE
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000020', 'Farxiga US LOE projected',                   'actual',  '2027-10-01'),
    (gen_random_uuid(), p_space_id, uid,
      'a0000000-0000-0000-0000-000000000021', 'Farxiga generic entry expected',              'company', '2027-12-01');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t1 from public.markers
    where space_id = p_space_id and title in ('Farxiga US LOE projected','Farxiga generic entry expected');

  -- ==========================================================================
  -- Sample marker_notifications for demo richness
  -- Three high-priority notifications referencing key competitor events.
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

comment on function public.seed_demo_data(uuid) is
  'Seeds a new space with a rich competitive landscape fixture: nine companies, ~20 products '
  'in the Heart Failure therapeutic area distributed across all seven development-phase rings '
  '(PRECLIN through LAUNCHED), plus the original timeline fixture (Farxiga/Jardiance/Mounjaro/'
  'Ozempic) and a representative set of mechanisms of action and routes of administration. '
  'Uses the new marker system schema: markers + marker_assignments + marker_notifications. '
  'Phase data is stored directly on the trial row (phase_type, phase_start_date, phase_end_date). '
  'Includes future-dated catalyst markers for the Key Catalysts page. '
  'Idempotent: returns early if the space already has companies.';
