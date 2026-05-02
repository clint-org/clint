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

-- =============================================================================
-- 8. helper: _seed_demo_trials (~35 real cardiometabolic trials)
-- =============================================================================

create or replace function public._seed_demo_trials(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Products
  p_mounjaro     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_mounjaro');
  p_zepbound     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_zepbound');
  p_retatrutide  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_retatrutide');
  p_orforglipron uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_orforglipron');
  p_ozempic      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_ozempic');
  p_wegovy       uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_wegovy');
  p_rybelsus     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_rybelsus');
  p_cagrisema    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_cagrisema');
  p_farxiga      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_farxiga');
  p_jardiance    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_jardiance');
  p_survodutide  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_survodutide');
  p_camzyos      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_camzyos');
  p_aficamten    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_aficamten');
  p_kerendia     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_kerendia');
  p_entresto     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_entresto');
  p_vyndaqel     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vyndaqel');
  p_danuglipron  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_danuglipron');
  p_ct388        uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_ct388');
  p_maritide     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_maritide');
  p_vk2735_sc    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vk2735_sc');
  p_vk2735_oral  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vk2735_oral');
  p_attruby      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_attruby');

  -- Therapeutic areas
  ta_hf      uuid := (select id from _seed_ids where entity_type = 'ta' and key = 'ta_hf');
  ta_ckd     uuid := (select id from _seed_ids where entity_type = 'ta' and key = 'ta_ckd');
  ta_t2d     uuid := (select id from _seed_ids where entity_type = 'ta' and key = 'ta_t2d');
  ta_obesity uuid := (select id from _seed_ids where entity_type = 'ta' and key = 'ta_obesity');
  ta_attr_cm uuid := (select id from _seed_ids where entity_type = 'ta' and key = 'ta_attr_cm');

  -- Timeline trials (10 pivotal)
  t_surmount_1       uuid := gen_random_uuid();
  t_surpass_2        uuid := gen_random_uuid();
  t_step_1           uuid := gen_random_uuid();
  t_select           uuid := gen_random_uuid();
  t_dapa_hf          uuid := gen_random_uuid();
  t_emperor_reduced  uuid := gen_random_uuid();
  t_explorer_hcm     uuid := gen_random_uuid();
  t_paradigm_hf      uuid := gen_random_uuid();
  t_attr_act         uuid := gen_random_uuid();
  t_attribute_cm     uuid := gen_random_uuid();

  -- Landscape trials (25)
  t_surmount_mmo     uuid := gen_random_uuid();
  t_summit           uuid := gen_random_uuid();
  t_surmount_osa     uuid := gen_random_uuid();
  t_attain_1         uuid := gen_random_uuid();
  t_achieve_1        uuid := gen_random_uuid();
  t_triumph_1        uuid := gen_random_uuid();
  t_flow             uuid := gen_random_uuid();
  t_redefine_1       uuid := gen_random_uuid();
  t_redefine_2       uuid := gen_random_uuid();
  t_soul             uuid := gen_random_uuid();
  t_deliver          uuid := gen_random_uuid();
  t_dapa_ckd         uuid := gen_random_uuid();
  t_emperor_preserved uuid := gen_random_uuid();
  t_empa_kidney      uuid := gen_random_uuid();
  t_empact_mi        uuid := gen_random_uuid();
  t_survodutide_p2   uuid := gen_random_uuid();
  t_fineart_hf       uuid := gen_random_uuid();
  t_sequoia_hcm      uuid := gen_random_uuid();
  t_maple_hcm        uuid := gen_random_uuid();
  t_acacia_hcm       uuid := gen_random_uuid();
  t_odyssey_hcm      uuid := gen_random_uuid();
  t_ct388_p2         uuid := gen_random_uuid();
  t_vk2735_sc_p2     uuid := gen_random_uuid();
  t_vk2735_oral_p2   uuid := gen_random_uuid();
  t_maritide_p2      uuid := gen_random_uuid();
  t_danuglipron_p2   uuid := gen_random_uuid();
begin
  -- Timeline trials (10 pivotal, all completed and tied to launched products)
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id,
    name, identifier, sample_size, status, display_order,
    phase_type, phase_start_date, phase_end_date) values
    -- src: https://clinicaltrials.gov/study/NCT04184622
    (t_surmount_1,      p_space_id, p_uid, p_zepbound,    ta_obesity, 'SURMOUNT-1',      'NCT04184622',  2539, 'Completed', 1, 'LAUNCHED', '2019-12-04', '2022-04-01'),
    -- src: https://clinicaltrials.gov/study/NCT03987919
    (t_surpass_2,       p_space_id, p_uid, p_mounjaro,    ta_t2d,     'SURPASS-2',       'NCT03987919',  1879, 'Completed', 1, 'LAUNCHED', '2019-07-30', '2021-01-28'),
    -- src: https://clinicaltrials.gov/study/NCT03548935
    (t_step_1,          p_space_id, p_uid, p_wegovy,      ta_obesity, 'STEP 1',          'NCT03548935',  1961, 'Completed', 1, 'LAUNCHED', '2018-06-04', '2020-03-30'),
    -- src: https://clinicaltrials.gov/study/NCT03574597
    (t_select,          p_space_id, p_uid, p_wegovy,      ta_obesity, 'SELECT',          'NCT03574597', 17604, 'Completed', 2, 'APPROVED', '2018-10-24', '2023-06-21'),
    -- src: https://clinicaltrials.gov/study/NCT03036124
    (t_dapa_hf,         p_space_id, p_uid, p_farxiga,     ta_hf,      'DAPA-HF',         'NCT03036124',  4744, 'Completed', 1, 'LAUNCHED', '2017-02-08', '2019-07-17'),
    -- src: https://clinicaltrials.gov/study/NCT03057977
    (t_emperor_reduced, p_space_id, p_uid, p_jardiance,   ta_hf,      'EMPEROR-Reduced', 'NCT03057977',  3730, 'Completed', 1, 'LAUNCHED', '2017-03-06', '2020-05-01'),
    -- src: https://clinicaltrials.gov/study/NCT03470545
    (t_explorer_hcm,    p_space_id, p_uid, p_camzyos,     ta_hf,      'EXPLORER-HCM',    'NCT03470545',   251, 'Completed', 1, 'LAUNCHED', '2018-05-29', '2020-03-14'),
    -- src: https://clinicaltrials.gov/study/NCT01035255
    (t_paradigm_hf,     p_space_id, p_uid, p_entresto,    ta_hf,      'PARADIGM-HF',     'NCT01035255',  8442, 'Terminated', 1, 'LAUNCHED', '2009-12-08', '2014-05-31'),
    -- src: https://clinicaltrials.gov/study/NCT01994889
    (t_attr_act,        p_space_id, p_uid, p_vyndaqel,    ta_attr_cm, 'ATTR-ACT',        'NCT01994889',   441, 'Completed', 1, 'LAUNCHED', '2013-12-09', '2018-02-07'),
    -- src: https://clinicaltrials.gov/study/NCT03860935
    (t_attribute_cm,    p_space_id, p_uid, p_attruby,     ta_attr_cm, 'ATTRibute-CM',    'NCT03860935',   632, 'Completed', 1, 'LAUNCHED', '2019-03-19', '2023-05-11');

  -- Landscape trials (25 active or recently read out)
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id,
    name, identifier, sample_size, status, display_order,
    phase_type, phase_start_date, phase_end_date) values
    -- src: https://clinicaltrials.gov/study/NCT05556512
    (t_surmount_mmo,    p_space_id, p_uid, p_zepbound,    ta_obesity, 'SURMOUNT-MMO',    'NCT05556512', 15374, 'Active, not recruiting', 3, 'P3', '2022-10-11', null),
    -- src: https://clinicaltrials.gov/study/NCT04847557
    (t_summit,          p_space_id, p_uid, p_zepbound,    ta_hf,      'SUMMIT',          'NCT04847557',   731, 'Completed', 4, 'P3', '2021-04-20', '2024-07-02'),
    -- src: https://clinicaltrials.gov/study/NCT05412004
    (t_surmount_osa,    p_space_id, p_uid, p_zepbound,    ta_obesity, 'SURMOUNT-OSA',    'NCT05412004',   469, 'Completed', 5, 'APPROVED', '2022-06-21', '2024-03-12'),
    -- src: https://clinicaltrials.gov/study/NCT05869903
    (t_attain_1,        p_space_id, p_uid, p_orforglipron, ta_obesity,'ATTAIN-1',        'NCT05869903',  3127, 'Active, not recruiting', 6, 'P3', '2023-06-05', '2025-07-25'),
    -- src: https://clinicaltrials.gov/study/NCT05971940
    (t_achieve_1,       p_space_id, p_uid, p_orforglipron, ta_t2d,    'ACHIEVE-1',       'NCT05971940',   559, 'Completed', 7, 'P3', '2023-08-09', '2025-04-03'),
    -- src: https://clinicaltrials.gov/study/NCT05929066
    (t_triumph_1,       p_space_id, p_uid, p_retatrutide, ta_obesity, 'TRIUMPH-1',       'NCT05929066',  2300, 'Active, not recruiting', 8, 'P3', '2023-07-10', null),
    -- src: https://clinicaltrials.gov/study/NCT03819153
    (t_flow,            p_space_id, p_uid, p_ozempic,     ta_ckd,     'FLOW',            'NCT03819153',  3533, 'Completed', 4, 'APPROVED', '2019-06-17', '2024-01-09'),
    -- src: https://clinicaltrials.gov/study/NCT05567796
    (t_redefine_1,      p_space_id, p_uid, p_cagrisema,   ta_obesity, 'REDEFINE-1',      'NCT05567796',  3400, 'Active, not recruiting', 5, 'P3', '2022-11-01', '2024-10-30'),
    -- src: https://clinicaltrials.gov/study/NCT05394519
    (t_redefine_2,      p_space_id, p_uid, p_cagrisema,   ta_obesity, 'REDEFINE-2',      'NCT05394519',  1200, 'Completed', 6, 'P3', '2023-02-01', '2025-01-28'),
    -- src: https://clinicaltrials.gov/study/NCT03914326
    (t_soul,            p_space_id, p_uid, p_rybelsus,    ta_t2d,     'SOUL',            'NCT03914326',  9651, 'Completed', 7, 'P3', '2019-06-17', '2024-08-23'),
    -- src: https://clinicaltrials.gov/study/NCT03619213
    (t_deliver,         p_space_id, p_uid, p_farxiga,     ta_hf,      'DELIVER',         'NCT03619213',  6263, 'Completed', 2, 'APPROVED', '2018-08-27', '2022-03-27'),
    -- src: https://clinicaltrials.gov/study/NCT03036150
    (t_dapa_ckd,        p_space_id, p_uid, p_farxiga,     ta_ckd,     'DAPA-CKD',        'NCT03036150',  4304, 'Completed', 3, 'APPROVED', '2017-02-02', '2020-06-12'),
    -- src: https://clinicaltrials.gov/study/NCT03057951
    (t_emperor_preserved, p_space_id, p_uid, p_jardiance, ta_hf,      'EMPEROR-Preserved', 'NCT03057951', 5988, 'Completed', 2, 'APPROVED', '2017-03-02', '2021-04-26'),
    -- src: https://clinicaltrials.gov/study/NCT03594110
    (t_empa_kidney,     p_space_id, p_uid, p_jardiance,   ta_ckd,     'EMPA-KIDNEY',     'NCT03594110',  6609, 'Completed', 3, 'APPROVED', '2019-01-31', '2022-07-05'),
    -- src: https://clinicaltrials.gov/study/NCT04509674
    (t_empact_mi,       p_space_id, p_uid, p_jardiance,   ta_hf,      'EMPACT-MI',       'NCT04509674',  6522, 'Completed', 4, 'P3', '2020-12-16', '2023-11-05'),
    -- src: https://clinicaltrials.gov/study/NCT04667377
    (t_survodutide_p2,  p_space_id, p_uid, p_survodutide, ta_obesity, 'Survodutide P2 obesity', 'NCT04667377', 387, 'Completed', 1, 'P2', '2021-03-08', '2022-09-15'),
    -- src: https://clinicaltrials.gov/study/NCT04435626
    (t_fineart_hf,      p_space_id, p_uid, p_kerendia,    ta_hf,      'FINEARTS-HF',     'NCT04435626',  6016, 'Completed', 2, 'APPROVED', '2020-09-14', '2024-05-15'),
    -- src: https://clinicaltrials.gov/study/NCT05186818
    (t_sequoia_hcm,     p_space_id, p_uid, p_aficamten,   ta_hf,      'SEQUOIA-HCM',     'NCT05186818',   282, 'Completed', 1, 'P3', '2022-02-01', '2023-11-10'),
    -- src: https://clinicaltrials.gov/study/NCT05767346
    (t_maple_hcm,       p_space_id, p_uid, p_aficamten,   ta_hf,      'MAPLE-HCM',       'NCT05767346',   175, 'Completed', 2, 'P3', '2023-06-20', '2025-02-28'),
    -- src: https://clinicaltrials.gov/study/NCT06081894
    (t_acacia_hcm,      p_space_id, p_uid, p_aficamten,   ta_hf,      'ACACIA-HCM',      'NCT06081894',   500, 'Active, not recruiting', 3, 'P3', '2023-08-30', null),
    -- src: https://clinicaltrials.gov/study/NCT05582395
    (t_odyssey_hcm,     p_space_id, p_uid, p_camzyos,     ta_hf,      'ODYSSEY-HCM',     'NCT05582395',   580, 'Completed', 2, 'P3', '2022-12-14', '2025-03-06'),
    -- src: https://clinicaltrials.gov/study/NCT06525935
    (t_ct388_p2,        p_space_id, p_uid, p_ct388,       ta_obesity, 'CT-388 P2',       'NCT06525935',   469, 'Completed', 1, 'P2', '2024-08-16', '2025-12-08'),
    -- src: https://clinicaltrials.gov/study/NCT06068946
    (t_vk2735_sc_p2,    p_space_id, p_uid, p_vk2735_sc,   ta_obesity, 'VK2735 SC P2',    'NCT06068946',   176, 'Completed', 1, 'P2', '2023-08-31', '2024-02-27'),
    -- src: https://clinicaltrials.gov/study/NCT06828055
    (t_vk2735_oral_p2,  p_space_id, p_uid, p_vk2735_oral, ta_obesity, 'VK2735 oral P2',  'NCT06828055',   280, 'Completed', 2, 'P2', '2024-12-18', '2025-06-24'),
    -- src: https://clinicaltrials.gov/study/NCT05669599
    (t_maritide_p2,     p_space_id, p_uid, p_maritide,    ta_obesity, 'MariTide P2',     'NCT05669599',   592, 'Completed', 1, 'P2', '2023-01-18', '2024-10-08'),
    -- src: https://clinicaltrials.gov/study/NCT04882961
    (t_danuglipron_p2,  p_space_id, p_uid, p_danuglipron, ta_obesity, 'Danuglipron P2',  'NCT04882961',   628, 'Terminated', 1, 'P2', '2021-01-29', '2023-09-13');

  -- CT.gov dimension enrichment for the 15 most prominent trials
  update public.trials set
    recruitment_status = 'Completed', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_intervention_model = 'Parallel Assignment',
    design_masking = 'Double', design_primary_purpose = 'Treatment',
    conditions = array['Obesity'],
    intervention_type = 'Drug', intervention_name = 'tirzepatide SC weekly',
    primary_outcome_measures = array['Percent change in body weight from baseline at 72 weeks'],
    secondary_outcome_measures = array['Proportion achieving 5% body weight reduction', 'Change in waist circumference'],
    eligibility_sex = 'All', eligibility_min_age = '18 Years',
    start_date = '2019-12-04', start_date_type = 'Actual',
    primary_completion_date = '2022-04-01', primary_completion_date_type = 'Actual',
    has_dmc = true, is_fda_regulated_drug = true, is_fda_regulated_device = false
  where id = t_surmount_1;

  update public.trials set
    recruitment_status = 'Completed', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_masking = 'Single',
    conditions = array['Type 2 Diabetes Mellitus'],
    intervention_type = 'Drug', intervention_name = 'tirzepatide vs semaglutide',
    primary_outcome_measures = array['Change in HbA1c from baseline at 40 weeks'],
    has_dmc = true, is_fda_regulated_drug = true,
    start_date = '2019-07-30', start_date_type = 'Actual',
    primary_completion_date = '2021-01-28', primary_completion_date_type = 'Actual'
  where id = t_surpass_2;

  update public.trials set
    recruitment_status = 'Completed', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_masking = 'Double',
    conditions = array['Cardiovascular Disease', 'Obesity'],
    intervention_type = 'Drug', intervention_name = 'semaglutide 2.4 mg SC weekly',
    primary_outcome_measures = array['Time to first MACE (CV death, non-fatal MI, non-fatal stroke)'],
    has_dmc = true, is_fda_regulated_drug = true,
    start_date = '2018-10-24', start_date_type = 'Actual',
    primary_completion_date = '2023-06-21', primary_completion_date_type = 'Actual'
  where id = t_select;

  update public.trials set
    recruitment_status = 'Completed', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_masking = 'Double',
    conditions = array['Heart Failure with Reduced Ejection Fraction'],
    intervention_type = 'Drug', intervention_name = 'dapagliflozin 10 mg',
    primary_outcome_measures = array['Time to first HF event or CV death'],
    has_dmc = true, is_fda_regulated_drug = true,
    start_date = '2017-02-08', start_date_type = 'Actual',
    primary_completion_date = '2019-07-17', primary_completion_date_type = 'Actual'
  where id = t_dapa_hf;

  update public.trials set
    recruitment_status = 'Completed', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_masking = 'Double',
    conditions = array['Heart Failure with Reduced Ejection Fraction'],
    intervention_type = 'Drug', intervention_name = 'empagliflozin 10 mg',
    primary_outcome_measures = array['Time to CV death or HF hospitalization'],
    has_dmc = true, is_fda_regulated_drug = true,
    start_date = '2017-03-06', start_date_type = 'Actual',
    primary_completion_date = '2020-05-01', primary_completion_date_type = 'Actual'
  where id = t_emperor_reduced;

  update public.trials set
    recruitment_status = 'Completed', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_masking = 'Double',
    conditions = array['Hypertrophic Cardiomyopathy'],
    intervention_type = 'Drug', intervention_name = 'mavacamten',
    primary_outcome_measures = array['Composite of pVO2 + NYHA class improvement at week 30'],
    has_dmc = true, is_fda_regulated_drug = true,
    start_date = '2018-05-29', start_date_type = 'Actual',
    primary_completion_date = '2020-03-14', primary_completion_date_type = 'Actual'
  where id = t_explorer_hcm;

  update public.trials set
    recruitment_status = 'Completed', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_masking = 'Double',
    conditions = array['Transthyretin Cardiomyopathy'],
    intervention_type = 'Drug', intervention_name = 'tafamidis',
    primary_outcome_measures = array['Hierarchical: all-cause mortality and CV-related hospitalizations'],
    has_dmc = true, is_fda_regulated_drug = true,
    start_date = '2013-12-09', start_date_type = 'Actual',
    primary_completion_date = '2018-02-07', primary_completion_date_type = 'Actual'
  where id = t_attr_act;

  update public.trials set
    recruitment_status = 'Completed', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_masking = 'Double',
    conditions = array['Transthyretin Amyloid Cardiomyopathy'],
    intervention_type = 'Drug', intervention_name = 'acoramidis',
    primary_outcome_measures = array['Hierarchical: all-cause mortality, CV hospitalization, NT-proBNP, 6MWT'],
    has_dmc = true, is_fda_regulated_drug = true,
    start_date = '2019-03-19', start_date_type = 'Actual',
    primary_completion_date = '2023-05-11', primary_completion_date_type = 'Actual'
  where id = t_attribute_cm;

  update public.trials set
    recruitment_status = 'Completed', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_masking = 'Double',
    conditions = array['Heart Failure with Preserved Ejection Fraction', 'Obesity'],
    intervention_type = 'Drug', intervention_name = 'tirzepatide',
    primary_outcome_measures = array['Composite of CV death or worsening HF, change in KCCQ-CSS'],
    has_dmc = true, is_fda_regulated_drug = true,
    start_date = '2021-04-20', start_date_type = 'Actual',
    primary_completion_date = '2024-07-02', primary_completion_date_type = 'Actual'
  where id = t_summit;

  update public.trials set
    recruitment_status = 'Completed', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_masking = 'Double',
    conditions = array['Chronic Kidney Disease', 'Type 2 Diabetes'],
    intervention_type = 'Drug', intervention_name = 'semaglutide 1 mg SC weekly',
    primary_outcome_measures = array['Time to first kidney failure event or CV/renal death'],
    has_dmc = true, is_fda_regulated_drug = true,
    start_date = '2019-06-17', start_date_type = 'Actual',
    primary_completion_date = '2024-01-09', primary_completion_date_type = 'Actual'
  where id = t_flow;

  update public.trials set
    recruitment_status = 'Active, not recruiting', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_masking = 'Double',
    conditions = array['Obesity'],
    intervention_type = 'Drug', intervention_name = 'CagriSema (cagrilintide + semaglutide)',
    primary_outcome_measures = array['Percent change in body weight from baseline at 68 weeks'],
    has_dmc = true, is_fda_regulated_drug = true,
    start_date = '2022-11-01', start_date_type = 'Actual',
    primary_completion_date = '2024-10-30', primary_completion_date_type = 'Actual'
  where id = t_redefine_1;

  update public.trials set
    recruitment_status = 'Completed', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_masking = 'Double',
    conditions = array['Heart Failure with Preserved or Mildly Reduced Ejection Fraction'],
    intervention_type = 'Drug', intervention_name = 'finerenone',
    primary_outcome_measures = array['Composite of CV death and total HF events'],
    has_dmc = true, is_fda_regulated_drug = true,
    start_date = '2020-09-14', start_date_type = 'Actual',
    primary_completion_date = '2024-05-15', primary_completion_date_type = 'Actual'
  where id = t_fineart_hf;

  update public.trials set
    recruitment_status = 'Completed', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_masking = 'Double',
    conditions = array['Obstructive Hypertrophic Cardiomyopathy'],
    intervention_type = 'Drug', intervention_name = 'aficamten',
    primary_outcome_measures = array['Change in pVO2 at week 24'],
    has_dmc = true, is_fda_regulated_drug = true,
    start_date = '2022-02-01', start_date_type = 'Actual',
    primary_completion_date = '2023-11-10', primary_completion_date_type = 'Actual'
  where id = t_sequoia_hcm;

  update public.trials set
    recruitment_status = 'Completed', study_type = 'Interventional', phase = 'Phase 3',
    design_allocation = 'Randomized', design_masking = 'Double',
    conditions = array['Acute Myocardial Infarction'],
    intervention_type = 'Drug', intervention_name = 'empagliflozin 10 mg',
    primary_outcome_measures = array['Time to first HF hospitalization or all-cause death'],
    has_dmc = true, is_fda_regulated_drug = true,
    start_date = '2020-12-16', start_date_type = 'Actual',
    primary_completion_date = '2023-11-05', primary_completion_date_type = 'Actual'
  where id = t_empact_mi;

  update public.trials set
    recruitment_status = 'Completed', study_type = 'Interventional', phase = 'Phase 2',
    design_allocation = 'Randomized', design_masking = 'Quadruple',
    conditions = array['Obesity'],
    intervention_type = 'Drug', intervention_name = 'VK2735 SC weekly',
    primary_outcome_measures = array['Percent change in body weight at week 13'],
    has_dmc = true, is_fda_regulated_drug = true,
    start_date = '2023-08-31', start_date_type = 'Actual',
    primary_completion_date = '2024-02-27', primary_completion_date_type = 'Actual'
  where id = t_vk2735_sc_p2;

  -- Register all trial UUIDs in _seed_ids
  insert into _seed_ids (entity_type, key, id) values
    ('trial', 't_surmount_1',       t_surmount_1),
    ('trial', 't_surpass_2',        t_surpass_2),
    ('trial', 't_step_1',           t_step_1),
    ('trial', 't_select',           t_select),
    ('trial', 't_dapa_hf',          t_dapa_hf),
    ('trial', 't_emperor_reduced',  t_emperor_reduced),
    ('trial', 't_explorer_hcm',     t_explorer_hcm),
    ('trial', 't_paradigm_hf',      t_paradigm_hf),
    ('trial', 't_attr_act',         t_attr_act),
    ('trial', 't_attribute_cm',     t_attribute_cm),
    ('trial', 't_surmount_mmo',     t_surmount_mmo),
    ('trial', 't_summit',           t_summit),
    ('trial', 't_surmount_osa',     t_surmount_osa),
    ('trial', 't_attain_1',         t_attain_1),
    ('trial', 't_achieve_1',        t_achieve_1),
    ('trial', 't_triumph_1',        t_triumph_1),
    ('trial', 't_flow',             t_flow),
    ('trial', 't_redefine_1',       t_redefine_1),
    ('trial', 't_redefine_2',       t_redefine_2),
    ('trial', 't_soul',             t_soul),
    ('trial', 't_deliver',          t_deliver),
    ('trial', 't_dapa_ckd',         t_dapa_ckd),
    ('trial', 't_emperor_preserved', t_emperor_preserved),
    ('trial', 't_empa_kidney',      t_empa_kidney),
    ('trial', 't_empact_mi',        t_empact_mi),
    ('trial', 't_survodutide_p2',   t_survodutide_p2),
    ('trial', 't_fineart_hf',       t_fineart_hf),
    ('trial', 't_sequoia_hcm',      t_sequoia_hcm),
    ('trial', 't_maple_hcm',        t_maple_hcm),
    ('trial', 't_acacia_hcm',       t_acacia_hcm),
    ('trial', 't_odyssey_hcm',      t_odyssey_hcm),
    ('trial', 't_ct388_p2',         t_ct388_p2),
    ('trial', 't_vk2735_sc_p2',     t_vk2735_sc_p2),
    ('trial', 't_vk2735_oral_p2',   t_vk2735_oral_p2),
    ('trial', 't_maritide_p2',      t_maritide_p2),
    ('trial', 't_danuglipron_p2',   t_danuglipron_p2);
end;
$$;
