-- migration: 20260412130500_update_rpcs_moa_abbreviation
-- purpose: update RPCs that return MOA data to use m.abbreviation instead of
--          a hardcoded null, now that mechanisms_of_action.abbreviation exists.
--          Also update get_positioning_data to prefer abbreviations over full
--          names in bubble labels for all grouping dimensions that support it
--          (moa, moa+therapeutic-area, therapeutic-area, roa).
-- affected objects:
--   public.get_bullseye_by_moa        (scope object: abbreviation field)
--   public.get_landscape_index_by_moa (entity object: abbreviation field)
--   public.get_positioning_data       (group_label: coalesce(abbrev, name))

-- =============================================================================
-- 1. get_bullseye_by_moa: return m.abbreviation in scope object
-- =============================================================================
create or replace function public.get_bullseye_by_moa(
  p_space_id uuid,
  p_moa_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_scope  jsonb;
  v_spokes jsonb;
begin
  select jsonb_build_object('id', m.id, 'name', m.name, 'abbreviation', m.abbreviation)
  into v_scope
  from public.mechanisms_of_action m
  where m.id = p_moa_id and m.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension',   'moa',
      'scope',       null,
      'ring_order',  jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
      'spokes',      '[]'::jsonb,
      'spoke_label', 'Companies'
    );
  end if;

  with product_rollup as (
    select
      p.id   as product_id,
      p.name as product_name,
      p.generic_name,
      p.logo_url,
      p.company_id,
      max(case t.phase_type
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) as max_rank
    from public.product_mechanisms_of_action pmoa
    join public.products p on p.id = pmoa.product_id and p.space_id = p_space_id
    join public.trials t
      on t.product_id = p.id
     and t.space_id = p_space_id
     and t.phase_type is not null
     and t.phase_type <> 'OBS'
    where pmoa.moa_id = p_moa_id
    group by p.id, p.name, p.generic_name, p.logo_url, p.company_id
    having max(case t.phase_type
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) is not null
  ),
  company_rank as (
    select company_id, max(max_rank) as company_max_rank
    from product_rollup
    group by company_id
  )
  select coalesce(jsonb_agg(spoke_obj order by cr.company_max_rank desc, c.name), '[]'::jsonb)
  into v_spokes
  from public.companies c
  join company_rank cr on cr.company_id = c.id
  cross join lateral (
    select jsonb_build_object(
      'id',                c.id,
      'name',              c.name,
      'display_order',     c.display_order,
      'highest_phase_rank', cr.company_max_rank,
      'products', (
        select coalesce(jsonb_agg(product_obj order by pr.max_rank desc, pr.product_name), '[]'::jsonb)
        from product_rollup pr
        cross join lateral (
          select jsonb_build_object(
            'id',                 pr.product_id,
            'name',               pr.product_name,
            'generic_name',       pr.generic_name,
            'logo_url',           pr.logo_url,
            'company_id',         pr.company_id,
            'company_name',       c.name,
            'highest_phase_rank', pr.max_rank,
            'highest_phase', case pr.max_rank
              when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
              when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
            end,
            'moas', coalesce((
              select jsonb_agg(jsonb_build_object('id', mm.id, 'name', mm.name) order by mm.display_order, mm.name)
              from public.product_mechanisms_of_action pmoa2
              join public.mechanisms_of_action mm on mm.id = pmoa2.moa_id
              where pmoa2.product_id = pr.product_id
            ), '[]'::jsonb),
            'roas', coalesce((
              select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name)
              from public.product_routes_of_administration proa
              join public.routes_of_administration r on r.id = proa.roa_id
              where proa.product_id = pr.product_id
            ), '[]'::jsonb),
            'trials', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id',                 t.id,
                  'name',               t.name,
                  'identifier',         t.identifier,
                  'sample_size',        t.sample_size,
                  'status',             t.status,
                  'recruitment_status', t.recruitment_status,
                  'study_type',         t.study_type,
                  'phase',              t.phase_type
                ) order by t.display_order, t.name
              ), '[]'::jsonb)
              from public.trials t
              where t.product_id = pr.product_id and t.space_id = p_space_id
            ),
            'recent_markers', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id',               rmm.id,
                  'event_date',       rmm.event_date,
                  'projection',       rmm.projection,
                  'marker_type_name', mt.name,
                  'icon',             mt.icon,
                  'shape',            mt.shape,
                  'color',            mt.color,
                  'category_name',    mc.name
                ) order by rmm.event_date desc
              ), '[]'::jsonb)
              from (
                select m.id, m.event_date, m.marker_type_id, m.projection
                from public.marker_assignments ma
                join public.markers m on m.id = ma.marker_id
                join public.trials t2 on t2.id = ma.trial_id
                where t2.product_id = pr.product_id
                  and t2.space_id = p_space_id
                  and m.space_id = p_space_id
                order by m.event_date desc
                limit 3
              ) rmm
              join public.marker_types mt on mt.id = rmm.marker_type_id
              left join public.marker_categories mc on mc.id = mt.category_id
            )
          ) as product_obj
        ) as product_lateral
        where pr.company_id = c.id
      )
    ) as spoke_obj
  ) as spoke_lateral
  where c.space_id = p_space_id;

  return jsonb_build_object(
    'dimension',   'moa',
    'scope',       v_scope,
    'ring_order',  jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
    'spokes',      coalesce(v_spokes, '[]'::jsonb),
    'spoke_label', 'Companies'
  );
end;
$$;


-- =============================================================================
-- 2. get_landscape_index_by_moa: return m.abbreviation in entity object
-- =============================================================================
create or replace function public.get_landscape_index_by_moa(
  p_space_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  select coalesce(jsonb_agg(entry_obj order by m.display_order, m.name), '[]'::jsonb)
  into result
  from public.mechanisms_of_action m
  cross join lateral (
    with product_rollup as (
      select
        p.id as product_id,
        p.company_id,
        max(case t.phase_type
          when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
          when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
          else null
        end) as max_rank
      from public.product_mechanisms_of_action pmoa
      join public.products p on p.id = pmoa.product_id and p.space_id = p_space_id
      join public.trials t on t.product_id = p.id and t.space_id = p_space_id
      where pmoa.moa_id = m.id
        and (t.phase_type is null or t.phase_type <> 'OBS')
      group by p.id, p.company_id
    )
    select jsonb_build_object(
      'entity',          jsonb_build_object('id', m.id, 'name', m.name, 'abbreviation', m.abbreviation),
      'product_count',   (select count(*) from product_rollup where max_rank is not null),
      'secondary_count', (select count(distinct company_id) from product_rollup where max_rank is not null),
      'secondary_label', 'companies',
      'highest_phase_present', (
        select case max(max_rank)
          when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
          when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
          else null
        end from product_rollup where max_rank is not null
      ),
      'products_missing_phase', (select count(*) from product_rollup where max_rank is null)
    ) as entry_obj
  ) as entry_lateral
  where m.space_id = p_space_id;

  return result;
end;
$$;


-- =============================================================================
-- 3. get_positioning_data: use coalesce(abbreviation, name) for bubble labels
--    for moa, moa+therapeutic-area, therapeutic-area, and roa groupings
-- =============================================================================
create or replace function public.get_positioning_data(
  p_space_id                    uuid,
  p_grouping                    text default 'moa',
  p_count_unit                  text default 'products',
  p_company_ids                 uuid[] default null,
  p_product_ids                 uuid[] default null,
  p_therapeutic_area_ids        uuid[] default null,
  p_mechanism_of_action_ids     uuid[] default null,
  p_route_of_administration_ids uuid[] default null,
  p_phases                      text[] default null,
  p_recruitment_statuses        text[] default null,
  p_study_types                 text[] default null
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_bubbles jsonb;
begin
  -- normalize empty arrays to null
  if p_company_ids = '{}' then p_company_ids := null; end if;
  if p_product_ids = '{}' then p_product_ids := null; end if;
  if p_therapeutic_area_ids = '{}' then p_therapeutic_area_ids := null; end if;
  if p_mechanism_of_action_ids = '{}' then p_mechanism_of_action_ids := null; end if;
  if p_route_of_administration_ids = '{}' then p_route_of_administration_ids := null; end if;
  if p_phases = '{}' then p_phases := null; end if;
  if p_recruitment_statuses = '{}' then p_recruitment_statuses := null; end if;
  if p_study_types = '{}' then p_study_types := null; end if;

  with phase_rank_map(phase_name, phase_rank) as (
    values
      ('PRECLIN'::text, 0), ('P1', 1), ('P2', 2), ('P3', 3),
      ('P4', 4), ('APPROVED', 5), ('LAUNCHED', 6)
  ),

  -- eligible products: have at least one trial with a non-OBS, non-null phase_type
  eligible_products as (
    select distinct
      p.id          as product_id,
      p.name        as product_name,
      p.company_id,
      c.name        as company_name
    from public.products p
    join public.companies c on c.id = p.company_id
    join public.trials t on t.product_id = p.id
    join phase_rank_map prm on prm.phase_name = t.phase_type
    where p.space_id = p_space_id
      and t.space_id = p_space_id
      and t.phase_type is not null
      and t.phase_type <> 'OBS'
      and (p_company_ids is null or p.company_id = any(p_company_ids))
      and (p_product_ids is null or p.id = any(p_product_ids))
      and (p_therapeutic_area_ids is null or t.therapeutic_area_id = any(p_therapeutic_area_ids))
      and (p_mechanism_of_action_ids is null or exists (
        select 1 from public.product_mechanisms_of_action pm
        where pm.product_id = p.id and pm.moa_id = any(p_mechanism_of_action_ids)
      ))
      and (p_route_of_administration_ids is null or exists (
        select 1 from public.product_routes_of_administration pr
        where pr.product_id = p.id and pr.roa_id = any(p_route_of_administration_ids)
      ))
      and (p_phases is null or t.phase_type = any(p_phases))
      and (p_recruitment_statuses is null or t.recruitment_status = any(p_recruitment_statuses))
      and (p_study_types is null or t.study_type = any(p_study_types))
  ),

  product_highest_phase as (
    select
      ep.product_id,
      ep.product_name,
      ep.company_id,
      ep.company_name,
      max(prm.phase_rank) as highest_phase_rank,
      (array_agg(prm.phase_name order by prm.phase_rank desc))[1] as highest_phase,
      count(distinct t.id) as trial_count
    from eligible_products ep
    join public.trials t on t.product_id = ep.product_id and t.space_id = p_space_id
    join phase_rank_map prm on prm.phase_name = t.phase_type
    where t.phase_type is not null
      and t.phase_type <> 'OBS'
      and (p_therapeutic_area_ids is null or t.therapeutic_area_id = any(p_therapeutic_area_ids))
      and (p_recruitment_statuses is null or t.recruitment_status = any(p_recruitment_statuses))
      and (p_study_types is null or t.study_type = any(p_study_types))
    group by ep.product_id, ep.product_name, ep.company_id, ep.company_name
  ),

  product_groups as (
    select
      php.product_id, php.product_name, php.company_id, php.company_name,
      php.highest_phase_rank, php.highest_phase, php.trial_count,
      case p_grouping
        when 'moa'                  then m.id::text
        when 'therapeutic-area'     then ta.id::text
        when 'moa+therapeutic-area' then m.id::text || '|' || ta.id::text
        when 'company'              then php.company_id::text
        when 'roa'                  then r.id::text
      end as group_key,
      case p_grouping
        when 'moa'                  then coalesce(m.abbreviation, m.name)
        when 'therapeutic-area'     then coalesce(ta.abbreviation, ta.name)
        when 'moa+therapeutic-area' then coalesce(m.abbreviation, m.name) || ' + ' || coalesce(ta.abbreviation, ta.name)
        when 'company'              then php.company_name
        when 'roa'                  then coalesce(r.abbreviation, r.name)
      end as group_label,
      case p_grouping
        when 'moa'                  then jsonb_build_object('moa_id', m.id, 'moa_name', m.name)
        when 'therapeutic-area'     then jsonb_build_object('therapeutic_area_id', ta.id, 'therapeutic_area_name', ta.name)
        when 'moa+therapeutic-area' then jsonb_build_object('moa_id', m.id, 'moa_name', m.name, 'therapeutic_area_id', ta.id, 'therapeutic_area_name', ta.name)
        when 'company'              then jsonb_build_object('company_id', php.company_id, 'company_name', php.company_name)
        when 'roa'                  then jsonb_build_object('roa_id', r.id, 'roa_name', r.name)
      end as group_keys
    from product_highest_phase php
    left join public.product_mechanisms_of_action pm
      on pm.product_id = php.product_id
      and p_grouping in ('moa', 'moa+therapeutic-area')
    left join public.mechanisms_of_action m
      on m.id = pm.moa_id
      and p_grouping in ('moa', 'moa+therapeutic-area')
    left join lateral (
      select distinct t2.therapeutic_area_id
      from public.trials t2
      where t2.product_id = php.product_id
        and t2.space_id = p_space_id
        and t2.therapeutic_area_id is not null
        and p_grouping in ('therapeutic-area', 'moa+therapeutic-area')
    ) trial_tas on true
    left join public.therapeutic_areas ta
      on ta.id = trial_tas.therapeutic_area_id
      and p_grouping in ('therapeutic-area', 'moa+therapeutic-area')
    left join public.product_routes_of_administration pr
      on pr.product_id = php.product_id
      and p_grouping = 'roa'
    left join public.routes_of_administration r
      on r.id = pr.roa_id
      and p_grouping = 'roa'
    where
      case p_grouping
        when 'moa'                  then m.id is not null
        when 'therapeutic-area'     then ta.id is not null
        when 'moa+therapeutic-area' then m.id is not null and ta.id is not null
        when 'company'              then true
        when 'roa'                  then r.id is not null
        else false
      end
  ),

  bubble_agg as (
    select
      pg.group_key,
      pg.group_label,
      pg.group_keys,
      count(distinct pg.company_id) as competitor_count,
      max(pg.highest_phase_rank)    as highest_phase_rank,
      (array_agg(pg.highest_phase order by pg.highest_phase_rank desc))[1] as highest_phase,
      case p_count_unit
        when 'products'   then count(distinct pg.product_id)
        when 'trials'     then sum(pg.trial_count)
        when 'companies'  then count(distinct pg.company_id)
      end as unit_count,
      jsonb_agg(distinct jsonb_build_object(
        'id',                 pg.product_id,
        'name',               pg.product_name,
        'company_id',         pg.company_id,
        'company_name',       pg.company_name,
        'highest_phase',      pg.highest_phase,
        'highest_phase_rank', pg.highest_phase_rank,
        'trial_count',        pg.trial_count
      )) as products
    from product_groups pg
    group by pg.group_key, pg.group_label, pg.group_keys
  )

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'label',              ba.group_label,
      'group_keys',         ba.group_keys,
      'competitor_count',   ba.competitor_count,
      'highest_phase',      ba.highest_phase,
      'highest_phase_rank', ba.highest_phase_rank,
      'unit_count',         ba.unit_count,
      'products',           ba.products
    )
    order by ba.competitor_count desc, ba.highest_phase_rank desc
  ), '[]'::jsonb)
  into v_bubbles
  from bubble_agg ba;

  return jsonb_build_object(
    'grouping',   p_grouping,
    'count_unit', p_count_unit,
    'bubbles',    v_bubbles
  );
end;
$$;
