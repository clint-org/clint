-- migration: 20260626120100_dashboard_data_ctgov_withdrawn
-- purpose: surface trials.ctgov_withdrawn_at in the dashboard payload so the
--   timeline can render a muted treatment for trials removed from ct.gov (HTTP
--   404 on full pull). The column was added in 20260625200000_ctgov_withdrawn_trials
--   and stamped by mark_trials_ctgov_withdrawn; the dashboard RPC did not yet emit
--   it. ct.gov-owned, null for live trials.
--
-- change: redefine get_dashboard_data from its CURRENT live body (pulled via
--   pg_get_functiondef, not an old repo copy, to avoid reverting newer logic such
--   as the primary_intelligence-aware recent-change rollup and
--   most_recent_change_event_id) and add exactly one trial-level key,
--   'ctgov_withdrawn_at', next to 'ctgov_last_synced_at'. Same signature, so
--   create or replace is sufficient; no notify pgrst needed.
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
                        select 'intelligence_published'::text as etype, pi.updated_at as ets, null::uuid as eid
                        from public.primary_intelligence pi
                        where pi.entity_type = 'trial'
                          and pi.entity_id = t.id
                          and pi.space_id = p_space_id
                          and pi.state = 'published'
                          and pi.updated_at >= now() - public.recent_change_window()
                      )
                      select
                        count(*)                                  as recent_changes_count,
                        (array_agg(etype order by ets desc))[1]   as most_recent_change_type,
                        (array_agg(eid order by ets desc))[1]     as most_recent_change_event_id
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
                        'ctgov_withdrawn_at', t.ctgov_withdrawn_at,
                        'recent_changes_count', coalesce(recent.recent_changes_count, 0),
                        'most_recent_change_type', recent.most_recent_change_type,
                        'most_recent_change_event_id', recent.most_recent_change_event_id,
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
$function$;

comment on function public.get_dashboard_data(uuid, uuid[], uuid[], uuid[], integer, integer, text[], text[], text[], uuid[], uuid[]) is
  'Returns hierarchical dashboard data (companies > assets > indications > trials) with optional filtering. Trial payload now emits acronym alongside name; the client uses acronym ?? name for the display label. acronym is materialized from CT.gov via _materialize_trial_from_snapshot; see 20260528003300. Trial payload also emits most_recent_change_event_id (the trial_change_events.id behind the recent-change dot; null when the most-recent change is an intel note) for feed deep-linking. Trial payload also emits ctgov_withdrawn_at (null for live trials; set when ct.gov 404s the NCT) so the timeline can render a muted treatment for trials removed from CT.gov; see 20260625200000.';

-- =============================================================================
-- smoke test: get_dashboard_data emits a non-null ctgov_withdrawn_at for a
-- withdrawn trial at companies > assets > indications > trials. Direct call is
-- viable here: get_dashboard_data is STABLE security-invoker with no in-body
-- space-access gate, and this DO block runs as the migration owner (RLS does not
-- apply), so the function reads the seeded graph directly. UUID set is distinct
-- from the 20260625200000 (99999bb*) and 20260626120000 (7e57*) smokes.
-- =============================================================================
do $$
declare
  v_agency_id     uuid := 'd5b00000-d5b0-d5b0-d5b0-d5b000000001';
  v_tenant_id     uuid := 'd5b00000-d5b0-d5b0-d5b0-d5b000000002';
  v_owner_id      uuid := 'd5b00000-d5b0-d5b0-d5b0-d5b000000003';
  v_space_id      uuid := 'd5b00000-d5b0-d5b0-d5b0-d5b000000004';
  v_company_id    uuid := 'd5b00000-d5b0-d5b0-d5b0-d5b000000005';
  v_asset_id      uuid := 'd5b00000-d5b0-d5b0-d5b0-d5b000000006';
  v_indication_id uuid := 'd5b00000-d5b0-d5b0-d5b0-d5b000000007';
  v_condition_id  uuid := 'd5b00000-d5b0-d5b0-d5b0-d5b000000008';
  v_trial_id      uuid := 'd5b00000-d5b0-d5b0-d5b0-d5b000000009';
  v_withdrawn_at  timestamptz := '2026-06-20 12:00:00+00';
  v_result        jsonb;
  v_trial         jsonb;
begin
  insert into auth.users (id, email) values
    (v_owner_id, 'dashboard-withdrawn-owner@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'DW Smoke', 'dw-smoke', 'dwsmoke', 'DW', 'dw@y.z');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'DW', 'dw-smoke-t', 'dwsmoket', 'DW');

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant_id, v_owner_id, 'owner');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_owner_id);

  insert into public.space_members (space_id, user_id, role)
    values (v_space_id, v_owner_id, 'owner');

  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_owner_id, 'DW Pharma');

  insert into public.assets (id, space_id, created_by, company_id, name)
    values (v_asset_id, v_space_id, v_owner_id, v_company_id, 'DW Asset');

  insert into public.indications (id, space_id, created_by, name, abbreviation)
    values (v_indication_id, v_space_id, v_owner_id, 'Obesity', 'OBES');

  insert into public.asset_indications (asset_id, indication_id, space_id, development_status, created_by)
    values (v_asset_id, v_indication_id, v_space_id, 'P3', v_owner_id);

  insert into public.conditions (id, space_id, name, source)
    values (v_condition_id, v_space_id, 'Obesity', 'analyst');

  insert into public.condition_indication_map (condition_id, indication_id)
    values (v_condition_id, v_indication_id);

  -- withdrawn trial: asset_id auto-derives the trial_assets row via trigger;
  -- the condition links it to the indication.
  insert into public.trials (id, space_id, created_by, asset_id, name, identifier, phase_type, ctgov_withdrawn_at)
    values (v_trial_id, v_space_id, v_owner_id, v_asset_id, 'WITHDRAWN_DASH_TRIAL', 'NCT-DW-001', 'P3', v_withdrawn_at);

  insert into public.trial_conditions (trial_id, condition_id)
    values (v_trial_id, v_condition_id);

  v_result := public.get_dashboard_data(v_space_id);

  v_trial := jsonb_path_query_first(
    v_result,
    '$[*].assets[*].indications[*].trials[*] ? (@.id == $tid)',
    jsonb_build_object('tid', v_trial_id)
  );

  if v_trial is null then
    raise exception 'dashboard ctgov_withdrawn smoke FAIL: trial node missing in get_dashboard_data output';
  end if;
  if not (v_trial ? 'ctgov_withdrawn_at') then
    raise exception 'dashboard ctgov_withdrawn smoke FAIL: ctgov_withdrawn_at key missing on trial';
  end if;
  if jsonb_typeof(v_trial -> 'ctgov_withdrawn_at') = 'null' then
    raise exception 'dashboard ctgov_withdrawn smoke FAIL: ctgov_withdrawn_at is null, expected a timestamp';
  end if;
  if (v_trial ->> 'ctgov_withdrawn_at')::timestamptz is distinct from v_withdrawn_at then
    raise exception 'dashboard ctgov_withdrawn smoke FAIL: expected ctgov_withdrawn_at=%, got %',
      v_withdrawn_at, v_trial ->> 'ctgov_withdrawn_at';
  end if;

  -- cleanup. Set member_guard cascade GUC, then delete parents (children cascade
  -- via FK ON DELETE CASCADE), mirroring the 20260528130000 dashboard smoke.
  perform set_config('clint.member_guard_cascade', 'on', true);

  delete from public.space_members where space_id = v_space_id;
  delete from public.tenant_members where tenant_id = v_tenant_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_owner_id;

  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'dashboard_data_ctgov_withdrawn smoke test: PASS';
end$$;
