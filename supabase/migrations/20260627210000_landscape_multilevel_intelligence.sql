-- Landscape RPCs emit multi-level intelligence (company + asset).
--
-- Additive change to three landscape-feeding functions so the UI can surface
-- company-own and asset-own published intelligence directly on the landscape
-- views, not just the trial-level / asset-rollup signals already present.
--
--   get_dashboard_data  -> each company object gains has_intelligence +
--                          intelligence_headline; each asset object gains the
--                          same two keys (asset anchors use entity_type='product').
--   get_positioning_data -> each bubble gains has_intelligence, true only when
--                          p_grouping = 'company' and that company has a published
--                          company-anchored brief (distinct from the existing
--                          intelligence_count assets-rollup).
--   get_bullseye_assets  -> top-level payload gains companies_with_intelligence
--                          (jsonb array of company ids with a published company anchor).
--
-- Lead-headline selection per entity:
--   order by a_pi.is_lead desc, pi.published_at desc nulls last limit 1 -> pi.headline
--   gated on pi.state = 'published' and a_pi.space_id = p_space_id.
-- Anchor entity_type per level: trial='trial', asset='product', company='company'
-- (the anchors CHECK forbids 'asset').
--
-- Bases (newest committed definitions, copied verbatim then extended):
--   get_dashboard_data  -> 20260627180000_fix_get_dashboard_data_unspecified_clobber.sql
--   get_positioning_data -> 20260627130600_intelligence_feed_and_landscape_multi.sql
--   get_bullseye_assets  -> 20260627130900_fix_asset_entity_type_anchors.sql

-- =============================================================================
-- 1. get_dashboard_data  (company-own + asset-own intelligence)
-- =============================================================================
create or replace function public.get_dashboard_data(p_space_id uuid, p_company_ids uuid[] DEFAULT NULL::uuid[], p_asset_ids uuid[] DEFAULT NULL::uuid[], p_indication_ids uuid[] DEFAULT NULL::uuid[], p_start_year integer DEFAULT NULL::integer, p_end_year integer DEFAULT NULL::integer, p_recruitment_statuses text[] DEFAULT NULL::text[], p_study_types text[] DEFAULT NULL::text[], p_phases text[] DEFAULT NULL::text[], p_mechanism_of_action_ids uuid[] DEFAULT NULL::uuid[], p_route_of_administration_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  result jsonb;
begin
  if p_mechanism_of_action_ids = '{}' then p_mechanism_of_action_ids := null; end if;
  if p_route_of_administration_ids = '{}' then p_route_of_administration_ids := null; end if;

  select coalesce(jsonb_agg(company_obj order by c.display_order), '[]'::jsonb)
  into result
  from public.companies c
  left join lateral (
    select pi.headline
    from public.primary_intelligence_anchors a_pi
    join public.primary_intelligence pi
      on pi.anchor_id = a_pi.id and pi.state = 'published'
    where a_pi.entity_type = 'company'
      and a_pi.entity_id   = c.id
      and a_pi.space_id    = p_space_id
    order by a_pi.is_lead desc, pi.published_at desc nulls last
    limit 1
  ) pi_company on true
  cross join lateral (
    select jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'logo_url', c.logo_url,
      'display_order', c.display_order,
      'has_intelligence', (pi_company.headline is not null),
      'intelligence_headline', pi_company.headline,
      'assets', coalesce((
        select jsonb_agg(asset_obj order by a.display_order)
        from public.assets a
        left join lateral (
          select pi.headline
          from public.primary_intelligence_anchors a_pi
          join public.primary_intelligence pi
            on pi.anchor_id = a_pi.id and pi.state = 'published'
          where a_pi.entity_type = 'product'
            and a_pi.entity_id   = a.id
            and a_pi.space_id    = p_space_id
          order by a_pi.is_lead desc, pi.published_at desc nulls last
          limit 1
        ) pi_asset on true
        cross join lateral (
          select jsonb_build_object(
            'id', a.id,
            'name', a.name,
            'generic_name', a.generic_name,
            'logo_url', a.logo_url,
            'display_order', a.display_order,
            'has_intelligence', (pi_asset.headline is not null),
            'intelligence_headline', pi_asset.headline,
            'mechanisms_of_action', coalesce((
              select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.display_order, m.name)
              from public.asset_mechanisms_of_action am
              join public.mechanisms_of_action m on m.id = am.moa_id
              where am.asset_id = a.id
            ), '[]'::jsonb),
            'routes_of_administration', coalesce((
              select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name)
              from public.asset_routes_of_administration ar
              join public.routes_of_administration r on r.id = ar.roa_id
              where ar.asset_id = a.id
            ), '[]'::jsonb),
            'indications', (
              select coalesce(jsonb_agg(ind_obj order by sort_key, ind_display_order, ind_name), '[]'::jsonb)
              from (
                -- real indications, tagged is_unspecified=false
                select 0 as sort_key, ind.display_order as ind_display_order, ind.name as ind_name,
                       jsonb_build_object(
                         'id', ind.id,
                         'name', ind.name,
                         'abbreviation', ind.abbreviation,
                         'is_unspecified', false,
                         'development_status', ai.development_status,
                         'development_status_source', ai.development_status_source,
                         'trials', coalesce((
                           select jsonb_agg(public._dashboard_trial_obj(t, p_space_id, p_start_year, p_end_year)
                                            order by t.display_order)
                           from (
                             select distinct on (t.id) t.*
                             from public.trials t
                             join public.trial_assets ta on ta.trial_id = t.id
                             join public.trial_conditions tc on tc.trial_id = t.id
                             join public.condition_indication_map cim on cim.condition_id = tc.condition_id
                             where ta.asset_id = a.id
                               and t.space_id = p_space_id
                               and cim.indication_id = ind.id
                               and (p_recruitment_statuses is null or t.recruitment_status = any(p_recruitment_statuses))
                               and (p_study_types is null or t.study_type = any(p_study_types))
                               and (p_phases is null or t.phase_type = any(p_phases))
                             order by t.id
                           ) t
                         ), '[]'::jsonb)
                       ) as ind_obj
                from public.asset_indications ai
                join public.indications ind on ind.id = ai.indication_id
                where ai.asset_id = a.id
                  and ai.space_id = p_space_id
                  and (p_indication_ids is null or ai.indication_id = any(p_indication_ids))

                union all

                -- synthetic Unspecified node: only when no indication filter and orphans exist
                select 1 as sort_key, 0 as ind_display_order, '' as ind_name,
                       jsonb_build_object(
                         'id', null,
                         'name', 'Unspecified',
                         'abbreviation', null,
                         'is_unspecified', true,
                         'development_status', null,
                         'development_status_source', null,
                         'trials', coalesce((
                           select jsonb_agg(public._dashboard_trial_obj(t, p_space_id, p_start_year, p_end_year)
                                            order by t.display_order)
                           from (
                             select distinct on (t.id) t.*
                             from public.trials t
                             join public.trial_assets ta on ta.trial_id = t.id
                             where ta.asset_id = a.id
                               and t.space_id = p_space_id
                               and not exists (
                                 select 1 from public.trial_conditions tc
                                 join public.condition_indication_map cim on cim.condition_id = tc.condition_id
                                 where tc.trial_id = t.id
                               )
                               and (p_recruitment_statuses is null or t.recruitment_status = any(p_recruitment_statuses))
                               and (p_study_types is null or t.study_type = any(p_study_types))
                               and (p_phases is null or t.phase_type = any(p_phases))
                             order by t.id
                           ) t
                         ), '[]'::jsonb)
                       ) as ind_obj
                where p_indication_ids is null
                  and exists (
                    select 1 from public.trials t2
                    join public.trial_assets ta2 on ta2.trial_id = t2.id
                    where ta2.asset_id = a.id
                      and t2.space_id = p_space_id
                      and not exists (
                        select 1 from public.trial_conditions tc2
                        join public.condition_indication_map cim2 on cim2.condition_id = tc2.condition_id
                        where tc2.trial_id = t2.id
                      )
                  )
              ) s
            )
          ) as asset_obj
        ) as asset_lateral
        where a.company_id = c.id
          and a.space_id = p_space_id
          and (p_asset_ids is null or a.id = any(p_asset_ids))
          and (
            p_mechanism_of_action_ids is null
            or exists (
              select 1 from public.asset_mechanisms_of_action am2
              where am2.asset_id = a.id
                and am2.moa_id = any(p_mechanism_of_action_ids)
            )
          )
          and (
            p_route_of_administration_ids is null
            or exists (
              select 1 from public.asset_routes_of_administration ar2
              where ar2.asset_id = a.id
                and ar2.roa_id = any(p_route_of_administration_ids)
            )
          )
      ), '[]'::jsonb)
    ) as company_obj
  ) as company_lateral
  where c.space_id = p_space_id
    and (p_company_ids is null or c.id = any(p_company_ids));

  return result;
end;
$function$;

comment on function public.get_dashboard_data(uuid, uuid[], uuid[], uuid[], integer, integer, text[], text[], text[], uuid[], uuid[]) is
  'Landscape dashboard tree (companies -> assets -> indications -> trials). '
  'Each company and asset object carries has_intelligence + intelligence_headline '
  'from its lead published anchor (company entity_type=company, asset entity_type=product). '
  'See 20260627180000 (Unspecified base) and 20260627200000 (multi-level intelligence).';

-- =============================================================================
-- 2. get_positioning_data  (per-bubble company-own has_intelligence)
-- =============================================================================
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
        'highest_phase', ag.highest_phase,
        'highest_phase_rank', ag.highest_phase_rank,
        'trial_count', ag.trial_count,
        'has_intelligence', ag.has_intelligence
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
$$;

comment on function public.get_positioning_data(uuid, text, text, uuid[], uuid[], uuid[], uuid[], uuid[], text[], text[], text[]) is
  'Heatmap/positioning bubbles. has_intelligence goes through primary_intelligence_anchors '
  '(entity_type/entity_id moved there in 20260627130000). Checks product-direct and '
  'trial-via-trial_assets branches. intelligence_count = assets-with-intelligence per bubble. '
  'Per-bubble has_intelligence flags a company-own published anchor, set only when '
  'p_grouping = company. See 20260627130600 (anchor rebase) and 20260627200000 (company flag).';

-- =============================================================================
-- 3. get_bullseye_assets  (companies_with_intelligence sibling key)
-- =============================================================================
create or replace function public.get_bullseye_assets(
  p_space_id       uuid,
  p_indication_ids uuid[]  default null::uuid[],
  p_company_ids    uuid[]  default null::uuid[],
  p_moa_ids        uuid[]  default null::uuid[],
  p_roa_ids        uuid[]  default null::uuid[],
  p_phases         text[]  default null::text[],
  p_asset_ids      uuid[]  default null::uuid[],
  p_trial_ids      uuid[]  default null::uuid[]
)
  returns jsonb
  language plpgsql
  stable
  set search_path to ''
as $function$
declare
  v_result    jsonb;
  v_show_preclin boolean := public.space_shows_preclinical(p_space_id);
begin
  -- Normalize empty arrays to null (no-filter semantics)
  if p_indication_ids = '{}' then p_indication_ids := null; end if;
  if p_company_ids    = '{}' then p_company_ids    := null; end if;
  if p_moa_ids        = '{}' then p_moa_ids        := null; end if;
  if p_roa_ids        = '{}' then p_roa_ids        := null; end if;
  if p_phases         = '{}' then p_phases         := null; end if;
  if p_asset_ids      = '{}' then p_asset_ids      := null; end if;
  if p_trial_ids      = '{}' then p_trial_ids      := null; end if;

  with
  -- Step 1: identify candidate assets passing all scope filters except phase
  candidate_assets as (
    select distinct a.id as asset_id
    from public.assets a
    where a.space_id = p_space_id
      and (p_company_ids is null or a.company_id = any(p_company_ids))
      and (p_asset_ids is null or a.id = any(p_asset_ids))
      and (p_indication_ids is null or exists (
        select 1 from public.asset_indications ai
        where ai.asset_id = a.id
          and ai.indication_id = any(p_indication_ids)
      ))
      and (p_moa_ids is null or exists (
        select 1 from public.asset_mechanisms_of_action amoa
        where amoa.asset_id = a.id
          and amoa.moa_id = any(p_moa_ids)
      ))
      and (p_roa_ids is null or exists (
        select 1 from public.asset_routes_of_administration aroa
        where aroa.asset_id = a.id
          and aroa.roa_id = any(p_roa_ids)
      ))
      and (p_trial_ids is null or exists (
        select 1 from public.trial_assets ta
        where ta.asset_id = a.id
          and ta.trial_id = any(p_trial_ids)
      ))
  ),

  -- Step 2: compute highest phase rank per candidate asset
  asset_phase as (
    select
      ca.asset_id,
      max(case ai.development_status
        when 'LAUNCHED'  then 6
        when 'APPROVED'  then 5
        when 'P4'        then 4
        when 'P3'        then 3
        when 'P2'        then 2
        when 'P1'        then 1
        when 'PRECLIN'   then 0
        else null
      end) as max_rank
    from candidate_assets ca
    join public.asset_indications ai on ai.asset_id = ca.asset_id
    where ai.development_status is not null
      and (v_show_preclin or ai.development_status is distinct from 'PRECLIN')
    group by ca.asset_id
    having max(case ai.development_status
      when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
      when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
      else null
    end) is not null
  ),

  -- Step 3: apply phase filter
  filtered_assets as (
    select ap.asset_id, ap.max_rank
    from asset_phase ap
    where p_phases is null or (
      case ap.max_rank
        when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
        when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
      end
    ) = any(p_phases)
  ),

  -- Step 4: compute intelligence count per asset
  -- anchors use entity_type='product' for assets (CHECK forbids 'asset')
  asset_intel as (
    select
      fa.asset_id,
      (
        -- asset-level briefs: use 'product' (the stored anchor type for assets)
        (select count(distinct a_pi.id)
         from public.primary_intelligence_anchors a_pi
         where a_pi.entity_type = 'product'
           and a_pi.entity_id = fa.asset_id
           and a_pi.space_id = p_space_id)
        +
        -- trial-level briefs for trials belonging to this asset
        (select count(distinct a_pi.id)
         from public.primary_intelligence_anchors a_pi
         where a_pi.entity_type = 'trial'
           and a_pi.space_id = p_space_id
           and a_pi.entity_id in (
             select t.id from public.trials t
             where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = fa.asset_id)
               and t.space_id = p_space_id
           ))
      ) as intelligence_count
    from filtered_assets fa
  ),

  -- Step 5: compute recent change activity per asset (14-day window)
  -- anchors use entity_type='product' for assets
  asset_activity as (
    select
      fa.asset_id,
      (
        (select count(*)
         from public.trial_change_events e
         join public.trials t on t.id = e.trial_id
         where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = fa.asset_id)
           and t.space_id = p_space_id
           and e.observed_at >= now() - public.recent_change_window())
        +
        (select count(*)
         from public.primary_intelligence_anchors a_pi
         join public.primary_intelligence pi on pi.anchor_id = a_pi.id and pi.state = 'published'
         where a_pi.space_id = p_space_id
           and pi.updated_at >= now() - public.recent_change_window()
           and (
             (a_pi.entity_type = 'product' and a_pi.entity_id = fa.asset_id)
             or (a_pi.entity_type = 'trial' and a_pi.entity_id in (
                   select t2.id from public.trials t2
                   where exists (select 1 from public.trial_assets ta where ta.trial_id = t2.id and ta.asset_id = fa.asset_id) and t2.space_id = p_space_id))
           ))
      ) as recent_changes_count,
      (
        select c.etype
        from (
          select e.event_type::text as etype, e.observed_at as ets
          from public.trial_change_events e
          join public.trials t on t.id = e.trial_id
          where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = fa.asset_id)
            and t.space_id = p_space_id
            and e.observed_at >= now() - public.recent_change_window()
          union all
          select 'intelligence_published'::text as etype, pi.updated_at as ets
          from public.primary_intelligence_anchors a_pi
          join public.primary_intelligence pi on pi.anchor_id = a_pi.id and pi.state = 'published'
          where a_pi.space_id = p_space_id
            and pi.updated_at >= now() - public.recent_change_window()
            and (
              (a_pi.entity_type = 'product' and a_pi.entity_id = fa.asset_id)
              or (a_pi.entity_type = 'trial' and a_pi.entity_id in (
                    select t2.id from public.trials t2
                    where exists (select 1 from public.trial_assets ta where ta.trial_id = t2.id and ta.asset_id = fa.asset_id) and t2.space_id = p_space_id))
            )
        ) c
        order by c.ets desc
        limit 1
      ) as most_recent_change_type,
      (
        select c.eid
        from (
          select e.observed_at as ets, e.id as eid
          from public.trial_change_events e
          join public.trials t on t.id = e.trial_id
          where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = fa.asset_id)
            and t.space_id = p_space_id
            and e.observed_at >= now() - public.recent_change_window()
          union all
          select pi.updated_at as ets, null::uuid as eid
          from public.primary_intelligence_anchors a_pi
          join public.primary_intelligence pi on pi.anchor_id = a_pi.id and pi.state = 'published'
          where a_pi.space_id = p_space_id
            and pi.updated_at >= now() - public.recent_change_window()
            and (
              (a_pi.entity_type = 'product' and a_pi.entity_id = fa.asset_id)
              or (a_pi.entity_type = 'trial' and a_pi.entity_id in (
                    select t2.id from public.trials t2
                    where exists (select 1 from public.trial_assets ta where ta.trial_id = t2.id and ta.asset_id = fa.asset_id) and t2.space_id = p_space_id))
            )
        ) c
        order by c.ets desc
        limit 1
      ) as most_recent_change_event_id
    from filtered_assets fa
  )

  -- Step 6: assemble result
  select jsonb_build_object(
    'assets', coalesce((
      select jsonb_agg(asset_obj order by fa.max_rank desc, a.name)
      from filtered_assets fa
      join public.assets a on a.id = fa.asset_id
      join public.companies c on c.id = a.company_id
      left join asset_intel ai_cnt on ai_cnt.asset_id = fa.asset_id
      left join asset_activity aa on aa.asset_id = fa.asset_id
      cross join lateral (
        select jsonb_build_object(
          'id', a.id,
          'name', a.name,
          'generic_name', a.generic_name,
          'logo_url', a.logo_url,
          'company_id', c.id,
          'company_name', c.name,
          'company_logo_url', c.logo_url,
          'highest_phase_rank', fa.max_rank,
          'highest_phase', case fa.max_rank
            when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
            when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
          end,
          'indications', coalesce((
            select jsonb_agg(
              jsonb_build_object('id', ind.id, 'name', ind.name, 'abbreviation', ind.abbreviation)
              order by ind.display_order, ind.name
            )
            from public.asset_indications ai2
            join public.indications ind on ind.id = ai2.indication_id
            where ai2.asset_id = a.id
          ), '[]'::jsonb),
          'moas', coalesce((
            select jsonb_agg(
              jsonb_build_object('id', m.id, 'name', m.name)
              order by m.display_order, m.name
            )
            from public.asset_mechanisms_of_action amoa
            join public.mechanisms_of_action m on m.id = amoa.moa_id
            where amoa.asset_id = a.id
          ), '[]'::jsonb),
          'roas', coalesce((
            select jsonb_agg(
              jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation)
              order by r.display_order, r.name
            )
            from public.asset_routes_of_administration aroa
            join public.routes_of_administration r on r.id = aroa.roa_id
            where aroa.asset_id = a.id
          ), '[]'::jsonb),
          'trials', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', t.id,
                'name', t.name,
                'acronym', t.acronym,
                'identifier', t.identifier,
                'status', t.status,
                'recruitment_status', t.recruitment_status,
                'study_type', t.study_type,
                'phase', t.phase_type
              ) order by t.display_order, t.name
            )
            from public.trials t
            where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = a.id) and t.space_id = p_space_id
          ), '[]'::jsonb),
          'recent_markers', coalesce((
            select jsonb_agg(marker_obj order by mk_sub.event_date desc)
            from (
              select mk.id, mk.event_date, mk.projection,
                     mt.name as marker_type_name, mt.shape, mt.color,
                     mc.name as category_name
              from public.marker_assignments ma
              join public.markers mk on mk.id = ma.marker_id
              join public.marker_types mt on mt.id = mk.marker_type_id
              left join public.marker_categories mc on mc.id = mt.category_id
              join public.trials t2 on t2.id = ma.trial_id
              where exists (select 1 from public.trial_assets ta where ta.trial_id = t2.id and ta.asset_id = a.id)
                and t2.space_id = p_space_id
                and mk.space_id = p_space_id
              order by mk.event_date desc
              limit 3
            ) mk_sub
            cross join lateral (
              select jsonb_build_object(
                'id', mk_sub.id,
                'event_date', mk_sub.event_date,
                'projection', mk_sub.projection,
                'marker_type_name', mk_sub.marker_type_name,
                'shape', mk_sub.shape,
                'color', mk_sub.color,
                'category_name', mk_sub.category_name
              ) as marker_obj
            ) mk_lateral
          ), '[]'::jsonb),
          'intelligence_count', coalesce(ai_cnt.intelligence_count, 0),
          'recent_changes_count', coalesce(aa.recent_changes_count, 0),
          'most_recent_change_type', aa.most_recent_change_type,
          'most_recent_change_event_id', aa.most_recent_change_event_id,
          'has_recent_activity', coalesce(aa.recent_changes_count, 0) > 0
        ) as asset_obj
      ) as asset_lateral
    ), '[]'::jsonb),
    'companies_with_intelligence', coalesce((
      select jsonb_agg(distinct a_pi.entity_id)
      from public.primary_intelligence_anchors a_pi
      join public.primary_intelligence pi
        on pi.anchor_id = a_pi.id and pi.state = 'published'
      where a_pi.space_id    = p_space_id
        and a_pi.entity_type = 'company'
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

notify pgrst, 'reload schema';

-- =============================================================================
-- 4. In-file smoke: seed a published company anchor + a published asset
--    (product) anchor, assert the three RPCs surface the new fields, then
--    delete the seeded rows. No transaction-control statements (this runs
--    inside the migration transaction and also against prod): seeded rows are
--    removed explicitly before the PASS notice. Any assertion failure raises
--    loudly and aborts the migration.
-- =============================================================================
do $$
declare
  v_space uuid; v_company uuid; v_asset uuid; v_owner uuid;
  v_anchor_company uuid; v_anchor_asset uuid;
  v_dash jsonb; v_pos jsonb; v_company_obj jsonb; v_asset_obj jsonb;
begin
  -- pick a space with a positioning-eligible company+asset (asset_indications row with non-null
  -- development_status), so the get_positioning_data assertion cannot nondeterministically fail
  -- when the random fixture company has no phase-ranked indication; skip smoke if none exists
  select c.space_id, c.id, a.id into v_space, v_company, v_asset
  from public.companies c
  join public.assets a on a.company_id = c.id and a.space_id = c.space_id
  join public.asset_indications ai on ai.asset_id = a.id and ai.space_id = c.space_id
    and ai.development_status is not null
  limit 1;
  if v_space is null then
    raise notice 'multilevel-intel smoke: no fixture data, skipping';
    return;
  end if;

  -- pick a real auth.users id for the FK columns
  select created_by into v_owner from public.companies where id = v_company;
  if v_owner is null then
    select user_id into v_owner from public.space_members where space_id = v_space limit 1;
  end if;
  if v_owner is null then
    select id into v_owner from auth.users limit 1;
  end if;

  -- seed company anchor + published version
  insert into public.primary_intelligence_anchors (space_id, entity_type, entity_id, is_lead, created_by)
    values (v_space, 'company', v_company, true, v_owner) returning id into v_anchor_company;
  insert into public.primary_intelligence (space_id, anchor_id, state, headline, summary_md, implications_md, last_edited_by, published_at)
    values (v_space, v_anchor_company, 'published', 'Smoke company headline', '', '', v_owner, now());

  -- seed asset (product) anchor + published version
  insert into public.primary_intelligence_anchors (space_id, entity_type, entity_id, is_lead, created_by)
    values (v_space, 'product', v_asset, true, v_owner) returning id into v_anchor_asset;
  insert into public.primary_intelligence (space_id, anchor_id, state, headline, summary_md, implications_md, last_edited_by, published_at)
    values (v_space, v_anchor_asset, 'published', 'Smoke asset headline', '', '', v_owner, now());

  -- dashboard: company + asset carry has_intelligence + headline
  v_dash := public.get_dashboard_data(v_space);
  v_company_obj := (select obj from jsonb_array_elements(v_dash) obj where obj->>'id' = v_company::text);
  if (v_company_obj->>'has_intelligence')::bool is not true then
    raise exception 'smoke FAIL: company has_intelligence not true';
  end if;
  if v_company_obj->>'intelligence_headline' <> 'Smoke company headline' then
    raise exception 'smoke FAIL: company headline mismatch (got %)', v_company_obj->>'intelligence_headline';
  end if;
  v_asset_obj := (select a2 from jsonb_array_elements(v_company_obj->'assets') a2 where a2->>'id' = v_asset::text);
  if (v_asset_obj->>'has_intelligence')::bool is not true then
    raise exception 'smoke FAIL: asset has_intelligence not true';
  end if;
  if v_asset_obj->>'intelligence_headline' <> 'Smoke asset headline' then
    raise exception 'smoke FAIL: asset headline mismatch (got %)', v_asset_obj->>'intelligence_headline';
  end if;

  -- positioning: company-grouped bubble carries has_intelligence; non-company grouping does not
  v_pos := public.get_positioning_data(v_space, 'company');
  if not exists (
    select 1 from jsonb_array_elements(v_pos->'bubbles') b
    where (b->'group_keys'->>'company_id') = v_company::text and (b->>'has_intelligence')::bool is true
  ) then
    raise exception 'smoke FAIL: company-grouped bubble missing has_intelligence';
  end if;
  v_pos := public.get_positioning_data(v_space, 'moa');
  if exists (select 1 from jsonb_array_elements(v_pos->'bubbles') b where (b->>'has_intelligence')::bool is true) then
    raise exception 'smoke FAIL: moa grouping should not set company has_intelligence';
  end if;

  -- bullseye: companies_with_intelligence includes the seeded company
  if not (public.get_bullseye_assets(v_space)->'companies_with_intelligence' @> to_jsonb(v_company)) then
    raise exception 'smoke FAIL: bullseye companies_with_intelligence missing seeded company';
  end if;

  -- remove the seeded rows (no residue; this also runs against prod)
  delete from public.primary_intelligence where anchor_id in (v_anchor_company, v_anchor_asset);
  delete from public.primary_intelligence_anchors where id in (v_anchor_company, v_anchor_asset);

  raise notice 'multilevel-intel smoke: PASS';
end $$;

notify pgrst, 'reload schema';
