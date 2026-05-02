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
