-- migration: 20260528130000_dashboard_rpcs_emit_trial_acronym
-- purpose:  Surface trials.acronym in the dashboard, bullseye, and
--          landscape RPCs so the client's acronym ?? name fallback
--          stops firing on every row.
-- context: The events feed RPCs were updated in 20260528050000; the
--          dashboard / bullseye family was missed in that sweep.
-- depends on: 20260528003300 (trials.acronym column),
--             20260524120500 (get_dashboard_data: latest indication-grouped body),
--             20260524120600 (get_bullseye_data, get_bullseye_by_company,
--                             get_bullseye_by_moa, get_bullseye_by_roa: latest bodies),
--             20260525120000 (get_bullseye_assets)
-- =============================================================================

-- =============================================================================
-- 1. recreate get_dashboard_data: emit t.acronym alongside t.name
--    canonical body source: 20260524120500_rpcs_dashboard_entity_crud.sql
-- =============================================================================
drop function if exists public.get_dashboard_data(uuid, uuid[], uuid[], uuid[], int, int, text[], text[], text[], uuid[], uuid[]);

create or replace function public.get_dashboard_data(
  p_space_id uuid,
  p_company_ids uuid[] default null,
  p_asset_ids uuid[] default null,
  p_indication_ids uuid[] default null,
  p_start_year int default null,
  p_end_year int default null,
  p_recruitment_statuses text[] default null,
  p_study_types text[] default null,
  p_phases text[] default null,
  p_mechanism_of_action_ids uuid[] default null,
  p_route_of_administration_ids uuid[] default null
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
                      select
                        count(*)                                              as recent_changes_count,
                        (array_agg(event_type order by observed_at desc))[1]  as most_recent_change_type
                      from public.trial_change_events e
                      where e.trial_id = t.id
                        and e.observed_at >= now() - interval '7 days'
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
                                  'icon',          mt.icon,
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
$$;

comment on function public.get_dashboard_data is
  'Returns hierarchical dashboard data (companies > assets > indications > trials) with optional filtering. Trial payload now emits acronym alongside name; the client uses acronym ?? name for the display label. acronym is materialized from CT.gov via _materialize_trial_from_snapshot; see 20260528003300. Uses security invoker so RLS policies apply.';

-- =============================================================================
-- 2. recreate get_bullseye_data: emit t.acronym alongside t.name
--    canonical body source: 20260524120600_rpcs_bullseye_landscape_index.sql
-- =============================================================================
drop function if exists public.get_bullseye_data(uuid, uuid);

create or replace function public.get_bullseye_data(p_space_id uuid, p_indication_id uuid)
returns jsonb
language plpgsql
stable
set search_path to ''
as $$
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
                  'marker_type_name', mt.name, 'icon', mt.icon, 'shape', mt.shape,
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
$$;

comment on function public.get_bullseye_data(uuid, uuid) is
  'Indication-scoped bullseye. Trial payload emits acronym alongside name; the client uses acronym ?? name for the display label. acronym is materialized from CT.gov via _materialize_trial_from_snapshot; see 20260528003300.';

-- =============================================================================
-- 3. recreate get_bullseye_by_company: emit t.acronym alongside t.name
--    canonical body source: 20260524120600_rpcs_bullseye_landscape_index.sql
-- =============================================================================
create or replace function public.get_bullseye_by_company(p_space_id uuid, p_company_id uuid)
returns jsonb
language plpgsql
stable
set search_path to ''
as $$
declare
  v_scope  jsonb;
  v_spokes jsonb;
begin
  select jsonb_build_object('id', c.id, 'name', c.name, 'abbreviation', null)
  into v_scope
  from public.companies c where c.id = p_company_id and c.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension', 'company', 'scope', null,
      'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
      'spokes', '[]'::jsonb, 'spoke_label', 'Indications'
    );
  end if;

  with asset_rollup as (
    select
      a.id as asset_id, a.name as asset_name, a.generic_name, a.logo_url, a.company_id,
      ai.indication_id,
      case ai.development_status
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end as phase_rank
    from public.assets a
    join public.asset_indications ai on ai.asset_id = a.id
    where a.company_id = p_company_id and a.space_id = p_space_id
      and ai.development_status is not null
  ),
  indication_rank as (
    select indication_id, max(phase_rank) as ind_max_rank
    from asset_rollup group by indication_id
  )
  select coalesce(jsonb_agg(spoke_obj order by ir.ind_max_rank desc, ind.name), '[]'::jsonb)
  into v_spokes
  from public.indications ind
  join indication_rank ir on ir.indication_id = ind.id
  cross join lateral (
    select jsonb_build_object(
      'id', ind.id, 'name', ind.name, 'display_order', ind.display_order,
      'highest_phase_rank', ir.ind_max_rank,
      'products', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'id', ar.asset_id, 'name', ar.asset_name, 'generic_name', ar.generic_name,
            'logo_url', ar.logo_url, 'company_id', ar.company_id,
            'company_name', (select cc.name from public.companies cc where cc.id = ar.company_id),
            'highest_phase_rank', ar.phase_rank,
            'highest_phase', case ar.phase_rank
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
              select coalesce(jsonb_agg(jsonb_build_object(
                'id', t.id, 'name', t.name, 'acronym', t.acronym, 'identifier', t.identifier,
                'status', t.status, 'recruitment_status', t.recruitment_status,
                'study_type', t.study_type, 'phase', t.phase_type
              ) order by t.display_order, t.name), '[]'::jsonb)
              from public.trials t
              join public.trial_conditions tc on tc.trial_id = t.id
              join public.condition_indication_map cim on cim.condition_id = tc.condition_id
              where t.asset_id = ar.asset_id and t.space_id = p_space_id
                and cim.indication_id = ind.id
            ),
            'recent_markers', '[]'::jsonb
          ) order by ar.phase_rank desc, ar.asset_name
        ), '[]'::jsonb)
        from asset_rollup ar where ar.indication_id = ind.id
      )
    ) as spoke_obj
  ) as spoke_lateral
  where ind.space_id = p_space_id;

  return jsonb_build_object(
    'dimension', 'company', 'scope', v_scope,
    'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
    'spokes', coalesce(v_spokes, '[]'::jsonb), 'spoke_label', 'Indications'
  );
end;
$$;

comment on function public.get_bullseye_by_company(uuid, uuid) is
  'Company-scoped bullseye with indication spokes. Trial payload emits acronym alongside name; the client uses acronym ?? name for the display label. acronym is materialized from CT.gov via _materialize_trial_from_snapshot; see 20260528003300.';

-- =============================================================================
-- 4. recreate get_bullseye_by_moa: emit t.acronym alongside t.name
--    canonical body source: 20260524120600_rpcs_bullseye_landscape_index.sql
--    (the older 20260412120300 body references dropped tables, so use the
--    indication-model rewrite instead.)
-- =============================================================================
create or replace function public.get_bullseye_by_moa(p_space_id uuid, p_moa_id uuid)
returns jsonb
language plpgsql
stable
set search_path to ''
as $$
declare
  v_scope  jsonb;
  v_spokes jsonb;
begin
  select jsonb_build_object('id', m.id, 'name', m.name, 'abbreviation', m.abbreviation)
  into v_scope
  from public.mechanisms_of_action m where m.id = p_moa_id and m.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension', 'moa', 'scope', null,
      'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
      'spokes', '[]'::jsonb, 'spoke_label', 'Companies'
    );
  end if;

  with asset_rollup as (
    select
      a.id as asset_id, a.company_id, a.name as asset_name, a.generic_name, a.logo_url,
      max(case ai.development_status
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) as max_rank
    from public.assets a
    join public.asset_mechanisms_of_action amoa on amoa.asset_id = a.id and amoa.moa_id = p_moa_id
    left join public.asset_indications ai on ai.asset_id = a.id
    where a.space_id = p_space_id
    group by a.id, a.company_id, a.name, a.generic_name, a.logo_url
    having max(case ai.development_status
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) is not null
  ),
  company_rank as (
    select company_id, max(max_rank) as company_max_rank from asset_rollup group by company_id
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
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', ar.asset_id, 'name', ar.asset_name, 'generic_name', ar.generic_name,
          'logo_url', ar.logo_url, 'company_id', ar.company_id, 'company_name', c.name,
          'highest_phase_rank', ar.max_rank,
          'highest_phase', case ar.max_rank
            when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
            when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN' end,
          'moas', '[]'::jsonb, 'roas', '[]'::jsonb,
          'trials', '[]'::jsonb, 'recent_markers', '[]'::jsonb
        ) order by ar.max_rank desc, ar.asset_name), '[]'::jsonb)
        from asset_rollup ar where ar.company_id = c.id
      )
    ) as spoke_obj
  ) as spoke_lateral
  where c.space_id = p_space_id;

  return jsonb_build_object(
    'dimension', 'moa', 'scope', v_scope,
    'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
    'spokes', coalesce(v_spokes, '[]'::jsonb), 'spoke_label', 'Companies'
  );
end;
$$;

comment on function public.get_bullseye_by_moa(uuid, uuid) is
  'MOA-scoped bullseye. Asset payload emits an empty trials array (intentional, see 20260524120600). Acronym surfacing is therefore a no-op for this RPC today, but the comment is added for consistency: when trials are eventually attached here they will carry acronym alongside name per 20260528003300.';

-- =============================================================================
-- 5. recreate get_bullseye_by_roa: emit t.acronym alongside t.name
--    canonical body source: 20260524120600_rpcs_bullseye_landscape_index.sql
--    (the older 20260412120400 body references dropped tables, so use the
--    indication-model rewrite instead.)
-- =============================================================================
create or replace function public.get_bullseye_by_roa(p_space_id uuid, p_roa_id uuid)
returns jsonb
language plpgsql
stable
set search_path to ''
as $$
declare
  v_scope  jsonb;
  v_spokes jsonb;
begin
  select jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation)
  into v_scope
  from public.routes_of_administration r where r.id = p_roa_id and r.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension', 'roa', 'scope', null,
      'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
      'spokes', '[]'::jsonb, 'spoke_label', 'Companies'
    );
  end if;

  with asset_rollup as (
    select
      a.id as asset_id, a.company_id, a.name as asset_name, a.generic_name, a.logo_url,
      max(case ai.development_status
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) as max_rank
    from public.assets a
    join public.asset_routes_of_administration aroa on aroa.asset_id = a.id and aroa.roa_id = p_roa_id
    left join public.asset_indications ai on ai.asset_id = a.id
    where a.space_id = p_space_id
    group by a.id, a.company_id, a.name, a.generic_name, a.logo_url
    having max(case ai.development_status
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) is not null
  ),
  company_rank as (
    select company_id, max(max_rank) as company_max_rank from asset_rollup group by company_id
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
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', ar.asset_id, 'name', ar.asset_name, 'generic_name', ar.generic_name,
          'logo_url', ar.logo_url, 'company_id', ar.company_id, 'company_name', c.name,
          'highest_phase_rank', ar.max_rank,
          'highest_phase', case ar.max_rank
            when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
            when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN' end,
          'moas', '[]'::jsonb, 'roas', '[]'::jsonb,
          'trials', '[]'::jsonb, 'recent_markers', '[]'::jsonb
        ) order by ar.max_rank desc, ar.asset_name), '[]'::jsonb)
        from asset_rollup ar where ar.company_id = c.id
      )
    ) as spoke_obj
  ) as spoke_lateral
  where c.space_id = p_space_id;

  return jsonb_build_object(
    'dimension', 'roa', 'scope', v_scope,
    'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
    'spokes', coalesce(v_spokes, '[]'::jsonb), 'spoke_label', 'Companies'
  );
end;
$$;

comment on function public.get_bullseye_by_roa(uuid, uuid) is
  'ROA-scoped bullseye. Asset payload emits an empty trials array (intentional, see 20260524120600). Acronym surfacing is therefore a no-op for this RPC today, but the comment is added for consistency: when trials are eventually attached here they will carry acronym alongside name per 20260528003300.';

-- =============================================================================
-- 6. recreate get_bullseye_assets: emit t.acronym alongside t.name
--    canonical body source: 20260525120000_create_bullseye_assets_rpc.sql
-- =============================================================================
create or replace function public.get_bullseye_assets(
  p_space_id       uuid,
  p_indication_ids uuid[]  default null,
  p_company_ids    uuid[]  default null,
  p_moa_ids        uuid[]  default null,
  p_roa_ids        uuid[]  default null,
  p_phases         text[]  default null,
  p_asset_ids      uuid[]  default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
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

  -- Step 5: compute recent activity per asset (markers in last 30 days)
  asset_activity as (
    select
      fa.asset_id,
      (select mk.event_date
       from public.marker_assignments ma
       join public.markers mk on mk.id = ma.marker_id
       join public.trials t on t.id = ma.trial_id
       where t.asset_id = fa.asset_id
         and t.space_id = p_space_id
         and mk.space_id = p_space_id
       order by mk.event_date desc
       limit 1
      ) as latest_event_date,
      (select mt.name
       from public.marker_assignments ma
       join public.markers mk on mk.id = ma.marker_id
       join public.marker_types mt on mt.id = mk.marker_type_id
       join public.trials t on t.id = ma.trial_id
       where t.asset_id = fa.asset_id
         and t.space_id = p_space_id
         and mk.space_id = p_space_id
       order by mk.event_date desc
       limit 1
      ) as latest_event_type
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
                     mt.name as marker_type_name, mt.icon, mt.shape, mt.color,
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
                'icon', mk_sub.icon,
                'shape', mk_sub.shape,
                'color', mk_sub.color,
                'category_name', mk_sub.category_name
              ) as marker_obj
            ) mk_lateral
          ), '[]'::jsonb),
          'intelligence_count', coalesce(ai_cnt.intelligence_count, 0),
          'has_recent_activity', coalesce(aa.latest_event_date >= (current_date - interval '30 days'), false),
          'latest_event_date', aa.latest_event_date,
          'latest_event_type', aa.latest_event_type
        ) as asset_obj
      ) as asset_lateral
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.get_bullseye_assets(uuid, uuid[], uuid[], uuid[], uuid[], text[], uuid[]) is
  'Returns a flat list of assets matching multi-select scope filters across '
  'all dimensions (indications, companies, MOAs, ROAs, phases, assets). Each '
  'asset includes full dimension metadata, intelligence count, recent markers, '
  'and activity indicators. Used by the decoupled scope/grouping bullseye chart. '
  'Trial payload emits acronym alongside name; the client uses acronym ?? name '
  'for the display label. acronym is materialized from CT.gov via '
  '_materialize_trial_from_snapshot; see 20260528003300.';

-- =============================================================================
-- smoke tests: every recreated RPC emits trials.acronym at the right path
-- =============================================================================
do $$
declare
  v_agency_id     uuid := 'eeeeeeee-0001-0001-0001-eeeeeeeeee01';
  v_tenant_id     uuid := 'eeeeeeee-0002-0002-0002-eeeeeeeeee02';
  v_owner_id      uuid := 'eeeeeeee-0003-0003-0003-eeeeeeeeee03';
  v_space_id      uuid := 'eeeeeeee-0004-0004-0004-eeeeeeeeee04';
  v_company_id    uuid := 'eeeeeeee-0005-0005-0005-eeeeeeeeee05';
  v_asset_id      uuid := 'eeeeeeee-0006-0006-0006-eeeeeeeeee06';
  v_trial_a_id    uuid := 'eeeeeeee-0007-0007-0007-eeeeeeeeee07';
  v_trial_b_id    uuid := 'eeeeeeee-0008-0008-0008-eeeeeeeeee08';
  v_indication_id uuid := 'eeeeeeee-0009-0009-0009-eeeeeeeeee09';
  v_moa_id        uuid := 'eeeeeeee-000a-000a-000a-eeeeeeeeee0a';
  v_roa_id        uuid := 'eeeeeeee-000b-000b-000b-eeeeeeeeee0b';
  v_condition_id  uuid := 'eeeeeeee-000c-000c-000c-eeeeeeeeee0c';
  v_acronym       text := 'SURMOUNT-1';
  v_brief_title   text := 'A Very Long Brief Title Describing An Obesity Drug Study In Detail';
  v_result        jsonb;
  v_trial_a       jsonb;
  v_trial_b       jsonb;
begin
  -- bootstrap fixture
  insert into auth.users (id, email) values
    (v_owner_id, 'dashboard-acronym-owner@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'DA Smoke', 'da-smoke', 'dasmoke', 'DA', 'da@y.z');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'DA', 'da-smoke-t', 'dasmoket', 'DA');

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant_id, v_owner_id, 'owner');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_owner_id);

  insert into public.space_members (space_id, user_id, role)
    values (v_space_id, v_owner_id, 'owner');

  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_owner_id, 'DA Pharma');

  insert into public.assets (id, space_id, created_by, company_id, name)
    values (v_asset_id, v_space_id, v_owner_id, v_company_id, 'WonderAsset');

  insert into public.indications (id, space_id, created_by, name, abbreviation)
    values (v_indication_id, v_space_id, v_owner_id, 'Obesity', 'OBES');

  insert into public.asset_indications (asset_id, indication_id, space_id, development_status, created_by)
    values (v_asset_id, v_indication_id, v_space_id, 'P3', v_owner_id);

  insert into public.mechanisms_of_action (id, space_id, created_by, name)
    values (v_moa_id, v_space_id, v_owner_id, 'DA MOA');

  insert into public.asset_mechanisms_of_action (asset_id, moa_id)
    values (v_asset_id, v_moa_id);

  insert into public.routes_of_administration (id, space_id, created_by, name, abbreviation)
    values (v_roa_id, v_space_id, v_owner_id, 'Subcutaneous', 'SC');

  insert into public.asset_routes_of_administration (asset_id, roa_id)
    values (v_asset_id, v_roa_id);

  insert into public.conditions (id, space_id, name, source)
    values (v_condition_id, v_space_id, 'Obesity', 'analyst');

  insert into public.condition_indication_map (condition_id, indication_id)
    values (v_condition_id, v_indication_id);

  -- trial A: has acronym + briefTitle in name
  insert into public.trials (id, space_id, created_by, asset_id, name, acronym, identifier, phase_type)
    values (v_trial_a_id, v_space_id, v_owner_id, v_asset_id, v_brief_title, v_acronym, 'NCT-DA-001', 'P3');

  -- trial B: briefTitle in name, no acronym (fallback path)
  insert into public.trials (id, space_id, created_by, asset_id, name, acronym, identifier, phase_type)
    values (v_trial_b_id, v_space_id, v_owner_id, v_asset_id, 'Long Title No Acronym Trial', null, 'NCT-DA-002', 'P3');

  -- link both trials to the indication via condition
  insert into public.trial_conditions (trial_id, condition_id) values
    (v_trial_a_id, v_condition_id),
    (v_trial_b_id, v_condition_id);

  -- =========================================================================
  -- 1. get_dashboard_data: companies > assets > indications > trials
  -- =========================================================================
  v_result := public.get_dashboard_data(v_space_id);

  v_trial_a := jsonb_path_query_first(
    v_result,
    '$[*].assets[*].indications[*].trials[*] ? (@.id == $tid)',
    jsonb_build_object('tid', v_trial_a_id)
  );
  v_trial_b := jsonb_path_query_first(
    v_result,
    '$[*].assets[*].indications[*].trials[*] ? (@.id == $tid)',
    jsonb_build_object('tid', v_trial_b_id)
  );

  if v_trial_a is null then
    raise exception 'dashboard acronym smoke FAIL get_dashboard_data: trial A node missing in output';
  end if;
  if v_trial_b is null then
    raise exception 'dashboard acronym smoke FAIL get_dashboard_data: trial B node missing in output';
  end if;
  if not (v_trial_a ? 'acronym') then
    raise exception 'dashboard acronym smoke FAIL get_dashboard_data: acronym key missing on trial A';
  end if;
  if v_trial_a ->> 'acronym' is distinct from v_acronym then
    raise exception 'dashboard acronym smoke FAIL get_dashboard_data: expected acronym=%, got %',
      v_acronym, v_trial_a ->> 'acronym';
  end if;
  if not (v_trial_b ? 'acronym') then
    raise exception 'dashboard acronym smoke FAIL get_dashboard_data: acronym key missing on trial B';
  end if;
  if jsonb_typeof(v_trial_b -> 'acronym') <> 'null' then
    raise exception 'dashboard acronym smoke FAIL get_dashboard_data: expected null acronym on trial B, got type %',
      jsonb_typeof(v_trial_b -> 'acronym');
  end if;
  raise notice 'dashboard acronym smoke ok: get_dashboard_data emits acronym (set + null paths)';

  -- =========================================================================
  -- 2. get_bullseye_data: indication-scoped, spokes > products > trials
  -- =========================================================================
  v_result := public.get_bullseye_data(v_space_id, v_indication_id);

  v_trial_a := jsonb_path_query_first(
    v_result,
    '$.spokes[*].products[*].trials[*] ? (@.id == $tid)',
    jsonb_build_object('tid', v_trial_a_id)
  );
  v_trial_b := jsonb_path_query_first(
    v_result,
    '$.spokes[*].products[*].trials[*] ? (@.id == $tid)',
    jsonb_build_object('tid', v_trial_b_id)
  );

  if v_trial_a is null then
    raise exception 'dashboard acronym smoke FAIL get_bullseye_data: trial A node missing in output';
  end if;
  if v_trial_b is null then
    raise exception 'dashboard acronym smoke FAIL get_bullseye_data: trial B node missing in output';
  end if;
  if v_trial_a ->> 'acronym' is distinct from v_acronym then
    raise exception 'dashboard acronym smoke FAIL get_bullseye_data: expected acronym=%, got %',
      v_acronym, v_trial_a ->> 'acronym';
  end if;
  if not (v_trial_b ? 'acronym') then
    raise exception 'dashboard acronym smoke FAIL get_bullseye_data: acronym key missing on trial B';
  end if;
  if jsonb_typeof(v_trial_b -> 'acronym') <> 'null' then
    raise exception 'dashboard acronym smoke FAIL get_bullseye_data: expected null acronym on trial B, got type %',
      jsonb_typeof(v_trial_b -> 'acronym');
  end if;
  raise notice 'dashboard acronym smoke ok: get_bullseye_data emits acronym (set + null paths)';

  -- =========================================================================
  -- 3. get_bullseye_by_company: company-scoped, spokes (indications) > products > trials
  -- =========================================================================
  v_result := public.get_bullseye_by_company(v_space_id, v_company_id);

  v_trial_a := jsonb_path_query_first(
    v_result,
    '$.spokes[*].products[*].trials[*] ? (@.id == $tid)',
    jsonb_build_object('tid', v_trial_a_id)
  );

  if v_trial_a is null then
    raise exception 'dashboard acronym smoke FAIL get_bullseye_by_company: trial A node missing in output';
  end if;
  if v_trial_a ->> 'acronym' is distinct from v_acronym then
    raise exception 'dashboard acronym smoke FAIL get_bullseye_by_company: expected acronym=%, got %',
      v_acronym, v_trial_a ->> 'acronym';
  end if;
  raise notice 'dashboard acronym smoke ok: get_bullseye_by_company emits acronym';

  -- =========================================================================
  -- 4. get_bullseye_by_moa: trials array is intentionally empty in current body
  --    (see 20260524120600), so we assert only that the rpc runs without error
  --    and returns the dimension/scope envelope.
  -- =========================================================================
  v_result := public.get_bullseye_by_moa(v_space_id, v_moa_id);
  if v_result is null or v_result ->> 'dimension' <> 'moa' then
    raise exception 'dashboard acronym smoke FAIL get_bullseye_by_moa: expected dimension=moa, got %',
      v_result ->> 'dimension';
  end if;
  raise notice 'dashboard acronym smoke ok: get_bullseye_by_moa returns envelope (no trials in payload by design)';

  -- =========================================================================
  -- 5. get_bullseye_by_roa: trials array is intentionally empty in current body
  --    (see 20260524120600), so we assert only that the rpc runs without error
  --    and returns the dimension/scope envelope.
  -- =========================================================================
  v_result := public.get_bullseye_by_roa(v_space_id, v_roa_id);
  if v_result is null or v_result ->> 'dimension' <> 'roa' then
    raise exception 'dashboard acronym smoke FAIL get_bullseye_by_roa: expected dimension=roa, got %',
      v_result ->> 'dimension';
  end if;
  raise notice 'dashboard acronym smoke ok: get_bullseye_by_roa returns envelope (no trials in payload by design)';

  -- =========================================================================
  -- 6. get_bullseye_assets: assets[] > trials[]
  -- =========================================================================
  v_result := public.get_bullseye_assets(v_space_id, p_asset_ids := array[v_asset_id]);

  v_trial_a := jsonb_path_query_first(
    v_result,
    '$.assets[*].trials[*] ? (@.id == $tid)',
    jsonb_build_object('tid', v_trial_a_id)
  );
  v_trial_b := jsonb_path_query_first(
    v_result,
    '$.assets[*].trials[*] ? (@.id == $tid)',
    jsonb_build_object('tid', v_trial_b_id)
  );

  if v_trial_a is null then
    raise exception 'dashboard acronym smoke FAIL get_bullseye_assets: trial A node missing in output';
  end if;
  if v_trial_b is null then
    raise exception 'dashboard acronym smoke FAIL get_bullseye_assets: trial B node missing in output';
  end if;
  if v_trial_a ->> 'acronym' is distinct from v_acronym then
    raise exception 'dashboard acronym smoke FAIL get_bullseye_assets: expected acronym=%, got %',
      v_acronym, v_trial_a ->> 'acronym';
  end if;
  if not (v_trial_b ? 'acronym') then
    raise exception 'dashboard acronym smoke FAIL get_bullseye_assets: acronym key missing on trial B';
  end if;
  if jsonb_typeof(v_trial_b -> 'acronym') <> 'null' then
    raise exception 'dashboard acronym smoke FAIL get_bullseye_assets: expected null acronym on trial B, got type %',
      jsonb_typeof(v_trial_b -> 'acronym');
  end if;
  raise notice 'dashboard acronym smoke ok: get_bullseye_assets emits acronym (set + null paths)';

  -- =========================================================================
  -- cleanup. Mirrors the feed-rpc smoke (20260528050000): set member_guard
  -- cascade GUC, delete children in reverse-dependency order, then parents.
  -- Most child rows cascade from the tenant delete via FK ON DELETE CASCADE.
  -- =========================================================================
  perform set_config('clint.member_guard_cascade', 'on', true);

  delete from public.space_members where space_id = v_space_id;
  delete from public.tenant_members where tenant_id = v_tenant_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_owner_id;

  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'dashboard_rpcs_emit_trial_acronym smoke ok';
end$$;
