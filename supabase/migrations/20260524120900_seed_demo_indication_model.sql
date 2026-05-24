-- migration: 20260524120900_seed_demo_indication_model
-- purpose: rewrite seed_demo helper functions for the indication model redesign.
--          - _seed_demo_therapeutic_areas -> _seed_demo_indications
--          - _seed_demo_products -> _seed_demo_assets (table renamed)
--          - _seed_demo_moa_roa -> updated table refs
--          - _seed_demo_trials -> no TA, real phase_types, trial_conditions
--          - NEW: _seed_demo_asset_indications
--          - _seed_demo_events -> asset_id
--          - seed_demo_data orchestrator -> updated call order

-- =============================================================================
-- 1. _seed_demo_indications (replaces _seed_demo_therapeutic_areas)
-- =============================================================================

create or replace function public._seed_demo_indications(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ind_hf       uuid := gen_random_uuid();
  ind_ckd      uuid := gen_random_uuid();
  ind_t2d      uuid := gen_random_uuid();
  ind_obesity  uuid := gen_random_uuid();
  ind_attr_cm  uuid := gen_random_uuid();

  cond_hf      uuid := gen_random_uuid();
  cond_hfref   uuid := gen_random_uuid();
  cond_hfpef   uuid := gen_random_uuid();
  cond_ckd     uuid := gen_random_uuid();
  cond_t2d     uuid := gen_random_uuid();
  cond_obesity uuid := gen_random_uuid();
  cond_attr_cm uuid := gen_random_uuid();
  cond_cv      uuid := gen_random_uuid();
  cond_hcm     uuid := gen_random_uuid();
begin
  insert into public.indications (id, space_id, created_by, name, abbreviation, display_order) values
    (ind_hf,      p_space_id, p_uid, 'Heart Failure',          'HF',      1),
    (ind_ckd,     p_space_id, p_uid, 'Chronic Kidney Disease', 'CKD',     2),
    (ind_t2d,     p_space_id, p_uid, 'Type 2 Diabetes',        'T2D',     3),
    (ind_obesity, p_space_id, p_uid, 'Obesity',                'OB',      4),
    (ind_attr_cm, p_space_id, p_uid, 'ATTR Cardiomyopathy',    'ATTR-CM', 5);

  insert into public.conditions (id, space_id, name, mesh_id, source) values
    (cond_hf,      p_space_id, 'Heart Failure',                                    'D006333', 'ctgov'),
    (cond_hfref,   p_space_id, 'Heart Failure With Reduced Ejection Fraction',      null,      'ctgov'),
    (cond_hfpef,   p_space_id, 'Heart Failure With Preserved Ejection Fraction',    null,      'ctgov'),
    (cond_ckd,     p_space_id, 'Chronic Kidney Disease',                           'D051436', 'ctgov'),
    (cond_t2d,     p_space_id, 'Type 2 Diabetes Mellitus',                         'D003924', 'ctgov'),
    (cond_obesity, p_space_id, 'Obesity',                                          'D009765', 'ctgov'),
    (cond_attr_cm, p_space_id, 'Transthyretin Amyloid Cardiomyopathy',             null,      'ctgov'),
    (cond_cv,      p_space_id, 'Cardiovascular Disease',                           'D002318', 'ctgov'),
    (cond_hcm,     p_space_id, 'Hypertrophic Cardiomyopathy',                      'D002312', 'ctgov');

  insert into public.condition_indication_map (condition_id, indication_id) values
    (cond_hf,      ind_hf),
    (cond_hfref,   ind_hf),
    (cond_hfpef,   ind_hf),
    (cond_hcm,     ind_hf),
    (cond_cv,      ind_hf),
    (cond_ckd,     ind_ckd),
    (cond_t2d,     ind_t2d),
    (cond_obesity, ind_obesity),
    (cond_cv,      ind_obesity),
    (cond_attr_cm, ind_attr_cm);

  insert into _seed_ids (entity_type, key, id) values
    ('ind', 'ind_hf',      ind_hf),
    ('ind', 'ind_ckd',     ind_ckd),
    ('ind', 'ind_t2d',     ind_t2d),
    ('ind', 'ind_obesity', ind_obesity),
    ('ind', 'ind_attr_cm', ind_attr_cm),
    ('cond', 'cond_hf',      cond_hf),
    ('cond', 'cond_hfref',   cond_hfref),
    ('cond', 'cond_hfpef',   cond_hfpef),
    ('cond', 'cond_ckd',     cond_ckd),
    ('cond', 'cond_t2d',     cond_t2d),
    ('cond', 'cond_obesity', cond_obesity),
    ('cond', 'cond_attr_cm', cond_attr_cm),
    ('cond', 'cond_cv',      cond_cv),
    ('cond', 'cond_hcm',     cond_hcm);
end;
$$;

-- =============================================================================
-- 2. _seed_demo_assets (was _seed_demo_products, table renamed)
-- =============================================================================

create or replace function public._seed_demo_assets(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_meridian uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_meridian');
  c_helios   uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_helios');
  c_vantage  uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_vantage');
  c_apex     uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_apex');
  c_cardinal uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_cardinal');
  c_solara   uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_solara');
  c_cascade  uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_cascade');
  c_zenith   uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_zenith');
  c_aurora   uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_aurora');
  c_vortex   uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_vortex');
  c_polaris  uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_polaris');
  c_orion    uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_orion');
  c_atlas    uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_atlas');
  p_mounjaro uuid := gen_random_uuid(); p_zepbound uuid := gen_random_uuid();
  p_retatrutide uuid := gen_random_uuid(); p_orforglipron uuid := gen_random_uuid();
  p_trulicity uuid := gen_random_uuid(); p_ozempic uuid := gen_random_uuid();
  p_wegovy uuid := gen_random_uuid(); p_rybelsus uuid := gen_random_uuid();
  p_cagrisema uuid := gen_random_uuid(); p_farxiga uuid := gen_random_uuid();
  p_azd5004 uuid := gen_random_uuid(); p_jardiance uuid := gen_random_uuid();
  p_survodutide uuid := gen_random_uuid(); p_camzyos uuid := gen_random_uuid();
  p_aficamten uuid := gen_random_uuid(); p_omecamtiv uuid := gen_random_uuid();
  p_kerendia uuid := gen_random_uuid(); p_verquvo uuid := gen_random_uuid();
  p_entresto uuid := gen_random_uuid(); p_leqvio uuid := gen_random_uuid();
  p_vyndaqel uuid := gen_random_uuid(); p_danuglipron uuid := gen_random_uuid();
  p_ct388 uuid := gen_random_uuid(); p_ct996 uuid := gen_random_uuid();
  p_maritide uuid := gen_random_uuid(); p_vk2735_sc uuid := gen_random_uuid();
  p_vk2735_oral uuid := gen_random_uuid(); p_attruby uuid := gen_random_uuid();
begin
  insert into public.assets (id, space_id, created_by, company_id, name, generic_name, display_order) values
    (p_mounjaro,     p_space_id, p_uid, c_meridian, 'Mounjaro',            'tirzepatide',              1),
    (p_zepbound,     p_space_id, p_uid, c_meridian, 'Zepbound',            'tirzepatide',              2),
    (p_retatrutide,  p_space_id, p_uid, c_meridian, 'retatrutide',         null,                       3),
    (p_orforglipron, p_space_id, p_uid, c_meridian, 'orforglipron',        null,                       4),
    (p_trulicity,    p_space_id, p_uid, c_meridian, 'Trulicity',           'dulaglutide',              5),
    (p_ozempic,      p_space_id, p_uid, c_vantage,  'Ozempic',             'semaglutide',              1),
    (p_wegovy,       p_space_id, p_uid, c_vantage,  'Wegovy',              'semaglutide',              2),
    (p_rybelsus,     p_space_id, p_uid, c_vantage,  'Rybelsus',            'semaglutide (oral)',       3),
    (p_cagrisema,    p_space_id, p_uid, c_vantage,  'CagriSema',           'cagrilintide + semaglutide', 4),
    (p_farxiga,      p_space_id, p_uid, c_aurora,   'Farxiga',             'dapagliflozin',            1),
    (p_azd5004,      p_space_id, p_uid, c_aurora,   'AZD5004',             null,                       2),
    (p_jardiance,    p_space_id, p_uid, c_vortex,   'Jardiance',           'empagliflozin',            1),
    (p_survodutide,  p_space_id, p_uid, c_vortex,   'survodutide',         null,                       2),
    (p_camzyos,      p_space_id, p_uid, c_helios,   'Camzyos',             'mavacamten',               1),
    (p_aficamten,    p_space_id, p_uid, c_solara,   'aficamten',           null,                       1),
    (p_omecamtiv,    p_space_id, p_uid, c_solara,   'omecamtiv mecarbil',  null,                       2),
    (p_kerendia,     p_space_id, p_uid, c_cardinal, 'Kerendia',            'finerenone',               1),
    (p_verquvo,      p_space_id, p_uid, c_cardinal, 'Verquvo',             'vericiguat',               2),
    (p_entresto,     p_space_id, p_uid, c_polaris,  'Entresto',            'sacubitril-valsartan',     1),
    (p_leqvio,       p_space_id, p_uid, c_polaris,  'Leqvio',              'inclisiran',               2),
    (p_vyndaqel,     p_space_id, p_uid, c_apex,     'Vyndaqel',            'tafamidis',                1),
    (p_danuglipron,  p_space_id, p_uid, c_apex,     'danuglipron',         null,                       2),
    (p_ct388,        p_space_id, p_uid, c_cascade,  'CT-388',              null,                       1),
    (p_ct996,        p_space_id, p_uid, c_cascade,  'CT-996',              null,                       2),
    (p_maritide,     p_space_id, p_uid, c_orion,    'MariTide',            'maridebart cafraglutide',  1),
    (p_vk2735_sc,    p_space_id, p_uid, c_zenith,   'VK2735 (SC)',         null,                       1),
    (p_vk2735_oral,  p_space_id, p_uid, c_zenith,   'VK2735 (oral)',       null,                       2),
    (p_attruby,      p_space_id, p_uid, c_atlas,    'Attruby',             'acoramidis',               1);

  insert into _seed_ids (entity_type, key, id) values
    ('product', 'p_mounjaro', p_mounjaro), ('product', 'p_zepbound', p_zepbound),
    ('product', 'p_retatrutide', p_retatrutide), ('product', 'p_orforglipron', p_orforglipron),
    ('product', 'p_trulicity', p_trulicity), ('product', 'p_ozempic', p_ozempic),
    ('product', 'p_wegovy', p_wegovy), ('product', 'p_rybelsus', p_rybelsus),
    ('product', 'p_cagrisema', p_cagrisema), ('product', 'p_farxiga', p_farxiga),
    ('product', 'p_azd5004', p_azd5004), ('product', 'p_jardiance', p_jardiance),
    ('product', 'p_survodutide', p_survodutide), ('product', 'p_camzyos', p_camzyos),
    ('product', 'p_aficamten', p_aficamten), ('product', 'p_omecamtiv', p_omecamtiv),
    ('product', 'p_kerendia', p_kerendia), ('product', 'p_verquvo', p_verquvo),
    ('product', 'p_entresto', p_entresto), ('product', 'p_leqvio', p_leqvio),
    ('product', 'p_vyndaqel', p_vyndaqel), ('product', 'p_danuglipron', p_danuglipron),
    ('product', 'p_ct388', p_ct388), ('product', 'p_ct996', p_ct996),
    ('product', 'p_maritide', p_maritide), ('product', 'p_vk2735_sc', p_vk2735_sc),
    ('product', 'p_vk2735_oral', p_vk2735_oral), ('product', 'p_attruby', p_attruby);
end;
$$;

-- =============================================================================
-- 3. _seed_demo_moa_roa (updated table refs)
-- =============================================================================

create or replace function public._seed_demo_moa_roa(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  moa_sglt2 uuid := gen_random_uuid(); moa_glp1 uuid := gen_random_uuid();
  moa_gip_glp1 uuid := gen_random_uuid(); moa_triple uuid := gen_random_uuid();
  moa_glp1_glucagon uuid := gen_random_uuid(); moa_gipra_glp1 uuid := gen_random_uuid();
  moa_nsmra uuid := gen_random_uuid(); moa_sgc uuid := gen_random_uuid();
  moa_cmi uuid := gen_random_uuid(); moa_ttr uuid := gen_random_uuid();
  moa_arni uuid := gen_random_uuid(); moa_pcsk9_sirna uuid := gen_random_uuid();
  roa_oral uuid := gen_random_uuid(); roa_sc uuid := gen_random_uuid(); roa_iv uuid := gen_random_uuid();
  p_mounjaro uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_mounjaro');
  p_zepbound uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_zepbound');
  p_retatrutide uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_retatrutide');
  p_orforglipron uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_orforglipron');
  p_trulicity uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_trulicity');
  p_ozempic uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_ozempic');
  p_wegovy uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_wegovy');
  p_rybelsus uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_rybelsus');
  p_cagrisema uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_cagrisema');
  p_farxiga uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_farxiga');
  p_azd5004 uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_azd5004');
  p_jardiance uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_jardiance');
  p_survodutide uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_survodutide');
  p_camzyos uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_camzyos');
  p_aficamten uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_aficamten');
  p_omecamtiv uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_omecamtiv');
  p_kerendia uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_kerendia');
  p_verquvo uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_verquvo');
  p_entresto uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_entresto');
  p_leqvio uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_leqvio');
  p_vyndaqel uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vyndaqel');
  p_danuglipron uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_danuglipron');
  p_ct388 uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_ct388');
  p_ct996 uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_ct996');
  p_maritide uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_maritide');
  p_vk2735_sc uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vk2735_sc');
  p_vk2735_oral uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vk2735_oral');
  p_attruby uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_attruby');
begin
  insert into public.mechanisms_of_action (id, space_id, created_by, name, abbreviation, description, display_order) values
    (moa_sglt2, p_space_id, p_uid, 'SGLT2 inhibitor', 'SGLT2i', 'Blocks sodium-glucose co-transporter 2.', 1),
    (moa_glp1, p_space_id, p_uid, 'GLP-1 receptor agonist', 'GLP-1 RA', 'Activates GLP-1 receptor.', 2),
    (moa_gip_glp1, p_space_id, p_uid, 'GIP/GLP-1 dual agonist', 'GIP/GLP-1', 'Co-activates GIP and GLP-1.', 3),
    (moa_triple, p_space_id, p_uid, 'GIP/GLP-1/glucagon triple agonist', 'Triple', 'Triple agonist.', 4),
    (moa_glp1_glucagon, p_space_id, p_uid, 'GLP-1/glucagon dual agonist', 'GLP-1/Glucagon', 'Dual agonist.', 5),
    (moa_gipra_glp1, p_space_id, p_uid, 'GIPR antagonist + GLP-1 agonist', 'GIPR-A/GLP-1', 'Differentiated combo.', 6),
    (moa_nsmra, p_space_id, p_uid, 'Non-steroidal MRA', 'nsMRA', 'Selective MR antagonist.', 7),
    (moa_sgc, p_space_id, p_uid, 'sGC stimulator', 'sGC', 'Stimulates guanylate cyclase.', 8),
    (moa_cmi, p_space_id, p_uid, 'Cardiac myosin inhibitor', 'CMI', 'Reduces hypercontractility.', 9),
    (moa_ttr, p_space_id, p_uid, 'TTR stabilizer', 'TTR', 'Stabilizes transthyretin.', 10),
    (moa_arni, p_space_id, p_uid, 'ARNI', 'ARNI', 'ARB + neprilysin inhibitor.', 11),
    (moa_pcsk9_sirna, p_space_id, p_uid, 'PCSK9 siRNA', 'PCSK9 siRNA', 'siRNA targeting PCSK9.', 12);

  insert into public.routes_of_administration (id, space_id, created_by, name, abbreviation, display_order) values
    (roa_oral, p_space_id, p_uid, 'Oral', 'PO', 1),
    (roa_sc, p_space_id, p_uid, 'Subcutaneous', 'SC', 2),
    (roa_iv, p_space_id, p_uid, 'Intravenous', 'IV', 3);

  insert into public.asset_mechanisms_of_action (asset_id, moa_id) values
    (p_mounjaro, moa_gip_glp1), (p_zepbound, moa_gip_glp1), (p_retatrutide, moa_triple),
    (p_orforglipron, moa_glp1), (p_trulicity, moa_glp1), (p_ozempic, moa_glp1),
    (p_wegovy, moa_glp1), (p_rybelsus, moa_glp1), (p_cagrisema, moa_glp1),
    (p_farxiga, moa_sglt2), (p_azd5004, moa_glp1), (p_jardiance, moa_sglt2),
    (p_survodutide, moa_glp1_glucagon), (p_camzyos, moa_cmi), (p_aficamten, moa_cmi),
    (p_omecamtiv, moa_cmi), (p_kerendia, moa_nsmra), (p_verquvo, moa_sgc),
    (p_entresto, moa_arni), (p_leqvio, moa_pcsk9_sirna), (p_vyndaqel, moa_ttr),
    (p_danuglipron, moa_glp1), (p_ct388, moa_gip_glp1), (p_ct996, moa_glp1),
    (p_maritide, moa_gipra_glp1), (p_vk2735_sc, moa_gip_glp1),
    (p_vk2735_oral, moa_gip_glp1), (p_attruby, moa_ttr);

  insert into public.asset_routes_of_administration (asset_id, roa_id) values
    (p_mounjaro, roa_sc), (p_zepbound, roa_sc), (p_retatrutide, roa_sc),
    (p_orforglipron, roa_oral), (p_trulicity, roa_sc), (p_ozempic, roa_sc),
    (p_wegovy, roa_sc), (p_rybelsus, roa_oral), (p_cagrisema, roa_sc),
    (p_farxiga, roa_oral), (p_azd5004, roa_oral), (p_jardiance, roa_oral),
    (p_survodutide, roa_sc), (p_camzyos, roa_oral), (p_aficamten, roa_oral),
    (p_omecamtiv, roa_oral), (p_kerendia, roa_oral), (p_verquvo, roa_oral),
    (p_entresto, roa_oral), (p_leqvio, roa_sc), (p_vyndaqel, roa_oral),
    (p_danuglipron, roa_oral), (p_ct388, roa_sc), (p_ct996, roa_oral),
    (p_maritide, roa_sc), (p_vk2735_sc, roa_sc), (p_vk2735_oral, roa_oral),
    (p_attruby, roa_oral);
end;
$$;

-- =============================================================================
-- 4. _seed_demo_trials (no TA, real phases, trial_conditions)
-- =============================================================================

create or replace function public._seed_demo_trials(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  p_mounjaro uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_mounjaro');
  p_zepbound uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_zepbound');
  p_retatrutide uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_retatrutide');
  p_orforglipron uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_orforglipron');
  p_ozempic uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_ozempic');
  p_wegovy uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_wegovy');
  p_rybelsus uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_rybelsus');
  p_cagrisema uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_cagrisema');
  p_farxiga uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_farxiga');
  p_jardiance uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_jardiance');
  p_survodutide uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_survodutide');
  p_camzyos uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_camzyos');
  p_aficamten uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_aficamten');
  p_kerendia uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_kerendia');
  p_entresto uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_entresto');
  p_vyndaqel uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vyndaqel');
  p_danuglipron uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_danuglipron');
  p_ct388 uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_ct388');
  p_maritide uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_maritide');
  p_vk2735_sc uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vk2735_sc');
  p_vk2735_oral uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vk2735_oral');
  p_attruby uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_attruby');

  cond_hf uuid := (select id from _seed_ids where entity_type = 'cond' and key = 'cond_hf');
  cond_hfref uuid := (select id from _seed_ids where entity_type = 'cond' and key = 'cond_hfref');
  cond_hfpef uuid := (select id from _seed_ids where entity_type = 'cond' and key = 'cond_hfpef');
  cond_ckd uuid := (select id from _seed_ids where entity_type = 'cond' and key = 'cond_ckd');
  cond_t2d uuid := (select id from _seed_ids where entity_type = 'cond' and key = 'cond_t2d');
  cond_obesity uuid := (select id from _seed_ids where entity_type = 'cond' and key = 'cond_obesity');
  cond_attr_cm uuid := (select id from _seed_ids where entity_type = 'cond' and key = 'cond_attr_cm');
  cond_cv uuid := (select id from _seed_ids where entity_type = 'cond' and key = 'cond_cv');
  cond_hcm uuid := (select id from _seed_ids where entity_type = 'cond' and key = 'cond_hcm');

  t_surmount_1 uuid := gen_random_uuid(); t_surpass_2 uuid := gen_random_uuid();
  t_step_1 uuid := gen_random_uuid(); t_select uuid := gen_random_uuid();
  t_dapa_hf uuid := gen_random_uuid(); t_emperor_reduced uuid := gen_random_uuid();
  t_explorer_hcm uuid := gen_random_uuid(); t_paradigm_hf uuid := gen_random_uuid();
  t_attr_act uuid := gen_random_uuid(); t_attribute_cm uuid := gen_random_uuid();
  t_surmount_mmo uuid := gen_random_uuid(); t_summit uuid := gen_random_uuid();
  t_surmount_osa uuid := gen_random_uuid(); t_attain_1 uuid := gen_random_uuid();
  t_achieve_1 uuid := gen_random_uuid(); t_triumph_1 uuid := gen_random_uuid();
  t_flow uuid := gen_random_uuid(); t_redefine_1 uuid := gen_random_uuid();
  t_redefine_2 uuid := gen_random_uuid(); t_soul uuid := gen_random_uuid();
  t_deliver uuid := gen_random_uuid(); t_dapa_ckd uuid := gen_random_uuid();
  t_emperor_preserved uuid := gen_random_uuid(); t_empa_kidney uuid := gen_random_uuid();
  t_empact_mi uuid := gen_random_uuid(); t_survodutide_p2 uuid := gen_random_uuid();
  t_fineart_hf uuid := gen_random_uuid(); t_sequoia_hcm uuid := gen_random_uuid();
  t_maple_hcm uuid := gen_random_uuid(); t_acacia_hcm uuid := gen_random_uuid();
  t_odyssey_hcm uuid := gen_random_uuid(); t_ct388_p2 uuid := gen_random_uuid();
  t_vk2735_sc_p2 uuid := gen_random_uuid(); t_vk2735_oral_p2 uuid := gen_random_uuid();
  t_maritide_p2 uuid := gen_random_uuid(); t_danuglipron_p2 uuid := gen_random_uuid();
begin
  insert into public.trials (id, space_id, created_by, asset_id, name, identifier,
    status, display_order, phase_type, phase_start_date, phase_end_date) values
    (t_surmount_1,      p_space_id, p_uid, p_zepbound,    'SURMOUNT-1',      'NCT04184622',  'Completed', 1, 'P3', '2019-12-04', '2022-04-01'),
    (t_surpass_2,       p_space_id, p_uid, p_mounjaro,    'SURPASS-2',       'NCT03987919',  'Completed', 1, 'P3', '2019-07-30', '2021-01-28'),
    (t_step_1,          p_space_id, p_uid, p_wegovy,      'STEP 1',          'NCT03548935',  'Completed', 1, 'P3', '2018-06-04', '2020-03-30'),
    (t_select,          p_space_id, p_uid, p_wegovy,      'SELECT',          'NCT03574597',  'Completed', 2, 'P3', '2018-10-24', '2023-06-21'),
    (t_dapa_hf,         p_space_id, p_uid, p_farxiga,     'DAPA-HF',         'NCT03036124',  'Completed', 1, 'P3', '2017-02-08', '2019-07-17'),
    (t_emperor_reduced, p_space_id, p_uid, p_jardiance,   'EMPEROR-Reduced', 'NCT03057977',  'Completed', 1, 'P3', '2017-03-06', '2020-05-01'),
    (t_explorer_hcm,    p_space_id, p_uid, p_camzyos,     'EXPLORER-HCM',    'NCT03470545',  'Completed', 1, 'P3', '2018-05-29', '2020-03-14'),
    (t_paradigm_hf,     p_space_id, p_uid, p_entresto,    'PARADIGM-HF',     'NCT01035255',  'Terminated', 1, 'P3', '2009-12-08', '2014-05-31'),
    (t_attr_act,        p_space_id, p_uid, p_vyndaqel,    'ATTR-ACT',        'NCT01994889',  'Completed', 1, 'P3', '2013-12-09', '2018-02-07'),
    (t_attribute_cm,    p_space_id, p_uid, p_attruby,     'ATTRibute-CM',    'NCT03860935',  'Completed', 1, 'P3', '2019-03-19', '2023-05-11');

  insert into public.trials (id, space_id, created_by, asset_id, name, identifier,
    status, display_order, phase_type, phase_start_date, phase_end_date) values
    (t_surmount_mmo,    p_space_id, p_uid, p_zepbound,    'SURMOUNT-MMO',    'NCT05556512', 'Active, not recruiting', 3, 'P3', '2022-10-11', null),
    (t_summit,          p_space_id, p_uid, p_zepbound,    'SUMMIT',          'NCT04847557', 'Completed', 4, 'P3', '2021-04-20', '2024-07-02'),
    (t_surmount_osa,    p_space_id, p_uid, p_zepbound,    'SURMOUNT-OSA',    'NCT05412004', 'Completed', 5, 'P3', '2022-06-21', '2024-03-12'),
    (t_attain_1,        p_space_id, p_uid, p_orforglipron,'ATTAIN-1',        'NCT05869903', 'Active, not recruiting', 6, 'P3', '2023-06-05', '2025-07-25'),
    (t_achieve_1,       p_space_id, p_uid, p_orforglipron,'ACHIEVE-1',       'NCT05971940', 'Completed', 7, 'P3', '2023-08-09', '2025-04-03'),
    (t_triumph_1,       p_space_id, p_uid, p_retatrutide, 'TRIUMPH-1',       'NCT05929066', 'Active, not recruiting', 8, 'P3', '2023-07-10', null),
    (t_flow,            p_space_id, p_uid, p_ozempic,     'FLOW',            'NCT03819153', 'Completed', 4, 'P3', '2019-06-17', '2024-01-09'),
    (t_redefine_1,      p_space_id, p_uid, p_cagrisema,   'REDEFINE-1',      'NCT05567796', 'Active, not recruiting', 5, 'P3', '2022-11-01', '2024-10-30'),
    (t_redefine_2,      p_space_id, p_uid, p_cagrisema,   'REDEFINE-2',      'NCT05394519', 'Completed', 6, 'P3', '2023-02-01', '2025-01-28'),
    (t_soul,            p_space_id, p_uid, p_rybelsus,    'SOUL',            'NCT03914326', 'Completed', 7, 'P3', '2019-06-17', '2024-08-23'),
    (t_deliver,         p_space_id, p_uid, p_farxiga,     'DELIVER',         'NCT03619213', 'Completed', 2, 'P3', '2018-08-27', '2022-03-27'),
    (t_dapa_ckd,        p_space_id, p_uid, p_farxiga,     'DAPA-CKD',        'NCT03036150', 'Completed', 3, 'P3', '2017-02-02', '2020-06-12'),
    (t_emperor_preserved, p_space_id, p_uid, p_jardiance, 'EMPEROR-Preserved','NCT03057951','Completed', 2, 'P3', '2017-03-02', '2021-04-26'),
    (t_empa_kidney,     p_space_id, p_uid, p_jardiance,   'EMPA-KIDNEY',     'NCT03594110', 'Completed', 3, 'P3', '2019-01-31', '2022-07-05'),
    (t_empact_mi,       p_space_id, p_uid, p_jardiance,   'EMPACT-MI',       'NCT04509674', 'Completed', 4, 'P3', '2020-12-16', '2023-11-05'),
    (t_survodutide_p2,  p_space_id, p_uid, p_survodutide, 'Survodutide P2',  'NCT04667377', 'Completed', 1, 'P2', '2021-03-08', '2022-09-15'),
    (t_fineart_hf,      p_space_id, p_uid, p_kerendia,    'FINEARTS-HF',     'NCT04435626', 'Completed', 2, 'P3', '2020-09-14', '2024-05-15'),
    (t_sequoia_hcm,     p_space_id, p_uid, p_aficamten,   'SEQUOIA-HCM',     'NCT05186818', 'Completed', 1, 'P3', '2022-02-01', '2023-11-10'),
    (t_maple_hcm,       p_space_id, p_uid, p_aficamten,   'MAPLE-HCM',       'NCT05767346', 'Completed', 2, 'P3', '2023-06-20', '2025-02-28'),
    (t_acacia_hcm,      p_space_id, p_uid, p_aficamten,   'ACACIA-HCM',      'NCT06081894', 'Active, not recruiting', 3, 'P3', '2023-08-30', null),
    (t_odyssey_hcm,     p_space_id, p_uid, p_camzyos,     'ODYSSEY-HCM',     'NCT05582395', 'Completed', 2, 'P3', '2022-12-14', '2025-03-06'),
    (t_ct388_p2,        p_space_id, p_uid, p_ct388,       'CT-388 P2',       'NCT06525935', 'Completed', 1, 'P2', '2024-08-16', '2025-12-08'),
    (t_vk2735_sc_p2,    p_space_id, p_uid, p_vk2735_sc,   'VK2735 SC P2',    'NCT06068946', 'Completed', 1, 'P2', '2023-08-31', '2024-02-27'),
    (t_vk2735_oral_p2,  p_space_id, p_uid, p_vk2735_oral, 'VK2735 oral P2',  'NCT06828055', 'Completed', 2, 'P2', '2024-12-18', '2025-06-24'),
    (t_maritide_p2,     p_space_id, p_uid, p_maritide,    'MariTide P2',     'NCT05669599', 'Completed', 1, 'P2', '2023-01-18', '2024-10-08'),
    (t_danuglipron_p2,  p_space_id, p_uid, p_danuglipron, 'Danuglipron P2',  'NCT04882961', 'Terminated', 1, 'P2', '2021-01-29', '2023-09-13');

  insert into _seed_ids (entity_type, key, id) values
    ('trial', 't_surmount_1', t_surmount_1), ('trial', 't_surpass_2', t_surpass_2),
    ('trial', 't_step_1', t_step_1), ('trial', 't_select', t_select),
    ('trial', 't_dapa_hf', t_dapa_hf), ('trial', 't_emperor_reduced', t_emperor_reduced),
    ('trial', 't_explorer_hcm', t_explorer_hcm), ('trial', 't_paradigm_hf', t_paradigm_hf),
    ('trial', 't_attr_act', t_attr_act), ('trial', 't_attribute_cm', t_attribute_cm),
    ('trial', 't_surmount_mmo', t_surmount_mmo), ('trial', 't_summit', t_summit),
    ('trial', 't_surmount_osa', t_surmount_osa), ('trial', 't_attain_1', t_attain_1),
    ('trial', 't_achieve_1', t_achieve_1), ('trial', 't_triumph_1', t_triumph_1),
    ('trial', 't_flow', t_flow), ('trial', 't_redefine_1', t_redefine_1),
    ('trial', 't_redefine_2', t_redefine_2), ('trial', 't_soul', t_soul),
    ('trial', 't_deliver', t_deliver), ('trial', 't_dapa_ckd', t_dapa_ckd),
    ('trial', 't_emperor_preserved', t_emperor_preserved), ('trial', 't_empa_kidney', t_empa_kidney),
    ('trial', 't_empact_mi', t_empact_mi), ('trial', 't_survodutide_p2', t_survodutide_p2),
    ('trial', 't_fineart_hf', t_fineart_hf), ('trial', 't_sequoia_hcm', t_sequoia_hcm),
    ('trial', 't_maple_hcm', t_maple_hcm), ('trial', 't_acacia_hcm', t_acacia_hcm),
    ('trial', 't_odyssey_hcm', t_odyssey_hcm), ('trial', 't_ct388_p2', t_ct388_p2),
    ('trial', 't_vk2735_sc_p2', t_vk2735_sc_p2), ('trial', 't_vk2735_oral_p2', t_vk2735_oral_p2),
    ('trial', 't_maritide_p2', t_maritide_p2), ('trial', 't_danuglipron_p2', t_danuglipron_p2);

  -- link trials to conditions
  insert into public.trial_conditions (trial_id, condition_id, source) values
    (t_surmount_1, cond_obesity, 'ctgov'), (t_surpass_2, cond_t2d, 'ctgov'),
    (t_step_1, cond_obesity, 'ctgov'), (t_select, cond_obesity, 'ctgov'),
    (t_select, cond_cv, 'ctgov'),
    (t_dapa_hf, cond_hf, 'ctgov'), (t_dapa_hf, cond_hfref, 'ctgov'),
    (t_emperor_reduced, cond_hf, 'ctgov'), (t_emperor_reduced, cond_hfref, 'ctgov'),
    (t_explorer_hcm, cond_hcm, 'ctgov'), (t_paradigm_hf, cond_hf, 'ctgov'),
    (t_attr_act, cond_attr_cm, 'ctgov'), (t_attribute_cm, cond_attr_cm, 'ctgov'),
    (t_surmount_mmo, cond_obesity, 'ctgov'), (t_summit, cond_hf, 'ctgov'),
    (t_surmount_osa, cond_obesity, 'ctgov'),
    (t_attain_1, cond_obesity, 'ctgov'), (t_achieve_1, cond_t2d, 'ctgov'),
    (t_triumph_1, cond_obesity, 'ctgov'), (t_flow, cond_ckd, 'ctgov'),
    (t_redefine_1, cond_obesity, 'ctgov'), (t_redefine_2, cond_obesity, 'ctgov'),
    (t_soul, cond_t2d, 'ctgov'),
    (t_deliver, cond_hf, 'ctgov'), (t_deliver, cond_hfpef, 'ctgov'),
    (t_dapa_ckd, cond_ckd, 'ctgov'),
    (t_emperor_preserved, cond_hf, 'ctgov'), (t_emperor_preserved, cond_hfpef, 'ctgov'),
    (t_empa_kidney, cond_ckd, 'ctgov'), (t_empact_mi, cond_hf, 'ctgov'),
    (t_survodutide_p2, cond_obesity, 'ctgov'),
    (t_fineart_hf, cond_hf, 'ctgov'),
    (t_sequoia_hcm, cond_hcm, 'ctgov'), (t_maple_hcm, cond_hcm, 'ctgov'),
    (t_acacia_hcm, cond_hcm, 'ctgov'), (t_odyssey_hcm, cond_hcm, 'ctgov'),
    (t_ct388_p2, cond_obesity, 'ctgov'),
    (t_vk2735_sc_p2, cond_obesity, 'ctgov'), (t_vk2735_oral_p2, cond_obesity, 'ctgov'),
    (t_maritide_p2, cond_obesity, 'ctgov'), (t_danuglipron_p2, cond_obesity, 'ctgov');
end;
$$;

-- =============================================================================
-- 5. _seed_demo_asset_indications (development_status per program)
-- =============================================================================

create or replace function public._seed_demo_asset_indications(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ind_hf uuid := (select id from _seed_ids where entity_type = 'ind' and key = 'ind_hf');
  ind_ckd uuid := (select id from _seed_ids where entity_type = 'ind' and key = 'ind_ckd');
  ind_t2d uuid := (select id from _seed_ids where entity_type = 'ind' and key = 'ind_t2d');
  ind_obesity uuid := (select id from _seed_ids where entity_type = 'ind' and key = 'ind_obesity');
  ind_attr_cm uuid := (select id from _seed_ids where entity_type = 'ind' and key = 'ind_attr_cm');
  p_mounjaro uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_mounjaro');
  p_zepbound uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_zepbound');
  p_retatrutide uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_retatrutide');
  p_orforglipron uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_orforglipron');
  p_trulicity uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_trulicity');
  p_ozempic uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_ozempic');
  p_wegovy uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_wegovy');
  p_rybelsus uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_rybelsus');
  p_cagrisema uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_cagrisema');
  p_farxiga uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_farxiga');
  p_jardiance uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_jardiance');
  p_survodutide uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_survodutide');
  p_camzyos uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_camzyos');
  p_aficamten uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_aficamten');
  p_kerendia uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_kerendia');
  p_entresto uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_entresto');
  p_vyndaqel uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vyndaqel');
  p_attruby uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_attruby');
  p_ct388 uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_ct388');
  p_maritide uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_maritide');
  p_vk2735_sc uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vk2735_sc');
  p_vk2735_oral uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vk2735_oral');
  p_danuglipron uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_danuglipron');
begin
  insert into public.asset_indications (asset_id, indication_id, space_id, development_status, development_status_source, created_by) values
    (p_mounjaro,     ind_t2d,     p_space_id, 'LAUNCHED',  'analyst', p_uid),
    (p_zepbound,     ind_obesity, p_space_id, 'LAUNCHED',  'analyst', p_uid),
    (p_zepbound,     ind_hf,      p_space_id, 'P3',        'auto',    p_uid),
    (p_retatrutide,  ind_obesity, p_space_id, 'P3',        'auto',    p_uid),
    (p_orforglipron, ind_obesity, p_space_id, 'P3',        'auto',    p_uid),
    (p_orforglipron, ind_t2d,     p_space_id, 'P3',        'auto',    p_uid),
    (p_trulicity,    ind_t2d,     p_space_id, 'LAUNCHED',  'analyst', p_uid),
    (p_ozempic,      ind_t2d,     p_space_id, 'LAUNCHED',  'analyst', p_uid),
    (p_ozempic,      ind_ckd,     p_space_id, 'APPROVED',  'analyst', p_uid),
    (p_wegovy,       ind_obesity, p_space_id, 'LAUNCHED',  'analyst', p_uid),
    (p_rybelsus,     ind_t2d,     p_space_id, 'LAUNCHED',  'analyst', p_uid),
    (p_cagrisema,    ind_obesity, p_space_id, 'P3',        'auto',    p_uid),
    (p_farxiga,      ind_hf,      p_space_id, 'LAUNCHED',  'analyst', p_uid),
    (p_farxiga,      ind_ckd,     p_space_id, 'APPROVED',  'analyst', p_uid),
    (p_jardiance,    ind_hf,      p_space_id, 'LAUNCHED',  'analyst', p_uid),
    (p_jardiance,    ind_ckd,     p_space_id, 'APPROVED',  'analyst', p_uid),
    (p_survodutide,  ind_obesity, p_space_id, 'P2',        'auto',    p_uid),
    (p_camzyos,      ind_hf,      p_space_id, 'LAUNCHED',  'analyst', p_uid),
    (p_aficamten,    ind_hf,      p_space_id, 'P3',        'auto',    p_uid),
    (p_kerendia,     ind_hf,      p_space_id, 'APPROVED',  'analyst', p_uid),
    (p_entresto,     ind_hf,      p_space_id, 'LAUNCHED',  'analyst', p_uid),
    (p_vyndaqel,     ind_attr_cm, p_space_id, 'LAUNCHED',  'analyst', p_uid),
    (p_attruby,      ind_attr_cm, p_space_id, 'LAUNCHED',  'analyst', p_uid),
    (p_ct388,        ind_obesity, p_space_id, 'P2',        'auto',    p_uid),
    (p_maritide,     ind_obesity, p_space_id, 'P2',        'auto',    p_uid),
    (p_vk2735_sc,    ind_obesity, p_space_id, 'P2',        'auto',    p_uid),
    (p_vk2735_oral,  ind_obesity, p_space_id, 'P2',        'auto',    p_uid),
    (p_danuglipron,  ind_obesity, p_space_id, 'P2',        'auto',    p_uid);
end;
$$;

-- =============================================================================
-- 6. seed_demo_data orchestrator (updated call order)
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

  update public.trials
     set phase_type_source = case
           when phase_type is null then null
           when identifier is null then 'analyst'
           else 'ctgov'
         end,
         phase_start_date_source = case
           when phase_start_date is null then null
           when identifier is null then 'analyst'
           else 'ctgov'
         end,
         phase_end_date_source = case
           when phase_end_date is null then null
           when identifier is null then 'analyst'
           else 'ctgov'
         end
   where space_id = p_space_id;
end;
$$;
