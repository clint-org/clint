-- get_positioning_data (heatmap): under the indication / moa+indication groupings,
-- place each asset in a bubble at THAT indication's development_status, not the
-- asset's overall max. Mirrors the bullseye fix (issue #171). Adds an effective
-- per-row phase (eff_phase/eff_phase_rank) and uses it in the bubble aggregation;
-- moa / company / roa groupings keep the asset-max rollup. Based on the live
-- pg_get_functiondef.

CREATE OR REPLACE FUNCTION public.get_positioning_data(p_space_id uuid, p_grouping text DEFAULT 'moa'::text, p_count_unit text DEFAULT 'products'::text, p_company_ids uuid[] DEFAULT NULL::uuid[], p_asset_ids uuid[] DEFAULT NULL::uuid[], p_indication_ids uuid[] DEFAULT NULL::uuid[], p_mechanism_of_action_ids uuid[] DEFAULT NULL::uuid[], p_route_of_administration_ids uuid[] DEFAULT NULL::uuid[], p_phases text[] DEFAULT NULL::text[], p_recruitment_statuses text[] DEFAULT NULL::text[], p_study_types text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
           a.company_id, c.name as company_name, c.logo_url as company_logo_url,
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
           ea.company_id, ea.company_name, ea.company_logo_url, ea.asset_updated_at,
           max(srm.status_rank) as highest_phase_rank,
           (array_agg(srm.status_name order by srm.status_rank desc))[1] as highest_phase,
           count(distinct t.id) as trial_count,
           -- rebased: join anchors for entity binding (entity_type/entity_id dropped
           -- from primary_intelligence in 20260627130000; now live on anchors)
           exists (
             select 1 from public.primary_intelligence_anchors a_pi
             join public.primary_intelligence pi
               on pi.anchor_id = a_pi.id and pi.state = 'published'
             where a_pi.space_id = p_space_id
               and (
                 (a_pi.entity_type = 'product' and a_pi.entity_id = ea.asset_id)
                 or (a_pi.entity_type = 'trial' and exists (
                       select 1
                       from public.trial_assets ta2
                       join public.trials t2 on t2.id = ta2.trial_id
                       where ta2.trial_id = a_pi.entity_id
                         and ta2.asset_id = ea.asset_id
                         and t2.space_id  = p_space_id))
               )
           ) as has_intelligence
    from eligible_assets ea
    join public.asset_indications ai on ai.asset_id = ea.asset_id
    join status_rank_map srm on srm.status_name = ai.development_status
    left join public.trial_assets ta on ta.asset_id = ea.asset_id
    left join public.trials t on t.id = ta.trial_id and t.space_id = p_space_id
    where ai.development_status is not null
      and (p_indication_ids is null or ai.indication_id = any(p_indication_ids))
    group by ea.asset_id, ea.asset_name, ea.asset_generic_name,
             ea.company_id, ea.company_name, ea.company_logo_url, ea.asset_updated_at
  ),

  -- fan out assets into their grouping dimension
  asset_groups as (
    select
      ahp.asset_id, ahp.asset_name, ahp.asset_generic_name,
      ahp.company_id, ahp.company_name, ahp.company_logo_url, ahp.asset_updated_at,
      ahp.highest_phase_rank, ahp.highest_phase, ahp.trial_count, ahp.has_intelligence,
      -- effective phase for THIS group row: per-indication status under the
      -- indication groupings, else the asset's overall max (issue #171).
      case when p_grouping in ('indication', 'moa+indication')
        then ai2.development_status else ahp.highest_phase end as eff_phase,
      case when p_grouping in ('indication', 'moa+indication')
        then srm2.status_rank else ahp.highest_phase_rank end as eff_phase_rank,
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
    left join status_rank_map srm2
      on srm2.status_name = ai2.development_status
      and p_grouping in ('indication', 'moa+indication')
    left join public.asset_routes_of_administration ar
      on ar.asset_id = ahp.asset_id and p_grouping = 'roa'
    left join public.routes_of_administration r
      on r.id = ar.roa_id and p_grouping = 'roa'
    where
      case p_grouping
        when 'moa' then m.id is not null
        -- require a derived per-indication status: that is what now positions the
        -- asset in the bubble (issue #171); a null-status indication has no stage.
        when 'indication' then ind.id is not null and ai2.development_status is not null
        when 'moa+indication'
          then m.id is not null and ind.id is not null and ai2.development_status is not null
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
      max(ag.eff_phase_rank) as highest_phase_rank,
      (array_agg(ag.eff_phase order by ag.eff_phase_rank desc))[1] as highest_phase,
      count(distinct ag.asset_id) filter (where ag.has_intelligence) as intelligence_count,
      case p_count_unit
        when 'products' then count(distinct ag.asset_id)
        when 'trials' then sum(ag.trial_count)
        when 'companies' then count(distinct ag.company_id)
      end as unit_count,
      jsonb_agg(distinct jsonb_build_object(
        'id', ag.asset_id, 'name', ag.asset_name,
        'generic_name', ag.asset_generic_name,
        'company_id', ag.company_id, 'company_name', ag.company_name,
        'company_logo_url', ag.company_logo_url,
        'highest_phase', ag.eff_phase,
        'highest_phase_rank', ag.eff_phase_rank,
        'trial_count', ag.trial_count,
        'has_intelligence', ag.has_intelligence
      )) as products,
      -- phase_counts: always asset-based, regardless of p_count_unit
      (select jsonb_object_agg(hp, cnt)
       from (
         select ag2.eff_phase as hp, count(distinct ag2.asset_id) as cnt
         from asset_groups ag2
         where ag2.group_key = ag.group_key
         group by ag2.eff_phase
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
        'intelligence_count', ba.intelligence_count,
        'has_intelligence', case when p_grouping = 'company' then exists (
          select 1
          from public.primary_intelligence_anchors a_pi
          join public.primary_intelligence pi
            on pi.anchor_id = a_pi.id and pi.state = 'published'
          where a_pi.space_id    = p_space_id
            and a_pi.entity_type = 'company'
            and a_pi.entity_id   = (ba.group_keys->>'company_id')::uuid
        ) else false end,
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
$function$


