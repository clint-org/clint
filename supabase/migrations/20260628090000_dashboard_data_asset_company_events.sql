-- Stage 2c: surface asset-anchored and company-anchored events in the dashboard
-- tree, so the timeline grid can render an asset lane and a company band beside
-- the existing trial rows.
--
-- One source of truth for the event-array JSON shape: _dashboard_anchor_events
-- builds the same object the trial path already emitted under the 'markers' key
-- (marker_type_id = event_type_id; the system event_type UUIDs are reused, so the
-- existing marker renderer consumes it unchanged). _dashboard_trial_obj now calls
-- the helper for trial anchors; get_dashboard_data calls it for asset and company
-- anchors, adding an 'events' array to each asset and company object.
--
-- No significance/visibility filtering here: the full event set (each carrying its
-- own significance + visibility, and the type's default_significance) is returned;
-- the renderer applies effectiveVisibility (pinned -> show, hidden -> hide, else
-- significance == high) per the design's derived-membership rule. This matches the
-- existing trial path, which already returns all anchored events.
--
-- Bases (newest committed definitions, extended):
--   _dashboard_trial_obj -> 20260628074529_dashboard_trial_obj_reads_events.sql
--   get_dashboard_data   -> 20260627210000_landscape_multilevel_intelligence.sql

-- =============================================================================
-- 1. Shared event-array builder (trial / asset / company anchors)
-- =============================================================================
create or replace function public._dashboard_anchor_events(
  p_anchor_type text,
  p_anchor_id   uuid,
  p_space_id    uuid,
  p_start_year  integer,
  p_end_year    integer
)
 returns jsonb
 language sql
 stable
 set search_path to ''
as $function$
  select coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id',                 e.id,
        'marker_type_id',     e.event_type_id,
        'title',              e.title,
        'projection',         e.projection,
        'event_date',         e.event_date,
        'date_precision',     e.date_precision,
        'end_date',           e.end_date,
        'end_date_precision', e.end_date_precision,
        'is_ongoing',         e.is_ongoing,
        'description',        e.description,
        'source_url',         e.source_url,
        'metadata',           e.metadata,
        'is_projected',       e.is_projected,
        'no_longer_expected', e.no_longer_expected,
        'significance',       e.significance,
        'visibility',         e.visibility,
        'marker_type', (
          select jsonb_build_object(
            'id',                   et.id,
            'name',                 et.name,
            'shape',                et.shape,
            'fill_style',           et.fill_style,
            'color',                et.color,
            'inner_mark',           et.inner_mark,
            'default_significance', et.default_significance,
            'category_id',          et.category_id,
            'category_name',        ec.name
          )
          from public.event_types et
          left join public.event_type_categories ec on ec.id = et.category_id
          where et.id = e.event_type_id
        )
      )
      order by e.event_date
    )
    from public.events e
    where e.anchor_type = p_anchor_type
      and e.anchor_id   = p_anchor_id
      and e.space_id    = p_space_id
      and (p_start_year is null or extract(year from e.event_date) >= p_start_year)
      and (p_end_year   is null or extract(year from e.event_date) <= p_end_year)
  ), '[]'::jsonb)
$function$;

comment on function public._dashboard_anchor_events(text, uuid, uuid, integer, integer) is
  'Single source for the dashboard event-array JSON shape. Returns events anchored '
  'to (anchor_type, anchor_id) in space, within the year window, ordered by event_date, '
  'under the legacy marker shape (marker_type_id = event_type_id). Used for trial, '
  'asset, and company anchors. No significance/visibility filter: the renderer applies '
  'effectiveVisibility.';

-- =============================================================================
-- 2. _dashboard_trial_obj: delegate the trial-event array to the shared helper
-- =============================================================================
create or replace function public._dashboard_trial_obj(p_trial trials, p_space_id uuid, p_start_year integer, p_end_year integer)
 returns jsonb
 language sql
 stable
 set search_path to ''
as $function$
  select jsonb_build_object(
    'id', p_trial.id,
    'name', p_trial.name,
    'acronym', p_trial.acronym,
    'identifier', p_trial.identifier,
    'status', p_trial.status,
    'display_order', p_trial.display_order,
    'asset_id', p_trial.asset_id,
    'recruitment_status', p_trial.recruitment_status,
    'study_type', p_trial.study_type,
    'phase', p_trial.phase,
    'ctgov_last_synced_at', p_trial.ctgov_last_synced_at,
    'ctgov_withdrawn_at', p_trial.ctgov_withdrawn_at,
    'recent_changes_count', coalesce(recent.recent_changes_count, 0),
    'most_recent_change_type', recent.most_recent_change_type,
    'most_recent_change_event_id', recent.most_recent_change_event_id,
    'has_intelligence', (pi_trial.headline is not null),
    'intelligence_headline', pi_trial.headline,
    'intelligence_count', coalesce(pi_count.cnt, 0),
    'phase_data', case
      when p_trial.phase_type is not null then jsonb_build_object(
        'phase_type', p_trial.phase_type
      )
      else null
    end,
    'markers', public._dashboard_anchor_events('trial', p_trial.id, p_space_id, p_start_year, p_end_year)
  )
  from (
    select
      count(*)                                  as recent_changes_count,
      (array_agg(etype order by ets desc))[1]   as most_recent_change_type,
      (array_agg(eid order by ets desc))[1]     as most_recent_change_event_id
    from (
      select e.event_type::text as etype, e.observed_at as ets, e.id as eid
      from public.trial_change_events e
      where e.trial_id = p_trial.id
        and e.observed_at >= now() - public.recent_change_window()
      union all
      select 'intelligence_published'::text as etype, pi.updated_at as ets, null::uuid as eid
      from public.primary_intelligence pi
      join public.primary_intelligence_anchors a_pi on a_pi.id = pi.anchor_id
      where a_pi.entity_type = 'trial'
        and a_pi.entity_id = p_trial.id
        and pi.space_id = p_space_id
        and pi.state = 'published'
        and pi.updated_at >= now() - public.recent_change_window()
    ) combined
  ) recent
  left join lateral (
    -- lead anchor's published headline first, then most-recent published
    -- across all anchors for this trial (multi-brief support)
    select pi.headline
    from public.primary_intelligence pi
    join public.primary_intelligence_anchors a_pi on a_pi.id = pi.anchor_id
    where a_pi.entity_type = 'trial'
      and a_pi.entity_id   = p_trial.id
      and pi.space_id       = p_space_id
      and pi.state          = 'published'
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
      and a_pi.entity_id   = p_trial.id
      and a_pi.space_id    = p_space_id
  ) pi_count on true
$function$;

-- =============================================================================
-- 3. get_dashboard_data: add 'events' arrays to asset and company objects
--    (base 20260627210000, unchanged except the two new 'events' keys)
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
      'events', public._dashboard_anchor_events('company', c.id, p_space_id, p_start_year, p_end_year),
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
            'events', public._dashboard_anchor_events('asset', a.id, p_space_id, p_start_year, p_end_year),
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
  'from its lead published anchor (company entity_type=company, asset entity_type=product), '
  'and an events array of its anchor-level events (company band / asset lane); trials '
  'carry their trial-anchored events under markers. All event arrays share '
  '_dashboard_anchor_events. See 20260627210000 (multi-level intelligence base) and '
  '20260628090000 (asset/company event lanes).';

-- =============================================================================
-- 4. In-file smoke (data-conditional): when a space already has an asset-anchored
--    event, assert get_dashboard_data surfaces it under asset.events. Skips on a
--    fresh DB (db reset runs this migration before seed.sql, so there is no event
--    data yet -- local verification runs after reset via psql). Guards db push to
--    dev/prod once data exists.
-- =============================================================================
do $$
declare
  v_space uuid; v_company uuid; v_asset uuid; v_event uuid;
  v_dash jsonb; v_company_obj jsonb; v_asset_obj jsonb;
begin
  select e.space_id, a.company_id, e.anchor_id, e.id
    into v_space, v_company, v_asset, v_event
  from public.events e
  join public.assets a on a.id = e.anchor_id and a.space_id = e.space_id
  where e.anchor_type = 'asset'
  limit 1;

  if v_event is null then
    raise notice 'asset/company events smoke: no asset-anchored event, skipping';
    return;
  end if;

  v_dash := public.get_dashboard_data(v_space);
  v_company_obj := (select obj from jsonb_array_elements(v_dash) obj where obj->>'id' = v_company::text);
  if v_company_obj is null then
    raise exception 'smoke FAIL: company % not in dashboard tree', v_company;
  end if;
  if v_company_obj->'events' is null or jsonb_typeof(v_company_obj->'events') <> 'array' then
    raise exception 'smoke FAIL: company object missing events array';
  end if;
  v_asset_obj := (select a2 from jsonb_array_elements(v_company_obj->'assets') a2 where a2->>'id' = v_asset::text);
  if v_asset_obj is null then
    raise exception 'smoke FAIL: asset % not under company %', v_asset, v_company;
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_asset_obj->'events') ev where ev->>'id' = v_event::text
  ) then
    raise exception 'smoke FAIL: asset.events missing seeded asset event %', v_event;
  end if;

  raise notice 'asset/company events smoke: PASS';
end $$;

notify pgrst, 'reload schema';
