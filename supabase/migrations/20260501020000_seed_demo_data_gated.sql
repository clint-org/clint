-- migration: 20260501020000_seed_demo_data_gated
-- purpose: resurrect seed_demo_data and its nine _seed_demo_* helpers that
--          were dropped in migration 81 (20260501000000_drop_seed_demo_data).
--          Reinstates the helper-based architecture from migrations 50
--          (20260414200000_seed_data_redesign) and 51
--          (20260415160000_seed_real_companies), with one new addition: a
--          space-owner permission gate at the top of seed_demo_data so the
--          tenant-scope leak that motivated the original drop is closed.
--
-- callable surfaces:
--   - URL route /t/:tenantId/s/:spaceId/seed-demo (added in the same change
--     set as this migration) calls dashboardService.seedDemoData() which
--     invokes this RPC.
--   - the function is idempotent: returns early if the space already has
--     companies, so repeat calls or accidental URL hits are safe.
--
-- gate: the caller must hold a space_members row with role='owner' for
--       p_space_id, OR be a platform admin. Tenant ownership alone is NOT
--       sufficient (consistent with migration 75's firewall: tenant owners
--       get NO implicit space data access).

-- =============================================================================
-- 1. helper functions (re-create from migration 50 with overrides from migration 51)
-- =============================================================================
-- =============================================================================
-- 4. helper: _seed_demo_therapeutic_areas
-- =============================================================================

create or replace function public._seed_demo_therapeutic_areas(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ta_hf      uuid := gen_random_uuid();
  ta_ckd     uuid := gen_random_uuid();
  ta_t2d     uuid := gen_random_uuid();
  ta_obesity uuid := gen_random_uuid();
begin
  insert into public.therapeutic_areas (id, space_id, created_by, name, abbreviation) values
    (ta_hf,      p_space_id, p_uid, 'Heart Failure',          'HF'),
    (ta_ckd,     p_space_id, p_uid, 'Chronic Kidney Disease', 'CKD'),
    (ta_t2d,     p_space_id, p_uid, 'Type 2 Diabetes',        'T2D'),
    (ta_obesity, p_space_id, p_uid, 'Obesity',                'OB');

  insert into _seed_ids (entity_type, key, id) values
    ('ta', 'ta_hf',      ta_hf),
    ('ta', 'ta_ckd',     ta_ckd),
    ('ta', 'ta_t2d',     ta_t2d),
    ('ta', 'ta_obesity', ta_obesity);
end;
$$;

-- =============================================================================
-- 5. helper: _seed_demo_products
-- =============================================================================

create or replace function public._seed_demo_products(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_meridian  uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_meridian');
  c_helios    uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_helios');
  c_vantage   uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_vantage');
  c_apex      uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_apex');
  c_cardinal  uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_cardinal');
  c_solara    uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_solara');
  c_cascade   uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_cascade');
  c_zenith    uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_zenith');

  p_zelvox          uuid := gen_random_uuid();
  p_restivon        uuid := gen_random_uuid();
  p_mrd4471         uuid := gen_random_uuid();
  p_cardivant       uuid := gen_random_uuid();
  p_renoquil        uuid := gen_random_uuid();
  p_hls2289         uuid := gen_random_uuid();
  p_glytara         uuid := gen_random_uuid();
  p_oxavance        uuid := gen_random_uuid();
  p_vbx7803         uuid := gen_random_uuid();
  p_thyravex        uuid := gen_random_uuid();
  p_apx1150         uuid := gen_random_uuid();
  p_venatris        uuid := gen_random_uuid();
  p_crd3300         uuid := gen_random_uuid();
  p_ketavora        uuid := gen_random_uuid();
  p_lumivex         uuid := gen_random_uuid();
  p_slr8820         uuid := gen_random_uuid();
  p_pravicel        uuid := gen_random_uuid();
  p_csc6610         uuid := gen_random_uuid();
  p_znh1140         uuid := gen_random_uuid();
  p_znh0092         uuid := gen_random_uuid();
begin
  insert into public.products (id, space_id, created_by, company_id, name, generic_name, display_order) values
    (p_zelvox,    p_space_id, p_uid, c_meridian, 'Zelvox',    'cortagliflozin',  1),
    (p_restivon,  p_space_id, p_uid, c_meridian, 'Restivon',  'duralutide',      2),
    (p_mrd4471,   p_space_id, p_uid, c_meridian, 'MRD-4471',  null,              3),
    (p_cardivant, p_space_id, p_uid, c_helios,   'Cardivant',  'emparivat',      1),
    (p_renoquil,  p_space_id, p_uid, c_helios,   'Renoquil',   'benafinerone',   2),
    (p_hls2289,   p_space_id, p_uid, c_helios,   'HLS-2289',   null,            3),
    (p_glytara,   p_space_id, p_uid, c_vantage,  'Glytara',    'vantizepatide',  1),
    (p_oxavance,  p_space_id, p_uid, c_vantage,  'Oxavance',   'trebariguat',    2),
    (p_vbx7803,   p_space_id, p_uid, c_vantage,  'VBX-7803',   null,            3),
    (p_thyravex,  p_space_id, p_uid, c_apex,     'Thyravex',   'neratafidis',    1),
    (p_apx1150,   p_space_id, p_uid, c_apex,     'APX-1150',   null,            2),
    (p_venatris,  p_space_id, p_uid, c_cardinal, 'Venatris',   'cariguat',       1),
    (p_crd3300,   p_space_id, p_uid, c_cardinal, 'CRD-3300',   null,            2),
    (p_ketavora,  p_space_id, p_uid, c_solara,   'Ketavora',   'solafinerone',   1),
    (p_lumivex,   p_space_id, p_uid, c_solara,   'Lumivex',    'solagliflozin',  2),
    (p_slr8820,   p_space_id, p_uid, c_solara,   'SLR-8820',   null,            3),
    (p_pravicel,  p_space_id, p_uid, c_cascade,  'Pravicel',   'cascamyosin',    1),
    (p_csc6610,   p_space_id, p_uid, c_cascade,  'CSC-6610',   null,            2),
    (p_znh1140,   p_space_id, p_uid, c_zenith,   'ZNH-1140',   null,            1),
    (p_znh0092,   p_space_id, p_uid, c_zenith,   'ZNH-0092',   null,            2);

  insert into _seed_ids (entity_type, key, id) values
    ('product', 'p_zelvox',    p_zelvox),
    ('product', 'p_restivon',  p_restivon),
    ('product', 'p_mrd4471',   p_mrd4471),
    ('product', 'p_cardivant', p_cardivant),
    ('product', 'p_renoquil',  p_renoquil),
    ('product', 'p_hls2289',   p_hls2289),
    ('product', 'p_glytara',   p_glytara),
    ('product', 'p_oxavance',  p_oxavance),
    ('product', 'p_vbx7803',   p_vbx7803),
    ('product', 'p_thyravex',  p_thyravex),
    ('product', 'p_apx1150',   p_apx1150),
    ('product', 'p_venatris',  p_venatris),
    ('product', 'p_crd3300',   p_crd3300),
    ('product', 'p_ketavora',  p_ketavora),
    ('product', 'p_lumivex',   p_lumivex),
    ('product', 'p_slr8820',   p_slr8820),
    ('product', 'p_pravicel',  p_pravicel),
    ('product', 'p_csc6610',   p_csc6610),
    ('product', 'p_znh1140',   p_znh1140),
    ('product', 'p_znh0092',   p_znh0092);
end;
$$;

-- =============================================================================
-- 6. helper: _seed_demo_moa_roa
-- =============================================================================

create or replace function public._seed_demo_moa_roa(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  moa_sglt2          uuid := gen_random_uuid();
  moa_glp1           uuid := gen_random_uuid();
  moa_glp1_gip       uuid := gen_random_uuid();
  moa_sgc            uuid := gen_random_uuid();
  moa_ttr            uuid := gen_random_uuid();
  moa_nsmra          uuid := gen_random_uuid();
  moa_cardiac_myosin uuid := gen_random_uuid();
  moa_investigational uuid := gen_random_uuid();

  roa_oral        uuid := gen_random_uuid();
  roa_iv          uuid := gen_random_uuid();
  roa_sc          uuid := gen_random_uuid();
  roa_inhaled     uuid := gen_random_uuid();
  roa_im          uuid := gen_random_uuid();
  roa_topical     uuid := gen_random_uuid();
  roa_intrathecal uuid := gen_random_uuid();

  p_zelvox    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_zelvox');
  p_restivon  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_restivon');
  p_mrd4471   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_mrd4471');
  p_cardivant uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_cardivant');
  p_renoquil  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_renoquil');
  p_hls2289   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_hls2289');
  p_glytara   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_glytara');
  p_oxavance  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_oxavance');
  p_vbx7803   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vbx7803');
  p_thyravex  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_thyravex');
  p_apx1150   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_apx1150');
  p_venatris  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_venatris');
  p_crd3300   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_crd3300');
  p_ketavora  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_ketavora');
  p_lumivex   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_lumivex');
  p_slr8820   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_slr8820');
  p_pravicel  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_pravicel');
  p_csc6610   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_csc6610');
  p_znh1140   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_znh1140');
  p_znh0092   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_znh0092');
begin
  insert into public.mechanisms_of_action (id, space_id, created_by, name, abbreviation, description, display_order) values
    (moa_sglt2,          p_space_id, p_uid, 'SGLT2 inhibitor',              'SGLT2i',   'Blocks sodium-glucose co-transporter 2 in the kidney.',            1),
    (moa_glp1,           p_space_id, p_uid, 'GLP-1 receptor agonist',       'GLP-1 RA', 'Activates the GLP-1 receptor to increase insulin secretion.',       2),
    (moa_glp1_gip,       p_space_id, p_uid, 'GIP/GLP-1 dual agonist',      'GIP/GLP-1','Dual activation of GIP and GLP-1 receptors.',                      3),
    (moa_sgc,            p_space_id, p_uid, 'sGC stimulator',               'sGC',      'Stimulates soluble guanylate cyclase to increase cGMP.',            4),
    (moa_ttr,            p_space_id, p_uid, 'TTR stabilizer',               'TTR',      'Stabilizes the transthyretin tetramer to prevent amyloid formation.',5),
    (moa_nsmra,          p_space_id, p_uid, 'Non-steroidal MRA',            'nsMRA',    'Non-steroidal mineralocorticoid receptor antagonist.',               6),
    (moa_cardiac_myosin, p_space_id, p_uid, 'Cardiac myosin modulator',     'CMM',      'Modulates cardiac myosin to improve contractility.',                7),
    (moa_investigational,p_space_id, p_uid, 'Investigational (undisclosed)', null,       'Early-stage asset, target not yet disclosed.',                      99);

  insert into public.routes_of_administration (id, space_id, created_by, name, abbreviation, display_order) values
    (roa_oral,        p_space_id, p_uid, 'Oral',          'PO',  1),
    (roa_iv,          p_space_id, p_uid, 'Intravenous',   'IV',  2),
    (roa_sc,          p_space_id, p_uid, 'Subcutaneous',  'SC',  3),
    (roa_inhaled,     p_space_id, p_uid, 'Inhaled',       'INH', 4),
    (roa_im,          p_space_id, p_uid, 'Intramuscular', 'IM',  5),
    (roa_topical,     p_space_id, p_uid, 'Topical',       'TOP', 6),
    (roa_intrathecal, p_space_id, p_uid, 'Intrathecal',   'IT',  7);

  insert into public.product_mechanisms_of_action (product_id, moa_id) values
    (p_zelvox,    moa_sglt2),
    (p_restivon,  moa_glp1),
    (p_mrd4471,   moa_investigational),
    (p_cardivant, moa_cardiac_myosin),
    (p_renoquil,  moa_nsmra),
    (p_hls2289,   moa_investigational),
    (p_glytara,   moa_glp1_gip),
    (p_oxavance,  moa_sgc),
    (p_vbx7803,   moa_investigational),
    (p_thyravex,  moa_ttr),
    (p_apx1150,   moa_investigational),
    (p_venatris,  moa_sgc),
    (p_crd3300,   moa_investigational),
    (p_ketavora,  moa_nsmra),
    (p_lumivex,   moa_sglt2),
    (p_slr8820,   moa_investigational),
    (p_pravicel,  moa_cardiac_myosin),
    (p_csc6610,   moa_investigational),
    (p_znh1140,   moa_investigational),
    (p_znh0092,   moa_investigational);

  insert into public.product_routes_of_administration (product_id, roa_id) values
    (p_zelvox,    roa_oral),
    (p_restivon,  roa_sc),
    (p_mrd4471,   roa_oral),
    (p_cardivant, roa_oral),
    (p_renoquil,  roa_oral),
    (p_hls2289,   roa_iv),
    (p_glytara,   roa_sc),
    (p_glytara,   roa_oral),
    (p_oxavance,  roa_oral),
    (p_vbx7803,   roa_inhaled),
    (p_thyravex,  roa_oral),
    (p_apx1150,   roa_oral),
    (p_venatris,  roa_oral),
    (p_crd3300,   roa_iv),
    (p_ketavora,  roa_oral),
    (p_lumivex,   roa_oral),
    (p_slr8820,   roa_im),
    (p_pravicel,  roa_oral),
    (p_csc6610,   roa_topical),
    (p_znh1140,   roa_inhaled),
    (p_znh0092,   roa_intrathecal);
end;
$$;

-- =============================================================================
-- 7. helper: _seed_demo_trials
-- =============================================================================

create or replace function public._seed_demo_trials(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  p_zelvox    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_zelvox');
  p_restivon  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_restivon');
  p_mrd4471   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_mrd4471');
  p_cardivant uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_cardivant');
  p_renoquil  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_renoquil');
  p_hls2289   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_hls2289');
  p_glytara   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_glytara');
  p_oxavance  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_oxavance');
  p_vbx7803   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vbx7803');
  p_thyravex  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_thyravex');
  p_apx1150   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_apx1150');
  p_venatris  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_venatris');
  p_crd3300   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_crd3300');
  p_ketavora  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_ketavora');
  p_lumivex   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_lumivex');
  p_slr8820   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_slr8820');
  p_pravicel  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_pravicel');
  p_csc6610   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_csc6610');
  p_znh1140   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_znh1140');
  p_znh0092   uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_znh0092');

  ta_hf      uuid := (select id from _seed_ids where entity_type = 'ta' and key = 'ta_hf');
  ta_ckd     uuid := (select id from _seed_ids where entity_type = 'ta' and key = 'ta_ckd');
  ta_t2d     uuid := (select id from _seed_ids where entity_type = 'ta' and key = 'ta_t2d');
  ta_obesity uuid := (select id from _seed_ids where entity_type = 'ta' and key = 'ta_obesity');

  t_cardio_shield  uuid := gen_random_uuid();
  t_renal_guard    uuid := gen_random_uuid();
  t_fortify_hf     uuid := gen_random_uuid();
  t_heart_preserve uuid := gen_random_uuid();
  t_myocard_1      uuid := gen_random_uuid();
  t_nephro_clear   uuid := gen_random_uuid();
  t_glyco_advance  uuid := gen_random_uuid();
  t_trim_1         uuid := gen_random_uuid();

  t_mrd_preclin    uuid := gen_random_uuid();
  t_hls_early      uuid := gen_random_uuid();
  t_pulse_hf       uuid := gen_random_uuid();
  t_vbx_scout      uuid := gen_random_uuid();
  t_atlas_hf       uuid := gen_random_uuid();
  t_apx_scout      uuid := gen_random_uuid();
  t_valor_hf       uuid := gen_random_uuid();
  t_crd_probe      uuid := gen_random_uuid();
  t_minerva_hf     uuid := gen_random_uuid();
  t_renal_nova     uuid := gen_random_uuid();
  t_echo_hf        uuid := gen_random_uuid();
  t_csc_preclin    uuid := gen_random_uuid();
  t_slr_mid        uuid := gen_random_uuid();
  t_znh_scout      uuid := gen_random_uuid();
  t_znh_neuro      uuid := gen_random_uuid();
  t_restivon_step  uuid := gen_random_uuid();
  t_glytara_meta   uuid := gen_random_uuid();
  t_lumivex_renal  uuid := gen_random_uuid();
begin
  -- Timeline trials (8, completed, historical)
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id,
    name, identifier, sample_size, status, display_order,
    phase_type, phase_start_date, phase_end_date) values
    (t_cardio_shield,  p_space_id, p_uid, p_zelvox,    ta_hf,      'CARDIO-SHIELD',   'NCT05001001', 4744, 'Completed', 1, 'LAUNCHED',  '2020-05-05', null),
    (t_renal_guard,    p_space_id, p_uid, p_zelvox,    ta_ckd,     'RENAL-GUARD',     'NCT05001002', 4304, 'Completed', 2, 'P4',        '2021-06-01', '2024-12-31'),
    (t_fortify_hf,     p_space_id, p_uid, p_zelvox,    ta_hf,      'FORTIFY-HF',      'NCT05001003', 6263, 'Completed', 3, 'P3',        '2018-08-01', '2022-05-31'),
    (t_heart_preserve, p_space_id, p_uid, p_cardivant, ta_hf,      'HEART-PRESERVE',  'NCT05002001', 5988, 'Completed', 1, 'APPROVED',  '2022-02-24', null),
    (t_myocard_1,      p_space_id, p_uid, p_cardivant, ta_hf,      'MYOCARD-1',       'NCT05002002', 3730, 'Completed', 2, 'P3',        '2017-03-01', '2020-06-30'),
    (t_nephro_clear,   p_space_id, p_uid, p_renoquil,  ta_ckd,     'NEPHRO-CLEAR',    'NCT05003001', 6609, 'Completed', 1, 'P3',        '2019-05-01', '2022-11-30'),
    (t_glyco_advance,  p_space_id, p_uid, p_glytara,   ta_t2d,     'GLYCO-ADVANCE',   'NCT05004001',  478, 'Completed', 1, 'P3',        '2019-06-01', '2021-05-31'),
    (t_trim_1,         p_space_id, p_uid, p_restivon,  ta_obesity, 'TRIM-1',           'NCT05005001', 1961, 'Completed', 1, 'P3',        '2018-06-01', '2021-03-31');

  -- Landscape trials (18)
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id,
    name, identifier, sample_size, status, display_order,
    phase_type, phase_start_date, phase_end_date) values
    (t_mrd_preclin,   p_space_id, p_uid, p_mrd4471,   ta_hf,      'MRD-PRECLIN',     null,           120,  'Active',     1, 'PRECLIN',  '2025-06-01', null),
    (t_csc_preclin,   p_space_id, p_uid, p_csc6610,   ta_hf,      'CSC-PRECLIN',     null,            40,  'Active',     1, 'PRECLIN',  '2025-02-01', null),
    (t_znh_neuro,     p_space_id, p_uid, p_znh0092,   ta_ckd,     'ZNH-RENAL-EARLY', null,            30,  'Active',     1, 'PRECLIN',  '2025-09-01', null),
    (t_hls_early,     p_space_id, p_uid, p_hls2289,   ta_hf,      'HLS-EARLY-HF',    null,            80,  'Recruiting', 1, 'P1',       '2024-02-01', null),
    (t_vbx_scout,     p_space_id, p_uid, p_vbx7803,   ta_hf,      'VBX-SCOUT',       null,           150,  'Recruiting', 1, 'P1',       '2024-01-01', null),
    (t_znh_scout,     p_space_id, p_uid, p_znh1140,   ta_hf,      'ZNH-SCOUT-HF',    null,           180,  'Recruiting', 1, 'P1',       '2024-03-01', null),
    (t_apx_scout,     p_space_id, p_uid, p_apx1150,   ta_hf,      'APX-PROBE-HF',    'NCT05006001',  300,  'Active',     1, 'P2',       '2023-10-01', null),
    (t_crd_probe,     p_space_id, p_uid, p_crd3300,   ta_hf,      'CRD-PROBE-HF',    'NCT05007001',  600,  'Active',     1, 'P2',       '2023-06-01', null),
    (t_slr_mid,       p_space_id, p_uid, p_slr8820,   ta_ckd,     'SLR-RENAL-MID',   'NCT05008001',  900,  'Active',     1, 'P2',       '2023-04-01', null),
    (t_pulse_hf,      p_space_id, p_uid, p_oxavance,  ta_hf,      'PULSE-HF',        'NCT05009001', 4500,  'Active',     1, 'P3',       '2022-01-01', null),
    (t_echo_hf,       p_space_id, p_uid, p_pravicel,  ta_hf,      'ECHO-HF',         'NCT05010001', 3200,  'Active',     1, 'P3',       '2021-06-01', null),
    (t_lumivex_renal, p_space_id, p_uid, p_lumivex,   ta_ckd,     'RENAL-NOVA',      'NCT05011001', 4200,  'Active',     1, 'P3',       '2022-03-01', null),
    (t_restivon_step, p_space_id, p_uid, p_restivon,  ta_obesity, 'RESTIVON-STEP',   'NCT05012001', 2800,  'Active',     2, 'P3',       '2023-01-01', null),
    (t_glytara_meta,  p_space_id, p_uid, p_glytara,   ta_t2d,     'GLYTARA-META',    'NCT05013001', 1500,  'Active',     2, 'P2',       '2024-06-01', null),
    (t_renal_nova,    p_space_id, p_uid, p_renoquil,  ta_hf,      'RENOQUIL-HF',     'NCT05014001', 2400,  'Active',     2, 'P3',       '2023-02-01', null),
    (t_valor_hf,      p_space_id, p_uid, p_venatris,  ta_hf,      'VALOR-HF',        'NCT05015001', 5050,  'Completed',  1, 'APPROVED', '2021-01-19', null),
    (t_minerva_hf,    p_space_id, p_uid, p_ketavora,  ta_hf,      'MINERVA-HF',      'NCT05016001', 6016,  'Completed',  1, 'APPROVED', '2021-07-09', null),
    (t_atlas_hf,      p_space_id, p_uid, p_thyravex,  ta_hf,      'ATLAS-HF',        'NCT05017001',  441,  'Completed',  1, 'LAUNCHED', '2019-06-01', null);

  -- CT.gov dimension enrichment (10 trials)
  update public.trials set
    recruitment_status = 'Completed', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_intervention_model = 'Parallel Assignment',
    design_masking = 'Double', design_primary_purpose = 'Treatment',
    conditions = array['Heart Failure with Reduced Ejection Fraction'],
    intervention_type = 'Drug', intervention_name = 'cortagliflozin 10mg',
    primary_outcome_measures = array['Time to first occurrence of CV death or HF hospitalization'],
    secondary_outcome_measures = array['Change in KCCQ-TSS from baseline', 'All-cause mortality'],
    eligibility_sex = 'All', eligibility_min_age = '18 Years', eligibility_max_age = '85 Years',
    start_date = '2017-04-11', start_date_type = 'Actual',
    primary_completion_date = '2019-09-30', primary_completion_date_type = 'Actual',
    has_dmc = true, is_fda_regulated_drug = true, is_fda_regulated_device = false
  where id = t_cardio_shield;

  update public.trials set
    recruitment_status = 'Completed', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_masking = 'Double',
    conditions = array['Chronic Kidney Disease'],
    intervention_type = 'Drug', intervention_name = 'cortagliflozin 10mg',
    primary_outcome_measures = array['Composite of sustained eGFR decline, ESKD, or renal/CV death'],
    has_dmc = true, is_fda_regulated_drug = true
  where id = t_renal_guard;

  update public.trials set
    recruitment_status = 'Active, not recruiting', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_masking = 'Double',
    conditions = array['Heart Failure'],
    intervention_type = 'Drug', intervention_name = 'trebariguat 5mg',
    primary_outcome_measures = array['Composite of CV death or HF hospitalization'],
    has_dmc = true, is_fda_regulated_drug = true
  where id = t_pulse_hf;

  update public.trials set
    recruitment_status = 'Recruiting', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_masking = 'Double',
    conditions = array['Heart Failure with Preserved Ejection Fraction'],
    intervention_type = 'Drug', intervention_name = 'cascamyosin 20mg',
    primary_outcome_measures = array['Change in NT-proBNP from baseline at 12 months'],
    has_dmc = true, is_fda_regulated_drug = true
  where id = t_echo_hf;

  update public.trials set
    recruitment_status = 'Active, not recruiting', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_masking = 'Double',
    conditions = array['Chronic Kidney Disease'],
    intervention_type = 'Drug', intervention_name = 'solagliflozin 400mg',
    primary_outcome_measures = array['Composite of sustained eGFR decline, ESKD, or death'],
    has_dmc = true, is_fda_regulated_drug = true
  where id = t_lumivex_renal;

  update public.trials set
    recruitment_status = 'Recruiting', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_masking = 'Triple',
    conditions = array['Obesity'],
    intervention_type = 'Drug', intervention_name = 'duralutide 2.4mg SC weekly',
    primary_outcome_measures = array['Percent change in body weight from baseline at 68 weeks'],
    secondary_outcome_measures = array['Proportion achieving >= 5% weight loss', 'Change in waist circumference'],
    eligibility_sex = 'All', eligibility_min_age = '18 Years', eligibility_max_age = '75 Years',
    has_dmc = true, is_fda_regulated_drug = true
  where id = t_restivon_step;

  update public.trials set
    recruitment_status = 'Completed', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_masking = 'Double',
    conditions = array['Type 2 Diabetes Mellitus'],
    intervention_type = 'Drug', intervention_name = 'vantizepatide 15mg SC weekly',
    primary_outcome_measures = array['Change in HbA1c from baseline at 40 weeks'],
    has_dmc = true, is_fda_regulated_drug = true
  where id = t_glyco_advance;

  update public.trials set
    recruitment_status = 'Completed', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_masking = 'Double',
    conditions = array['Heart Failure with Preserved Ejection Fraction'],
    intervention_type = 'Drug', intervention_name = 'emparivat 5mg',
    primary_outcome_measures = array['Composite of CV death or HF hospitalization'],
    has_dmc = true, is_fda_regulated_drug = true
  where id = t_heart_preserve;

  update public.trials set
    recruitment_status = 'Recruiting', study_type = 'Interventional', phase = 'Phase 1',
    design_allocation = 'Non-Randomized', design_masking = 'None (Open Label)',
    conditions = array['Heart Failure'],
    intervention_type = 'Drug', intervention_name = 'HLS-2289 escalating doses IV',
    primary_outcome_measures = array['Incidence of dose-limiting toxicities', 'Maximum tolerated dose'],
    has_dmc = false, is_fda_regulated_drug = true
  where id = t_hls_early;

  update public.trials set
    recruitment_status = 'Completed', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_masking = 'Double',
    conditions = array['Chronic Kidney Disease', 'Type 2 Diabetes'],
    intervention_type = 'Drug', intervention_name = 'benafinerone 20mg',
    primary_outcome_measures = array['Time to kidney failure, sustained eGFR decline, or renal death'],
    has_dmc = true, is_fda_regulated_drug = true
  where id = t_nephro_clear;

  -- Register trial IDs
  insert into _seed_ids (entity_type, key, id) values
    ('trial', 't_cardio_shield',  t_cardio_shield),
    ('trial', 't_renal_guard',    t_renal_guard),
    ('trial', 't_fortify_hf',     t_fortify_hf),
    ('trial', 't_heart_preserve', t_heart_preserve),
    ('trial', 't_myocard_1',      t_myocard_1),
    ('trial', 't_nephro_clear',   t_nephro_clear),
    ('trial', 't_glyco_advance',  t_glyco_advance),
    ('trial', 't_trim_1',         t_trim_1),
    ('trial', 't_mrd_preclin',    t_mrd_preclin),
    ('trial', 't_hls_early',      t_hls_early),
    ('trial', 't_pulse_hf',       t_pulse_hf),
    ('trial', 't_vbx_scout',      t_vbx_scout),
    ('trial', 't_atlas_hf',       t_atlas_hf),
    ('trial', 't_apx_scout',      t_apx_scout),
    ('trial', 't_valor_hf',       t_valor_hf),
    ('trial', 't_crd_probe',      t_crd_probe),
    ('trial', 't_minerva_hf',     t_minerva_hf),
    ('trial', 't_renal_nova',     t_renal_nova),
    ('trial', 't_echo_hf',        t_echo_hf),
    ('trial', 't_csc_preclin',    t_csc_preclin),
    ('trial', 't_slr_mid',        t_slr_mid),
    ('trial', 't_znh_scout',      t_znh_scout),
    ('trial', 't_znh_neuro',      t_znh_neuro),
    ('trial', 't_restivon_step',  t_restivon_step),
    ('trial', 't_glytara_meta',   t_glytara_meta),
    ('trial', 't_lumivex_renal',  t_lumivex_renal);
end;
$$;

-- =============================================================================
-- 8. helper: _seed_demo_markers
-- =============================================================================

create or replace function public._seed_demo_markers(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  t_cardio_shield  uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_cardio_shield');
  t_renal_guard    uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_renal_guard');
  t_fortify_hf     uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_fortify_hf');
  t_heart_preserve uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_heart_preserve');
  t_myocard_1      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_myocard_1');
  t_nephro_clear   uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_nephro_clear');
  t_glyco_advance  uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_glyco_advance');
  t_trim_1         uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_trim_1');
  t_mrd_preclin    uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_mrd_preclin');
  t_hls_early      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_hls_early');
  t_pulse_hf       uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_pulse_hf');
  t_vbx_scout      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_vbx_scout');
  t_atlas_hf       uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_atlas_hf');
  t_apx_scout      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_apx_scout');
  t_valor_hf       uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_valor_hf');
  t_crd_probe      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_crd_probe');
  t_minerva_hf     uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_minerva_hf');
  t_renal_nova     uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_renal_nova');
  t_echo_hf        uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_echo_hf');
  t_csc_preclin    uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_csc_preclin');
  t_slr_mid        uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_slr_mid');
  t_znh_scout      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_znh_scout');
  t_restivon_step  uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_restivon_step');
  t_glytara_meta   uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_glytara_meta');
  t_lumivex_renal  uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_lumivex_renal');

  m_cardio_data    uuid := gen_random_uuid();
  m_heart_filing   uuid := gen_random_uuid();
  m_nephro_proj    uuid := gen_random_uuid();
  m_pulse_topline  uuid := gen_random_uuid();
  m_echo_interim   uuid := gen_random_uuid();
begin
  -- CARDIO-SHIELD (LAUNCHED) -- 5 markers: full lifecycle
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, description, source_url) values
    (m_cardio_data,    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'CARDIO-SHIELD primary results presented at ESC 2019',   'actual',  '2019-09-19', 'Significant reduction in composite of CV death and HF hospitalization (HR 0.74, p<0.001).', 'https://example.com/cardio-shield-esc2019'),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000033', 'sNDA submitted to FDA for HFrEF',                       'actual',  '2020-01-15', 'Supplemental NDA based on CARDIO-SHIELD pivotal data.', null),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'FDA approval for HFrEF',                                'actual',  '2020-05-05', null, null),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000036', 'Zelvox US launch for HFrEF',                            'actual',  '2020-07-01', null, null),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000008', 'CARDIO-SHIELD primary completion',                      'actual',  '2019-09-30', null, null);
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_cardio_shield from public.markers where space_id = p_space_id and title in (
      'CARDIO-SHIELD primary results presented at ESC 2019', 'sNDA submitted to FDA for HFrEF',
      'FDA approval for HFrEF', 'Zelvox US launch for HFrEF', 'CARDIO-SHIELD primary completion');

  -- RENAL-GUARD (P4) -- 3 markers
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, description, source_url) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'RENAL-GUARD topline results announced',                'actual',  '2020-09-24', 'Met primary endpoint: 39% reduction in composite renal endpoint.', 'https://example.com/renal-guard-topline'),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000033', 'sNDA submitted for CKD',                               'actual',  '2021-02-15', null, null),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000008', 'RENAL-GUARD primary completion',                       'actual',  '2020-06-30', null, null);
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_renal_guard from public.markers where space_id = p_space_id and title in (
      'RENAL-GUARD topline results announced', 'sNDA submitted for CKD', 'RENAL-GUARD primary completion');

  -- FORTIFY-HF (P3) -- 3 markers, one projected
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'FORTIFY-HF results expected at ESC 2022',              'company', '2022-08-01'),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000031', 'FORTIFY-HF full results published in NEJM',            'actual',  '2022-08-26'),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000008', 'FORTIFY-HF primary completion',                        'actual',  '2022-05-31');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_fortify_hf from public.markers where space_id = p_space_id and title in (
      'FORTIFY-HF results expected at ESC 2022', 'FORTIFY-HF full results published in NEJM', 'FORTIFY-HF primary completion');

  -- HEART-PRESERVE (APPROVED) -- 4 markers incl NLE
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, no_longer_expected, description) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'HEART-PRESERVE results presented at ESC 2021',         'actual',  '2021-08-27', false, 'First positive outcome trial for HFpEF. Major unmet need addressed.'),
    (m_heart_filing,    p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000033', 'sNDA submitted for HFpEF',                             'actual',  '2022-02-24', false, null),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'FDA approval for HFpEF',                               'actual',  '2022-06-15', false, null),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Planned pediatric filing no longer expected',           'actual',  '2023-06-01', true,  'Sponsor discontinued pediatric development program.');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_heart_preserve from public.markers where space_id = p_space_id and title in (
      'HEART-PRESERVE results presented at ESC 2021', 'sNDA submitted for HFpEF',
      'FDA approval for HFpEF', 'Planned pediatric filing no longer expected');

  -- MYOCARD-1 (P3) -- 3 markers incl NLE
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, no_longer_expected) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'MYOCARD-1 results presented at ESC 2020',              'actual',  '2020-06-29', false),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000033', 'sNDA submitted for HFrEF (Cardivant)',                  'actual',  '2020-11-15', false),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000008', 'MYOCARD-1 extension study cancelled',                  'actual',  '2021-06-01', true);
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_myocard_1 from public.markers where space_id = p_space_id and title in (
      'MYOCARD-1 results presented at ESC 2020', 'sNDA submitted for HFrEF (Cardivant)', 'MYOCARD-1 extension study cancelled');

  -- NEPHRO-CLEAR (P3) -- 3 markers incl range marker
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, end_date, description) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'NEPHRO-CLEAR results presented at ASN 2022',           'actual',  '2022-11-04', null, 'Significant reduction in composite kidney endpoint.'),
    (m_nephro_proj,     p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'NEPHRO-CLEAR regulatory filing projected',             'company', '2023-03-01', null, null),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000036', 'Estimated CKD launch window',                          'company', '2023-06-01', '2024-03-31', 'Range reflects expected FDA review timeline.');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_nephro_clear from public.markers where space_id = p_space_id and title in (
      'NEPHRO-CLEAR results presented at ASN 2022', 'NEPHRO-CLEAR regulatory filing projected', 'Estimated CKD launch window');

  -- GLYCO-ADVANCE (P3) -- 2 markers
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'GLYCO-ADVANCE topline results announced',              'actual',  '2021-05-28'),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000033', 'Glytara NDA submitted to FDA',                         'actual',  '2022-05-13');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_glyco_advance from public.markers where space_id = p_space_id and title in (
      'GLYCO-ADVANCE topline results announced', 'Glytara NDA submitted to FDA');

  -- TRIM-1 (P3) -- 3 markers
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, source_url) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000031', 'TRIM-1 full results published in NEJM',                'actual',  '2021-02-10', 'https://example.com/trim1-nejm'),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000033', 'sNDA submitted for obesity (Restivon)',                 'actual',  '2021-12-04', null),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'FDA approval for obesity projected',                   'company', '2022-06-01', null);
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_trim_1 from public.markers where space_id = p_space_id and title in (
      'TRIM-1 full results published in NEJM', 'sNDA submitted for obesity (Restivon)', 'FDA approval for obesity projected');

  -- ATLAS-HF (LAUNCHED)
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'ATLAS-HF topline data reported',  'actual', '2018-09-01'),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000036', 'Thyravex US launch',              'actual', '2019-06-01');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_atlas_hf from public.markers where space_id = p_space_id and title in ('ATLAS-HF topline data reported', 'Thyravex US launch');

  -- VALOR-HF (APPROVED)
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, description, source_url) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'VALOR-HF data reported',          'actual', '2019-11-10', 'Modest but significant benefit in worsening HF events.', 'https://example.com/valor-hf-nejm'),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000033', 'Venatris NDA submitted',          'actual', '2020-08-15', null, 'https://example.com/venatris-nda-filing');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_valor_hf from public.markers where space_id = p_space_id and title in ('VALOR-HF data reported', 'Venatris NDA submitted');

  -- MINERVA-HF (APPROVED)
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, source_url) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'MINERVA-HF topline data',         'actual', '2024-05-13', 'https://example.com/minerva-hf-data'),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000033', 'Ketavora sNDA submitted for HFmrEF/HFpEF', 'actual', '2024-09-20', 'https://example.com/ketavora-snda');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_minerva_hf from public.markers where space_id = p_space_id and title in ('MINERVA-HF topline data', 'Ketavora sNDA submitted for HFmrEF/HFpEF');

  -- Trial Start markers
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000011', 'MRD-PRECLIN study initiated',     'actual', '2025-06-01'),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000011', 'HLS-EARLY-HF first patient in',   'actual', '2024-02-15'),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000011', 'VBX-SCOUT first patient in',      'actual', '2024-01-20');
  insert into public.marker_assignments (marker_id, trial_id)
    select m.id, case m.title
      when 'MRD-PRECLIN study initiated'   then t_mrd_preclin
      when 'HLS-EARLY-HF first patient in' then t_hls_early
      when 'VBX-SCOUT first patient in'    then t_vbx_scout
    end
    from public.markers m where m.space_id = p_space_id and m.title in (
      'MRD-PRECLIN study initiated', 'HLS-EARLY-HF first patient in', 'VBX-SCOUT first patient in');

  -- Trial End markers
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000012', 'MYOCARD-1 study completed',       'actual', '2020-06-30'),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000012', 'GLYCO-ADVANCE study completed',   'actual', '2021-05-31');
  insert into public.marker_assignments (marker_id, trial_id)
    select m.id, case m.title
      when 'MYOCARD-1 study completed'     then t_myocard_1
      when 'GLYCO-ADVANCE study completed' then t_glyco_advance
    end
    from public.markers m where m.space_id = p_space_id and m.title in (
      'MYOCARD-1 study completed', 'GLYCO-ADVANCE study completed');

  -- FUTURE CATALYSTS (event_date >= 2026-04-14)
  -- PULSE-HF
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, description, source_url) values
    (m_pulse_topline, p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'PULSE-HF topline data readout',       'company', '2026-06-15', 'Primary endpoint readout expected at ESC 2026.', 'https://example.com/pulse-hf-timeline'),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Oxavance HF sNDA filing projected', 'company', '2026-12-01', 'Contingent on positive PULSE-HF results.', 'https://example.com/oxavance-regulatory-plan'),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000008', 'PULSE-HF primary completion projected', 'company', '2026-08-01', null, null);
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_pulse_hf from public.markers where space_id = p_space_id and title in (
      'PULSE-HF topline data readout', 'Oxavance HF sNDA filing projected', 'PULSE-HF primary completion projected');

  -- ECHO-HF
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, description, source_url) values
    (m_echo_interim, p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000030', 'ECHO-HF interim analysis at AHA 2026', 'company', '2026-05-10', 'Pre-specified interim look by independent DSMB.', 'https://example.com/echo-hf-dsmb-plan'),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'ECHO-HF topline results projected', 'company', '2026-11-01', null, null);
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_echo_hf from public.markers where space_id = p_space_id and title in (
      'ECHO-HF interim analysis at AHA 2026', 'ECHO-HF topline results projected');

  -- RENAL-NOVA (primary projection)
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'RENAL-NOVA topline data projected', 'primary', '2026-09-01');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_lumivex_renal from public.markers where space_id = p_space_id and title = 'RENAL-NOVA topline data projected';

  -- RENOQUIL-HF
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'RENOQUIL-HF topline results', 'company', '2026-07-15'),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Renoquil HF regulatory filing projected', 'company', '2027-01-15');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_renal_nova from public.markers where space_id = p_space_id and title in (
      'RENOQUIL-HF topline results', 'Renoquil HF regulatory filing projected');

  -- RESTIVON-STEP (includes range marker with end_date for readout window)
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, end_date, description, source_url) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'RESTIVON-STEP topline data projected', 'company', '2026-08-01', '2026-10-31', '68-week primary endpoint readout. Window reflects potential delay due to enrollment pace.', 'https://example.com/restivon-step-timeline');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_restivon_step from public.markers where space_id = p_space_id and title = 'RESTIVON-STEP topline data projected';

  -- CRD-PROBE-HF regulatory pathway (includes range marker with end_date)
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, end_date) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000033', 'CRD-PROBE NDA submission projected',  'company', '2026-05-20', null),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000034', 'CRD-PROBE FDA acceptance projected',  'company', '2026-08-01', null),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000035', 'CRD-PROBE PDUFA date projected',      'company', '2027-03-01', null),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000036', 'CRD-PROBE estimated launch window',   'company', '2027-06-01', '2027-12-31');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_crd_probe from public.markers where space_id = p_space_id and title in (
      'CRD-PROBE NDA submission projected', 'CRD-PROBE FDA acceptance projected', 'CRD-PROBE PDUFA date projected', 'CRD-PROBE estimated launch window');

  -- SLR-RENAL-MID
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000013', 'SLR-RENAL-MID P2 topline data projected', 'company', '2026-06-01');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_slr_mid from public.markers where space_id = p_space_id and title = 'SLR-RENAL-MID P2 topline data projected';

  -- ZNH-SCOUT-HF
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000008', 'ZNH-SCOUT P1 completion projected', 'company', '2026-09-30');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_znh_scout from public.markers where space_id = p_space_id and title = 'ZNH-SCOUT P1 completion projected';

  -- LOE markers
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000020', 'Ketavora US patent expiry',    'actual',  '2027-07-15'),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000020', 'Zelvox US LOE projected',      'actual',  '2027-10-01'),
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000021', 'Zelvox generic entry expected', 'company', '2027-12-01');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_minerva_hf from public.markers where space_id = p_space_id and title = 'Ketavora US patent expiry';
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_cardio_shield from public.markers where space_id = p_space_id and title in ('Zelvox US LOE projected', 'Zelvox generic entry expected');

  -- Shared marker: many-to-many assignment
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, description) values
    (gen_random_uuid(), p_space_id, p_uid, 'a0000000-0000-0000-0000-000000000032', 'Zelvox HF+CKD label expansion filing', 'company', '2026-04-28', 'Combined filing based on CARDIO-SHIELD and RENAL-GUARD data.');
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_cardio_shield from public.markers where space_id = p_space_id and title = 'Zelvox HF+CKD label expansion filing';
  insert into public.marker_assignments (marker_id, trial_id)
    select id, t_renal_guard from public.markers where space_id = p_space_id and title = 'Zelvox HF+CKD label expansion filing';

  -- Register named marker IDs for notifications
  insert into _seed_ids (entity_type, key, id) values
    ('marker', 'm_cardio_data',   m_cardio_data),
    ('marker', 'm_heart_filing',  m_heart_filing),
    ('marker', 'm_nephro_proj',   m_nephro_proj),
    ('marker', 'm_pulse_topline', m_pulse_topline),
    ('marker', 'm_echo_interim',  m_echo_interim);
end;
$$;

-- =============================================================================
-- 9. helper: _seed_demo_trial_notes
-- =============================================================================

create or replace function public._seed_demo_trial_notes(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  t_cardio_shield  uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_cardio_shield');
  t_renal_guard    uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_renal_guard');
  t_heart_preserve uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_heart_preserve');
  t_trim_1         uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_trim_1');
  t_pulse_hf       uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_pulse_hf');
  t_echo_hf        uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_echo_hf');
  t_lumivex_renal  uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_lumivex_renal');
  t_restivon_step  uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_restivon_step');
  t_hls_early      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_hls_early');
  t_nephro_clear   uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_nephro_clear');
  t_glyco_advance  uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_glyco_advance');
  t_apx_scout      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_apx_scout');
begin
  insert into public.trial_notes (id, space_id, created_by, trial_id, content) values
    (gen_random_uuid(), p_space_id, p_uid, t_cardio_shield,  'Landmark trial establishing SGLT2i in HFrEF. Changed ESC treatment guidelines.'),
    (gen_random_uuid(), p_space_id, p_uid, t_renal_guard,    'First SGLT2i approved for CKD regardless of diabetes status. Broad label.'),
    (gen_random_uuid(), p_space_id, p_uid, t_heart_preserve, 'First positive trial for HFpEF. Major unmet need addressed.'),
    (gen_random_uuid(), p_space_id, p_uid, t_trim_1,         'Demonstrated ~15% body weight reduction at 68 weeks. Pivotal for obesity indication.'),
    (gen_random_uuid(), p_space_id, p_uid, t_pulse_hf,       'Enrollment complete. Primary endpoint readout expected H2 2026.'),
    (gen_random_uuid(), p_space_id, p_uid, t_echo_hf,        'Protocol amended to add biomarker secondary endpoint after DSMB recommendation.'),
    (gen_random_uuid(), p_space_id, p_uid, t_lumivex_renal,  'Enrollment ahead of schedule. 85% of target reached.'),
    (gen_random_uuid(), p_space_id, p_uid, t_restivon_step,  'Actively enrolling across 180 sites in North America and Europe.'),
    (gen_random_uuid(), p_space_id, p_uid, t_hls_early,      'Dose escalation ongoing. Cohort 3 of 5 completed. No DLTs observed.'),
    (gen_random_uuid(), p_space_id, p_uid, t_nephro_clear,   'Post-hoc analysis suggests greater benefit in patients with albuminuria > 200 mg/g.'),
    (gen_random_uuid(), p_space_id, p_uid, t_glyco_advance,  'HbA1c reduction exceeded expectations. Regulatory strategy under review for expanded label.'),
    (gen_random_uuid(), p_space_id, p_uid, t_apx_scout,      'Phase 2 dose-ranging study. Adaptive design with interim futility analysis planned.');
end;
$$;

-- =============================================================================
-- 1. replace _seed_demo_companies with real pharma names + logo URLs
-- =============================================================================
-- Mapping (variable key -> new name):
--   c_meridian  -> AstraZeneca       (SGLT2i anchor, maps to Zelvox)
--   c_helios    -> Bristol-Myers Squibb (cardiac myosin, maps to Cardivant)
--   c_vantage   -> Novo Nordisk      (GLP-1/GIP, maps to Glytara)
--   c_apex      -> Pfizer            (TTR stabilizer, maps to Thyravex)
--   c_cardinal  -> Merck             (sGC, maps to Venatris)
--   c_solara    -> Bayer             (nsMRA, maps to Ketavora)
--   c_cascade   -> Boehringer Ingelheim (cardiac myosin, maps to Pravicel)
--   c_zenith    -> GSK               (early stage)

create or replace function public._seed_demo_companies(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_meridian  uuid := gen_random_uuid();
  c_helios    uuid := gen_random_uuid();
  c_vantage   uuid := gen_random_uuid();
  c_apex      uuid := gen_random_uuid();
  c_cardinal  uuid := gen_random_uuid();
  c_solara    uuid := gen_random_uuid();
  c_cascade   uuid := gen_random_uuid();
  c_zenith    uuid := gen_random_uuid();
begin
  insert into public.companies (id, space_id, created_by, name, logo_url, display_order) values
    (c_meridian, p_space_id, p_uid, 'AstraZeneca',          'https://cdn.brandfetch.io/domain/astrazeneca.com',          1),
    (c_helios,   p_space_id, p_uid, 'Bristol-Myers Squibb', 'https://cdn.brandfetch.io/domain/bms.com',                 2),
    (c_vantage,  p_space_id, p_uid, 'Novo Nordisk',         'https://cdn.brandfetch.io/domain/novonordisk.com',         3),
    (c_apex,     p_space_id, p_uid, 'Pfizer',               'https://cdn.brandfetch.io/domain/pfizer.com',              4),
    (c_cardinal, p_space_id, p_uid, 'Merck',                'https://cdn.brandfetch.io/domain/merck.com',               5),
    (c_solara,   p_space_id, p_uid, 'Bayer',                'https://cdn.brandfetch.io/domain/bayer.com',               6),
    (c_cascade,  p_space_id, p_uid, 'Boehringer Ingelheim', 'https://cdn.brandfetch.io/domain/boehringer-ingelheim.com', 7),
    (c_zenith,   p_space_id, p_uid, 'GSK',                  'https://cdn.brandfetch.io/domain/gsk.com',                 8);

  insert into _seed_ids (entity_type, key, id) values
    ('company', 'c_meridian',  c_meridian),
    ('company', 'c_helios',    c_helios),
    ('company', 'c_vantage',   c_vantage),
    ('company', 'c_apex',      c_apex),
    ('company', 'c_cardinal',  c_cardinal),
    ('company', 'c_solara',    c_solara),
    ('company', 'c_cascade',   c_cascade),
    ('company', 'c_zenith',    c_zenith);
end;
$$;

-- =============================================================================
-- 2. replace _seed_demo_events with real company names in text
-- =============================================================================

create or replace function public._seed_demo_events(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_meridian  uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_meridian');
  c_helios    uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_helios');
  c_vantage   uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_vantage');
  c_apex      uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_apex');
  c_solara    uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_solara');

  p_zelvox    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_zelvox');
  p_cardivant uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_cardivant');
  p_oxavance  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_oxavance');
  p_restivon  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_restivon');
  p_ketavora  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_ketavora');

  t_pulse_hf       uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_pulse_hf');
  t_echo_hf        uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_echo_hf');
  t_restivon_step  uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_restivon_step');
  t_hls_early      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_hls_early');
  t_lumivex_renal  uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_lumivex_renal');

  ec_leadership  uuid := 'e0000000-0000-0000-0000-000000000001';
  ec_regulatory  uuid := 'e0000000-0000-0000-0000-000000000002';
  ec_financial   uuid := 'e0000000-0000-0000-0000-000000000003';
  ec_strategic   uuid := 'e0000000-0000-0000-0000-000000000004';
  ec_clinical    uuid := 'e0000000-0000-0000-0000-000000000005';
  ec_commercial  uuid := 'e0000000-0000-0000-0000-000000000006';

  th_leadership  uuid := gen_random_uuid();
  th_supply      uuid := gen_random_uuid();

  ev_fda_guidance     uuid := gen_random_uuid();
  ev_esc_preview      uuid := gen_random_uuid();
  ev_safety_signal    uuid := gen_random_uuid();
  ev_enrollment_pause uuid := gen_random_uuid();
  ev_meridian_q4      uuid := gen_random_uuid();
  ev_meridian_ceo1    uuid := gen_random_uuid();
  ev_meridian_ceo2    uuid := gen_random_uuid();
  ev_meridian_ceo3    uuid := gen_random_uuid();
  ev_supply1          uuid := gen_random_uuid();
  ev_supply2          uuid := gen_random_uuid();
  ev_zelvox_esc       uuid := gen_random_uuid();
  ev_ketavora_payer   uuid := gen_random_uuid();
  ev_helios_patent    uuid := gen_random_uuid();
  ev_pulse_enroll     uuid := gen_random_uuid();
  ev_echo_protocol    uuid := gen_random_uuid();
  ev_restivon_site    uuid := gen_random_uuid();
  ev_solara_ipo       uuid := gen_random_uuid();
  ev_apex_license     uuid := gen_random_uuid();
  ev_renal_guideline  uuid := gen_random_uuid();
  ev_hls_dose         uuid := gen_random_uuid();
begin
  -- Event threads
  insert into public.event_threads (id, space_id, title, created_by) values
    (th_leadership, p_space_id, 'AstraZeneca Leadership Transition',  p_uid),
    (th_supply,     p_space_id, 'Zelvox Supply Chain Update',         p_uid);

  -- Space-level events (industry)
  insert into public.events (id, space_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_fda_guidance,    p_space_id, ec_regulatory, 'FDA publishes updated HF treatment guidance',
      '2025-03-15', 'New guidance emphasizes earlier intervention with SGLT2i and GLP-1 RA in HFpEF patients. Implications for ongoing P3 programs.',
      'high', array['guidance', 'regulatory', 'hf'], p_uid),
    (ev_esc_preview,     p_space_id, ec_clinical,   'ESC 2026 late-breaking sessions announced',
      '2026-02-28', 'Three HF trials selected for late-breaking presentations: PULSE-HF, ECHO-HF, and one undisclosed.',
      'low',  array['conference', 'esc'], p_uid),
    (ev_renal_guideline, p_space_id, ec_clinical,   'KDIGO updates CKD management guidelines',
      '2025-09-10', 'Updated KDIGO guidelines expand recommended use of SGLT2i in CKD regardless of diabetes status.',
      'high', array['guidance', 'ckd', 'kdigo'], p_uid);

  -- Company-level events
  insert into public.events (id, space_id, company_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_meridian_q4, p_space_id, c_meridian, ec_financial, 'AstraZeneca Q4 2025 earnings: pipeline update',
      '2025-02-12', 'Zelvox sales up 23% YoY. Management reaffirmed PULSE-HF readout timeline. Raised full-year guidance.',
      'low', array['earnings', 'pipeline'], p_uid);

  -- AstraZeneca leadership thread (3 events)
  insert into public.events (id, space_id, company_id, category_id, thread_id, thread_order, title, event_date, description, priority, tags, created_by) values
    (ev_meridian_ceo1, p_space_id, c_meridian, ec_leadership, th_leadership, 1, 'AstraZeneca CEO announces retirement',
      '2025-06-01', 'Dr. Sarah Chen to step down as CEO effective Q4 2025 after 12-year tenure.',
      'high', array['leadership', 'succession'], p_uid),
    (ev_meridian_ceo2, p_space_id, c_meridian, ec_leadership, th_leadership, 2, 'AstraZeneca names interim CEO',
      '2025-09-15', 'COO James Park appointed interim CEO. Board initiates formal search process.',
      'high', array['leadership', 'succession'], p_uid),
    (ev_meridian_ceo3, p_space_id, c_meridian, ec_leadership, th_leadership, 3, 'AstraZeneca selects permanent CEO',
      '2026-01-20', 'Dr. Maria Rodriguez, former BMS CMO, appointed CEO effective March 1.',
      'high', array['leadership', 'succession'], p_uid);

  -- Other company events
  insert into public.events (id, space_id, company_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_helios_patent, p_space_id, c_helios, ec_strategic, 'BMS secures key HF patent extension',
      '2025-07-20', 'USPTO grants patent term extension for Cardivant composition of matter through 2031.',
      'low', array['patent', 'ip'], p_uid),
    (ev_solara_ipo, p_space_id, c_solara, ec_financial, 'Bayer divests consumer health unit',
      '2025-04-10', 'Raised $3.8B from divestiture. Proceeds to fund RENAL-NOVA P3 and SLR-8820 development.',
      'high', array['divestiture', 'financing'], p_uid),
    (ev_apex_license, p_space_id, c_apex, ec_strategic, 'Pfizer licenses Thyravex ex-US rights to Merck',
      '2025-11-05', '$200M upfront + milestones. Merck gains commercialization rights in EU and Japan.',
      'high', array['licensing', 'partnership'], p_uid);

  -- Product-level events
  insert into public.events (id, space_id, product_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_zelvox_esc, p_space_id, p_zelvox, ec_clinical, 'Zelvox added to ESC HF treatment algorithm',
      '2025-08-30', 'Updated ESC guidelines now recommend Zelvox as first-line in HFrEF alongside standard therapy.',
      'high', array['guidelines', 'esc', 'hf'], p_uid),
    (ev_ketavora_payer, p_space_id, p_ketavora, ec_commercial, 'Major PBM adds Ketavora to preferred formulary',
      '2025-05-18', 'CVS Caremark adds Ketavora to preferred tier for MRA-eligible HF patients.',
      'low', array['payer', 'formulary', 'access'], p_uid);

  -- Zelvox supply chain thread (2 events)
  insert into public.events (id, space_id, product_id, category_id, thread_id, thread_order, title, event_date, description, priority, tags, created_by) values
    (ev_supply1, p_space_id, p_zelvox, ec_commercial, th_supply, 1, 'Zelvox API supply disruption reported',
      '2025-10-01', 'AstraZeneca discloses temporary disruption at primary API manufacturing site. Inventory levels adequate for 90 days.',
      'high', array['supply-chain', 'manufacturing'], p_uid),
    (ev_supply2, p_space_id, p_zelvox, ec_commercial, th_supply, 2, 'Zelvox supply normalized',
      '2025-12-15', 'Manufacturing site back to full capacity. No patient supply interruptions occurred.',
      'low', array['supply-chain', 'manufacturing'], p_uid);

  -- Trial-level events
  insert into public.events (id, space_id, trial_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_pulse_enroll, p_space_id, t_pulse_hf, ec_clinical, 'PULSE-HF enrollment complete',
      '2025-11-20', 'Target enrollment of 4,500 patients achieved across 320 sites globally.',
      'high', array['enrollment', 'milestone'], p_uid),
    (ev_echo_protocol, p_space_id, t_echo_hf, ec_clinical, 'ECHO-HF protocol amendment approved by FDA',
      '2025-08-05', 'Amendment adds NT-proBNP secondary endpoint per DSMB recommendation. No change to primary.',
      'low', array['protocol', 'amendment'], p_uid),
    (ev_restivon_site, p_space_id, t_restivon_step, ec_clinical, 'RESTIVON-STEP expands to 50 additional sites',
      '2025-07-01', 'Expansion includes 30 sites in EU and 20 in Asia-Pacific to accelerate enrollment.',
      'low', array['enrollment', 'expansion'], p_uid),
    (ev_hls_dose, p_space_id, t_hls_early, ec_clinical, 'HLS-EARLY-HF dose cohort 3 complete',
      '2025-09-20', 'No dose-limiting toxicities at 40mg. Cohort 4 (80mg) enrollment initiating.',
      'low', array['dose-escalation', 'safety'], p_uid);

  -- Safety signal + enrollment pause (linked events)
  insert into public.events (id, space_id, trial_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_safety_signal, p_space_id, t_lumivex_renal, ec_clinical, 'RENAL-NOVA DSMB flags hepatic signal',
      '2025-06-15', 'Independent DSMB identified transient ALT elevations in 3.2% of treatment arm. Recommends enhanced monitoring.',
      'high', array['safety', 'dsmb'], p_uid),
    (ev_enrollment_pause, p_space_id, t_lumivex_renal, ec_clinical, 'RENAL-NOVA enrollment temporarily paused',
      '2025-06-20', 'Sponsor pauses enrollment pending hepatic safety review. Existing patients continue on protocol.',
      'high', array['safety', 'enrollment', 'pause'], p_uid);

  -- Event sources
  insert into public.event_sources (id, event_id, url, label) values
    (gen_random_uuid(), ev_fda_guidance,    'https://example.com/fda-hf-guidance-2025',       'FDA Guidance Document'),
    (gen_random_uuid(), ev_meridian_q4,     'https://example.com/astrazeneca-q4-2025',        'Press Release'),
    (gen_random_uuid(), ev_meridian_q4,     'https://example.com/astrazeneca-q4-slides',      'Earnings Slides'),
    (gen_random_uuid(), ev_meridian_ceo1,   'https://example.com/astrazeneca-ceo-retirement', 'Press Release'),
    (gen_random_uuid(), ev_solara_ipo,      'https://example.com/bayer-divestiture',           'SEC Filing'),
    (gen_random_uuid(), ev_apex_license,    'https://example.com/pfizer-merck-license',        'Press Release'),
    (gen_random_uuid(), ev_zelvox_esc,      'https://example.com/esc-2025-guidelines',         'ESC Guidelines'),
    (gen_random_uuid(), ev_safety_signal,   'https://example.com/renal-nova-dsmb',             'Company Statement'),
    (gen_random_uuid(), ev_renal_guideline, 'https://example.com/kdigo-2025-ckd',              'KDIGO Guidelines');

  -- Event links
  insert into public.event_links (source_event_id, target_event_id, created_by) values
    (ev_safety_signal,   ev_enrollment_pause, p_uid),
    (ev_fda_guidance,    ev_zelvox_esc,       p_uid),
    (ev_apex_license,    ev_ketavora_payer,   p_uid),
    (ev_renal_guideline, ev_fda_guidance,     p_uid);
end;
$$;

-- =============================================================================
-- 3. update _seed_demo_notifications with real company names
-- =============================================================================

create or replace function public._seed_demo_notifications(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  m_cardio_data   uuid := (select id from _seed_ids where entity_type = 'marker' and key = 'm_cardio_data');
  m_heart_filing  uuid := (select id from _seed_ids where entity_type = 'marker' and key = 'm_heart_filing');
  m_nephro_proj   uuid := (select id from _seed_ids where entity_type = 'marker' and key = 'm_nephro_proj');
  m_pulse_topline uuid := (select id from _seed_ids where entity_type = 'marker' and key = 'm_pulse_topline');
  m_echo_interim  uuid := (select id from _seed_ids where entity_type = 'marker' and key = 'm_echo_interim');
begin
  insert into public.marker_notifications (space_id, marker_id, priority, summary, created_by) values
    (p_space_id, m_cardio_data,   'high', 'Zelvox CARDIO-SHIELD results presented at ESC 2019 -- positive primary endpoint.',                    p_uid),
    (p_space_id, m_heart_filing,  'high', 'Cardivant HEART-PRESERVE sNDA filed for HFpEF -- PDUFA action expected Q3 2022.',                     p_uid),
    (p_space_id, m_nephro_proj,   'low',  'Renoquil NEPHRO-CLEAR regulatory filing projection updated to Q1 2023.',                              p_uid),
    (p_space_id, m_pulse_topline, 'high', 'Oxavance PULSE-HF topline readout expected H2 2026 -- potential best-in-class sGC stimulator.',       p_uid),
    (p_space_id, m_echo_interim,  'low',  'Pravicel ECHO-HF interim analysis scheduled for AHA 2026. DSMB pre-specified futility boundary.',     p_uid);
end;
$$;

-- =============================================================================
-- 2. orchestrator with space-owner permission gate
-- =============================================================================

create or replace function public.seed_demo_data(p_space_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  existing_count int;
begin
  if uid is null then
    raise exception 'Must be authenticated to seed demo data'
      using errcode = '28000';
  end if;

  -- Space-owner gate. Tenant ownership alone is not sufficient: this is
  -- consistent with the firewall introduced in migration 75 where tenant
  -- owners get no implicit space data access. Platform admins bypass.
  if not exists (
    select 1 from public.space_members
     where space_id = p_space_id
       and user_id = uid
       and role = 'owner'
  ) and not public.is_platform_admin() then
    raise exception 'Insufficient permissions: must be space owner to seed demo data'
      using errcode = '42501';
  end if;

  select count(*) into existing_count
    from public.companies
    where space_id = p_space_id;

  if existing_count > 0 then
    return;
  end if;

  create temp table if not exists _seed_ids (
    entity_type text not null,
    key         text not null,
    id          uuid not null,
    primary key (entity_type, key)
  ) on commit drop;

  perform public._seed_demo_companies(p_space_id, uid);
  perform public._seed_demo_therapeutic_areas(p_space_id, uid);
  perform public._seed_demo_products(p_space_id, uid);
  perform public._seed_demo_moa_roa(p_space_id, uid);
  perform public._seed_demo_trials(p_space_id, uid);
  perform public._seed_demo_markers(p_space_id, uid);
  perform public._seed_demo_trial_notes(p_space_id, uid);
  perform public._seed_demo_events(p_space_id, uid);
  perform public._seed_demo_notifications(p_space_id, uid);
end;
$$;

comment on function public.seed_demo_data(uuid) is
  'Seeds a space with comprehensive demo data: 8 real pharma companies (AstraZeneca, '
  'Bristol-Myers Squibb, Novo Nordisk, Pfizer, Merck, Bayer, Boehringer Ingelheim, GSK) '
  'with logo URLs, 20 fictional products across 4 therapeutic areas (HF, CKD, T2D, Obesity), '
  '26 trials covering all development phases (PRECLIN through LAUNCHED), 55+ markers using '
  'all 13 system types, 12 trial notes, 20 events with threads/links/sources, and 5 marker '
  'notifications. Uses modular helper functions (_seed_demo_*) for maintainability. '
  'Permission gate (added 2026-05-01): caller must be a space owner of p_space_id or a '
  'platform admin. Tenant ownership alone is not sufficient. '
  'Idempotent: returns early if the space already has companies.';
