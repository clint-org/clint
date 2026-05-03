-- migration: 20260502120900_dashboard_data_change_counts
-- purpose: extend get_dashboard_data per-trial output with two keys derived
--          from trial_change_events: recent_changes_count (last 7 days) and
--          most_recent_change_type. these power the trial-row badges on
--          both the bullseye and landscape views; consolidating onto the
--          dashboard rpc keeps a single source of truth.
-- affected functions:
--   public.get_dashboard_data  -- adds recent_changes_count and
--                                 most_recent_change_type to trial jsonb
-- canonical body source: 20260415190000_unified_landscape_data_layer.sql.

-- =============================================================================
-- 1. drop and recreate get_dashboard_data with the same parameter list and
--    body, plus a left join lateral that aggregates recent change events.
-- =============================================================================

drop function if exists public.get_dashboard_data(uuid, uuid[], uuid[], uuid[], int, int, text[], text[], text[], uuid[], uuid[]);

create or replace function public.get_dashboard_data(
  p_space_id uuid,
  p_company_ids uuid[] default null,
  p_product_ids uuid[] default null,
  p_therapeutic_area_ids uuid[] default null,
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
      'products', coalesce((
        select jsonb_agg(product_obj order by p.display_order)
        from public.products p
        cross join lateral (
          select jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'generic_name', p.generic_name,
            'logo_url', p.logo_url,
            'display_order', p.display_order,
            'mechanisms_of_action', coalesce((
              select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.display_order, m.name)
              from public.product_mechanisms_of_action pm
              join public.mechanisms_of_action m on m.id = pm.moa_id
              where pm.product_id = p.id
            ), '[]'::jsonb),
            'routes_of_administration', coalesce((
              select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name)
              from public.product_routes_of_administration pr
              join public.routes_of_administration r on r.id = pr.roa_id
              where pr.product_id = p.id
            ), '[]'::jsonb),
            'trials', coalesce((
              select jsonb_agg(trial_obj order by t.display_order)
              from public.trials t
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
                  'identifier', t.identifier,
                  'sample_size', t.sample_size,
                  'status', t.status,
                  'notes', t.notes,
                  'display_order', t.display_order,
                  'product_id', t.product_id,
                  'therapeutic_area_id', t.therapeutic_area_id,
                  'recruitment_status', t.recruitment_status,
                  'study_type', t.study_type,
                  'phase', t.phase,
                  'intervention_type', t.intervention_type,
                  'intervention_name', t.intervention_name,
                  'lead_sponsor', t.lead_sponsor,
                  'study_countries', t.study_countries,
                  'fda_designations', t.fda_designations,
                  'has_dmc', t.has_dmc,
                  'start_date', t.start_date,
                  'primary_completion_date', t.primary_completion_date,
                  'ctgov_last_synced_at', t.ctgov_last_synced_at,
                  'recent_changes_count', coalesce(recent.recent_changes_count, 0),
                  'most_recent_change_type', recent.most_recent_change_type,
                  'therapeutic_area', (
                    select jsonb_build_object('id', ta.id, 'name', ta.name, 'abbreviation', ta.abbreviation)
                    from public.therapeutic_areas ta where ta.id = t.therapeutic_area_id
                  ),
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
                        'id',                 m.id,
                        'title',              m.title,
                        'projection',         m.projection,
                        'event_date',         m.event_date,
                        'end_date',           m.end_date,
                        'description',        m.description,
                        'source_url',         m.source_url,
                        'metadata',           m.metadata,
                        'is_projected',       m.is_projected,
                        'no_longer_expected', m.no_longer_expected,
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
                          where mt.id = m.marker_type_id
                        )
                      )
                      order by m.event_date
                    )
                    from public.marker_assignments ma
                    join public.markers m on m.id = ma.marker_id
                    where ma.trial_id = t.id
                      and m.space_id = p_space_id
                      and (p_start_year is null or extract(year from m.event_date) >= p_start_year)
                      and (p_end_year   is null or extract(year from m.event_date) <= p_end_year)
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
              where t.product_id = p.id
                and t.space_id = p_space_id
                and (p_therapeutic_area_ids is null or t.therapeutic_area_id = any(p_therapeutic_area_ids))
                and (p_recruitment_statuses is null or t.recruitment_status = any(p_recruitment_statuses))
                and (p_study_types is null or t.study_type = any(p_study_types))
                and (p_phases is null or t.phase_type = any(p_phases))
            ), '[]'::jsonb)
          ) as product_obj
        ) as product_lateral
        where p.company_id = c.id
          and p.space_id = p_space_id
          and (p_product_ids is null or p.id = any(p_product_ids))
          and (
            p_mechanism_of_action_ids is null
            or exists (
              select 1 from public.product_mechanisms_of_action pm2
              where pm2.product_id = p.id
                and pm2.moa_id = any(p_mechanism_of_action_ids)
            )
          )
          and (
            p_route_of_administration_ids is null
            or exists (
              select 1 from public.product_routes_of_administration pr2
              where pr2.product_id = p.id
                and pr2.roa_id = any(p_route_of_administration_ids)
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

comment on function public.get_dashboard_data is 'Returns hierarchical dashboard data (companies > products > trials) with optional filtering by company, product, therapeutic area, and date range. Uses security invoker so rls policies apply.';

-- =============================================================================
-- smoke tests: bootstrap a hermetic fixture, exercise the new keys, and tear
-- down. seed.sql runs after migrations so the smoke must build its own
-- agency / tenant / space / company / product / TA / trial(s) and emit
-- trial_change_events directly. nested jsonb is unwrapped via chained ->.
--
do $$
declare
  v_agency_id      uuid := '99999991-9999-9999-9999-999999999991';
  v_tenant_id      uuid := '99999992-9999-9999-9999-999999999992';
  v_user_id        uuid := '99999993-9999-9999-9999-999999999993';
  v_space_id       uuid := '99999994-9999-9999-9999-999999999994';
  v_company_id     uuid := '99999995-9999-9999-9999-999999999995';
  v_product_id     uuid := '99999996-9999-9999-9999-999999999996';
  v_ta_id          uuid := '99999997-9999-9999-9999-999999999997';
  v_trial_a_id     uuid := '99999998-9999-9999-9999-999999999998';
  v_trial_b_id     uuid := '99999999-9999-9999-9999-999999999999';
  v_dashboard      jsonb;
  v_trial_a        jsonb;
  v_trial_b        jsonb;
  v_count_a        int;
  v_type_a         text;
  v_count_b        int;
  v_type_b         text;
begin
  -- bootstrap fixture.
  insert into auth.users (id, email)
    values (v_user_id, 'dashboard-change-counts-smoke@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'DCC Smoke', 'dcc-smoke', 'dccsmoke', 'DCC', 'dcc@y.z');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'DCC', 'dcc-smoke-t', 'dccsmoket', 'DCC');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_user_id);

  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_user_id, 'DCC Smoke Co');

  insert into public.products (id, space_id, created_by, company_id, name)
    values (v_product_id, v_space_id, v_user_id, v_company_id, 'DCC Smoke Drug');

  insert into public.therapeutic_areas (id, space_id, created_by, name)
    values (v_ta_id, v_space_id, v_user_id, 'DCC Smoke TA');

  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier)
    values
      (v_trial_a_id, v_space_id, v_user_id, v_product_id, v_ta_id, 'DCC_TRIAL_A', 'NCT-DCC-A'),
      (v_trial_b_id, v_space_id, v_user_id, v_product_id, v_ta_id, 'DCC_TRIAL_B', 'NCT-DCC-B');

  -- emit 3 recent events (within 7-day window) plus 1 old event (14 days
  -- back, must be excluded). vary event_type so we can assert most-recent.
  -- observed_at is what the rpc keys off; occurred_at is required not null
  -- but otherwise irrelevant for this test.
  insert into public.trial_change_events (
    trial_id, space_id, event_type, source, payload, occurred_at, observed_at
  ) values
    (v_trial_a_id, v_space_id, 'status_changed', 'ctgov',
     '{}'::jsonb,
     now() - interval '3 days', now() - interval '3 days'),
    (v_trial_a_id, v_space_id, 'phase_transitioned', 'ctgov',
     '{}'::jsonb,
     now() - interval '2 days', now() - interval '2 days'),
    (v_trial_a_id, v_space_id, 'date_moved', 'analyst',
     '{}'::jsonb,
     now() - interval '1 day', now() - interval '1 day'),
    (v_trial_a_id, v_space_id, 'status_changed', 'ctgov',
     '{}'::jsonb,
     now() - interval '14 days', now() - interval '14 days');

  -- run the rpc once and unwrap companies -> products -> trials.
  v_dashboard := public.get_dashboard_data(v_space_id);

  v_trial_a := jsonb_path_query_first(
    v_dashboard,
    '$[*].products[*].trials[*] ? (@.id == $tid)',
    jsonb_build_object('tid', v_trial_a_id)
  );
  v_trial_b := jsonb_path_query_first(
    v_dashboard,
    '$[*].products[*].trials[*] ? (@.id == $tid)',
    jsonb_build_object('tid', v_trial_b_id)
  );

  if v_trial_a is null then
    raise exception 'dashboard change counts smoke FAIL: trial A node missing in rpc output';
  end if;
  if v_trial_b is null then
    raise exception 'dashboard change counts smoke FAIL: trial B node missing in rpc output';
  end if;

  -- --- test 1: trial A has 3 recent events; the 14-day-old event is excluded.
  v_count_a := (v_trial_a ->> 'recent_changes_count')::int;
  if v_count_a <> 3 then
    raise exception 'dashboard change counts smoke FAIL test 1: expected recent_changes_count=3 for trial A, got %', v_count_a;
  end if;
  raise notice 'dashboard change counts smoke ok 1: trial A recent_changes_count=3 (old event excluded)';

  -- --- test 2: trial A's most_recent_change_type is the 1-day-old event.
  v_type_a := v_trial_a ->> 'most_recent_change_type';
  if v_type_a is distinct from 'date_moved' then
    raise exception 'dashboard change counts smoke FAIL test 2: expected most_recent_change_type=date_moved for trial A, got %', v_type_a;
  end if;
  raise notice 'dashboard change counts smoke ok 2: trial A most_recent_change_type=date_moved';

  -- --- test 3: trial B has no events; count=0, type is null.
  v_count_b := (v_trial_b ->> 'recent_changes_count')::int;
  if v_count_b <> 0 then
    raise exception 'dashboard change counts smoke FAIL test 3: expected recent_changes_count=0 for trial B, got %', v_count_b;
  end if;
  v_type_b := v_trial_b ->> 'most_recent_change_type';
  if v_type_b is not null then
    raise exception 'dashboard change counts smoke FAIL test 3: expected most_recent_change_type=null for trial B, got %', v_type_b;
  end if;
  raise notice 'dashboard change counts smoke ok 3: trial B recent_changes_count=0, most_recent_change_type=null';

  -- cleanup: tear down fixture in reverse-dependency order. delete events
  -- first, then trials and the rest cascade through tenant + agency.
  -- (no markers were inserted here so the BEFORE DELETE marker trigger
  -- hazard from task 1.8 does not apply, but we follow the same shape.)
  delete from public.trial_change_events where space_id = v_space_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;

  raise notice 'dashboard change counts smoke test: PASS';
end$$;
