-- migration: 20260502130000_seed_demo_realistic_cardiometabolic
-- snapshot date: 2026-05-02. Refresh quarterly.
--
-- purpose: replace the synthetic seed_demo helper bodies with real
--          cardiometabolic landscape data (Lilly, Novo, AZ, BI, BMS,
--          Cytokinetics, Bayer, Novartis, Pfizer, Roche, Amgen, Viking,
--          BridgeBio across HF, CKD, T2D, Obesity, ATTR-CM). Adds the
--          'conference_report' value to the materials.material_type whitelist
--          end to end.
--
-- spec: docs/superpowers/specs/2026-05-02-realistic-cardiometabolic-seed-design.md
-- verification: docs/specs/seed-data-verification.md

-- =============================================================================
-- 1. extend materials.material_type CHECK constraint
-- =============================================================================

alter table public.materials
  drop constraint materials_material_type_check;

alter table public.materials
  add constraint materials_material_type_check
  check (material_type in ('briefing', 'priority_notice', 'ad_hoc', 'conference_report'));

-- =============================================================================
-- 2. update register_material RPC whitelist
-- =============================================================================

create or replace function public.register_material(
  p_space_id uuid,
  p_file_path text,
  p_file_name text,
  p_file_size_bytes bigint,
  p_mime_type text,
  p_material_type text,
  p_title text,
  p_links jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_max_size bigint;
  v_allowed_types text[];
begin
  if not public.has_space_access(p_space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_material_type not in ('briefing', 'priority_notice', 'ad_hoc', 'conference_report') then
    raise exception 'invalid material_type: %', p_material_type
      using errcode = '22023';
  end if;

  if p_file_size_bytes is null or p_file_size_bytes < 0 then
    raise exception 'invalid file_size_bytes'
      using errcode = '22023';
  end if;

  perform public.validate_material_links_payload(p_links);

  -- read tenant upload limits via space -> tenant.
  select t.material_max_size_bytes, t.material_allowed_mime_types
    into v_max_size, v_allowed_types
  from public.spaces s
  join public.tenants t on t.id = s.tenant_id
  where s.id = p_space_id;

  if v_max_size is null then
    raise exception 'space not found' using errcode = 'P0002';
  end if;

  if p_file_size_bytes > v_max_size then
    raise exception 'file_too_large: limit is %', v_max_size
      using errcode = '22023';
  end if;

  if not (p_mime_type = any(v_allowed_types)) then
    raise exception 'mime_type_not_allowed: %', p_mime_type
      using errcode = '22023';
  end if;

  insert into public.materials (
    space_id, uploaded_by, file_path, file_name, file_size_bytes,
    mime_type, material_type, title
  ) values (
    p_space_id, auth.uid(), p_file_path, p_file_name, p_file_size_bytes,
    p_mime_type, p_material_type, coalesce(nullif(p_title, ''), p_file_name)
  )
  returning id into v_id;

  if p_links is not null and jsonb_array_length(p_links) > 0 then
    insert into public.material_links (
      material_id, entity_type, entity_id, display_order
    )
    select v_id,
           (l->>'entity_type')::text,
           (l->>'entity_id')::uuid,
           coalesce((l->>'display_order')::int, (row_number() over ())::int - 1)
    from jsonb_array_elements(p_links) l
    on conflict (material_id, entity_type, entity_id) do nothing;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.register_material(
  uuid, text, text, bigint, text, text, text, jsonb
) from public, anon;
grant  execute on function public.register_material(
  uuid, text, text, bigint, text, text, text, jsonb
) to authenticated;

-- =============================================================================
-- 3. update update_material RPC whitelist
-- =============================================================================

create or replace function public.update_material(
  p_id uuid,
  p_title text default null,
  p_material_type text default null,
  p_links jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  select m.id, m.space_id, m.uploaded_by
    into v_row
  from public.materials m
  where m.id = p_id;

  if v_row.id is null then
    raise exception 'material not found' using errcode = 'P0002';
  end if;

  if v_row.uploaded_by <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not public.has_space_access(v_row.space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_material_type is not null
     and p_material_type not in ('briefing', 'priority_notice', 'ad_hoc', 'conference_report')
  then
    raise exception 'invalid material_type: %', p_material_type
      using errcode = '22023';
  end if;

  perform public.validate_material_links_payload(p_links);

  update public.materials
  set title = coalesce(nullif(p_title, ''), title),
      material_type = coalesce(p_material_type, material_type)
  where id = p_id;

  -- replace links wholesale when an explicit array is provided.
  if p_links is not null then
    delete from public.material_links where material_id = p_id;
    if jsonb_array_length(p_links) > 0 then
      insert into public.material_links (
        material_id, entity_type, entity_id, display_order
      )
      select p_id,
             (l->>'entity_type')::text,
             (l->>'entity_id')::uuid,
             coalesce((l->>'display_order')::int, (row_number() over ())::int - 1)
      from jsonb_array_elements(p_links) l
      on conflict (material_id, entity_type, entity_id) do nothing;
    end if;
  end if;
end;
$$;

revoke execute on function public.update_material(uuid, text, text, jsonb)
  from public, anon;
grant  execute on function public.update_material(uuid, text, text, jsonb)
  to authenticated;

-- =============================================================================
-- 4. helper: _seed_demo_companies (13 real cardiometabolic companies)
-- =============================================================================

create or replace function public._seed_demo_companies(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_meridian uuid := gen_random_uuid();
  c_helios   uuid := gen_random_uuid();
  c_vantage  uuid := gen_random_uuid();
  c_apex     uuid := gen_random_uuid();
  c_cardinal uuid := gen_random_uuid();
  c_solara   uuid := gen_random_uuid();
  c_cascade  uuid := gen_random_uuid();
  c_zenith   uuid := gen_random_uuid();
  c_aurora   uuid := gen_random_uuid();
  c_vortex   uuid := gen_random_uuid();
  c_polaris  uuid := gen_random_uuid();
  c_orion    uuid := gen_random_uuid();
  c_atlas    uuid := gen_random_uuid();
begin
  insert into public.companies (id, space_id, created_by, name, logo_url, display_order) values
    (c_meridian, p_space_id, p_uid, 'Eli Lilly',            'https://cdn.brandfetch.io/domain/lilly.com',                1),
    (c_vantage,  p_space_id, p_uid, 'Novo Nordisk',         'https://cdn.brandfetch.io/domain/novonordisk.com',          2),
    (c_aurora,   p_space_id, p_uid, 'AstraZeneca',          'https://cdn.brandfetch.io/domain/astrazeneca.com',          3),
    (c_vortex,   p_space_id, p_uid, 'Boehringer Ingelheim', 'https://cdn.brandfetch.io/domain/boehringer-ingelheim.com', 4),
    (c_helios,   p_space_id, p_uid, 'Bristol Myers Squibb', 'https://cdn.brandfetch.io/domain/bms.com',                  5),
    (c_solara,   p_space_id, p_uid, 'Cytokinetics',         'https://cdn.brandfetch.io/domain/cytokinetics.com',         6),
    (c_cardinal, p_space_id, p_uid, 'Bayer',                'https://cdn.brandfetch.io/domain/bayer.com',                7),
    (c_polaris,  p_space_id, p_uid, 'Novartis',             'https://cdn.brandfetch.io/domain/novartis.com',             8),
    (c_apex,     p_space_id, p_uid, 'Pfizer',               'https://cdn.brandfetch.io/domain/pfizer.com',               9),
    (c_cascade,  p_space_id, p_uid, 'Roche',                'https://cdn.brandfetch.io/domain/roche.com',                10),
    (c_orion,    p_space_id, p_uid, 'Amgen',                'https://cdn.brandfetch.io/domain/amgen.com',                11),
    (c_zenith,   p_space_id, p_uid, 'Viking Therapeutics',  'https://cdn.brandfetch.io/domain/vikingtherapeutics.com',   12),
    (c_atlas,    p_space_id, p_uid, 'BridgeBio',            'https://cdn.brandfetch.io/domain/bridgebio.com',            13);

  insert into _seed_ids (entity_type, key, id) values
    ('company', 'c_meridian',  c_meridian),
    ('company', 'c_helios',    c_helios),
    ('company', 'c_vantage',   c_vantage),
    ('company', 'c_apex',      c_apex),
    ('company', 'c_cardinal',  c_cardinal),
    ('company', 'c_solara',    c_solara),
    ('company', 'c_cascade',   c_cascade),
    ('company', 'c_zenith',    c_zenith),
    ('company', 'c_aurora',    c_aurora),
    ('company', 'c_vortex',    c_vortex),
    ('company', 'c_polaris',   c_polaris),
    ('company', 'c_orion',     c_orion),
    ('company', 'c_atlas',     c_atlas);
end;
$$;

-- =============================================================================
-- 5. helper: _seed_demo_therapeutic_areas (5 TAs incl ATTR-CM)
-- =============================================================================

create or replace function public._seed_demo_therapeutic_areas(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ta_hf       uuid := gen_random_uuid();
  ta_ckd      uuid := gen_random_uuid();
  ta_t2d      uuid := gen_random_uuid();
  ta_obesity  uuid := gen_random_uuid();
  ta_attr_cm  uuid := gen_random_uuid();
begin
  insert into public.therapeutic_areas (id, space_id, created_by, name, abbreviation) values
    (ta_hf,      p_space_id, p_uid, 'Heart Failure',          'HF'),
    (ta_ckd,     p_space_id, p_uid, 'Chronic Kidney Disease', 'CKD'),
    (ta_t2d,     p_space_id, p_uid, 'Type 2 Diabetes',        'T2D'),
    (ta_obesity, p_space_id, p_uid, 'Obesity',                'OB'),
    (ta_attr_cm, p_space_id, p_uid, 'ATTR Cardiomyopathy',    'ATTR-CM');

  insert into _seed_ids (entity_type, key, id) values
    ('ta', 'ta_hf',      ta_hf),
    ('ta', 'ta_ckd',     ta_ckd),
    ('ta', 'ta_t2d',     ta_t2d),
    ('ta', 'ta_obesity', ta_obesity),
    ('ta', 'ta_attr_cm', ta_attr_cm);
end;
$$;

-- =============================================================================
-- 6. helper: _seed_demo_products (28 real cardiometabolic products)
-- =============================================================================

create or replace function public._seed_demo_products(p_space_id uuid, p_uid uuid)
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

  -- Lilly products
  p_mounjaro      uuid := gen_random_uuid();
  p_zepbound      uuid := gen_random_uuid();
  p_retatrutide   uuid := gen_random_uuid();
  p_orforglipron  uuid := gen_random_uuid();
  p_trulicity     uuid := gen_random_uuid();
  -- Novo products
  p_ozempic       uuid := gen_random_uuid();
  p_wegovy        uuid := gen_random_uuid();
  p_rybelsus      uuid := gen_random_uuid();
  p_cagrisema     uuid := gen_random_uuid();
  -- AZ products
  p_farxiga       uuid := gen_random_uuid();
  p_azd5004       uuid := gen_random_uuid();
  -- BI products
  p_jardiance     uuid := gen_random_uuid();
  p_survodutide   uuid := gen_random_uuid();
  -- BMS products
  p_camzyos       uuid := gen_random_uuid();
  -- Cytokinetics products
  p_aficamten     uuid := gen_random_uuid();
  p_omecamtiv     uuid := gen_random_uuid();
  -- Bayer products
  p_kerendia      uuid := gen_random_uuid();
  p_verquvo       uuid := gen_random_uuid();
  -- Novartis products
  p_entresto      uuid := gen_random_uuid();
  p_leqvio        uuid := gen_random_uuid();
  -- Pfizer products
  p_vyndaqel      uuid := gen_random_uuid();
  p_danuglipron   uuid := gen_random_uuid();
  -- Roche products
  p_ct388         uuid := gen_random_uuid();
  p_ct996         uuid := gen_random_uuid();
  -- Amgen products
  p_maritide      uuid := gen_random_uuid();
  -- Viking products
  p_vk2735_sc     uuid := gen_random_uuid();
  p_vk2735_oral   uuid := gen_random_uuid();
  -- BridgeBio products
  p_attruby       uuid := gen_random_uuid();
begin
  insert into public.products (id, space_id, created_by, company_id, name, generic_name, display_order) values
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
    ('product', 'p_mounjaro',     p_mounjaro),
    ('product', 'p_zepbound',     p_zepbound),
    ('product', 'p_retatrutide',  p_retatrutide),
    ('product', 'p_orforglipron', p_orforglipron),
    ('product', 'p_trulicity',    p_trulicity),
    ('product', 'p_ozempic',      p_ozempic),
    ('product', 'p_wegovy',       p_wegovy),
    ('product', 'p_rybelsus',     p_rybelsus),
    ('product', 'p_cagrisema',    p_cagrisema),
    ('product', 'p_farxiga',      p_farxiga),
    ('product', 'p_azd5004',      p_azd5004),
    ('product', 'p_jardiance',    p_jardiance),
    ('product', 'p_survodutide',  p_survodutide),
    ('product', 'p_camzyos',      p_camzyos),
    ('product', 'p_aficamten',    p_aficamten),
    ('product', 'p_omecamtiv',    p_omecamtiv),
    ('product', 'p_kerendia',     p_kerendia),
    ('product', 'p_verquvo',      p_verquvo),
    ('product', 'p_entresto',     p_entresto),
    ('product', 'p_leqvio',       p_leqvio),
    ('product', 'p_vyndaqel',     p_vyndaqel),
    ('product', 'p_danuglipron',  p_danuglipron),
    ('product', 'p_ct388',        p_ct388),
    ('product', 'p_ct996',        p_ct996),
    ('product', 'p_maritide',     p_maritide),
    ('product', 'p_vk2735_sc',    p_vk2735_sc),
    ('product', 'p_vk2735_oral',  p_vk2735_oral),
    ('product', 'p_attruby',      p_attruby);
end;
$$;

-- =============================================================================
-- 7. helper: _seed_demo_moa_roa (12 MoA, 3 RoA, 28 product mappings)
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
  moa_gip_glp1       uuid := gen_random_uuid();
  moa_triple         uuid := gen_random_uuid();
  moa_glp1_glucagon  uuid := gen_random_uuid();
  moa_gipra_glp1     uuid := gen_random_uuid();
  moa_nsmra          uuid := gen_random_uuid();
  moa_sgc            uuid := gen_random_uuid();
  moa_cmi            uuid := gen_random_uuid();
  moa_ttr            uuid := gen_random_uuid();
  moa_arni           uuid := gen_random_uuid();
  moa_pcsk9_sirna    uuid := gen_random_uuid();

  roa_oral uuid := gen_random_uuid();
  roa_sc   uuid := gen_random_uuid();
  roa_iv   uuid := gen_random_uuid();

  p_mounjaro     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_mounjaro');
  p_zepbound     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_zepbound');
  p_retatrutide  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_retatrutide');
  p_orforglipron uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_orforglipron');
  p_trulicity    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_trulicity');
  p_ozempic      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_ozempic');
  p_wegovy       uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_wegovy');
  p_rybelsus     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_rybelsus');
  p_cagrisema    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_cagrisema');
  p_farxiga      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_farxiga');
  p_azd5004      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_azd5004');
  p_jardiance    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_jardiance');
  p_survodutide  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_survodutide');
  p_camzyos      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_camzyos');
  p_aficamten    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_aficamten');
  p_omecamtiv    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_omecamtiv');
  p_kerendia     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_kerendia');
  p_verquvo      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_verquvo');
  p_entresto     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_entresto');
  p_leqvio       uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_leqvio');
  p_vyndaqel     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vyndaqel');
  p_danuglipron  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_danuglipron');
  p_ct388        uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_ct388');
  p_ct996        uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_ct996');
  p_maritide     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_maritide');
  p_vk2735_sc    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vk2735_sc');
  p_vk2735_oral  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vk2735_oral');
  p_attruby      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_attruby');
begin
  insert into public.mechanisms_of_action (id, space_id, created_by, name, abbreviation, description, display_order) values
    (moa_sglt2,         p_space_id, p_uid, 'SGLT2 inhibitor',                     'SGLT2i',         'Blocks sodium-glucose co-transporter 2 in the proximal tubule, increasing urinary glucose and sodium excretion.', 1),
    (moa_glp1,          p_space_id, p_uid, 'GLP-1 receptor agonist',              'GLP-1 RA',       'Activates the GLP-1 receptor to potentiate glucose-dependent insulin secretion and slow gastric emptying.', 2),
    (moa_gip_glp1,      p_space_id, p_uid, 'GIP/GLP-1 dual agonist',              'GIP/GLP-1',      'Co-activates GIP and GLP-1 receptors for additive incretin and adipocyte effects.', 3),
    (moa_triple,        p_space_id, p_uid, 'GIP/GLP-1/glucagon triple agonist',   'Triple',         'Co-activates GIP, GLP-1, and glucagon receptors, adding energy expenditure to incretin-driven weight loss.', 4),
    (moa_glp1_glucagon, p_space_id, p_uid, 'GLP-1/glucagon dual agonist',         'GLP-1/Glucagon', 'Co-activates GLP-1 and glucagon receptors to combine satiety with increased energy expenditure.', 5),
    (moa_gipra_glp1,    p_space_id, p_uid, 'GIPR antagonist + GLP-1 agonist',     'GIPR-A/GLP-1',   'Blocks GIP receptor signaling while activating GLP-1, a differentiated incretin combination thesis.', 6),
    (moa_nsmra,         p_space_id, p_uid, 'Non-steroidal MRA',                   'nsMRA',          'Selective non-steroidal mineralocorticoid receptor antagonist with reduced hyperkalemia risk.', 7),
    (moa_sgc,           p_space_id, p_uid, 'sGC stimulator',                      'sGC',            'Stimulates soluble guanylate cyclase to increase cGMP independent of nitric oxide availability.', 8),
    (moa_cmi,           p_space_id, p_uid, 'Cardiac myosin inhibitor',            'CMI',            'Selectively inhibits cardiac myosin to reduce hypercontractility in hypertrophic cardiomyopathy.', 9),
    (moa_ttr,           p_space_id, p_uid, 'TTR stabilizer',                      'TTR',            'Stabilizes the transthyretin tetramer to prevent dissociation and amyloid fibril formation.', 10),
    (moa_arni,          p_space_id, p_uid, 'ARNI',                                'ARNI',           'Combined angiotensin receptor blocker and neprilysin inhibitor for HFrEF.', 11),
    (moa_pcsk9_sirna,   p_space_id, p_uid, 'PCSK9 siRNA',                         'PCSK9 siRNA',    'Small interfering RNA that silences hepatic PCSK9, lowering LDL-C with twice-yearly dosing.', 12);

  insert into public.routes_of_administration (id, space_id, created_by, name, abbreviation, display_order) values
    (roa_oral, p_space_id, p_uid, 'Oral',         'PO', 1),
    (roa_sc,   p_space_id, p_uid, 'Subcutaneous', 'SC', 2),
    (roa_iv,   p_space_id, p_uid, 'Intravenous',  'IV', 3);

  insert into public.product_mechanisms_of_action (product_id, moa_id) values
    (p_mounjaro,     moa_gip_glp1),
    (p_zepbound,     moa_gip_glp1),
    (p_retatrutide,  moa_triple),
    (p_orforglipron, moa_glp1),
    (p_trulicity,    moa_glp1),
    (p_ozempic,      moa_glp1),
    (p_wegovy,       moa_glp1),
    (p_rybelsus,     moa_glp1),
    (p_cagrisema,    moa_glp1),
    (p_farxiga,      moa_sglt2),
    (p_azd5004,      moa_glp1),
    (p_jardiance,    moa_sglt2),
    (p_survodutide,  moa_glp1_glucagon),
    (p_camzyos,      moa_cmi),
    (p_aficamten,    moa_cmi),
    (p_omecamtiv,    moa_cmi),
    (p_kerendia,     moa_nsmra),
    (p_verquvo,      moa_sgc),
    (p_entresto,     moa_arni),
    (p_leqvio,       moa_pcsk9_sirna),
    (p_vyndaqel,     moa_ttr),
    (p_danuglipron,  moa_glp1),
    (p_ct388,        moa_gip_glp1),
    (p_ct996,        moa_glp1),
    (p_maritide,     moa_gipra_glp1),
    (p_vk2735_sc,    moa_gip_glp1),
    (p_vk2735_oral,  moa_gip_glp1),
    (p_attruby,      moa_ttr);

  insert into public.product_routes_of_administration (product_id, roa_id) values
    (p_mounjaro,     roa_sc),
    (p_zepbound,     roa_sc),
    (p_retatrutide,  roa_sc),
    (p_orforglipron, roa_oral),
    (p_trulicity,    roa_sc),
    (p_ozempic,      roa_sc),
    (p_wegovy,       roa_sc),
    (p_rybelsus,     roa_oral),
    (p_cagrisema,    roa_sc),
    (p_farxiga,      roa_oral),
    (p_azd5004,      roa_oral),
    (p_jardiance,    roa_oral),
    (p_survodutide,  roa_sc),
    (p_camzyos,      roa_oral),
    (p_aficamten,    roa_oral),
    (p_omecamtiv,    roa_oral),
    (p_kerendia,     roa_oral),
    (p_verquvo,      roa_oral),
    (p_entresto,     roa_oral),
    (p_leqvio,       roa_sc),
    (p_vyndaqel,     roa_oral),
    (p_danuglipron,  roa_oral),
    (p_ct388,        roa_sc),
    (p_ct996,        roa_oral),
    (p_maritide,     roa_sc),
    (p_vk2735_sc,    roa_sc),
    (p_vk2735_oral,  roa_oral),
    (p_attruby,      roa_oral);
end;
$$;
