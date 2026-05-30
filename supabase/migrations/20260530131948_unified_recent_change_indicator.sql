-- migration: 20260530131948_unified_recent_change_indicator
-- purpose:  One definition of "recent change" across the product: a 14-day
--           window over trial_change_events PLUS published primary_intelligence
--           notes, computed server-side. Replaces the old split (7-day trial
--           dot from trial_change_events vs 30-day bullseye flag from marker
--           dates). Adds recent_change_window() as the single source of truth
--           for the window, rewires get_dashboard_data and get_bullseye_assets.
-- spec: docs/superpowers/specs/2026-05-29-unified-recent-change-indicator-design.md
-- depends on: 20260528130000 (latest get_dashboard_data / get_bullseye_assets bodies)
-- =============================================================================

-- 1. single source of truth for the recency window
create or replace function public.recent_change_window()
  returns interval
  language sql
  immutable
  set search_path = ''
as $$ select interval '14 days' $$;

comment on function public.recent_change_window() is
  'Single source of truth for the "recent change" window used by the change-feed '
  'dot across dashboard, catalysts, and bullseye. See '
  '2026-05-29-unified-recent-change-indicator-design.md.';

do $$
begin
  if public.recent_change_window() <> interval '14 days' then
    raise exception 'recent_change_window smoke FAIL: expected 14 days, got %',
      public.recent_change_window();
  end if;
  raise notice 'recent_change_window smoke ok';
end$$;

-- =============================================================================
-- 2. recreate get_dashboard_data: unified window + published trial intel
--    canonical body source: 20260528130000_dashboard_rpcs_emit_trial_acronym.sql
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
-- 3. recreate get_bullseye_assets: asset activity = rollup of trial change
--    events + published intel (asset-level and its trials'), 14-day window.
--    canonical body source: 20260528130000_dashboard_rpcs_emit_trial_acronym.sql
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
          'recent_changes_count', coalesce(aa.recent_changes_count, 0),
          'most_recent_change_type', aa.most_recent_change_type,
          'has_recent_activity', coalesce(aa.recent_changes_count, 0) > 0
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
  'and a unified recent-change count (14-day window over trial change events plus published intel; see 2026-05-29-unified-recent-change-indicator-design.md). Used by the decoupled scope/grouping bullseye chart. '
  'Trial payload emits acronym alongside name; the client uses acronym ?? name '
  'for the display label. acronym is materialized from CT.gov via '
  '_materialize_trial_from_snapshot; see 20260528003300.';

-- =============================================================================
-- smoke: unified recent-change window + asset rollup
-- =============================================================================
do $$
declare
  v_agency_id     uuid := 'dddddddd-0001-0001-0001-dddddddddd01';
  v_tenant_id     uuid := 'dddddddd-0002-0002-0002-dddddddddd02';
  v_owner_id      uuid := 'dddddddd-0003-0003-0003-dddddddddd03';
  v_space_id      uuid := 'dddddddd-0004-0004-0004-dddddddddd04';
  v_company_id    uuid := 'dddddddd-0005-0005-0005-dddddddddd05';
  v_asset_id      uuid := 'dddddddd-0006-0006-0006-dddddddddd06';
  v_trial_a_id    uuid := 'dddddddd-0007-0007-0007-dddddddddd07';
  v_trial_b_id    uuid := 'dddddddd-0008-0008-0008-dddddddddd08';
  v_indication_id uuid := 'dddddddd-0009-0009-0009-dddddddddd09';
  v_condition_id  uuid := 'dddddddd-000c-000c-000c-dddddddddd0c';
  v_result        jsonb;
  v_trial_a       jsonb;
  v_trial_b       jsonb;
  v_asset         jsonb;
begin
  insert into auth.users (id, email) values (v_owner_id, 'recent-window-owner@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'RW Smoke', 'rw-smoke', 'rwsmoke', 'RW', 'rw@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'RW', 'rw-smoke-t', 'rwsmoket', 'RW');
  insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant_id, v_owner_id, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by) values (v_space_id, v_tenant_id, 'Primary', v_owner_id);
  insert into public.space_members (space_id, user_id, role) values (v_space_id, v_owner_id, 'owner');
  insert into public.companies (id, space_id, created_by, name) values (v_company_id, v_space_id, v_owner_id, 'RW Pharma');
  insert into public.assets (id, space_id, created_by, company_id, name)
    values (v_asset_id, v_space_id, v_owner_id, v_company_id, 'RW Asset');
  insert into public.indications (id, space_id, created_by, name, abbreviation)
    values (v_indication_id, v_space_id, v_owner_id, 'Obesity', 'OBES');
  -- asset_indications with a development_status is required for the asset to
  -- appear in get_bullseye_assets (asset_phase / filtered_assets).
  insert into public.asset_indications (asset_id, indication_id, space_id, development_status, created_by)
    values (v_asset_id, v_indication_id, v_space_id, 'P3', v_owner_id);
  insert into public.conditions (id, space_id, name, source) values (v_condition_id, v_space_id, 'Obesity', 'analyst');
  insert into public.condition_indication_map (condition_id, indication_id) values (v_condition_id, v_indication_id);
  insert into public.trials (id, space_id, created_by, asset_id, name, phase_type)
    values (v_trial_a_id, v_space_id, v_owner_id, v_asset_id, 'Trial A', 'P3'),
           (v_trial_b_id, v_space_id, v_owner_id, v_asset_id, 'Trial B', 'P3');
  insert into public.trial_conditions (trial_id, condition_id) values
    (v_trial_a_id, v_condition_id), (v_trial_b_id, v_condition_id);

  -- trial A: one change event INSIDE the window (13 days) and one OUTSIDE (15 days)
  insert into public.trial_change_events (trial_id, space_id, event_type, source, payload, occurred_at, observed_at) values
    (v_trial_a_id, v_space_id, 'date_moved', 'ctgov', '{}'::jsonb, now() - interval '13 days', now() - interval '13 days'),
    (v_trial_a_id, v_space_id, 'date_moved', 'ctgov', '{}'::jsonb, now() - interval '15 days', now() - interval '15 days');

  -- published asset-level intel (counts) and a draft asset-level note (excluded)
  insert into public.primary_intelligence (space_id, entity_type, entity_id, state, headline, last_edited_by) values
    (v_space_id, 'asset', v_asset_id, 'published', 'Asset read', v_owner_id),
    (v_space_id, 'asset', v_asset_id, 'draft',     'WIP',        v_owner_id);
  -- published trial-level intel on trial B (counts toward trial B and the asset)
  insert into public.primary_intelligence (space_id, entity_type, entity_id, state, headline, last_edited_by) values
    (v_space_id, 'trial', v_trial_b_id, 'published', 'Trial read', v_owner_id);

  -- ---- dashboard: trial-level counts ----
  v_result := public.get_dashboard_data(v_space_id);
  v_trial_a := jsonb_path_query_first(v_result,
    '$[*].assets[*].indications[*].trials[*] ? (@.id == $tid)', jsonb_build_object('tid', v_trial_a_id));
  v_trial_b := jsonb_path_query_first(v_result,
    '$[*].assets[*].indications[*].trials[*] ? (@.id == $tid)', jsonb_build_object('tid', v_trial_b_id));

  if (v_trial_a ->> 'recent_changes_count')::int <> 1 then
    raise exception 'unified smoke FAIL dashboard trial A: expected 1 (13d event; 15d excluded), got %',
      v_trial_a ->> 'recent_changes_count';
  end if;
  if (v_trial_b ->> 'recent_changes_count')::int <> 1 then
    raise exception 'unified smoke FAIL dashboard trial B: expected 1 (published trial intel), got %',
      v_trial_b ->> 'recent_changes_count';
  end if;
  if v_trial_b ->> 'most_recent_change_type' <> 'intelligence_published' then
    raise exception 'unified smoke FAIL dashboard trial B: expected most_recent_change_type=intelligence_published, got %',
      v_trial_b ->> 'most_recent_change_type';
  end if;

  -- ---- bullseye: asset rollup ----
  v_result := public.get_bullseye_assets(v_space_id, p_asset_ids := array[v_asset_id]);
  v_asset := jsonb_path_query_first(v_result,
    '$.assets[*] ? (@.id == $aid)', jsonb_build_object('aid', v_asset_id));

  if v_asset is null then
    raise exception 'unified smoke FAIL bullseye: asset node missing';
  end if;
  -- 1 trial event (13d) + asset published intel (1) + trial B published intel (1) = 3; draft + 15d excluded.
  if (v_asset ->> 'recent_changes_count')::int <> 3 then
    raise exception 'unified smoke FAIL bullseye asset rollup: expected 3, got %',
      v_asset ->> 'recent_changes_count';
  end if;
  if (v_asset ->> 'has_recent_activity')::boolean is not true then
    raise exception 'unified smoke FAIL bullseye asset: expected has_recent_activity true';
  end if;
  if v_asset ? 'latest_event_date' or v_asset ? 'latest_event_type' then
    raise exception 'unified smoke FAIL bullseye asset: legacy marker activity fields should be gone';
  end if;
  raise notice 'unified recent-change smoke ok';

  -- cleanup (mirrors 20260528130000)
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.space_members where space_id = v_space_id;
  delete from public.tenant_members where tenant_id = v_tenant_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_owner_id;
  perform set_config('clint.member_guard_cascade', 'off', true);
end$$;
