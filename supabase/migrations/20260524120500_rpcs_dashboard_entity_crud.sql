-- migration: 20260524120500_rpcs_dashboard_entity_crud
-- purpose: rewrite get_dashboard_data with indication grouping, rename all RPCs
--          from products/product_id to assets/asset_id, update entity_type
--          references from 'product' to 'asset'.
-- affected functions: get_dashboard_data, search_palette, palette_empty_state,
--   preview_company_delete, preview_asset_delete (was preview_product_delete),
--   get_events_page_data, get_activity_feed, get_trial_activity,
--   get_space_landing_stats, build_intelligence_payload

-- =============================================================================
-- 1. get_dashboard_data: full rewrite with indication grouping
-- =============================================================================
-- hierarchy changes from companies > products > trials
-- to companies > assets > indications > trials

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
  'Returns hierarchical dashboard data (companies > assets > indications > trials) with optional filtering. Uses security invoker so RLS policies apply.';

-- =============================================================================
-- 2. search_palette: rename products -> assets
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
    select 'company'::text as kind,
           c.id,
           c.name::text as name,
           ((select count(*) from public.assets ac
             where ac.company_id = c.id and ac.space_id = p_space_id)::text || ' assets') as secondary,
           similarity(c.name, v_q)
             + case when c.name ilike v_q || '%' then 0.3 else 0 end as score
    from public.companies c
    where c.space_id = p_space_id
      and (p_kind is null or p_kind = 'company')
      and c.name % v_q

    union all
    select 'asset'::text,
           a.id,
           a.name::text,
           concat_ws(' · ',
             (select co.name::text from public.companies co where co.id = a.company_id),
             nullif(a.generic_name, '')
           ) as secondary,
           greatest(similarity(a.name, v_q), similarity(coalesce(a.generic_name,''), v_q))
             + case when a.name ilike v_q || '%' or coalesce(a.generic_name,'') ilike v_q || '%' then 0.3 else 0 end as score
    from public.assets a
    where a.space_id = p_space_id
      and (p_kind is null or p_kind = 'asset')
      and (a.name % v_q or coalesce(a.generic_name,'') % v_q)

    union all
    select 'trial'::text,
           t.id,
           t.name::text,
           concat_ws(' · ',
             nullif('Ph' || coalesce(t.phase, ''), 'Ph'),
             (select co.name::text from public.companies co
                join public.assets aa on aa.company_id = co.id
                where aa.id = t.asset_id),
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

-- =============================================================================
-- 3. palette_empty_state: rename products -> assets
-- =============================================================================

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

  with pinned_raw as (
    select kind, entity_id, position
    from public.palette_pinned
    where user_id = v_uid and space_id = p_space_id
    order by position asc
    limit 10
  ),
  pinned_enriched as (
    select pr.kind, pr.entity_id as id,
           c.name::text as name,
           ((select count(*) from public.assets ac
             where ac.company_id = c.id and ac.space_id = p_space_id)::text || ' assets') as secondary,
           pr.position
    from pinned_raw pr
    join public.companies c on c.id = pr.entity_id
    where pr.kind = 'company' and c.space_id = p_space_id

    union all
    select pr.kind, pr.entity_id, a.name::text,
           concat_ws(' · ',
             (select co.name::text from public.companies co where co.id = a.company_id),
             nullif(a.generic_name, '')
           ) as secondary,
           pr.position
    from pinned_raw pr
    join public.assets a on a.id = pr.entity_id
    where pr.kind = 'asset' and a.space_id = p_space_id

    union all
    select pr.kind, pr.entity_id, t.name::text,
           concat_ws(' · ',
             nullif('Ph' || coalesce(t.phase, ''), 'Ph'),
             (select co.name::text from public.companies co
                join public.assets aa on aa.company_id = co.id
                where aa.id = t.asset_id),
             t.identifier
           ) as secondary,
           pr.position
    from pinned_raw pr
    join public.trials t on t.id = pr.entity_id
    where pr.kind = 'trial' and t.space_id = p_space_id

    union all
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
        'kind', kind, 'id', id, 'name', name, 'secondary', secondary,
        'score', 0, 'pinned', true, 'recentAt', null
      ) order by position asc
    ), '[]'::jsonb
  ) into v_pinned
  from pinned_enriched;

  with recents_raw as (
    select kind, entity_id, last_opened_at
    from public.palette_recents
    where user_id = v_uid and space_id = p_space_id
    order by last_opened_at desc
    limit 8
  ),
  recents_enriched as (
    select rr.kind, rr.entity_id as id, c.name::text as name,
           ((select count(*) from public.assets ac
             where ac.company_id = c.id and ac.space_id = p_space_id)::text || ' assets') as secondary,
           rr.last_opened_at
    from recents_raw rr
    join public.companies c on c.id = rr.entity_id
    where rr.kind = 'company' and c.space_id = p_space_id

    union all
    select rr.kind, rr.entity_id, a.name::text,
           concat_ws(' · ',
             (select co.name::text from public.companies co where co.id = a.company_id),
             nullif(a.generic_name, '')
           ) as secondary,
           rr.last_opened_at
    from recents_raw rr
    join public.assets a on a.id = rr.entity_id
    where rr.kind = 'asset' and a.space_id = p_space_id

    union all
    select rr.kind, rr.entity_id, t.name::text,
           concat_ws(' · ',
             nullif('Ph' || coalesce(t.phase, ''), 'Ph'),
             (select co.name::text from public.companies co
                join public.assets aa on aa.company_id = co.id
                where aa.id = t.asset_id),
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
        'kind', kind, 'id', id, 'name', name, 'secondary', secondary,
        'score', 0, 'pinned', false, 'recentAt', last_opened_at
      ) order by last_opened_at desc
    ), '[]'::jsonb
  ) into v_recents
  from recents_enriched;

  return jsonb_build_object('pinned', v_pinned, 'recents', v_recents);
end;
$$;

grant execute on function public.palette_empty_state(uuid) to authenticated;

-- =============================================================================
-- 4. preview_company_delete: rename products -> assets
-- =============================================================================

create or replace function public.preview_company_delete(p_company_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
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
  select count(*) into v_n_primary_intelligence from public.primary_intelligence pi
    where (pi.entity_type = 'company' and pi.entity_id = p_company_id)
       or (pi.entity_type = 'asset' and pi.entity_id = any(v_asset_ids))
       or (pi.entity_type = 'trial' and pi.entity_id = any(v_trial_ids));
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
$$;

-- =============================================================================
-- 5. preview_asset_delete (was preview_product_delete)
-- =============================================================================

drop function if exists public.preview_product_delete(uuid);

create or replace function public.preview_asset_delete(p_asset_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_space_id uuid;
  v_trial_ids uuid[];
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
  select a.space_id into v_space_id from public.assets a where a.id = p_asset_id;
  if v_space_id is null then raise exception 'asset % not found', p_asset_id using errcode = 'P0002'; end if;
  if not public.has_space_access(v_space_id) then raise exception 'not authorized' using errcode = '42501'; end if;

  select coalesce(array_agg(t.id), array[]::uuid[]) into v_trial_ids from public.trials t where t.asset_id = p_asset_id;
  v_n_trials := coalesce(array_length(v_trial_ids, 1), 0);
  select count(*) into v_n_trial_notes from public.trial_notes tn where tn.trial_id = any(v_trial_ids);
  select count(*) into v_n_events from public.events e where e.asset_id = p_asset_id or e.trial_id = any(v_trial_ids);
  select count(*) into v_n_material_links from public.material_links ml
    where (ml.entity_type = 'asset' and ml.entity_id = p_asset_id)
       or (ml.entity_type = 'trial' and ml.entity_id = any(v_trial_ids));
  select count(*) into v_n_primary_intelligence from public.primary_intelligence pi
    where (pi.entity_type = 'asset' and pi.entity_id = p_asset_id)
       or (pi.entity_type = 'trial' and pi.entity_id = any(v_trial_ids));
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
    'trials', v_n_trials, 'trial_notes', v_n_trial_notes, 'events', v_n_events,
    'material_links', v_n_material_links, 'primary_intelligence', v_n_primary_intelligence,
    'primary_intelligence_links', v_n_primary_intelligence_links,
    'marker_assignments', v_n_marker_assignments,
    'markers_removed_entirely', v_n_markers_removed_entirely,
    'markers_unlinked_only', v_n_markers_unlinked_only
  );
end;
$$;

revoke all on function public.preview_asset_delete(uuid) from public;
grant execute on function public.preview_asset_delete(uuid) to authenticated;

-- =============================================================================
-- 6. get_space_landing_stats: rename products -> assets
-- =============================================================================

create or replace function public.get_space_landing_stats(
  p_space_id uuid
) returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when not public.has_space_access(p_space_id) then null
    else jsonb_build_object(
      'active_trials', (
        select count(*)::int from public.trials t
        where t.space_id = p_space_id
          and (t.recruitment_status is null or lower(t.recruitment_status) not in ('completed','withdrawn','terminated'))
      ),
      'companies', (
        select count(distinct a.company_id)::int from public.assets a
        where a.space_id = p_space_id and a.company_id is not null
      ),
      'programs', (
        select count(*)::int from public.assets a where a.space_id = p_space_id
      ),
      'catalysts_90d', (
        select count(*)::int from public.markers m
        where m.space_id = p_space_id and m.event_date between current_date and current_date + interval '90 days'
      ),
      'intelligence_total', (
        select count(*)::int from public.primary_intelligence pi
        where pi.space_id = p_space_id and pi.state = 'published'
      ),
      'p3_readouts_90d', (
        select count(distinct m.id)::int
        from public.markers m
        join public.marker_assignments ma on ma.marker_id = m.id
        join public.trials t on t.id = ma.trial_id
        join public.marker_types mt on mt.id = m.marker_type_id
        where m.space_id = p_space_id
          and mt.category_id = 'c0000000-0000-0000-0000-000000000002'
          and t.phase = 'Phase 3'
          and m.event_date between current_date and current_date + interval '90 days'
      ),
      'new_intel_7d', (
        select count(*)::int from public.primary_intelligence pi
        where pi.space_id = p_space_id and pi.state = 'published' and pi.published_at >= now() - interval '7 days'
      ),
      'trial_moves_30d', (
        select count(distinct trial_id)::int from public.trial_change_events
        where space_id = p_space_id and observed_at >= now() - interval '30 days'
          and (event_type = 'phase_transitioned'
               or (event_type = 'status_changed' and payload->>'to' in ('TERMINATED','WITHDRAWN','SUSPENDED','COMPLETED')))
      ),
      'loe_365d', (
        select count(distinct m.id)::int
        from public.markers m
        join public.marker_types mt on mt.id = m.marker_type_id
        where m.space_id = p_space_id
          and mt.category_id = 'c0000000-0000-0000-0000-000000000005'
          and m.event_date between current_date and current_date + interval '365 days'
      )
    )
  end;
$$;

-- =============================================================================
-- 7. get_activity_feed: rename products -> assets
-- =============================================================================

create or replace function public.get_activity_feed(
  p_space_id uuid,
  p_filters jsonb default '{}'::jsonb,
  p_cursor_observed_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit int default 50
) returns setof jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
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
    'trial_identifier', t.identifier,
    'asset_name', a.name,
    'asset_id', a.id,
    'company_name', co.name,
    'company_id', co.id,
    'company_logo_url', co.logo_url,
    'marker_type', case when ce.marker_id is not null then (
      select jsonb_build_object('id', mt.id, 'name', mt.name, 'icon', mt.icon,
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
$$;

-- =============================================================================
-- 8. get_trial_activity: rename products -> assets
-- =============================================================================

create or replace function public.get_trial_activity(
  p_trial_id uuid,
  p_limit int default 25
) returns setof jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
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
    'trial_identifier', t.identifier,
    'asset_name', a.name,
    'asset_id', a.id,
    'company_name', co.name,
    'company_id', co.id,
    'company_logo_url', co.logo_url,
    'marker_type', case when ce.marker_id is not null then (
      select jsonb_build_object('id', mt.id, 'name', mt.name, 'icon', mt.icon,
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
$$;

-- =============================================================================
-- 9. get_events_page_data: rename product_id -> asset_id, products -> assets
-- =============================================================================

create or replace function public.get_events_page_data(
  p_space_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_entity_level text default null,
  p_entity_id uuid default null,
  p_category_ids uuid[] default null,
  p_tags text[] default null,
  p_priority text default null,
  p_source_type text default null,
  p_limit int default 50,
  p_offset int default 0
) returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_total_count int;
  v_entity_pred text;
  v_trial_ids uuid[];
  v_asset_ids uuid[];
begin
  if p_entity_level = 'company' and p_entity_id is not null then
    select coalesce(array_agg(a.id), '{}') into v_asset_ids
      from public.assets a where a.company_id = p_entity_id and a.space_id = p_space_id;
    select coalesce(array_agg(t.id), '{}') into v_trial_ids
      from public.trials t where t.asset_id = any(v_asset_ids) and t.space_id = p_space_id;
  elsif p_entity_level in ('asset', 'product') and p_entity_id is not null then
    v_asset_ids := array[p_entity_id];
    select coalesce(array_agg(t.id), '{}') into v_trial_ids
      from public.trials t where t.asset_id = p_entity_id and t.space_id = p_space_id;
  elsif p_entity_level = 'trial' and p_entity_id is not null then
    v_trial_ids := array[p_entity_id];
    v_asset_ids := '{}';
  else
    v_trial_ids := null;
    v_asset_ids := null;
  end if;

  with filtered as (
    select ev.*, 'event' as row_type
    from public.events ev
    where ev.space_id = p_space_id
      and (p_date_from is null or ev.event_date >= p_date_from)
      and (p_date_to is null or ev.event_date <= p_date_to)
      and (p_category_ids is null or ev.category_id = any(p_category_ids))
      and (p_priority is null or ev.priority = p_priority)
      and (v_trial_ids is null or ev.company_id = p_entity_id
           or ev.asset_id = any(v_asset_ids) or ev.trial_id = any(v_trial_ids))
      and (p_tags is null or ev.tags && p_tags)
      and (p_source_type is null or
           (p_source_type = 'sourced' and exists (select 1 from public.event_sources es where es.event_id = ev.id)) or
           (p_source_type = 'unsourced' and not exists (select 1 from public.event_sources es where es.event_id = ev.id)))
    order by ev.event_date desc, ev.created_at desc
  )
  select count(*) into v_total_count from filtered;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', f.id,
      'space_id', f.space_id,
      'title', f.title,
      'event_date', f.event_date,
      'end_date', f.end_date,
      'priority', f.priority,
      'company_id', f.company_id,
      'asset_id', f.asset_id,
      'trial_id', f.trial_id,
      'category_id', f.category_id,
      'thread_id', f.thread_id,
      'body_md', f.body_md,
      'tags', f.tags,
      'created_at', f.created_at,
      'updated_at', f.updated_at,
      'category', (select jsonb_build_object('id', ec.id, 'name', ec.name, 'color', ec.color, 'icon', ec.icon)
                   from public.event_categories ec where ec.id = f.category_id),
      'company', case when f.company_id is not null then
        (select jsonb_build_object('id', cc.id, 'name', cc.name, 'logo_url', cc.logo_url)
         from public.companies cc where cc.id = f.company_id) else null end,
      'asset', case when f.asset_id is not null then
        (select jsonb_build_object('id', aa.id, 'name', aa.name,
           'company', (select jsonb_build_object('id', cc2.id, 'name', cc2.name, 'logo_url', cc2.logo_url)
                       from public.companies cc2 where cc2.id = aa.company_id))
         from public.assets aa where aa.id = f.asset_id) else null end,
      'trial', case when f.trial_id is not null then
        (select jsonb_build_object('id', tt.id, 'name', tt.name, 'identifier', tt.identifier,
           'asset', (select jsonb_build_object('id', aa2.id, 'name', aa2.name,
              'company', (select jsonb_build_object('id', cc3.id, 'name', cc3.name, 'logo_url', cc3.logo_url)
                          from public.companies cc3 where cc3.id = aa2.company_id))
            from public.assets aa2 where aa2.id = tt.asset_id))
         from public.trials tt where tt.id = f.trial_id) else null end,
      'sources', coalesce((select jsonb_agg(jsonb_build_object('id', es.id, 'url', es.url, 'label', es.label))
                           from public.event_sources es where es.event_id = f.id), '[]'::jsonb),
      'link_count', (select count(*) from public.event_links el where el.source_event_id = f.id or el.target_event_id = f.id)
    ) order by f.event_date desc, f.created_at desc
  ), '[]'::jsonb)
  into v_rows
  from (select * from filtered order by event_date desc, created_at desc limit p_limit offset p_offset) f;

  return jsonb_build_object('rows', v_rows, 'total_count', v_total_count);
end;
$$;

-- =============================================================================
-- 10. build_intelligence_payload: rename entity_type 'product' -> 'asset'
-- =============================================================================

create or replace function public.build_intelligence_payload(
  p_intelligence_id uuid
) returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_space_id uuid;
  v_result   jsonb;
begin
  select pi.space_id into v_space_id
    from public.primary_intelligence pi
    where pi.id = p_intelligence_id;

  if v_space_id is null then return null; end if;
  if not public.has_space_access(v_space_id) then return null; end if;

  with target as (
    select pi.*
    from public.primary_intelligence pi
    where pi.id = p_intelligence_id
  )
  select jsonb_build_object(
    'id', tg.id,
    'space_id', tg.space_id,
    'entity_type', tg.entity_type,
    'entity_id', tg.entity_id,
    'state', tg.state,
    'headline', tg.headline,
    'summary_md', tg.summary_md,
    'body_md', tg.body_md,
    'published_at', tg.published_at,
    'last_edited_by', tg.last_edited_by,
    'created_at', tg.created_at,
    'updated_at', tg.updated_at,
    'entity_name', case tg.entity_type
      when 'company' then (select c.name from public.companies c where c.id = tg.entity_id)
      when 'asset'   then (select a.name from public.assets a where a.id = tg.entity_id)
      when 'trial'   then (select t.name from public.trials t where t.id = tg.entity_id)
      else null
    end,
    'company_name', case tg.entity_type
      when 'company' then (select c.name from public.companies c where c.id = tg.entity_id)
      when 'asset'   then (select co.name from public.assets a join public.companies co on co.id = a.company_id where a.id = tg.entity_id)
      when 'trial'   then (select co.name from public.trials t join public.assets a on a.id = t.asset_id join public.companies co on co.id = a.company_id where t.id = tg.entity_id)
      else null
    end,
    'links', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'entity_type', l.entity_type,
        'entity_id', l.entity_id,
        'entity_name', case l.entity_type
          when 'company' then (select c.name from public.companies c where c.id = l.entity_id)
          when 'asset'   then (select a.name from public.assets a where a.id = l.entity_id)
          when 'trial'   then (select t.name from public.trials t where t.id = l.entity_id)
          else null
        end
      ) order by l.created_at)
      from public.primary_intelligence_links l
      where l.primary_intelligence_id = tg.id
    ), '[]'::jsonb),
    'contributors', coalesce((
      select jsonb_agg(distinct rev.edited_by::text)
      from public.primary_intelligence_revisions rev
      where rev.primary_intelligence_id = tg.id
    ), '[]'::jsonb),
    'recent_revisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rev.id, 'edited_by', rev.edited_by,
        'changed_fields', rev.changed_fields, 'created_at', rev.created_at
      ) order by rev.created_at desc)
      from (
        select * from public.primary_intelligence_revisions r2
        where r2.primary_intelligence_id = tg.id
        order by r2.created_at desc limit 5
      ) rev
    ), '[]'::jsonb)
  ) into v_result
  from target tg;

  return v_result;
end;
$$;
