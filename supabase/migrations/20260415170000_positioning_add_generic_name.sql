-- migration: 20260415170000_positioning_add_generic_name
-- purpose: include product generic_name in get_positioning_data RPC output
-- affected objects: public.get_positioning_data (function)

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

  eligible_products as (
    select distinct p.id as product_id, p.name as product_name,
           p.generic_name as product_generic_name,
           p.company_id, c.name as company_name
    from public.products p
    join public.companies c on c.id = p.company_id
    join public.trials t on t.product_id = p.id
    join public.trial_phases tp on tp.trial_id = t.id
    join phase_rank_map prm on prm.phase_name = tp.phase_type
    where p.space_id = p_space_id
      and tp.phase_type <> 'OBS'
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
      and (p_phases is null or tp.phase_type = any(p_phases))
      and (p_recruitment_statuses is null or t.recruitment_status = any(p_recruitment_statuses))
      and (p_study_types is null or t.study_type = any(p_study_types))
  ),

  product_highest_phase as (
    select ep.product_id, ep.product_name, ep.product_generic_name,
           ep.company_id, ep.company_name,
           max(prm.phase_rank) as highest_phase_rank,
           (array_agg(prm.phase_name order by prm.phase_rank desc))[1] as highest_phase,
           count(distinct t.id) as trial_count
    from eligible_products ep
    join public.trials t on t.product_id = ep.product_id
    join public.trial_phases tp on tp.trial_id = t.id and tp.phase_type <> 'OBS'
    join phase_rank_map prm on prm.phase_name = tp.phase_type
    where t.product_id = ep.product_id
      and (p_therapeutic_area_ids is null or t.therapeutic_area_id = any(p_therapeutic_area_ids))
      and (p_recruitment_statuses is null or t.recruitment_status = any(p_recruitment_statuses))
      and (p_study_types is null or t.study_type = any(p_study_types))
    group by ep.product_id, ep.product_name, ep.product_generic_name, ep.company_id, ep.company_name
  ),

  product_groups as (
    select
      php.product_id, php.product_name, php.product_generic_name,
      php.company_id, php.company_name,
      php.highest_phase_rank, php.highest_phase, php.trial_count,
      case p_grouping
        when 'moa' then m.id::text
        when 'therapeutic-area' then ta.id::text
        when 'moa+therapeutic-area' then m.id::text || '|' || ta.id::text
        when 'company' then php.company_id::text
        when 'roa' then r.id::text
      end as group_key,
      case p_grouping
        when 'moa' then m.name
        when 'therapeutic-area' then ta.name
        when 'moa+therapeutic-area' then m.name || ' + ' || ta.name
        when 'company' then php.company_name
        when 'roa' then r.name
      end as group_label,
      case p_grouping
        when 'moa' then jsonb_build_object('moa_id', m.id, 'moa_name', m.name)
        when 'therapeutic-area' then jsonb_build_object('therapeutic_area_id', ta.id, 'therapeutic_area_name', ta.name)
        when 'moa+therapeutic-area' then jsonb_build_object('moa_id', m.id, 'moa_name', m.name, 'therapeutic_area_id', ta.id, 'therapeutic_area_name', ta.name)
        when 'company' then jsonb_build_object('company_id', php.company_id, 'company_name', php.company_name)
        when 'roa' then jsonb_build_object('roa_id', r.id, 'roa_name', r.name)
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
        when 'moa' then m.id is not null
        when 'therapeutic-area' then ta.id is not null
        when 'moa+therapeutic-area' then m.id is not null and ta.id is not null
        when 'company' then true
        when 'roa' then r.id is not null
        else false
      end
  ),

  bubble_agg as (
    select
      pg.group_key,
      pg.group_label,
      pg.group_keys,
      count(distinct pg.company_id) as competitor_count,
      max(pg.highest_phase_rank) as highest_phase_rank,
      (array_agg(pg.highest_phase order by pg.highest_phase_rank desc))[1] as highest_phase,
      case p_count_unit
        when 'products' then count(distinct pg.product_id)
        when 'trials' then sum(pg.trial_count)
        when 'companies' then count(distinct pg.company_id)
      end as unit_count,
      jsonb_agg(distinct jsonb_build_object(
        'id', pg.product_id,
        'name', pg.product_name,
        'generic_name', pg.product_generic_name,
        'company_id', pg.company_id,
        'company_name', pg.company_name,
        'highest_phase', pg.highest_phase,
        'highest_phase_rank', pg.highest_phase_rank,
        'trial_count', pg.trial_count
      )) as products
    from product_groups pg
    group by pg.group_key, pg.group_label, pg.group_keys
  )

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'label', ba.group_label,
      'group_keys', ba.group_keys,
      'competitor_count', ba.competitor_count,
      'highest_phase', ba.highest_phase,
      'highest_phase_rank', ba.highest_phase_rank,
      'unit_count', ba.unit_count,
      'products', ba.products
    )
    order by ba.competitor_count desc, ba.highest_phase_rank desc
  ), '[]'::jsonb)
  into v_bubbles
  from bubble_agg ba;

  return jsonb_build_object(
    'grouping', p_grouping,
    'count_unit', p_count_unit,
    'bubbles', v_bubbles
  );
end;
$$;
