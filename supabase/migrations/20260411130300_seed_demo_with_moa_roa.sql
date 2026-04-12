-- migration: 20260411130300_seed_demo_with_moa_roa
-- purpose: replace public.seed_demo_data() with a version that also
--          seeds mechanisms of action and routes of administration for
--          the space, and assigns them to the seeded products so the
--          dashboard grid and landscape bullseye render MOA/ROA data
--          out of the box. All other behavior is preserved.
-- affected objects: public.seed_demo_data (function replaced)
-- notes: same idempotency guard (existing_count), same security invoker,
--        same auth.uid() gating. New local variables for MOA/ROA UUIDs
--        are declared alongside the existing company/product variables.

create or replace function public.seed_demo_data(p_space_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();

  -- ------------------------- companies -------------------------
  c_az uuid := gen_random_uuid();
  c_lilly uuid := gen_random_uuid();
  c_novo uuid := gen_random_uuid();
  c_merck uuid := gen_random_uuid();
  c_pfizer uuid := gen_random_uuid();
  c_bayer uuid := gen_random_uuid();
  c_bi uuid := gen_random_uuid();
  c_sanofi uuid := gen_random_uuid();
  c_gsk uuid := gen_random_uuid();

  -- ------------------------- products -------------------------
  -- existing timeline products
  p_farxiga uuid := gen_random_uuid();
  p_jardiance uuid := gen_random_uuid();
  p_mounjaro uuid := gen_random_uuid();
  p_ozempic uuid := gen_random_uuid();
  -- extra landscape products per company
  p_az_early uuid := gen_random_uuid();
  p_lly_early uuid := gen_random_uuid();
  p_novo_sema_hf uuid := gen_random_uuid();
  p_novo_early uuid := gen_random_uuid();
  p_merck_verquvo uuid := gen_random_uuid();
  p_merck_probe uuid := gen_random_uuid();
  p_merck_early uuid := gen_random_uuid();
  p_pfe_vynda uuid := gen_random_uuid();
  p_pfe_next uuid := gen_random_uuid();
  p_pfe_early uuid := gen_random_uuid();
  p_bayer_kerendia uuid := gen_random_uuid();
  p_bayer_mid uuid := gen_random_uuid();
  p_bi_alt uuid := gen_random_uuid();
  p_bi_preclin uuid := gen_random_uuid();
  p_sanofi_piv uuid := gen_random_uuid();
  p_sanofi_probe uuid := gen_random_uuid();
  p_gsk_cand uuid := gen_random_uuid();
  p_gsk_early uuid := gen_random_uuid();

  -- ------------------------- therapeutic areas -------------------------
  ta_hf uuid := gen_random_uuid();
  ta_ckd uuid := gen_random_uuid();
  ta_t2d uuid := gen_random_uuid();
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
  tl_az_early uuid := gen_random_uuid();
  tl_lly_early uuid := gen_random_uuid();
  tl_sema_hf uuid := gen_random_uuid();
  tl_novo_early uuid := gen_random_uuid();
  tl_verquvo uuid := gen_random_uuid();
  tl_merck_probe uuid := gen_random_uuid();
  tl_merck_early uuid := gen_random_uuid();
  tl_vynda uuid := gen_random_uuid();
  tl_pfe_next uuid := gen_random_uuid();
  tl_pfe_early uuid := gen_random_uuid();
  tl_kerendia uuid := gen_random_uuid();
  tl_bayer_mid uuid := gen_random_uuid();
  tl_bi_alt uuid := gen_random_uuid();
  tl_bi_preclin uuid := gen_random_uuid();
  tl_sanofi_piv uuid := gen_random_uuid();
  tl_sanofi_probe uuid := gen_random_uuid();
  tl_gsk_cand uuid := gen_random_uuid();
  tl_gsk_early uuid := gen_random_uuid();

  -- ------------------------- new: MOAs -------------------------
  moa_sglt2 uuid := gen_random_uuid();
  moa_glp1 uuid := gen_random_uuid();
  moa_glp1_gip uuid := gen_random_uuid();
  moa_sgc uuid := gen_random_uuid();
  moa_ttr uuid := gen_random_uuid();
  moa_nsmra uuid := gen_random_uuid();
  moa_ns_investigational uuid := gen_random_uuid();
  moa_cardiac_myosin uuid := gen_random_uuid();

  -- ------------------------- new: ROAs -------------------------
  roa_oral uuid := gen_random_uuid();
  roa_iv uuid := gen_random_uuid();
  roa_sc uuid := gen_random_uuid();
  roa_inhaled uuid := gen_random_uuid();
  roa_im uuid := gen_random_uuid();
  roa_topical uuid := gen_random_uuid();
  roa_intrathecal uuid := gen_random_uuid();

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
    (c_az, p_space_id, uid, 'AstraZeneca', 'https://cdn.brandfetch.io/idJpLuJVA4/theme/dark/symbol.svg?c=1bxid64Mup7aczewSAYMX&t=1677288655682', 1),
    (c_lilly, p_space_id, uid, 'Eli Lilly', 'https://cdn.brandfetch.io/idxr899feu/theme/dark/logo.svg?c=1bxid64Mup7aczewSAYMX&t=1667576418707', 2),
    (c_novo, p_space_id, uid, 'Novo Nordisk', 'https://cdn.brandfetch.io/idzG7CuQEI/theme/dark/logo.svg?c=1bxid64Mup7aczewSAYMX&t=1668424247400', 3),
    (c_merck, p_space_id, uid, 'Merck', null, 4),
    (c_pfizer, p_space_id, uid, 'Pfizer', null, 5),
    (c_bayer, p_space_id, uid, 'Bayer', null, 6),
    (c_bi, p_space_id, uid, 'Boehringer Ingelheim', null, 7),
    (c_sanofi, p_space_id, uid, 'Sanofi', null, 8),
    (c_gsk, p_space_id, uid, 'GSK', null, 9);

  -- ==========================================================================
  -- Therapeutic areas
  -- ==========================================================================
  insert into public.therapeutic_areas (id, space_id, created_by, name, abbreviation) values
    (ta_hf, p_space_id, uid, 'Heart Failure', 'HF'),
    (ta_ckd, p_space_id, uid, 'Chronic Kidney Disease', 'CKD'),
    (ta_t2d, p_space_id, uid, 'Type 2 Diabetes', 'T2D'),
    (ta_obesity, p_space_id, uid, 'Obesity', 'OB');

  -- ==========================================================================
  -- Products: existing timeline fixture + new landscape-density products
  -- ==========================================================================
  insert into public.products (id, space_id, created_by, company_id, name, generic_name, display_order) values
    -- existing timeline fixture
    (p_farxiga, p_space_id, uid, c_az, 'Farxiga', 'dapagliflozin', 1),
    (p_jardiance, p_space_id, uid, c_lilly, 'Jardiance', 'empagliflozin', 1),
    (p_mounjaro, p_space_id, uid, c_lilly, 'Mounjaro', 'tirzepatide', 2),
    (p_ozempic, p_space_id, uid, c_novo, 'Ozempic', 'semaglutide', 1),
    -- AstraZeneca: early-stage pipeline asset
    (p_az_early, p_space_id, uid, c_az, 'AZD-Early', null, 2),
    -- Eli Lilly: early-stage pipeline asset
    (p_lly_early, p_space_id, uid, c_lilly, 'LY-Early', null, 3),
    -- Novo Nordisk: semaglutide HF extension + early pipeline
    (p_novo_sema_hf, p_space_id, uid, c_novo, 'Semaglutide-HF', 'semaglutide', 2),
    (p_novo_early, p_space_id, uid, c_novo, 'NVO-Early', null, 3),
    -- Merck: Verquvo launched + pipeline
    (p_merck_verquvo, p_space_id, uid, c_merck, 'Verquvo', 'vericiguat', 1),
    (p_merck_probe, p_space_id, uid, c_merck, 'MRK-Probe', null, 2),
    (p_merck_early, p_space_id, uid, c_merck, 'MRK-Early', null, 3),
    -- Pfizer: Vyndaqel launched (TTR cardiomyopathy) + pipeline
    (p_pfe_vynda, p_space_id, uid, c_pfizer, 'Vyndaqel', 'tafamidis', 1),
    (p_pfe_next, p_space_id, uid, c_pfizer, 'PF-Next', null, 2),
    (p_pfe_early, p_space_id, uid, c_pfizer, 'PF-Early', null, 3),
    -- Bayer: Kerendia approved + pipeline
    (p_bayer_kerendia, p_space_id, uid, c_bayer, 'Kerendia', 'finerenone', 1),
    (p_bayer_mid, p_space_id, uid, c_bayer, 'BAY-Mid', null, 2),
    -- Boehringer Ingelheim: pipeline plays
    (p_bi_alt, p_space_id, uid, c_bi, 'BI-Alt', null, 1),
    (p_bi_preclin, p_space_id, uid, c_bi, 'BI-Early', null, 2),
    -- Sanofi: pivotal + early
    (p_sanofi_piv, p_space_id, uid, c_sanofi, 'Sanofi-Pivotal', null, 1),
    (p_sanofi_probe, p_space_id, uid, c_sanofi, 'Sanofi-Probe', null, 2),
    -- GSK: candidate + early
    (p_gsk_cand, p_space_id, uid, c_gsk, 'GSK-Candidate', null, 1),
    (p_gsk_early, p_space_id, uid, c_gsk, 'GSK-Early', null, 2);

  -- ==========================================================================
  -- Mechanisms of action
  -- ==========================================================================
  insert into public.mechanisms_of_action (id, space_id, created_by, name, description, display_order) values
    (moa_sglt2, p_space_id, uid, 'SGLT2 inhibitor', 'Blocks sodium-glucose co-transporter 2 in the kidney.', 1),
    (moa_glp1, p_space_id, uid, 'GLP-1 agonist', 'Activates the GLP-1 receptor to increase insulin secretion.', 2),
    (moa_glp1_gip, p_space_id, uid, 'GIP/GLP-1 dual agonist', 'Dual activation of GIP and GLP-1 receptors.', 3),
    (moa_sgc, p_space_id, uid, 'sGC stimulator', 'Stimulates soluble guanylate cyclase to increase cGMP.', 4),
    (moa_ttr, p_space_id, uid, 'TTR stabilizer', 'Stabilizes the transthyretin tetramer to prevent amyloid formation.', 5),
    (moa_nsmra, p_space_id, uid, 'Non-steroidal MRA', 'Non-steroidal mineralocorticoid receptor antagonist.', 6),
    (moa_cardiac_myosin, p_space_id, uid, 'Cardiac myosin modulator', 'Modulates cardiac myosin to improve contractility.', 7),
    (moa_ns_investigational, p_space_id, uid, 'Investigational (undisclosed)', 'Early-stage asset, target not yet disclosed.', 99);

  -- ==========================================================================
  -- Routes of administration
  -- ==========================================================================
  insert into public.routes_of_administration (id, space_id, created_by, name, abbreviation, display_order) values
    (roa_oral, p_space_id, uid, 'Oral', 'PO', 1),
    (roa_iv, p_space_id, uid, 'Intravenous', 'IV', 2),
    (roa_sc, p_space_id, uid, 'Subcutaneous', 'SC', 3),
    (roa_inhaled, p_space_id, uid, 'Inhaled', 'INH', 4),
    (roa_im, p_space_id, uid, 'Intramuscular', 'IM', 5),
    (roa_topical, p_space_id, uid, 'Topical', 'TOP', 6),
    (roa_intrathecal, p_space_id, uid, 'Intrathecal', 'IT', 7);

  -- ==========================================================================
  -- Product <-> MOA assignments
  -- ==========================================================================
  insert into public.product_mechanisms_of_action (product_id, moa_id) values
    -- known molecules with real MOAs
    (p_farxiga, moa_sglt2),
    (p_jardiance, moa_sglt2),
    (p_mounjaro, moa_glp1_gip),
    (p_ozempic, moa_glp1),
    (p_novo_sema_hf, moa_glp1),
    (p_merck_verquvo, moa_sgc),
    (p_pfe_vynda, moa_ttr),
    (p_bayer_kerendia, moa_nsmra),
    -- a few early-stage pipeline assets get plausible MOAs so the landscape has visual variety
    (p_az_early, moa_cardiac_myosin),
    (p_lly_early, moa_cardiac_myosin),
    (p_novo_early, moa_ns_investigational),
    (p_merck_probe, moa_ns_investigational),
    (p_merck_early, moa_ns_investigational),
    (p_pfe_next, moa_sgc),
    (p_pfe_early, moa_ns_investigational),
    (p_bayer_mid, moa_nsmra),
    (p_bi_alt, moa_ns_investigational),
    (p_bi_preclin, moa_ns_investigational),
    (p_sanofi_piv, moa_cardiac_myosin),
    (p_sanofi_probe, moa_ns_investigational),
    (p_gsk_cand, moa_ns_investigational),
    (p_gsk_early, moa_ns_investigational);

  -- ==========================================================================
  -- Product <-> ROA assignments
  -- ==========================================================================
  insert into public.product_routes_of_administration (product_id, roa_id) values
    -- oral (small molecules)
    (p_farxiga, roa_oral),
    (p_jardiance, roa_oral),
    (p_merck_verquvo, roa_oral),
    (p_pfe_vynda, roa_oral),
    (p_bayer_kerendia, roa_oral),
    (p_az_early, roa_oral),
    (p_lly_early, roa_oral),
    (p_pfe_next, roa_oral),
    (p_pfe_early, roa_oral),
    (p_bayer_mid, roa_oral),
    (p_bi_alt, roa_oral),
    (p_bi_preclin, roa_oral),
    (p_sanofi_piv, roa_oral),
    (p_sanofi_probe, roa_oral),
    -- subcutaneous (peptide injectables)
    (p_mounjaro, roa_sc),
    (p_ozempic, roa_sc),
    (p_novo_sema_hf, roa_sc),
    (p_novo_early, roa_sc),
    -- dual-route examples (also show up as multi-ROA in the dashboard)
    (p_mounjaro, roa_oral),          -- forward-looking: oral tirzepatide in Phase 3 as of 2025
    (p_merck_probe, roa_iv),
    (p_merck_early, roa_iv),
    (p_gsk_cand, roa_inhaled),
    (p_gsk_early, roa_inhaled),
    -- placeholder early-stage assets exercising the remaining routes so
    -- the filter panel does not show route options with zero results
    (p_bi_preclin, roa_im),
    (p_sanofi_probe, roa_topical),
    (p_bayer_mid, roa_intrathecal);

  -- ==========================================================================
  -- Existing timeline trials (unchanged -- horizontal dashboard still reads
  -- these). trial_phases for these trials are extended below with
  -- APPROVED/LAUNCHED rows so the landscape bullseye inner rings pick
  -- them up for Farxiga and Jardiance.
  -- ==========================================================================
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order) values
    (t1, p_space_id, uid, p_farxiga, ta_hf, 'DAPA-HF', 'NCT03036124', 4744, 'Completed', 1),
    (t2, p_space_id, uid, p_farxiga, ta_ckd, 'DAPA-CKD', 'NCT03036150', 4304, 'Completed', 2),
    (t3, p_space_id, uid, p_farxiga, ta_hf, 'DELIVER', 'NCT03619213', 6263, 'Completed', 3),
    (t4, p_space_id, uid, p_jardiance, ta_hf, 'EMPEROR-Preserved', 'NCT03057977', 5988, 'Completed', 1),
    (t5, p_space_id, uid, p_jardiance, ta_hf, 'EMPEROR-Reduced', 'NCT03057951', 3730, 'Completed', 2),
    (t6, p_space_id, uid, p_jardiance, ta_ckd, 'EMPA-KIDNEY', 'NCT03594110', 6609, 'Completed', 3),
    (t7, p_space_id, uid, p_mounjaro, ta_t2d, 'SURPASS-1', 'NCT03954834', 478, 'Completed', 1),
    (t8, p_space_id, uid, p_ozempic, ta_obesity, 'STEP 1', 'NCT03548935', 1961, 'Completed', 1);

  insert into public.trial_phases (id, space_id, created_by, trial_id, phase_type, start_date, end_date, label) values
    (gen_random_uuid(), p_space_id, uid, t1, 'P1', '2015-06-01', '2016-12-31', 'P1'),
    (gen_random_uuid(), p_space_id, uid, t1, 'P2', '2017-02-01', '2018-06-30', 'P2'),
    (gen_random_uuid(), p_space_id, uid, t1, 'P3', '2017-02-01', '2019-09-30', 'P3'),
    -- Farxiga launched for HFrEF in 2020, approved in 2020
    (gen_random_uuid(), p_space_id, uid, t1, 'APPROVED', '2020-05-05', null, 'FDA Approval HFrEF'),
    (gen_random_uuid(), p_space_id, uid, t1, 'LAUNCHED', '2020-05-05', null, 'US Launch HFrEF'),
    (gen_random_uuid(), p_space_id, uid, t2, 'P3', '2017-02-01', '2020-06-30', 'P3'),
    (gen_random_uuid(), p_space_id, uid, t2, 'P4', '2021-06-01', '2024-12-31', 'P4'),
    (gen_random_uuid(), p_space_id, uid, t3, 'P3', '2018-08-01', '2022-05-31', 'P3'),
    (gen_random_uuid(), p_space_id, uid, t4, 'P3', '2017-03-01', '2021-08-31', 'P3'),
    -- Jardiance approved for HFpEF in 2022, launched thereafter
    (gen_random_uuid(), p_space_id, uid, t4, 'APPROVED', '2022-02-24', null, 'FDA Approval HFpEF'),
    (gen_random_uuid(), p_space_id, uid, t4, 'LAUNCHED', '2022-03-15', null, 'US Launch HFpEF'),
    (gen_random_uuid(), p_space_id, uid, t5, 'P3', '2017-03-01', '2020-06-30', 'P3'),
    (gen_random_uuid(), p_space_id, uid, t6, 'P3', '2019-05-01', '2022-11-30', 'P3'),
    (gen_random_uuid(), p_space_id, uid, t7, 'P3', '2019-06-01', '2021-05-31', 'P3'),
    (gen_random_uuid(), p_space_id, uid, t8, 'P3', '2018-06-01', '2021-03-31', 'P3'),
    (gen_random_uuid(), p_space_id, uid, t8, 'OBS', '2021-06-01', '2023-12-31', 'OBS');

  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values
    (gen_random_uuid(), p_space_id, uid, t1, 'a0000000-0000-0000-0000-000000000002', '2019-09-19', null, 'Primary results presented at ESC 2019', false),
    (gen_random_uuid(), p_space_id, uid, t1, 'a0000000-0000-0000-0000-000000000004', '2020-05-05', null, 'sNDA submitted to FDA for HFrEF', false),
    (gen_random_uuid(), p_space_id, uid, t1, 'a0000000-0000-0000-0000-000000000008', '2019-09-30', null, 'Primary completion', false),
    (gen_random_uuid(), p_space_id, uid, t1, 'a0000000-0000-0000-0000-000000000009', '2019-06-01', null, 'Primary completion date moved earlier from Q4 to Q3 2019', false),
    (gen_random_uuid(), p_space_id, uid, t2, 'a0000000-0000-0000-0000-000000000002', '2020-09-24', null, 'Top-line results announced', false),
    (gen_random_uuid(), p_space_id, uid, t2, 'a0000000-0000-0000-0000-000000000004', '2021-02-15', null, 'sNDA submitted for CKD', false),
    (gen_random_uuid(), p_space_id, uid, t2, 'a0000000-0000-0000-0000-000000000008', '2020-06-30', null, 'Primary completion', false),
    (gen_random_uuid(), p_space_id, uid, t3, 'a0000000-0000-0000-0000-000000000001', '2022-08-01', null, 'Results expected at ESC 2022', true),
    (gen_random_uuid(), p_space_id, uid, t3, 'a0000000-0000-0000-0000-000000000002', '2022-08-26', null, 'Results presented at ESC 2022', false),
    (gen_random_uuid(), p_space_id, uid, t3, 'a0000000-0000-0000-0000-000000000008', '2022-05-31', null, 'Primary completion', false),
    (gen_random_uuid(), p_space_id, uid, t4, 'a0000000-0000-0000-0000-000000000002', '2021-08-27', null, 'Results presented at ESC 2021', false),
    (gen_random_uuid(), p_space_id, uid, t4, 'a0000000-0000-0000-0000-000000000004', '2022-02-24', null, 'sNDA submitted for HFpEF', false),
    (gen_random_uuid(), p_space_id, uid, t4, 'a0000000-0000-0000-0000-000000000005', '2022-10-01', null, 'FDA approval projected', true),
    (gen_random_uuid(), p_space_id, uid, t4, 'a0000000-0000-0000-0000-000000000006', '2022-06-15', null, 'Label updated to include HFpEF indication', false),
    (gen_random_uuid(), p_space_id, uid, t5, 'a0000000-0000-0000-0000-000000000002', '2020-06-29', null, 'Results presented at ESC 2020', false),
    (gen_random_uuid(), p_space_id, uid, t5, 'a0000000-0000-0000-0000-000000000004', '2020-11-15', null, 'sNDA submitted for HFrEF', false),
    (gen_random_uuid(), p_space_id, uid, t5, 'a0000000-0000-0000-0000-000000000008', '2020-06-30', null, 'Primary completion', false),
    (gen_random_uuid(), p_space_id, uid, t5, 'a0000000-0000-0000-0000-000000000010', '2021-06-01', null, 'Planned pediatric filing no longer expected', false),
    (gen_random_uuid(), p_space_id, uid, t6, 'a0000000-0000-0000-0000-000000000002', '2022-11-04', null, 'Results presented at ASN 2022', false),
    (gen_random_uuid(), p_space_id, uid, t6, 'a0000000-0000-0000-0000-000000000003', '2023-03-01', null, 'Regulatory filing projected', true),
    (gen_random_uuid(), p_space_id, uid, t6, 'a0000000-0000-0000-0000-000000000007', '2023-06-01', '2024-03-31', 'Estimated CKD launch window', true),
    (gen_random_uuid(), p_space_id, uid, t7, 'a0000000-0000-0000-0000-000000000002', '2021-05-28', null, 'Top-line results announced', false),
    (gen_random_uuid(), p_space_id, uid, t7, 'a0000000-0000-0000-0000-000000000004', '2022-05-13', null, 'NDA submitted to FDA', false),
    (gen_random_uuid(), p_space_id, uid, t8, 'a0000000-0000-0000-0000-000000000002', '2021-02-10', null, 'Published in NEJM', false),
    (gen_random_uuid(), p_space_id, uid, t8, 'a0000000-0000-0000-0000-000000000004', '2021-12-04', null, 'sNDA submitted for obesity', false),
    (gen_random_uuid(), p_space_id, uid, t8, 'a0000000-0000-0000-0000-000000000005', '2022-06-01', null, 'FDA approval projected', true);

  insert into public.trial_notes (id, space_id, created_by, trial_id, content) values
    (gen_random_uuid(), p_space_id, uid, t1, 'Landmark trial establishing SGLT2i in HFrEF. Changed treatment guidelines.'),
    (gen_random_uuid(), p_space_id, uid, t2, 'First SGLT2i approved for CKD regardless of diabetes status.'),
    (gen_random_uuid(), p_space_id, uid, t4, 'First positive trial for HFpEF. Major unmet need addressed.'),
    (gen_random_uuid(), p_space_id, uid, t8, 'Demonstrated ~15% body weight reduction. Pivotal for obesity indication.');

  -- ==========================================================================
  -- Landscape trials: one per new landscape product, all in Heart Failure.
  -- Highest-phase covers the full ring spectrum (PRECLIN through LAUNCHED)
  -- so the bullseye exercises every ring.
  -- ==========================================================================
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order) values
    (tl_az_early, p_space_id, uid, p_az_early, ta_hf, 'AZD-Early HF', null, 120, 'Active', 1),
    (tl_lly_early, p_space_id, uid, p_lly_early, ta_hf, 'LY-Early HF', null, 80, 'Active', 1),
    (tl_sema_hf, p_space_id, uid, p_novo_sema_hf, ta_hf, 'SELECT-HF', 'NCT04826393', 4500, 'Active', 1),
    (tl_novo_early, p_space_id, uid, p_novo_early, ta_hf, 'NVO-Probe HF', null, 90, 'Active', 1),
    (tl_verquvo, p_space_id, uid, p_merck_verquvo, ta_hf, 'VICTORIA', 'NCT02861534', 5050, 'Completed', 1),
    (tl_merck_probe, p_space_id, uid, p_merck_probe, ta_hf, 'MRK-Probe HF', null, 2000, 'Active', 1),
    (tl_merck_early, p_space_id, uid, p_merck_early, ta_hf, 'MRK-Early HF', null, 60, 'Active', 1),
    (tl_vynda, p_space_id, uid, p_pfe_vynda, ta_hf, 'ATTR-ACT', 'NCT01994889', 441, 'Completed', 1),
    (tl_pfe_next, p_space_id, uid, p_pfe_next, ta_hf, 'PF-Next HF', null, 1200, 'Active', 1),
    (tl_pfe_early, p_space_id, uid, p_pfe_early, ta_hf, 'PF-Early HF', null, 150, 'Active', 1),
    (tl_kerendia, p_space_id, uid, p_bayer_kerendia, ta_hf, 'FINEARTS-HF', 'NCT04435626', 6016, 'Completed', 1),
    (tl_bayer_mid, p_space_id, uid, p_bayer_mid, ta_hf, 'BAY-Mid HF', null, 2400, 'Active', 1),
    (tl_bi_alt, p_space_id, uid, p_bi_alt, ta_hf, 'BI-Alt HF', null, 900, 'Active', 1),
    (tl_bi_preclin, p_space_id, uid, p_bi_preclin, ta_hf, 'BI-Early HF', null, 40, 'Active', 1),
    (tl_sanofi_piv, p_space_id, uid, p_sanofi_piv, ta_hf, 'Sanofi Pivotal HF', null, 3200, 'Active', 1),
    (tl_sanofi_probe, p_space_id, uid, p_sanofi_probe, ta_hf, 'Sanofi Probe HF', null, 1400, 'Active', 1),
    (tl_gsk_cand, p_space_id, uid, p_gsk_cand, ta_hf, 'GSK Candidate HF', null, 180, 'Active', 1),
    (tl_gsk_early, p_space_id, uid, p_gsk_early, ta_hf, 'GSK Early HF', null, 50, 'Active', 1);

  insert into public.trial_phases (id, space_id, created_by, trial_id, phase_type, start_date, end_date, label) values
    -- PRECLIN
    (gen_random_uuid(), p_space_id, uid, tl_az_early, 'PRECLIN', '2025-06-01', null, 'PRECLIN'),
    (gen_random_uuid(), p_space_id, uid, tl_bi_preclin, 'PRECLIN', '2025-02-01', null, 'PRECLIN'),
    (gen_random_uuid(), p_space_id, uid, tl_gsk_early, 'PRECLIN', '2025-04-01', null, 'PRECLIN'),
    -- P1
    (gen_random_uuid(), p_space_id, uid, tl_lly_early, 'P1', '2024-02-01', null, 'P1'),
    (gen_random_uuid(), p_space_id, uid, tl_merck_early, 'P1', '2024-09-01', null, 'P1'),
    (gen_random_uuid(), p_space_id, uid, tl_pfe_early, 'P1', '2024-01-01', null, 'P1'),
    (gen_random_uuid(), p_space_id, uid, tl_gsk_cand, 'P1', '2024-03-01', null, 'P1'),
    -- P2
    (gen_random_uuid(), p_space_id, uid, tl_novo_early, 'P2', '2024-01-01', null, 'P2'),
    (gen_random_uuid(), p_space_id, uid, tl_pfe_next, 'P2', '2023-06-01', null, 'P2'),
    (gen_random_uuid(), p_space_id, uid, tl_bi_alt, 'P2', '2023-10-01', null, 'P2'),
    (gen_random_uuid(), p_space_id, uid, tl_sanofi_probe, 'P2', '2023-04-01', null, 'P2'),
    -- P3
    (gen_random_uuid(), p_space_id, uid, tl_sema_hf, 'P3', '2022-01-01', null, 'P3'),
    (gen_random_uuid(), p_space_id, uid, tl_merck_probe, 'P3', '2022-09-01', null, 'P3'),
    (gen_random_uuid(), p_space_id, uid, tl_bayer_mid, 'P3', '2023-02-01', null, 'P3'),
    (gen_random_uuid(), p_space_id, uid, tl_sanofi_piv, 'P3', '2021-06-01', null, 'P3'),
    -- APPROVED
    (gen_random_uuid(), p_space_id, uid, tl_verquvo, 'P3', '2016-08-01', '2019-12-31', 'P3'),
    (gen_random_uuid(), p_space_id, uid, tl_verquvo, 'APPROVED', '2021-01-19', null, 'FDA Approval'),
    (gen_random_uuid(), p_space_id, uid, tl_kerendia, 'P3', '2015-09-01', '2020-10-31', 'P3'),
    (gen_random_uuid(), p_space_id, uid, tl_kerendia, 'APPROVED', '2021-07-09', null, 'FDA Approval'),
    -- LAUNCHED (Vyndaqel launched for TTR cardiomyopathy in 2019)
    (gen_random_uuid(), p_space_id, uid, tl_vynda, 'P3', '2013-12-01', '2018-02-28', 'P3'),
    (gen_random_uuid(), p_space_id, uid, tl_vynda, 'APPROVED', '2019-05-03', null, 'FDA Approval'),
    (gen_random_uuid(), p_space_id, uid, tl_vynda, 'LAUNCHED', '2019-06-01', null, 'US Launch');
end;
$$;

comment on function public.seed_demo_data(uuid) is
  'Seeds a new space with a rich competitive landscape fixture: nine companies, ~20 products in the Heart Failure therapeutic area distributed across all seven development-phase rings (PRECLIN through LAUNCHED), plus the original timeline fixture (Farxiga/Jardiance/Mounjaro/Ozempic) and a representative set of mechanisms of action and routes of administration so the dashboard grid and landscape bullseye render MOA/ROA data out of the box. Idempotent: returns early if the space already has companies.';
