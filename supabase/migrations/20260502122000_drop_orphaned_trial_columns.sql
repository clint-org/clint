-- migration: 20260502122000_drop_orphaned_trial_columns
-- purpose: drop orphaned ct.gov columns from public.trials (per spec). data
--   remains accessible via trial_ctgov_snapshots.payload and the per-space
--   field visibility renderer. also rebuilds get_dashboard_data and the two
--   palette rpcs (search_palette, palette_empty_state) without the dropped
--   keys, since their plpgsql bodies referenced t.conditions[1] and the
--   per-trial jsonb projection had several keys backed by dropped columns.
-- destructive: irreversible without restore. phase 7 of the trial change
--   feed cleanup; runs after phases 1-6 ship.

-- =============================================================================
-- 1. drop the 33 orphaned ct.gov columns plus sample_size.
-- =============================================================================

alter table public.trials
  drop column if exists lead_sponsor,
  drop column if exists sponsor_type,
  drop column if exists collaborators,
  drop column if exists study_countries,
  drop column if exists study_regions,
  drop column if exists design_allocation,
  drop column if exists design_intervention_model,
  drop column if exists design_masking,
  drop column if exists design_primary_purpose,
  drop column if exists enrollment_type,
  drop column if exists conditions,
  drop column if exists intervention_type,
  drop column if exists intervention_name,
  drop column if exists primary_outcome_measures,
  drop column if exists secondary_outcome_measures,
  drop column if exists is_rare_disease,
  drop column if exists eligibility_sex,
  drop column if exists eligibility_min_age,
  drop column if exists eligibility_max_age,
  drop column if exists accepts_healthy_volunteers,
  drop column if exists eligibility_criteria,
  drop column if exists sampling_method,
  drop column if exists start_date,
  drop column if exists start_date_type,
  drop column if exists primary_completion_date,
  drop column if exists primary_completion_date_type,
  drop column if exists study_completion_date,
  drop column if exists study_completion_date_type,
  drop column if exists first_posted_date,
  drop column if exists results_first_posted_date,
  drop column if exists has_dmc,
  drop column if exists is_fda_regulated_drug,
  drop column if exists is_fda_regulated_device,
  drop column if exists fda_designations,
  drop column if exists submission_type,
  drop column if exists sample_size;

-- =============================================================================
-- 2. drop and recreate get_dashboard_data with the dropped keys removed from
--    the per-trial jsonb_build_object. canonical body is the phase 1.10
--    migration (20260502120900_dashboard_data_change_counts.sql); only the
--    dropped keys are removed -- everything else is verbatim.
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
                  'status', t.status,
                  'notes', t.notes,
                  'display_order', t.display_order,
                  'product_id', t.product_id,
                  'therapeutic_area_id', t.therapeutic_area_id,
                  'recruitment_status', t.recruitment_status,
                  'study_type', t.study_type,
                  'phase', t.phase,
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
-- 3. rebuild palette rpcs whose plpgsql bodies reference t.conditions[1].
--    plpgsql bodies are not tracked in pg_depend, so the column drop above
--    succeeds silently but every call from the ui would fail at runtime.
--    canonical bodies are 20260501120100_palette_rpc_functions.sql
--    (search_palette) and 20260501130000_palette_empty_state_enrich.sql
--    (palette_empty_state); only the conditions[1] line is removed.
-- =============================================================================

create or replace function public.search_palette (
  p_space_id uuid,
  p_query    text,
  p_kind     text default null,
  p_limit    int  default 25
) returns table (
  kind        text,
  id          uuid,
  name        text,
  secondary   text,
  score       real,
  pinned      boolean,
  recent_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_q   text := lower(coalesce(trim(p_query), ''));
begin
  if v_uid is null then return; end if;
  if not public.has_space_access(p_space_id) then return; end if;
  if length(v_q) < 2 then return; end if;

  return query
  with matches as (
    -- companies
    select 'company'::text as kind,
           c.id,
           c.name::text as name,
           ((select count(*) from public.products pc
             where pc.company_id = c.id and pc.space_id = p_space_id)::text || ' products') as secondary,
           similarity(c.name, v_q)
             + case when c.name ilike v_q || '%' then 0.3 else 0 end as score
    from public.companies c
    where c.space_id = p_space_id
      and (p_kind is null or p_kind = 'company')
      and c.name % v_q

    union all
    -- products
    select 'product'::text,
           p.id,
           p.name::text,
           concat_ws(' · ',
             (select co.name::text from public.companies co where co.id = p.company_id),
             nullif(p.generic_name, '')
           ) as secondary,
           greatest(similarity(p.name, v_q), similarity(coalesce(p.generic_name,''), v_q))
             + case when p.name ilike v_q || '%' or coalesce(p.generic_name,'') ilike v_q || '%' then 0.3 else 0 end as score
    from public.products p
    where p.space_id = p_space_id
      and (p_kind is null or p_kind = 'product')
      and (p.name % v_q or coalesce(p.generic_name,'') % v_q)

    union all
    -- trials (search name + identifier, with identifier exact match boost).
    -- conditions[1] segment removed in 20260502122000; the field lives in
    -- the snapshot payload and is not currently surfaced in palette rows.
    select 'trial'::text,
           t.id,
           t.name::text,
           concat_ws(' · ',
             nullif('Ph' || coalesce(t.phase, ''), 'Ph'),
             (select co.name::text from public.companies co
                join public.products pp on pp.company_id = co.id
                where pp.id = t.product_id),
             t.identifier
           ) as secondary,
           greatest(similarity(t.name, v_q), similarity(coalesce(t.identifier,''), v_q))
             + case when t.name ilike v_q || '%' then 0.3 else 0 end
             + case when upper(coalesce(t.identifier,'')) = upper(v_q) then 0.5 else 0 end as score
    from public.trials t
    where t.space_id = p_space_id
      and (p_kind is null or p_kind = 'trial')
      and (t.name % v_q or coalesce(t.identifier,'') % v_q)

    union all
    -- catalysts (= markers with optional linked trial)
    select 'catalyst'::text,
           m.id,
           m.title,
           concat_ws(' · ',
             to_char(m.event_date, 'YYYY-MM-DD'),
             (select mc.name from public.marker_types mt
                join public.marker_categories mc on mc.id = mt.category_id
                where mt.id = m.marker_type_id),
             (select t2.name::text from public.trials t2
                join public.marker_assignments ma on ma.trial_id = t2.id
                where ma.marker_id = m.id limit 1)
           ) as secondary,
           similarity(m.title, v_q)
             + case when m.title ilike v_q || '%' then 0.3 else 0 end as score
    from public.markers m
    where m.space_id = p_space_id
      and (p_kind is null or p_kind = 'catalyst')
      and m.title % v_q

    union all
    -- events
    select 'event'::text,
           e.id,
           e.title,
           concat_ws(' · ',
             to_char(e.event_date, 'YYYY-MM-DD'),
             (select ec.name from public.event_categories ec where ec.id = e.category_id),
             (select cc.name::text from public.companies cc where cc.id = e.company_id)
           ) as secondary,
           similarity(e.title, v_q)
             + case when e.title ilike v_q || '%' then 0.3 else 0 end as score
    from public.events e
    where e.space_id = p_space_id
      and (p_kind is null or p_kind = 'event')
      and e.title % v_q
  )
  select m.kind,
         m.id,
         m.name,
         m.secondary,
         m.score::real,
         (pp.user_id is not null) as pinned,
         pr.last_opened_at as recent_at
  from matches m
  left join public.palette_pinned pp
    on pp.user_id = v_uid and pp.space_id = p_space_id and pp.kind = m.kind and pp.entity_id = m.id
  left join public.palette_recents pr
    on pr.user_id = v_uid and pr.space_id = p_space_id and pr.kind = m.kind and pr.entity_id = m.id
  order by pinned desc,
           score desc,
           recent_at desc nulls last,
           m.name asc
  limit p_limit;
end;
$$;

grant execute on function public.search_palette(uuid, text, text, int) to authenticated;

create or replace function public.palette_empty_state (
  p_space_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_pinned jsonb;
  v_recents jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('pinned','[]'::jsonb,'recents','[]'::jsonb);
  end if;
  if not public.has_space_access(p_space_id) then
    return jsonb_build_object('pinned','[]'::jsonb,'recents','[]'::jsonb);
  end if;

  -- ============================================================
  -- pinned: enriched rows (top 10 by position)
  -- ============================================================
  with pinned_raw as (
    select kind, entity_id, position
    from public.palette_pinned
    where user_id = v_uid and space_id = p_space_id
    order by position asc
    limit 10
  ),
  pinned_enriched as (
    -- companies
    select pr.kind, pr.entity_id as id,
           c.name::text as name,
           ((select count(*) from public.products pc
             where pc.company_id = c.id and pc.space_id = p_space_id)::text || ' products') as secondary,
           pr.position
    from pinned_raw pr
    join public.companies c on c.id = pr.entity_id
    where pr.kind = 'company' and c.space_id = p_space_id

    union all
    -- products
    select pr.kind, pr.entity_id, p.name::text,
           concat_ws(' · ',
             (select co.name::text from public.companies co where co.id = p.company_id),
             nullif(p.generic_name, '')
           ) as secondary,
           pr.position
    from pinned_raw pr
    join public.products p on p.id = pr.entity_id
    where pr.kind = 'product' and p.space_id = p_space_id

    union all
    -- trials. conditions[1] segment removed in 20260502122000 along with
    -- the column itself; the field lives in the snapshot payload and is
    -- not currently surfaced in palette rows.
    select pr.kind, pr.entity_id, t.name::text,
           concat_ws(' · ',
             nullif('Ph' || coalesce(t.phase, ''), 'Ph'),
             (select co.name::text from public.companies co
                join public.products pp on pp.company_id = co.id
                where pp.id = t.product_id),
             t.identifier
           ) as secondary,
           pr.position
    from pinned_raw pr
    join public.trials t on t.id = pr.entity_id
    where pr.kind = 'trial' and t.space_id = p_space_id

    union all
    -- catalysts (markers)
    select pr.kind, pr.entity_id, m.title,
           concat_ws(' · ',
             to_char(m.event_date, 'YYYY-MM-DD'),
             (select mc.name from public.marker_types mt
                join public.marker_categories mc on mc.id = mt.category_id
                where mt.id = m.marker_type_id),
             (select t2.name::text from public.trials t2
                join public.marker_assignments ma on ma.trial_id = t2.id
                where ma.marker_id = m.id limit 1)
           ) as secondary,
           pr.position
    from pinned_raw pr
    join public.markers m on m.id = pr.entity_id
    where pr.kind = 'catalyst' and m.space_id = p_space_id

    union all
    -- events
    select pr.kind, pr.entity_id, e.title,
           concat_ws(' · ',
             to_char(e.event_date, 'YYYY-MM-DD'),
             (select ec.name from public.event_categories ec where ec.id = e.category_id),
             (select cc.name::text from public.companies cc where cc.id = e.company_id)
           ) as secondary,
           pr.position
    from pinned_raw pr
    join public.events e on e.id = pr.entity_id
    where pr.kind = 'event' and e.space_id = p_space_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'kind',      kind,
        'id',        id,
        'name',      name,
        'secondary', secondary,
        'score',     0,
        'pinned',    true,
        'recentAt',  null
      ) order by position asc
    ),
    '[]'::jsonb
  ) into v_pinned
  from pinned_enriched;

  -- ============================================================
  -- recents: enriched rows (top 8 by last_opened_at desc)
  -- ============================================================
  with recents_raw as (
    select kind, entity_id, last_opened_at
    from public.palette_recents
    where user_id = v_uid and space_id = p_space_id
    order by last_opened_at desc
    limit 8
  ),
  recents_enriched as (
    select rr.kind, rr.entity_id as id, c.name::text as name,
           ((select count(*) from public.products pc
             where pc.company_id = c.id and pc.space_id = p_space_id)::text || ' products') as secondary,
           rr.last_opened_at
    from recents_raw rr
    join public.companies c on c.id = rr.entity_id
    where rr.kind = 'company' and c.space_id = p_space_id

    union all
    select rr.kind, rr.entity_id, p.name::text,
           concat_ws(' · ',
             (select co.name::text from public.companies co where co.id = p.company_id),
             nullif(p.generic_name, '')
           ) as secondary,
           rr.last_opened_at
    from recents_raw rr
    join public.products p on p.id = rr.entity_id
    where rr.kind = 'product' and p.space_id = p_space_id

    union all
    -- trials. conditions[1] segment removed in 20260502122000.
    select rr.kind, rr.entity_id, t.name::text,
           concat_ws(' · ',
             nullif('Ph' || coalesce(t.phase, ''), 'Ph'),
             (select co.name::text from public.companies co
                join public.products pp on pp.company_id = co.id
                where pp.id = t.product_id),
             t.identifier
           ) as secondary,
           rr.last_opened_at
    from recents_raw rr
    join public.trials t on t.id = rr.entity_id
    where rr.kind = 'trial' and t.space_id = p_space_id

    union all
    select rr.kind, rr.entity_id, m.title,
           concat_ws(' · ',
             to_char(m.event_date, 'YYYY-MM-DD'),
             (select mc.name from public.marker_types mt
                join public.marker_categories mc on mc.id = mt.category_id
                where mt.id = m.marker_type_id),
             (select t2.name::text from public.trials t2
                join public.marker_assignments ma on ma.trial_id = t2.id
                where ma.marker_id = m.id limit 1)
           ) as secondary,
           rr.last_opened_at
    from recents_raw rr
    join public.markers m on m.id = rr.entity_id
    where rr.kind = 'catalyst' and m.space_id = p_space_id

    union all
    select rr.kind, rr.entity_id, e.title,
           concat_ws(' · ',
             to_char(e.event_date, 'YYYY-MM-DD'),
             (select ec.name from public.event_categories ec where ec.id = e.category_id),
             (select cc.name::text from public.companies cc where cc.id = e.company_id)
           ) as secondary,
           rr.last_opened_at
    from recents_raw rr
    join public.events e on e.id = rr.entity_id
    where rr.kind = 'event' and e.space_id = p_space_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'kind',      kind,
        'id',        id,
        'name',      name,
        'secondary', secondary,
        'score',     0,
        'pinned',    false,
        'recentAt',  last_opened_at
      ) order by last_opened_at desc
    ),
    '[]'::jsonb
  ) into v_recents
  from recents_enriched;

  return jsonb_build_object('pinned', v_pinned, 'recents', v_recents);
end;
$$;

grant execute on function public.palette_empty_state(uuid) to authenticated;

-- =============================================================================
-- smoke tests:
--   1. confirm none of the dropped columns exist on public.trials.
--   2. confirm get_dashboard_data still returns valid jsonb when called with
--      all-null filters against a hermetic fixture.
-- =============================================================================

do $$
declare
  v_dropped text[] := array[
    'lead_sponsor','sponsor_type','collaborators',
    'study_countries','study_regions',
    'design_allocation','design_intervention_model','design_masking',
    'design_primary_purpose','enrollment_type',
    'conditions','intervention_type','intervention_name',
    'primary_outcome_measures','secondary_outcome_measures','is_rare_disease',
    'eligibility_sex','eligibility_min_age','eligibility_max_age',
    'accepts_healthy_volunteers','eligibility_criteria','sampling_method',
    'start_date','start_date_type',
    'primary_completion_date','primary_completion_date_type',
    'study_completion_date','study_completion_date_type',
    'first_posted_date','results_first_posted_date',
    'has_dmc','is_fda_regulated_drug','is_fda_regulated_device',
    'fda_designations','submission_type',
    'sample_size'
  ];
  v_still_present text;
  v_agency_id  uuid := '88888881-8888-8888-8888-888888888881';
  v_tenant_id  uuid := '88888882-8888-8888-8888-888888888882';
  v_user_id    uuid := '88888883-8888-8888-8888-888888888883';
  v_space_id   uuid := '88888884-8888-8888-8888-888888888884';
  v_company_id uuid := '88888885-8888-8888-8888-888888888885';
  v_product_id uuid := '88888886-8888-8888-8888-888888888886';
  v_ta_id      uuid := '88888887-8888-8888-8888-888888888887';
  v_trial_id   uuid := '88888888-8888-8888-8888-888888888888';
  v_dashboard  jsonb;
begin
  -- --- test 1: every dropped column is gone from public.trials.
  select column_name into v_still_present
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'trials'
    and column_name = any(v_dropped)
  limit 1;

  if v_still_present is not null then
    raise exception 'orphaned trial columns cleanup smoke FAIL test 1: column % still exists on public.trials', v_still_present;
  end if;
  raise notice 'orphaned trial columns cleanup smoke ok 1: all 36 dropped columns absent from public.trials';

  -- --- test 2: get_dashboard_data returns a valid jsonb array against a
  --              hermetic fixture (all-null filters).
  insert into auth.users (id, email)
    values (v_user_id, 'drop-orphans-smoke@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'Drop Orphans Smoke', 'drop-orphans-smoke', 'droporphanssmoke', 'DOS', 'dos@y.z');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'DOS', 'dos-smoke-t', 'dossmoket', 'DOS');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_user_id);

  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_user_id, 'DOS Co');

  insert into public.products (id, space_id, created_by, company_id, name)
    values (v_product_id, v_space_id, v_user_id, v_company_id, 'DOS Drug');

  insert into public.therapeutic_areas (id, space_id, created_by, name)
    values (v_ta_id, v_space_id, v_user_id, 'DOS TA');

  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier)
    values (v_trial_id, v_space_id, v_user_id, v_product_id, v_ta_id, 'DOS_TRIAL', 'NCT-DOS-1');

  v_dashboard := public.get_dashboard_data(v_space_id);

  if v_dashboard is null or jsonb_typeof(v_dashboard) <> 'array' then
    raise exception 'orphaned trial columns cleanup smoke FAIL test 2: get_dashboard_data did not return a jsonb array, got %', jsonb_typeof(v_dashboard);
  end if;

  if jsonb_array_length(v_dashboard) <> 1 then
    raise exception 'orphaned trial columns cleanup smoke FAIL test 2: expected 1 company in dashboard output, got %', jsonb_array_length(v_dashboard);
  end if;
  raise notice 'orphaned trial columns cleanup smoke ok 2: get_dashboard_data returned valid jsonb array';

  -- cleanup: tenant + agency cascades take care of dependent rows.
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;

  raise notice 'orphaned trial columns cleanup smoke test: PASS';
end$$;
