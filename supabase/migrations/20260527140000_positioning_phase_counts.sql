-- migration: 20260527120200_positioning_phase_counts
-- purpose: extend get_positioning_data to include phase_counts per bubble
--          and latest_event_date on the top-level response.
--
--   phase_counts  -- jsonb object mapping each phase to the count of distinct
--                    assets whose highest_phase matches, always asset-based
--                    regardless of p_count_unit.
--   latest_event_date -- max(updated_at) across all assets in the result set,
--                        used for the freshness indicator.

drop function if exists public.get_positioning_data(uuid, text, text, uuid[], uuid[], uuid[], uuid[], uuid[], text[], text[], text[]);

create or replace function public.get_positioning_data(
  p_space_id                    uuid,
  p_grouping                    text default 'moa',
  p_count_unit                  text default 'products',
  p_company_ids                 uuid[] default null,
  p_asset_ids                   uuid[] default null,
  p_indication_ids              uuid[] default null,
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
  v_bubbles            jsonb;
  v_latest_event_date  timestamptz;
begin
  -- coerce empty arrays to null so the "is null" checks below work
  if p_company_ids = '{}' then p_company_ids := null; end if;
  if p_asset_ids = '{}' then p_asset_ids := null; end if;
  if p_indication_ids = '{}' then p_indication_ids := null; end if;
  if p_mechanism_of_action_ids = '{}' then p_mechanism_of_action_ids := null; end if;
  if p_route_of_administration_ids = '{}' then p_route_of_administration_ids := null; end if;
  if p_phases = '{}' then p_phases := null; end if;
  if p_recruitment_statuses = '{}' then p_recruitment_statuses := null; end if;
  if p_study_types = '{}' then p_study_types := null; end if;

  with status_rank_map(status_name, status_rank) as (
    values
      ('PRECLIN'::text, 0), ('P1', 1), ('P2', 2), ('P3', 3),
      ('P4', 4), ('APPROVED', 5), ('LAUNCHED', 6)
  ),

  -- eligible assets after applying all filters
  eligible_assets as (
    select distinct a.id as asset_id, a.name as asset_name,
           a.generic_name as asset_generic_name,
           a.company_id, c.name as company_name,
           a.updated_at as asset_updated_at
    from public.assets a
    join public.companies c on c.id = a.company_id
    join public.asset_indications ai on ai.asset_id = a.id
    join status_rank_map srm on srm.status_name = ai.development_status
    where a.space_id = p_space_id
      and ai.development_status is not null
      and (p_company_ids is null or a.company_id = any(p_company_ids))
      and (p_asset_ids is null or a.id = any(p_asset_ids))
      and (p_indication_ids is null or ai.indication_id = any(p_indication_ids))
      and (p_mechanism_of_action_ids is null or exists (
        select 1 from public.asset_mechanisms_of_action am
        where am.asset_id = a.id and am.moa_id = any(p_mechanism_of_action_ids)
      ))
      and (p_route_of_administration_ids is null or exists (
        select 1 from public.asset_routes_of_administration ar
        where ar.asset_id = a.id and ar.roa_id = any(p_route_of_administration_ids)
      ))
      and (p_phases is null or ai.development_status = any(p_phases))
  ),

  -- roll up to one row per asset with its highest phase and trial count
  asset_highest_phase as (
    select ea.asset_id, ea.asset_name, ea.asset_generic_name,
           ea.company_id, ea.company_name, ea.asset_updated_at,
           max(srm.status_rank) as highest_phase_rank,
           (array_agg(srm.status_name order by srm.status_rank desc))[1] as highest_phase,
           count(distinct t.id) as trial_count
    from eligible_assets ea
    join public.asset_indications ai on ai.asset_id = ea.asset_id
    join status_rank_map srm on srm.status_name = ai.development_status
    left join public.trials t on t.asset_id = ea.asset_id and t.space_id = p_space_id
    where ai.development_status is not null
      and (p_indication_ids is null or ai.indication_id = any(p_indication_ids))
    group by ea.asset_id, ea.asset_name, ea.asset_generic_name,
             ea.company_id, ea.company_name, ea.asset_updated_at
  ),

  -- fan out assets into their grouping dimension
  asset_groups as (
    select
      ahp.asset_id, ahp.asset_name, ahp.asset_generic_name,
      ahp.company_id, ahp.company_name, ahp.asset_updated_at,
      ahp.highest_phase_rank, ahp.highest_phase, ahp.trial_count,
      case p_grouping
        when 'moa' then m.id::text
        when 'indication' then ind.id::text
        when 'moa+indication' then m.id::text || '|' || ind.id::text
        when 'company' then ahp.company_id::text
        when 'roa' then r.id::text
        else null
      end as group_key,
      case p_grouping
        when 'moa' then m.name
        when 'indication' then ind.name
        when 'moa+indication' then m.name || ' + ' || ind.name
        when 'company' then ahp.company_name
        when 'roa' then r.name
        else null
      end as group_label,
      case p_grouping
        when 'moa' then jsonb_build_object('moa_id', m.id, 'moa_name', m.name)
        when 'indication' then jsonb_build_object('indication_id', ind.id, 'indication_name', ind.name)
        when 'moa+indication' then jsonb_build_object('moa_id', m.id, 'moa_name', m.name, 'indication_id', ind.id, 'indication_name', ind.name)
        when 'company' then jsonb_build_object('company_id', ahp.company_id, 'company_name', ahp.company_name)
        when 'roa' then jsonb_build_object('roa_id', r.id, 'roa_name', r.name)
        else '{}'::jsonb
      end as group_keys
    from asset_highest_phase ahp
    left join public.asset_mechanisms_of_action am
      on am.asset_id = ahp.asset_id and p_grouping in ('moa', 'moa+indication')
    left join public.mechanisms_of_action m
      on m.id = am.moa_id and p_grouping in ('moa', 'moa+indication')
    left join public.asset_indications ai2
      on ai2.asset_id = ahp.asset_id and p_grouping in ('indication', 'moa+indication')
    left join public.indications ind
      on ind.id = ai2.indication_id and p_grouping in ('indication', 'moa+indication')
    left join public.asset_routes_of_administration ar
      on ar.asset_id = ahp.asset_id and p_grouping = 'roa'
    left join public.routes_of_administration r
      on r.id = ar.roa_id and p_grouping = 'roa'
    where
      case p_grouping
        when 'moa' then m.id is not null
        when 'indication' then ind.id is not null
        when 'moa+indication' then m.id is not null and ind.id is not null
        when 'company' then true
        when 'roa' then r.id is not null
        else false
      end
  ),

  -- aggregate each group into a bubble with phase_counts
  bubble_agg as (
    select
      ag.group_key, ag.group_label, ag.group_keys,
      count(distinct ag.company_id) as competitor_count,
      max(ag.highest_phase_rank) as highest_phase_rank,
      (array_agg(ag.highest_phase order by ag.highest_phase_rank desc))[1] as highest_phase,
      case p_count_unit
        when 'products' then count(distinct ag.asset_id)
        when 'trials' then sum(ag.trial_count)
        when 'companies' then count(distinct ag.company_id)
      end as unit_count,
      jsonb_agg(distinct jsonb_build_object(
        'id', ag.asset_id, 'name', ag.asset_name,
        'generic_name', ag.asset_generic_name,
        'company_id', ag.company_id, 'company_name', ag.company_name,
        'highest_phase', ag.highest_phase,
        'highest_phase_rank', ag.highest_phase_rank,
        'trial_count', ag.trial_count
      )) as products,
      -- phase_counts: always asset-based, regardless of p_count_unit
      (select jsonb_object_agg(hp, cnt)
       from (
         select ag2.highest_phase as hp, count(distinct ag2.asset_id) as cnt
         from asset_groups ag2
         where ag2.group_key = ag.group_key
         group by ag2.highest_phase
       ) sub
      ) as phase_counts
    from asset_groups ag
    group by ag.group_key, ag.group_label, ag.group_keys
  ),

  -- max updated_at across all assets in the result set
  freshness as (
    select max(ag.asset_updated_at) as latest_event_date
    from asset_groups ag
  )

  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'label', ba.group_label, 'group_keys', ba.group_keys,
        'competitor_count', ba.competitor_count,
        'highest_phase', ba.highest_phase, 'highest_phase_rank', ba.highest_phase_rank,
        'unit_count', ba.unit_count, 'products', ba.products,
        'phase_counts', ba.phase_counts
      ) order by ba.competitor_count desc, ba.highest_phase_rank desc
    ), '[]'::jsonb),
    max(f.latest_event_date)
  into v_bubbles, v_latest_event_date
  from bubble_agg ba
  cross join freshness f;

  return jsonb_build_object(
    'grouping', p_grouping,
    'count_unit', p_count_unit,
    'latest_event_date', v_latest_event_date,
    'bubbles', v_bubbles
  );
end;
$$;
