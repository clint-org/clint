-- migration: 20260414200000_seed_data_redesign
-- purpose: consolidate seed data architecture. remap old marker types to
--          canonical seed.sql IDs, drop legacy seed functions, create modular
--          helper functions and orchestrator for seed_demo_data().
-- affected objects:
--   - public.marker_types (old IDs remapped and deleted)
--   - public.seed_demo_data(uuid) (replaced)
--   - public.seed_demo_data() (dropped, no-arg overload)
--   - public.seed_pharma_demo() (dropped)
--   - public._seed_demo_* (9 new helper functions created)

-- =============================================================================
-- 1. remap old marker type IDs to canonical seed.sql IDs
-- =============================================================================

-- Data category remaps
update public.markers set marker_type_id = 'a0000000-0000-0000-0000-000000000013'
  where marker_type_id in (
    'a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000009'
  );
update public.markers set marker_type_id = 'a0000000-0000-0000-0000-000000000030'
  where marker_type_id = 'a0000000-0000-0000-0000-000000000014';
update public.markers set marker_type_id = 'a0000000-0000-0000-0000-000000000031'
  where marker_type_id = 'a0000000-0000-0000-0000-000000000015';

-- Regulatory category remaps
update public.markers set marker_type_id = 'a0000000-0000-0000-0000-000000000032'
  where marker_type_id = 'a0000000-0000-0000-0000-000000000003';
update public.markers set marker_type_id = 'a0000000-0000-0000-0000-000000000033'
  where marker_type_id in (
    'a0000000-0000-0000-0000-000000000004',
    'a0000000-0000-0000-0000-000000000016'
  );
update public.markers set marker_type_id = 'a0000000-0000-0000-0000-000000000034'
  where marker_type_id = 'a0000000-0000-0000-0000-000000000017';

-- Approval category remaps
update public.markers set marker_type_id = 'a0000000-0000-0000-0000-000000000035'
  where marker_type_id in (
    'a0000000-0000-0000-0000-000000000005',
    'a0000000-0000-0000-0000-000000000006',
    'a0000000-0000-0000-0000-000000000018'
  );
update public.markers set marker_type_id = 'a0000000-0000-0000-0000-000000000036'
  where marker_type_id in (
    'a0000000-0000-0000-0000-000000000007',
    'a0000000-0000-0000-0000-000000000019'
  );

-- Clinical Trial category remaps
update public.markers set marker_type_id = 'a0000000-0000-0000-0000-000000000008'
  where marker_type_id = 'a0000000-0000-0000-0000-000000000010';

-- delete old marker types (now orphaned)
delete from public.marker_types
  where id in (
    'a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000004',
    'a0000000-0000-0000-0000-000000000005',
    'a0000000-0000-0000-0000-000000000006',
    'a0000000-0000-0000-0000-000000000007',
    'a0000000-0000-0000-0000-000000000009',
    'a0000000-0000-0000-0000-000000000010',
    'a0000000-0000-0000-0000-000000000014',
    'a0000000-0000-0000-0000-000000000015',
    'a0000000-0000-0000-0000-000000000016',
    'a0000000-0000-0000-0000-000000000017',
    'a0000000-0000-0000-0000-000000000018',
    'a0000000-0000-0000-0000-000000000019'
  );

-- =============================================================================
-- 2. drop legacy seed functions
-- =============================================================================

drop function if exists public.seed_demo_data();
drop function if exists public.seed_demo_data(uuid);
drop function if exists public.seed_pharma_demo();

-- =============================================================================
-- 3. helper: _seed_demo_companies
-- =============================================================================

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
    (c_meridian, p_space_id, p_uid, 'Meridian Therapeutics',  null, 1),
    (c_helios,   p_space_id, p_uid, 'Helios Pharma',         null, 2),
    (c_vantage,  p_space_id, p_uid, 'Vantage Biosciences',   null, 3),
    (c_apex,     p_space_id, p_uid, 'Apex Biotech',          null, 4),
    (c_cardinal, p_space_id, p_uid, 'Cardinal Life Sciences', null, 5),
    (c_solara,   p_space_id, p_uid, 'Solara Pharmaceuticals', null, 6),
    (c_cascade,  p_space_id, p_uid, 'Cascade Medicine',      null, 7),
    (c_zenith,   p_space_id, p_uid, 'Zenith Health',         null, 8);

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
