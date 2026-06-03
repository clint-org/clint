-- Drop the unused marker_types.icon column and stop emitting it from RPCs.
--
-- The icon field was collected by the Add/Edit Marker Type form but never
-- rendered anywhere: markers are drawn as parametric SVG shapes
-- (shape + fill_style + inner_mark + color) via the app-marker-icon component,
-- which has no icon concept. The column and its RPC payloads were dead data.
--
-- Recreate every RPC that emitted mt.icon / marker_type_icon without it,
-- then drop the column. Function bodies below are the live definitions with
-- only the icon references removed.

-- get_activity_feed
CREATE OR REPLACE FUNCTION public.get_activity_feed(p_space_id uuid, p_filters jsonb DEFAULT '{}'::jsonb, p_cursor_observed_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_event_types text[];
  v_sources text[];
  v_trial_id uuid;
begin
  if v_uid is null or not public.has_space_access(p_space_id) then return; end if;

  v_event_types := case when p_filters ? 'event_types' then
    (select array_agg(x::text) from jsonb_array_elements_text(p_filters->'event_types') x)
    else null end;
  v_sources := case when p_filters ? 'sources' then
    (select array_agg(x::text) from jsonb_array_elements_text(p_filters->'sources') x)
    else null end;
  v_trial_id := case when p_filters ? 'trial_id' then (p_filters->>'trial_id')::uuid else null end;

  return query
  select jsonb_build_object(
    'id', ce.id,
    'trial_id', ce.trial_id,
    'space_id', ce.space_id,
    'event_type', ce.event_type,
    'source', ce.source,
    'payload', ce.payload,
    'occurred_at', ce.occurred_at,
    'observed_at', ce.observed_at,
    'trial_name', t.name,
    'trial_acronym', t.acronym,
    'trial_identifier', t.identifier,
    'asset_name', a.name,
    'asset_id', a.id,
    'company_name', co.name,
    'company_id', co.id,
    'company_logo_url', co.logo_url,
    'marker_type', case when ce.marker_id is not null then (
      select jsonb_build_object('id', mt.id, 'name', mt.name,
        'shape', mt.shape, 'fill_style', mt.fill_style, 'color', mt.color,
        'inner_mark', mt.inner_mark, 'category_name', mc.name)
      from public.marker_types mt
      left join public.marker_categories mc on mc.id = mt.category_id
      where mt.id = (select m.marker_type_id from public.markers m where m.id = ce.marker_id)
    ) else null end
  )
  from public.trial_change_events ce
  join public.trials t on t.id = ce.trial_id
  left join public.assets a on a.id = t.asset_id
  left join public.companies co on co.id = a.company_id
  where ce.space_id = p_space_id
    and (v_event_types is null or ce.event_type = any(v_event_types))
    and (v_sources is null or ce.source = any(v_sources))
    and (v_trial_id is null or ce.trial_id = v_trial_id)
    and (p_cursor_observed_at is null or (ce.observed_at, ce.id) < (p_cursor_observed_at, p_cursor_id))
  order by ce.observed_at desc, ce.id desc
  limit p_limit;
end;
$function$

;

-- get_bullseye_assets
CREATE OR REPLACE FUNCTION public.get_bullseye_assets(p_space_id uuid, p_indication_ids uuid[] DEFAULT NULL::uuid[], p_company_ids uuid[] DEFAULT NULL::uuid[], p_moa_ids uuid[] DEFAULT NULL::uuid[], p_roa_ids uuid[] DEFAULT NULL::uuid[], p_phases text[] DEFAULT NULL::text[], p_asset_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  -- Normalize empty arrays to null (no-filter semantics)
  if p_indication_ids = '{}' then p_indication_ids := null; end if;
  if p_company_ids    = '{}' then p_company_ids    := null; end if;
  if p_moa_ids        = '{}' then p_moa_ids        := null; end if;
  if p_roa_ids        = '{}' then p_roa_ids        := null; end if;
  if p_phases         = '{}' then p_phases         := null; end if;
  if p_asset_ids      = '{}' then p_asset_ids      := null; end if;

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
  --   counts primary_intelligence records linked to the asset directly
  --   OR to any trial belonging to the asset
  asset_intel as (
    select
      fa.asset_id,
      (
        -- asset-level intelligence
        (select count(*)
         from public.primary_intelligence pi
         where pi.entity_type = 'asset'
           and pi.entity_id = fa.asset_id
           and pi.space_id = p_space_id)
        +
        -- trial-level intelligence for trials belonging to this asset
        (select count(*)
         from public.primary_intelligence pi
         where pi.entity_type = 'trial'
           and pi.space_id = p_space_id
           and pi.entity_id in (
             select t.id from public.trials t
             where t.asset_id = fa.asset_id and t.space_id = p_space_id
           ))
      ) as intelligence_count
    from filtered_assets fa
  ),

  -- Step 5: compute recent change activity per asset (14-day window).
  --   recent_changes_count rolls up everything beneath the asset:
  --     - trial_change_events for the asset's trials, plus
  --     - published primary_intelligence about the asset OR its trials.
  asset_activity as (
    select
      fa.asset_id,
      (
        (select count(*)
         from public.trial_change_events e
         join public.trials t on t.id = e.trial_id
         where t.asset_id = fa.asset_id
           and t.space_id = p_space_id
           and e.observed_at >= now() - public.recent_change_window())
        +
        (select count(*)
         from public.primary_intelligence pi
         where pi.space_id = p_space_id
           and pi.state = 'published'
           and pi.updated_at >= now() - public.recent_change_window()
           and (
             (pi.entity_type = 'asset' and pi.entity_id = fa.asset_id)
             or (pi.entity_type = 'trial' and pi.entity_id in (
                   select t2.id from public.trials t2
                   where t2.asset_id = fa.asset_id and t2.space_id = p_space_id))
           ))
      ) as recent_changes_count,
      (
        select c.etype
        from (
          select e.event_type::text as etype, e.observed_at as ets
          from public.trial_change_events e
          join public.trials t on t.id = e.trial_id
          where t.asset_id = fa.asset_id
            and t.space_id = p_space_id
            and e.observed_at >= now() - public.recent_change_window()
          union all
          select 'intelligence_published'::text as etype, pi.updated_at as ets
          from public.primary_intelligence pi
          where pi.space_id = p_space_id
            and pi.state = 'published'
            and pi.updated_at >= now() - public.recent_change_window()
            and (
              (pi.entity_type = 'asset' and pi.entity_id = fa.asset_id)
              or (pi.entity_type = 'trial' and pi.entity_id in (
                    select t2.id from public.trials t2
                    where t2.asset_id = fa.asset_id and t2.space_id = p_space_id))
            )
        ) c
        order by c.ets desc
        limit 1
      ) as most_recent_change_type
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
            where t.asset_id = a.id and t.space_id = p_space_id
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
              where t2.asset_id = a.id
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
          'has_recent_activity', coalesce(aa.recent_changes_count, 0) > 0
        ) as asset_obj
      ) as asset_lateral
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$

;

-- get_bullseye_data
CREATE OR REPLACE FUNCTION public.get_bullseye_data(p_space_id uuid, p_indication_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_scope  jsonb;
  v_spokes jsonb;
  v_indication_ids uuid[];
begin
  select jsonb_build_object('id', ind.id, 'name', ind.name, 'abbreviation', ind.abbreviation)
  into v_scope
  from public.indications ind
  where ind.id = p_indication_id and ind.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension',   'indication',
      'scope',       null,
      'ring_order',  jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
      'spokes',      '[]'::jsonb,
      'spoke_label', 'Companies'
    );
  end if;

  select array_agg(id) into v_indication_ids
  from public.indications
  where id = p_indication_id or parent_id = p_indication_id;

  with asset_rollup as (
    select
      a.id           as asset_id,
      a.company_id,
      a.name         as asset_name,
      a.generic_name,
      a.logo_url,
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
    from public.assets a
    join public.asset_indications ai on ai.asset_id = a.id
    where a.space_id = p_space_id
      and ai.indication_id = any(v_indication_ids)
      and ai.development_status is not null
    group by a.id, a.company_id, a.name, a.generic_name, a.logo_url
    having max(case ai.development_status
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) is not null
  ),
  company_rank as (
    select company_id, max(max_rank) as company_max_rank
    from asset_rollup group by company_id
  )
  select coalesce(jsonb_agg(spoke_obj order by cr.company_max_rank desc, c.name), '[]'::jsonb)
  into v_spokes
  from public.companies c
  join company_rank cr on cr.company_id = c.id
  cross join lateral (
    select jsonb_build_object(
      'id', c.id, 'name', c.name, 'display_order', c.display_order,
      'highest_phase_rank', cr.company_max_rank,
      'products', (
        select coalesce(jsonb_agg(asset_obj order by ar.max_rank desc, ar.asset_name), '[]'::jsonb)
        from asset_rollup ar
        cross join lateral (
          select jsonb_build_object(
            'id', ar.asset_id, 'name', ar.asset_name, 'generic_name', ar.generic_name,
            'logo_url', ar.logo_url, 'company_id', ar.company_id, 'company_name', c.name,
            'highest_phase_rank', ar.max_rank,
            'highest_phase', case ar.max_rank
              when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
              when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
            end,
            'moas', coalesce((
              select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.display_order, m.name)
              from public.asset_mechanisms_of_action amoa join public.mechanisms_of_action m on m.id = amoa.moa_id
              where amoa.asset_id = ar.asset_id
            ), '[]'::jsonb),
            'roas', coalesce((
              select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name)
              from public.asset_routes_of_administration aroa join public.routes_of_administration r on r.id = aroa.roa_id
              where aroa.asset_id = ar.asset_id
            ), '[]'::jsonb),
            'trials', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', t.id, 'name', t.name, 'acronym', t.acronym, 'identifier', t.identifier,
                  'status', t.status, 'recruitment_status', t.recruitment_status,
                  'study_type', t.study_type, 'phase', t.phase_type
                ) order by t.display_order, t.name
              ), '[]'::jsonb)
              from public.trials t
              join public.trial_conditions tc on tc.trial_id = t.id
              join public.condition_indication_map cim on cim.condition_id = tc.condition_id
              where t.asset_id = ar.asset_id
                and t.space_id = p_space_id
                and cim.indication_id = any(v_indication_ids)
            ),
            'recent_markers', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', rmm.id, 'event_date', rmm.event_date, 'projection', rmm.projection,
                  'marker_type_name', mt.name, 'shape', mt.shape,
                  'color', mt.color, 'category_name', mc.name
                ) order by rmm.event_date desc
              ), '[]'::jsonb)
              from (
                select mk.id, mk.event_date, mk.marker_type_id, mk.projection
                from public.marker_assignments ma
                join public.markers mk on mk.id = ma.marker_id
                join public.trials t2 on t2.id = ma.trial_id
                join public.trial_conditions tc2 on tc2.trial_id = t2.id
                join public.condition_indication_map cim2 on cim2.condition_id = tc2.condition_id
                where t2.asset_id = ar.asset_id
                  and cim2.indication_id = any(v_indication_ids)
                  and t2.space_id = p_space_id
                  and mk.space_id = p_space_id
                order by mk.event_date desc limit 3
              ) rmm
              join public.marker_types mt on mt.id = rmm.marker_type_id
              left join public.marker_categories mc on mc.id = mt.category_id
            )
          ) as asset_obj
        ) as asset_lateral
        where ar.company_id = c.id
      )
    ) as spoke_obj
  ) as spoke_lateral
  where c.space_id = p_space_id;

  return jsonb_build_object(
    'dimension',   'indication',
    'scope',       v_scope,
    'ring_order',  jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
    'spokes',      coalesce(v_spokes, '[]'::jsonb),
    'spoke_label', 'Companies'
  );
end;
$function$

;

-- get_catalyst_detail
CREATE OR REPLACE FUNCTION public.get_catalyst_detail(p_marker_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_catalyst   jsonb;
  v_trial_id   uuid;
  v_asset_id   uuid;
  v_company_id uuid;
  v_upcoming   jsonb;
  v_related    jsonb;
begin
  select
    jsonb_build_object(
      'marker_id',              m.id,
      'title',                  m.title,
      'event_date',             m.event_date,
      'end_date',               m.end_date,
      'category_name',          mc.name,
      'category_id',            mc.id,
      'marker_type_name',       mt.name,
      'marker_type_color',      mt.color,
      'marker_type_shape',      mt.shape,
      'marker_type_inner_mark', mt.inner_mark,
      'is_projected',           m.is_projected,
      'projection',             m.projection,
      'no_longer_expected',     m.no_longer_expected,
      'company_name',           co.name,
      'company_id',             co.id,
      'company_logo_url',       co.logo_url,
      'asset_name',             pr.name,
      'asset_id',               pr.id,
      'trial_name',             t.name,
      'trial_acronym',          t.acronym,
      'trial_id',               t.id,
      'trial_phase',            t.phase,
      'recruitment_status',     t.recruitment_status,
      'description',            m.description,
      'source_url',             m.source_url,
      'metadata',               m.metadata,
      'ctgov_last_synced_at',   t.ctgov_last_synced_at
    ),
    t.id,
    pr.id,
    co.id
  into v_catalyst, v_trial_id, v_asset_id, v_company_id
  from public.markers m
  join public.marker_types mt on mt.id = m.marker_type_id
  join public.marker_categories mc on mc.id = mt.category_id
  left join lateral (
    select ma_inner.trial_id
    from public.marker_assignments ma_inner
    where ma_inner.marker_id = m.id
    limit 1
  ) ma on true
  left join public.trials t on t.id = ma.trial_id
  left join public.assets pr on pr.id = t.asset_id
  left join public.companies co on co.id = pr.company_id
  where m.id = p_marker_id;

  if v_catalyst is null then
    return null;
  end if;

  if v_trial_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'marker_id',        sub.id,
      'title',            sub.title,
      'event_date',       sub.event_date,
      'marker_type_name', sub.mt_name,
      'is_projected',     sub.is_projected
    )), '[]'::jsonb)
    into v_upcoming
    from (
      select m2.id, m2.title, m2.event_date, mt2.name as mt_name, m2.is_projected
      from public.markers m2
      join public.marker_types mt2 on mt2.id = m2.marker_type_id
      join public.marker_assignments ma2 on ma2.marker_id = m2.id
      where ma2.trial_id = v_trial_id
        and m2.event_date >= current_date
        and m2.id != p_marker_id
        and m2.no_longer_expected = false
      order by m2.event_date asc
      limit 5
    ) sub;
  else
    v_upcoming := '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'event_id',      sub.id,
    'title',         sub.title,
    'event_date',    sub.event_date,
    'category_name', sub.cat_name
  )), '[]'::jsonb)
  into v_related
  from (
    select e.id, e.title, e.event_date, ec.name as cat_name
    from public.events e
    join public.event_categories ec on ec.id = e.category_id
    where (
      (v_trial_id   is not null and e.trial_id   = v_trial_id)
      or (v_asset_id is not null and e.asset_id = v_asset_id)
      or (v_company_id is not null and e.company_id = v_company_id)
    )
    order by e.event_date desc
    limit 10
  ) sub;

  return jsonb_build_object(
    'catalyst',         v_catalyst,
    'upcoming_markers', v_upcoming,
    'related_events',   v_related
  );
end;
$function$

;

-- get_dashboard_data
CREATE OR REPLACE FUNCTION public.get_dashboard_data(p_space_id uuid, p_company_ids uuid[] DEFAULT NULL::uuid[], p_asset_ids uuid[] DEFAULT NULL::uuid[], p_indication_ids uuid[] DEFAULT NULL::uuid[], p_start_year integer DEFAULT NULL::integer, p_end_year integer DEFAULT NULL::integer, p_recruitment_statuses text[] DEFAULT NULL::text[], p_study_types text[] DEFAULT NULL::text[], p_phases text[] DEFAULT NULL::text[], p_mechanism_of_action_ids uuid[] DEFAULT NULL::uuid[], p_route_of_administration_ids uuid[] DEFAULT NULL::uuid[])
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
                      join public.trial_conditions tc on tc.trial_id = t.id
                      join public.condition_indication_map cim on cim.condition_id = tc.condition_id
                      where t.asset_id = a.id
                        and t.space_id = p_space_id
                        and cim.indication_id = ind.id
                        and (p_recruitment_statuses is null or t.recruitment_status = any(p_recruitment_statuses))
                        and (p_study_types is null or t.study_type = any(p_study_types))
                        and (p_phases is null or t.phase_type = any(p_phases))
                      order by t.id
                    ) t
                    left join lateral (
                      with combined as (
                        select e.event_type::text as etype, e.observed_at as ets
                        from public.trial_change_events e
                        where e.trial_id = t.id
                          and e.observed_at >= now() - public.recent_change_window()
                        union all
                        select 'intelligence_published'::text as etype, pi.updated_at as ets
                        from public.primary_intelligence pi
                        where pi.entity_type = 'trial'
                          and pi.entity_id = t.id
                          and pi.space_id = p_space_id
                          and pi.state = 'published'
                          and pi.updated_at >= now() - public.recent_change_window()
                      )
                      select
                        count(*)                                  as recent_changes_count,
                        (array_agg(etype order by ets desc))[1]   as most_recent_change_type
                      from combined
                    ) recent on true
                    cross join lateral (
                      select jsonb_build_object(
                        'id', t.id,
                        'name', t.name,
                        'acronym', t.acronym,
                        'identifier', t.identifier,
                        'status', t.status,
                        'notes', t.notes,
                        'display_order', t.display_order,
                        'asset_id', t.asset_id,
                        'recruitment_status', t.recruitment_status,
                        'study_type', t.study_type,
                        'phase', t.phase,
                        'ctgov_last_synced_at', t.ctgov_last_synced_at,
                        'recent_changes_count', coalesce(recent.recent_changes_count, 0),
                        'most_recent_change_type', recent.most_recent_change_type,
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
                              'end_date',           mk.end_date,
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
                        ), '[]'::jsonb),
                        'trial_notes', coalesce((
                          select jsonb_agg(
                            jsonb_build_object(
                              'id', tn.id, 'content', tn.content,
                              'created_at', tn.created_at, 'updated_at', tn.updated_at
                            )
                            order by tn.created_at
                          )
                          from public.trial_notes tn
                          where tn.trial_id = t.id
                            and tn.space_id = p_space_id
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
$function$

;

-- get_key_catalysts
CREATE OR REPLACE FUNCTION public.get_key_catalysts(p_space_id uuid, p_category_ids uuid[] DEFAULT NULL::uuid[], p_company_id uuid DEFAULT NULL::uuid, p_asset_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  result jsonb;
begin
  if p_category_ids = '{}' then p_category_ids := null; end if;

  select coalesce(jsonb_agg(row_data order by event_date asc, title asc), '[]'::jsonb)
  into result
  from (
    select
      jsonb_build_object(
        'marker_id',        m.id,
        'title',            m.title,
        'event_date',       m.event_date,
        'end_date',         m.end_date,
        'category_name',    mc.name,
        'category_id',      mc.id,
        'marker_type_name', mt.name,
        'marker_type_color', mt.color,
        'marker_type_shape', mt.shape,
        'is_projected',     m.is_projected,
        'company_name',     co.name,
        'company_id',       co.id,
        'asset_name',       a.name,
        'asset_id',         a.id,
        'trial_name',       t.name,
        'trial_acronym',    t.acronym,
        'trial_id',         t.id,
        'trial_phase',      t.phase,
        'description',      m.description,
        'source_url',       m.source_url
      ) as row_data,
      m.event_date,
      m.title
    from public.markers m
    join public.marker_types mt on mt.id = m.marker_type_id
    join public.marker_categories mc on mc.id = mt.category_id
    left join lateral (
      select ma_inner.trial_id
      from public.marker_assignments ma_inner
      where ma_inner.marker_id = m.id
      limit 1
    ) ma on true
    left join public.trials t on t.id = ma.trial_id
    left join public.assets a on a.id = t.asset_id
    left join public.companies co on co.id = a.company_id
    where m.space_id = p_space_id
      and m.event_date >= current_date
      and m.no_longer_expected = false
      and (p_category_ids is null or mc.id = any(p_category_ids))
      and (p_company_id is null or co.id = p_company_id)
      and (p_asset_id is null or a.id = p_asset_id)
  ) sub;

  return result;
end;
$function$

;

-- get_trial_activity
CREATE OR REPLACE FUNCTION public.get_trial_activity(p_trial_id uuid, p_limit integer DEFAULT 25)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_space_id uuid;
begin
  if v_uid is null then return; end if;
  select t.space_id into v_space_id from public.trials t where t.id = p_trial_id;
  if v_space_id is null or not public.has_space_access(v_space_id) then return; end if;

  return query
  select jsonb_build_object(
    'id', ce.id,
    'trial_id', ce.trial_id,
    'space_id', ce.space_id,
    'event_type', ce.event_type,
    'source', ce.source,
    'payload', ce.payload,
    'occurred_at', ce.occurred_at,
    'observed_at', ce.observed_at,
    'trial_name', t.name,
    'trial_acronym', t.acronym,
    'trial_identifier', t.identifier,
    'asset_name', a.name,
    'asset_id', a.id,
    'company_name', co.name,
    'company_id', co.id,
    'company_logo_url', co.logo_url,
    'marker_type', case when ce.marker_id is not null then (
      select jsonb_build_object('id', mt.id, 'name', mt.name,
        'shape', mt.shape, 'fill_style', mt.fill_style, 'color', mt.color,
        'inner_mark', mt.inner_mark, 'category_name', mc.name)
      from public.marker_types mt
      left join public.marker_categories mc on mc.id = mt.category_id
      where mt.id = (select m.marker_type_id from public.markers m where m.id = ce.marker_id)
    ) else null end
  )
  from public.trial_change_events ce
  join public.trials t on t.id = ce.trial_id
  left join public.assets a on a.id = t.asset_id
  left join public.companies co on co.id = a.company_id
  where ce.trial_id = p_trial_id
  order by ce.observed_at desc, ce.id desc
  limit p_limit;
end;
$function$

;

alter table public.marker_types
  drop column icon;
