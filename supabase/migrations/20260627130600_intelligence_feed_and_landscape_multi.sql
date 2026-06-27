-- =============================================================================
-- Task 7: Feed is_lead + landscape multi-anchor presence
--
-- Fixes four RPCs that still referenced the dropped primary_intelligence.entity_type
-- and entity_id columns (dropped in 20260627130000_intelligence_anchors_schema):
--
--   list_primary_intelligence        -- base CTE filtered on p.entity_type (broken)
--   get_dashboard_data               -- two lateral joins on pi.entity_type/entity_id (broken)
--   get_positioning_data             -- has_intelligence EXISTS on pi.entity_type/entity_id (broken)
--   get_intelligence_notes_for_asset -- filter on pi.entity_type/entity_id (broken)
--
-- Changes per function:
--   list_primary_intelligence:  join primary_intelligence_anchors for entity binding;
--     output gains entity_type, entity_id, anchor_id, is_lead per row; entity_types
--     filter reads from anchor not version row.
--   get_dashboard_data: both PI lateral joins go through anchors; headline ordered
--     lead-first (is_lead desc), then published_at desc; new intelligence_count
--     (distinct published anchors per trial) added to trial payload.
--   get_positioning_data: has_intelligence EXISTS goes through anchors (both the
--     product-direct and the trial-via-trial_assets branches).
--   get_intelligence_notes_for_asset: entity_type/entity_id sourced from anchor.
--   referenced_in_entity: logic was fixed in 20260627130400; this migration adds
--     revoke execute from public, anon (matching list_intelligence_for_entity surface).
--
-- Rebase note: all bodies taken from live \sf output after supabase db reset
-- (post-tasks-1-6, pre-this-task). Only the PI presence/filter subqueries changed;
-- every other clause preserved byte-for-byte.
-- No @audit:tier1 markers (none of these are tier-1 governance RPCs).
-- =============================================================================

-- =============================================================================
-- 1. list_primary_intelligence
--    base CTE now joins primary_intelligence_anchors for entity binding.
--    entity_type/entity_id/anchor_id/is_lead added to each output row.
--    Signature unchanged; grant surface unchanged (CREATE OR REPLACE preserves
--    existing authenticated grant; no new grant/revoke needed).
-- =============================================================================

create or replace function public.list_primary_intelligence(
  p_space_id                  uuid,
  p_entity_types              text[]        default null,
  p_author_id                 uuid          default null,
  p_since                     timestamptz   default null,
  p_query                     text          default null,
  p_referencing_entity_type   text          default null,
  p_referencing_entity_id     uuid          default null,
  p_limit                     int           default 50,
  p_offset                    int           default 0
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_total int;
  v_query_pattern text;
begin
  v_query_pattern := case
    when p_query is null or length(trim(p_query)) = 0 then null
    else '%' || lower(trim(p_query)) || '%'
  end;

  -- base: join anchors to restore entity_type/entity_id (dropped from primary_intelligence
  -- in 20260627130000) and to carry is_lead for feed ordering.
  with base as (
    select p.*, a.entity_type, a.entity_id, a.is_lead
    from public.primary_intelligence p
    join public.primary_intelligence_anchors a on a.id = p.anchor_id
    where p.space_id = p_space_id
      and a.space_id = p_space_id
      and p.state = 'published'
      and (p_entity_types is null or a.entity_type = any(p_entity_types))
      and (p_since is null or p.updated_at >= p_since)
      and (
        v_query_pattern is null
        or lower(p.headline) like v_query_pattern
        or lower(p.summary_md) like v_query_pattern
      )
      and (
        p_author_id is null
        or p.last_edited_by = p_author_id
      )
      and (
        p_referencing_entity_type is null
        or p_referencing_entity_id is null
        or exists (
          select 1 from public.primary_intelligence_links l
          where l.primary_intelligence_id = p.id
            and l.entity_type = p_referencing_entity_type
            and l.entity_id = p_referencing_entity_id
        )
      )
  ), counted as (
    select count(*)::int as total from base
  ), paged as (
    select * from base
    order by updated_at desc
    limit greatest(p_limit, 0)
    offset greatest(p_offset, 0)
  )
  select
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', x.id,
            'space_id', x.space_id,
            'entity_type', x.entity_type,
            'entity_id', x.entity_id,
            'anchor_id', x.anchor_id,
            'is_lead', x.is_lead,
            'state', x.state,
            'headline', x.headline,
            'summary_md', x.summary_md,
            'last_edited_by', x.last_edited_by,
            'updated_at', x.updated_at,
            'links', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'entity_type', l.entity_type,
                    'entity_id', l.entity_id,
                    'relationship_type', l.relationship_type,
                    'gloss', l.gloss
                  )
                  order by l.display_order, l.created_at
                )
                from public.primary_intelligence_links l
                where l.primary_intelligence_id = x.id
              ),
              '[]'::jsonb
            ),
            'contributors', case
              when x.last_edited_by is null then '[]'::jsonb
              else jsonb_build_array(x.last_edited_by)
            end
          )
          order by x.updated_at desc
        )
        from paged x
      ),
      '[]'::jsonb
    ),
    (select total from counted)
  into v_rows, v_total;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset
  );
end;
$$;

comment on function public.list_primary_intelligence(uuid, text[], uuid, timestamptz, text, text, uuid, int, int) is
  'Returns paginated published primary intelligence. entity_type/entity_id/anchor_id/is_lead '
  'sourced from primary_intelligence_anchors (those columns moved off primary_intelligence in '
  '20260627130000). entity_types filter reads from anchor. See 20260627130600.';

-- =============================================================================
-- 2. get_dashboard_data
--    Two lateral joins on pi.entity_type/pi.entity_id rebased to join anchors.
--    pi_trial lateral: ordered by a.is_lead desc then published_at desc (lead headline).
--    New pi_count lateral: count(distinct anchor id) with a published version.
--    New 'intelligence_count' key added to each trial's jsonb payload.
--    Body is otherwise verbatim from the live definition (post 20260627120000).
-- =============================================================================

create or replace function public.get_dashboard_data(
  p_space_id uuid,
  p_company_ids uuid[] default null,
  p_asset_ids uuid[] default null,
  p_indication_ids uuid[] default null,
  p_start_year integer default null,
  p_end_year integer default null,
  p_recruitment_statuses text[] default null,
  p_study_types text[] default null,
  p_phases text[] default null,
  p_mechanism_of_action_ids uuid[] default null,
  p_route_of_administration_ids uuid[] default null
)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  result jsonb;
begin
  if p_mechanism_of_action_ids = '{}' then p_mechanism_of_action_ids := null; end if;
  if p_route_of_administration_ids = '{}' then p_route_of_administration_ids := null; end if;

  select coalesce(jsonb_agg(company_obj order by c.display_order), '[]'::jsonb)
  into result
  from public.companies c
  cross join lateral (
    select jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'logo_url', c.logo_url,
      'display_order', c.display_order,
      'assets', coalesce((
        select jsonb_agg(asset_obj order by a.display_order)
        from public.assets a
        cross join lateral (
          select jsonb_build_object(
            'id', a.id,
            'name', a.name,
            'generic_name', a.generic_name,
            'logo_url', a.logo_url,
            'display_order', a.display_order,
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
            'indications', coalesce((
              select jsonb_agg(indication_obj order by ind.display_order, ind.name)
              from public.asset_indications ai
              join public.indications ind on ind.id = ai.indication_id
              cross join lateral (
                select jsonb_build_object(
                  'id', ind.id,
                  'name', ind.name,
                  'abbreviation', ind.abbreviation,
                  'development_status', ai.development_status,
                  'development_status_source', ai.development_status_source,
                  'trials', coalesce((
                    select jsonb_agg(trial_obj order by t.display_order)
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
                    left join lateral (
                      with combined as (
                        select e.event_type::text as etype, e.observed_at as ets, e.id as eid
                        from public.trial_change_events e
                        where e.trial_id = t.id
                          and e.observed_at >= now() - public.recent_change_window()
                        union all
                        -- rebased: join anchors for entity binding (entity_type/entity_id
                        -- were dropped from primary_intelligence in 20260627130000)
                        select 'intelligence_published'::text as etype, pi.updated_at as ets, null::uuid as eid
                        from public.primary_intelligence_anchors a_pi
                        join public.primary_intelligence pi
                          on pi.anchor_id = a_pi.id and pi.state = 'published'
                        where a_pi.entity_type = 'trial'
                          and a_pi.entity_id = t.id
                          and a_pi.space_id = p_space_id
                          and pi.updated_at >= now() - public.recent_change_window()
                      )
                      select
                        count(*)                                  as recent_changes_count,
                        (array_agg(etype order by ets desc))[1]   as most_recent_change_type,
                        (array_agg(eid order by ets desc))[1]     as most_recent_change_event_id
                      from combined
                    ) recent on true
                    left join lateral (
                      -- rebased: join anchors; lead anchor's published headline first,
                      -- then most-recent published across all anchors for this trial.
                      select pi.headline
                      from public.primary_intelligence_anchors a_pi
                      join public.primary_intelligence pi
                        on pi.anchor_id = a_pi.id and pi.state = 'published'
                      where a_pi.entity_type = 'trial'
                        and a_pi.entity_id   = t.id
                        and a_pi.space_id    = p_space_id
                      order by a_pi.is_lead desc, pi.published_at desc nulls last
                      limit 1
                    ) pi_trial on true
                    left join lateral (
                      -- count distinct published anchors for this trial (multi-brief count)
                      select count(distinct a_pi.id)::int as cnt
                      from public.primary_intelligence_anchors a_pi
                      join public.primary_intelligence pi
                        on pi.anchor_id = a_pi.id and pi.state = 'published'
                      where a_pi.entity_type = 'trial'
                        and a_pi.entity_id   = t.id
                        and a_pi.space_id    = p_space_id
                    ) pi_count on true
                    cross join lateral (
                      select jsonb_build_object(
                        'id', t.id,
                        'name', t.name,
                        'acronym', t.acronym,
                        'identifier', t.identifier,
                        'status', t.status,
                        'display_order', t.display_order,
                        'asset_id', t.asset_id,
                        'recruitment_status', t.recruitment_status,
                        'study_type', t.study_type,
                        'phase', t.phase,
                        'ctgov_last_synced_at', t.ctgov_last_synced_at,
                        'ctgov_withdrawn_at', t.ctgov_withdrawn_at,
                        'recent_changes_count', coalesce(recent.recent_changes_count, 0),
                        'most_recent_change_type', recent.most_recent_change_type,
                        'most_recent_change_event_id', recent.most_recent_change_event_id,
                        'has_intelligence', (pi_trial.headline is not null),
                        'intelligence_headline', pi_trial.headline,
                        'intelligence_count', coalesce(pi_count.cnt, 0),
                        'phase_data', case
                          when t.phase_type is not null then jsonb_build_object(
                            'phase_type',       t.phase_type,
                            'phase_start_date', t.phase_start_date,
                            'phase_end_date',   t.phase_end_date
                          )
                          else null
                        end,
                        'markers', coalesce((
                          select jsonb_agg(
                            jsonb_build_object(
                              'id',                 mk.id,
                              'title',              mk.title,
                              'projection',         mk.projection,
                              'event_date',         mk.event_date,
                              'date_precision',     mk.date_precision,
                              'end_date',           mk.end_date,
                              'end_date_precision', mk.end_date_precision,
                              'is_ongoing',         mk.is_ongoing,
                              'description',        mk.description,
                              'source_url',         mk.source_url,
                              'metadata',           mk.metadata,
                              'is_projected',       mk.is_projected,
                              'no_longer_expected', mk.no_longer_expected,
                              'marker_type', (
                                select jsonb_build_object(
                                  'id',            mt.id,
                                  'name',          mt.name,
                                  'shape',         mt.shape,
                                  'fill_style',    mt.fill_style,
                                  'color',         mt.color,
                                  'inner_mark',    mt.inner_mark,
                                  'category_id',   mt.category_id,
                                  'category_name', mc.name
                                )
                                from public.marker_types mt
                                left join public.marker_categories mc on mc.id = mt.category_id
                                where mt.id = mk.marker_type_id
                              )
                            )
                            order by mk.event_date
                          )
                          from public.marker_assignments ma
                          join public.markers mk on mk.id = ma.marker_id
                          where ma.trial_id = t.id
                            and mk.space_id = p_space_id
                            and (p_start_year is null or extract(year from mk.event_date) >= p_start_year)
                            and (p_end_year   is null or extract(year from mk.event_date) <= p_end_year)
                        ), '[]'::jsonb)
                      ) as trial_obj
                    ) as trial_lateral
                  ), '[]'::jsonb)
                ) as indication_obj
              ) as indication_lateral
              where ai.asset_id = a.id
                and ai.space_id = p_space_id
                and (p_indication_ids is null or ai.indication_id = any(p_indication_ids))
            ), '[]'::jsonb)
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
  'Returns hierarchical dashboard data (companies > assets > indications > trials). '
  'Trial payload: has_intelligence (any published anchor), intelligence_headline '
  '(lead anchor published headline, fallback most-recent published), intelligence_count '
  '(distinct published anchors). PI presence goes through primary_intelligence_anchors '
  '(entity_type/entity_id moved there in 20260627130000). See 20260627130600.';

-- =============================================================================
-- 3. get_positioning_data
--    has_intelligence EXISTS in asset_highest_phase CTE rebased to join anchors.
--    Both branches (entity_type=product and entity_type=trial) updated.
--    All other logic preserved verbatim from live body (post 20260626180000).
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
  'See 20260626180000 (semantics) and 20260627130600 (anchor rebase).';

-- =============================================================================
-- 4. get_intelligence_notes_for_asset
--    entity_type/entity_id sourced from primary_intelligence_anchors.
--    join anchor on anchor_id; filter and output entity binding from anchor.
--    Language stays sql (stable, security invoker, set search_path = '').
-- =============================================================================

create or replace function public.get_intelligence_notes_for_asset(
  p_space_id uuid,
  p_asset_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',          pi.id,
        'entity_type', a.entity_type,
        'entity_id',   a.entity_id,
        'entity_name', case a.entity_type
          when 'product' then (
            select a2.name
            from public.assets a2
            where a2.id = a.entity_id
          )
          when 'trial' then (
            select t.name
            from public.trials t
            where t.id = a.entity_id
          )
        end,
        'headline',    pi.headline,
        'updated_at',  pi.updated_at
      )
      order by pi.updated_at desc
    ),
    '[]'::jsonb
  )
  from public.primary_intelligence pi
  join public.primary_intelligence_anchors a on a.id = pi.anchor_id
  where pi.space_id = p_space_id
    and a.space_id = p_space_id
    and pi.state = 'published'
    and (
      (a.entity_type = 'product' and a.entity_id = p_asset_id)
      or
      (a.entity_type = 'trial' and a.entity_id in (
        select t.id
        from public.trials t
        where t.asset_id = p_asset_id
          and t.space_id = p_space_id
      ))
    );
$$;

comment on function public.get_intelligence_notes_for_asset(uuid, uuid) is
  'Returns published intelligence notes for an asset and its trials. '
  'entity_type/entity_id sourced from primary_intelligence_anchors '
  '(those columns moved off primary_intelligence in 20260627130000). '
  'Lightweight projection (id, headline, entity context, updated_at) '
  'for the bullseye detail panel. See 20260627130600.';

-- =============================================================================
-- 5. referenced_in_entity: revoke from public and anon
--    The function logic was fixed in 20260627130400. Its grant surface did not
--    match list_intelligence_for_entity (which revokes public/anon). Align it.
-- =============================================================================

revoke execute on function public.referenced_in_entity(uuid, text, uuid, integer) from public, anon;

-- =============================================================================
-- 6. Straggler sweep fixes (found after initial audit)
--    Five additional functions still referenced primary_intelligence.entity_type
--    / entity_id after migration 20260627130000 dropped those columns.
-- =============================================================================

-- 6a. list_draft_intelligence_for_space
--     entity_type/entity_id now come from the anchor join.
create or replace function public.list_draft_intelligence_for_space(
  p_space_id uuid,
  p_limit    integer default 3
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select coalesce(jsonb_agg(row_data order by updated_at desc), '[]'::jsonb)
  from (
    select
      jsonb_build_object(
        'id',            p.id,
        'space_id',      p.space_id,
        'entity_type',   a.entity_type,
        'entity_id',     a.entity_id,
        'state',         p.state,
        'headline',      p.headline,
        'summary_md',    p.summary_md,
        'last_edited_by', p.last_edited_by,
        'updated_at',    p.updated_at,
        'links',         '[]'::jsonb,
        'contributors',  case
          when p.last_edited_by is null then '[]'::jsonb
          else jsonb_build_array(p.last_edited_by)
        end
      ) as row_data,
      p.updated_at
    from public.primary_intelligence p
    join public.primary_intelligence_anchors a on a.id = p.anchor_id
    where p.space_id = p_space_id
      and a.space_id = p_space_id
      and p.state = 'draft'
    order by p.updated_at desc
    limit p_limit
  ) ordered;
$function$;

comment on function public.list_draft_intelligence_for_space(uuid, integer) is
  'Lists the most-recent draft primary intelligence rows for a space. '
  'entity_type/entity_id sourced from primary_intelligence_anchors. '
  'See 20260627130600 (straggler fix).';

-- 6b. preview_trial_delete
--     primary_intelligence count now queries anchors (one anchor = one brief).
create or replace function public.preview_trial_delete(p_trial_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $function$
declare
  v_uid                          uuid := auth.uid();
  v_space_id                     uuid;
  v_n_trial_notes                bigint;
  v_n_events                     bigint;
  v_n_material_links             bigint;
  v_n_primary_intelligence       bigint;
  v_n_primary_intelligence_links bigint;
  v_n_marker_assignments         bigint;
  v_n_markers_removed_entirely   bigint;
  v_n_markers_unlinked_only      bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  select t.space_id into v_space_id
    from public.trials t
    where t.id = p_trial_id;
  if v_space_id is null then
    raise exception 'trial % not found', p_trial_id
      using errcode = 'P0002';
  end if;

  if not public.has_space_access(v_space_id) then
    raise exception 'not authorized for space %', v_space_id
      using errcode = '42501';
  end if;

  select count(*) into v_n_trial_notes
    from public.trial_notes tn
    where tn.trial_id = p_trial_id;

  select count(*) into v_n_events
    from public.events e
    where e.trial_id = p_trial_id;

  select count(*) into v_n_material_links
    from public.material_links ml
    where ml.entity_type = 'trial' and ml.entity_id = p_trial_id;

  -- count anchors (briefs) owned by this trial; each anchor = one brief
  select count(*) into v_n_primary_intelligence
    from public.primary_intelligence_anchors a_pi
    where a_pi.space_id = v_space_id
      and a_pi.entity_type = 'trial'
      and a_pi.entity_id = p_trial_id;

  select count(*) into v_n_primary_intelligence_links
    from public.primary_intelligence_links pil
    where pil.entity_type = 'trial' and pil.entity_id = p_trial_id;

  select count(*) into v_n_marker_assignments
    from public.marker_assignments ma
    where ma.trial_id = p_trial_id;

  with reachable_markers as (
    select distinct ma.marker_id
      from public.marker_assignments ma
      where ma.trial_id = p_trial_id
  ),
  split as (
    select rm.marker_id,
           not exists (
             select 1
               from public.marker_assignments ma2
               where ma2.marker_id = rm.marker_id
                 and ma2.trial_id <> p_trial_id
           ) as removed_entirely
      from reachable_markers rm
  )
  select
    count(*) filter (where removed_entirely),
    count(*) filter (where not removed_entirely)
    into v_n_markers_removed_entirely, v_n_markers_unlinked_only
    from split;

  return jsonb_build_object(
    'trial_notes',                v_n_trial_notes,
    'events',                     v_n_events,
    'material_links',             v_n_material_links,
    'primary_intelligence',       v_n_primary_intelligence,
    'primary_intelligence_links', v_n_primary_intelligence_links,
    'marker_assignments',         v_n_marker_assignments,
    'markers_removed_entirely',   v_n_markers_removed_entirely,
    'markers_unlinked_only',      v_n_markers_unlinked_only
  );
end;
$function$;

-- 6c. preview_company_delete
--     primary_intelligence count queries anchors, not versions.
create or replace function public.preview_company_delete(p_company_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_space_id uuid;
  v_asset_ids uuid[];
  v_trial_ids uuid[];
  v_n_assets bigint;
  v_n_trials bigint;
  v_n_trial_notes bigint;
  v_n_events bigint;
  v_n_material_links bigint;
  v_n_primary_intelligence bigint;
  v_n_primary_intelligence_links bigint;
  v_n_marker_assignments bigint;
  v_n_markers_removed_entirely bigint;
  v_n_markers_unlinked_only bigint;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select c.space_id into v_space_id from public.companies c where c.id = p_company_id;
  if v_space_id is null then raise exception 'company % not found', p_company_id using errcode = 'P0002'; end if;
  if not public.has_space_access(v_space_id) then raise exception 'not authorized' using errcode = '42501'; end if;

  select coalesce(array_agg(a.id), array[]::uuid[]) into v_asset_ids from public.assets a where a.company_id = p_company_id;
  select coalesce(array_agg(t.id), array[]::uuid[]) into v_trial_ids from public.trials t where t.asset_id = any(v_asset_ids);
  v_n_assets := coalesce(array_length(v_asset_ids, 1), 0);
  v_n_trials := coalesce(array_length(v_trial_ids, 1), 0);

  select count(*) into v_n_trial_notes from public.trial_notes tn where tn.trial_id = any(v_trial_ids);
  select count(*) into v_n_events from public.events e where e.company_id = p_company_id or e.asset_id = any(v_asset_ids) or e.trial_id = any(v_trial_ids);
  select count(*) into v_n_material_links from public.material_links ml
    where (ml.entity_type = 'company' and ml.entity_id = p_company_id)
       or (ml.entity_type = 'asset' and ml.entity_id = any(v_asset_ids))
       or (ml.entity_type = 'trial' and ml.entity_id = any(v_trial_ids));
  -- count anchors (briefs) owned by this company, its assets, and their trials
  select count(*) into v_n_primary_intelligence
    from public.primary_intelligence_anchors a_pi
    where a_pi.space_id = v_space_id
      and (
        (a_pi.entity_type = 'company' and a_pi.entity_id = p_company_id)
        or (a_pi.entity_type = 'asset' and a_pi.entity_id = any(v_asset_ids))
        or (a_pi.entity_type = 'trial' and a_pi.entity_id = any(v_trial_ids))
      );
  select count(*) into v_n_primary_intelligence_links from public.primary_intelligence_links pil
    where (pil.entity_type = 'company' and pil.entity_id = p_company_id)
       or (pil.entity_type = 'asset' and pil.entity_id = any(v_asset_ids))
       or (pil.entity_type = 'trial' and pil.entity_id = any(v_trial_ids));
  select count(*) into v_n_marker_assignments from public.marker_assignments ma where ma.trial_id = any(v_trial_ids);

  with reachable as (
    select distinct ma.marker_id from public.marker_assignments ma where ma.trial_id = any(v_trial_ids)
  ), split as (
    select rm.marker_id,
      not exists (select 1 from public.marker_assignments ma2 where ma2.marker_id = rm.marker_id and ma2.trial_id <> all(v_trial_ids)) as removed_entirely
    from reachable rm
  )
  select count(*) filter (where removed_entirely), count(*) filter (where not removed_entirely)
    into v_n_markers_removed_entirely, v_n_markers_unlinked_only from split;

  return jsonb_build_object(
    'assets', v_n_assets, 'trials', v_n_trials, 'trial_notes', v_n_trial_notes,
    'events', v_n_events, 'material_links', v_n_material_links,
    'primary_intelligence', v_n_primary_intelligence,
    'primary_intelligence_links', v_n_primary_intelligence_links,
    'marker_assignments', v_n_marker_assignments,
    'markers_removed_entirely', v_n_markers_removed_entirely,
    'markers_unlinked_only', v_n_markers_unlinked_only
  );
end;
$function$;

-- 6d. preview_asset_delete
--     primary_intelligence count queries anchors, not versions.
create or replace function public.preview_asset_delete(p_asset_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_space_id uuid;
  v_trial_ids uuid[];
  v_n_trials bigint;
  v_n_trials_unlinked bigint;
  v_n_trial_notes bigint;
  v_n_events bigint;
  v_n_material_links bigint;
  v_n_primary_intelligence bigint;
  v_n_primary_intelligence_links bigint;
  v_n_marker_assignments bigint;
  v_n_markers_removed_entirely bigint;
  v_n_markers_unlinked_only bigint;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select a.space_id into v_space_id from public.assets a where a.id = p_asset_id;
  if v_space_id is null then raise exception 'asset % not found', p_asset_id using errcode = 'P0002'; end if;
  if not public.has_space_access(v_space_id) then raise exception 'not authorized' using errcode = '42501'; end if;

  -- Trials FULLY deleted with this asset: those whose ONLY asset is this one.
  -- Multi-asset trials survive (they keep other assets) and are reported as unlinked.
  select coalesce(array_agg(t.id), array[]::uuid[]) into v_trial_ids
    from public.trials t
    where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = p_asset_id)
      and not exists (select 1 from public.trial_assets ta2 where ta2.trial_id = t.id and ta2.asset_id <> p_asset_id);
  select count(*) into v_n_trials_unlinked
    from public.trials t
    where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = p_asset_id)
      and exists (select 1 from public.trial_assets ta2 where ta2.trial_id = t.id and ta2.asset_id <> p_asset_id);
  v_n_trials := coalesce(array_length(v_trial_ids, 1), 0);
  select count(*) into v_n_trial_notes from public.trial_notes tn where tn.trial_id = any(v_trial_ids);
  select count(*) into v_n_events from public.events e where e.asset_id = p_asset_id or e.trial_id = any(v_trial_ids);
  select count(*) into v_n_material_links from public.material_links ml
    where (ml.entity_type = 'asset' and ml.entity_id = p_asset_id)
       or (ml.entity_type = 'trial' and ml.entity_id = any(v_trial_ids));
  -- count anchors (briefs) owned by this asset or its fully-deleted trials
  select count(*) into v_n_primary_intelligence
    from public.primary_intelligence_anchors a_pi
    where a_pi.space_id = v_space_id
      and (
        (a_pi.entity_type = 'asset' and a_pi.entity_id = p_asset_id)
        or (a_pi.entity_type = 'trial' and a_pi.entity_id = any(v_trial_ids))
      );
  select count(*) into v_n_primary_intelligence_links from public.primary_intelligence_links pil
    where (pil.entity_type = 'asset' and pil.entity_id = p_asset_id)
       or (pil.entity_type = 'trial' and pil.entity_id = any(v_trial_ids));
  select count(*) into v_n_marker_assignments from public.marker_assignments ma where ma.trial_id = any(v_trial_ids);

  with reachable as (
    select distinct ma.marker_id from public.marker_assignments ma where ma.trial_id = any(v_trial_ids)
  ), split as (
    select rm.marker_id,
      not exists (select 1 from public.marker_assignments ma2 where ma2.marker_id = rm.marker_id and ma2.trial_id <> all(v_trial_ids)) as removed_entirely
    from reachable rm
  )
  select count(*) filter (where removed_entirely), count(*) filter (where not removed_entirely)
    into v_n_markers_removed_entirely, v_n_markers_unlinked_only from split;

  return jsonb_build_object(
    'trials', v_n_trials, 'trials_unlinked', v_n_trials_unlinked, 'trial_notes', v_n_trial_notes, 'events', v_n_events,
    'material_links', v_n_material_links, 'primary_intelligence', v_n_primary_intelligence,
    'primary_intelligence_links', v_n_primary_intelligence_links,
    'marker_assignments', v_n_marker_assignments,
    'markers_removed_entirely', v_n_markers_removed_entirely,
    'markers_unlinked_only', v_n_markers_unlinked_only
  );
end;
$function$;

-- 6e. get_bullseye_assets
--     asset_intel CTE: count distinct anchors instead of PI versions.
--     asset_activity CTE: join anchors for PI recent-change union branches.
--     All other logic (filters, markers, trials, output shape) preserved verbatim.
create or replace function public.get_bullseye_assets(
  p_space_id      uuid,
  p_indication_ids uuid[] default null,
  p_company_ids   uuid[] default null,
  p_moa_ids       uuid[] default null,
  p_roa_ids       uuid[] default null,
  p_phases        text[] default null,
  p_asset_ids     uuid[] default null,
  p_trial_ids     uuid[] default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_result jsonb;
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
      -- company filter
      and (p_company_ids is null or a.company_id = any(p_company_ids))
      -- direct asset filter
      and (p_asset_ids is null or a.id = any(p_asset_ids))
      -- indication filter: asset must have at least one matching indication
      and (p_indication_ids is null or exists (
        select 1 from public.asset_indications ai
        where ai.asset_id = a.id
          and ai.indication_id = any(p_indication_ids)
      ))
      -- moa filter: asset must have at least one matching MOA
      and (p_moa_ids is null or exists (
        select 1 from public.asset_mechanisms_of_action amoa
        where amoa.asset_id = a.id
          and amoa.moa_id = any(p_moa_ids)
      ))
      -- roa filter: asset must have at least one matching ROA
      and (p_roa_ids is null or exists (
        select 1 from public.asset_routes_of_administration aroa
        where aroa.asset_id = a.id
          and aroa.roa_id = any(p_roa_ids)
      ))
      -- trial filter: asset must be linked to at least one matching trial
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
  --   rebased: count distinct anchors (briefs) for the asset directly
  --   OR for any trial belonging to the asset.
  asset_intel as (
    select
      fa.asset_id,
      (
        -- asset-level briefs
        (select count(distinct a_pi.id)
         from public.primary_intelligence_anchors a_pi
         where a_pi.entity_type = 'asset'
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

  -- Step 5: compute recent change activity per asset (14-day window).
  --   rebased: PI union branches join primary_intelligence_anchors for entity binding.
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
             (a_pi.entity_type = 'asset' and a_pi.entity_id = fa.asset_id)
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
              (a_pi.entity_type = 'asset' and a_pi.entity_id = fa.asset_id)
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
              (a_pi.entity_type = 'asset' and a_pi.entity_id = fa.asset_id)
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
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

comment on function public.get_bullseye_assets(uuid, uuid[], uuid[], uuid[], uuid[], text[], uuid[], uuid[]) is
  'Pipeline bullseye: assets with phase, indications, and intelligence counts. '
  'Rebased in 20260627130600 to count anchors (not PI versions) and join '
  'primary_intelligence_anchors for recent-change activity union branches.';

-- =============================================================================
-- 7. Inline smoke test
--    Verifies the four rebased functions accept calls without error and that
--    get_dashboard_data returns the correct multi-anchor presence flags.
--    Uses UUIDs in the d1306000 range (distinct from neighbouring smokes).
-- =============================================================================
do $$
declare
  v_agency_id     uuid := 'd1306000-d130-d130-d130-d13000000001';
  v_tenant_id     uuid := 'd1306000-d130-d130-d130-d13000000002';
  v_owner_id      uuid := 'd1306000-d130-d130-d130-d13000000003';
  v_space_id      uuid := 'd1306000-d130-d130-d130-d13000000004';
  v_company_id    uuid := 'd1306000-d130-d130-d130-d13000000005';
  v_asset_id      uuid := 'd1306000-d130-d130-d130-d13000000006';
  v_indication_id uuid := 'd1306000-d130-d130-d130-d13000000007';
  v_condition_id  uuid := 'd1306000-d130-d130-d130-d13000000008';
  v_trial_id      uuid := 'd1306000-d130-d130-d130-d13000000009';
  v_anchor1_id    uuid := 'd1306000-d130-d130-d130-d13000000010';
  v_anchor2_id    uuid := 'd1306000-d130-d130-d130-d13000000011';
  v_pi1_id        uuid;
  v_pi2_id        uuid;
  v_dash          jsonb;
  v_trial_node    jsonb;
  v_feed          jsonb;
  v_feed_rows     jsonb;
begin
  -- minimal entity hierarchy
  insert into auth.users (id, email) values
    (v_owner_id, 'feed-landscape-multi@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'FeedLand', 'feedland', 'feedland', 'FL', 'fl@y.z');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'FL', 'feedland-t', 'feedlandt', 'FL');

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant_id, v_owner_id, 'owner');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_owner_id);

  insert into public.space_members (space_id, user_id, role)
    values (v_space_id, v_owner_id, 'owner');

  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_owner_id, 'FL Pharma');

  insert into public.assets (id, space_id, created_by, company_id, name)
    values (v_asset_id, v_space_id, v_owner_id, v_company_id, 'FL Asset');

  insert into public.indications (id, space_id, created_by, name, abbreviation)
    values (v_indication_id, v_space_id, v_owner_id, 'Obesity', 'OBES');

  insert into public.asset_indications (asset_id, indication_id, space_id, development_status, created_by)
    values (v_asset_id, v_indication_id, v_space_id, 'P3', v_owner_id);

  insert into public.conditions (id, space_id, name, source)
    values (v_condition_id, v_space_id, 'Obesity', 'analyst');

  insert into public.condition_indication_map (condition_id, indication_id)
    values (v_condition_id, v_indication_id);

  -- trial (asset_id triggers trial_assets auto-derive)
  insert into public.trials (id, space_id, created_by, asset_id, name, phase_type)
    values (v_trial_id, v_space_id, v_owner_id, v_asset_id, 'FL Trial', 'P3');

  insert into public.trial_conditions (trial_id, condition_id)
    values (v_trial_id, v_condition_id);

  -- anchor 1 (lead, published with 'Lead headline')
  insert into public.primary_intelligence_anchors
    (id, space_id, entity_type, entity_id, is_lead, display_order, created_by)
    values (v_anchor1_id, v_space_id, 'trial', v_trial_id, true, 0, v_owner_id);

  insert into public.primary_intelligence
    (space_id, anchor_id, state, headline, summary_md, implications_md, last_edited_by)
    values (v_space_id, v_anchor1_id, 'published', 'Lead headline', '', '', v_owner_id)
  returning id into v_pi1_id;

  -- anchor 2 (non-lead sibling, published with 'Second')
  insert into public.primary_intelligence_anchors
    (id, space_id, entity_type, entity_id, is_lead, display_order, created_by)
    values (v_anchor2_id, v_space_id, 'trial', v_trial_id, false, 1, v_owner_id);

  insert into public.primary_intelligence
    (space_id, anchor_id, state, headline, summary_md, implications_md, last_edited_by)
    values (v_space_id, v_anchor2_id, 'published', 'Second', '', '', v_owner_id)
  returning id into v_pi2_id;

  -- smoke 1: list_primary_intelligence returns both rows with entity binding
  v_feed := public.list_primary_intelligence(v_space_id);
  v_feed_rows := v_feed -> 'rows';
  if (v_feed ->> 'total')::int <> 2 then
    raise exception 'feed smoke FAIL: expected 2 rows, got %', v_feed ->> 'total';
  end if;
  if not jsonb_path_exists(v_feed_rows, '$[*] ? (@.entity_type == "trial")') then
    raise exception 'feed smoke FAIL: entity_type not set on feed rows';
  end if;
  if not jsonb_path_exists(v_feed_rows, '$[*] ? (@.is_lead == true)') then
    raise exception 'feed smoke FAIL: no is_lead=true row in feed';
  end if;
  if not jsonb_path_exists(v_feed_rows, '$[*] ? (@.anchor_id != null)') then
    raise exception 'feed smoke FAIL: anchor_id missing from feed rows';
  end if;

  -- smoke 2: get_dashboard_data returns the trial with multi-anchor presence flags
  v_dash := public.get_dashboard_data(v_space_id);
  v_trial_node := jsonb_path_query_first(
    v_dash,
    '$[*].assets[*].indications[*].trials[*] ? (@.id == $tid)',
    jsonb_build_object('tid', v_trial_id)
  );
  if v_trial_node is null then
    raise exception 'dashboard smoke FAIL: trial node missing';
  end if;
  if (v_trial_node ->> 'has_intelligence') is distinct from 'true' then
    raise exception 'dashboard smoke FAIL: has_intelligence not true (got %)',
      v_trial_node ->> 'has_intelligence';
  end if;
  if (v_trial_node ->> 'intelligence_headline') is distinct from 'Lead headline' then
    raise exception 'dashboard smoke FAIL: intelligence_headline wrong (got %)',
      v_trial_node ->> 'intelligence_headline';
  end if;
  if (v_trial_node ->> 'intelligence_count')::int <> 2 then
    raise exception 'dashboard smoke FAIL: intelligence_count expected 2, got %',
      v_trial_node ->> 'intelligence_count';
  end if;

  -- smoke 3: get_intelligence_notes_for_asset returns both notes for the asset
  declare
    v_notes jsonb;
  begin
    v_notes := public.get_intelligence_notes_for_asset(v_space_id, v_asset_id);
    if jsonb_array_length(v_notes) <> 2 then
      raise exception 'notes smoke FAIL: expected 2 notes, got %', jsonb_array_length(v_notes);
    end if;
    if not jsonb_path_exists(v_notes, '$[*] ? (@.entity_type == "trial")') then
      raise exception 'notes smoke FAIL: entity_type not set on notes';
    end if;
  end;

  -- cleanup
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.primary_intelligence_anchors where space_id = v_space_id;
  delete from public.space_members where space_id = v_space_id;
  delete from public.tenant_members where tenant_id = v_tenant_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_owner_id;
  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'intelligence_feed_and_landscape_multi smoke test: PASS';
end$$;

notify pgrst, 'reload schema';
