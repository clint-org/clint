-- migration: 20260625160000_detail_rpcs_source_doc_provenance
-- purpose: surface import provenance on the catalyst (marker) and event detail
--          surfaces. Both detail RPCs gain a source_doc_id field so the
--          read-only provenance line (get_source_document drill) can render for
--          owners/editors. AI-imported rows carry the id; manual rows are null.
--          Only the new field is added; the rest of each body is unchanged from
--          its prior definition (get_catalyst_detail: 20260528003300,
--          get_event_detail: 20260528050000).

-- ---------------------------------------------------------------------------
-- get_catalyst_detail: + source_doc_id on the catalyst object
-- ---------------------------------------------------------------------------
create or replace function public.get_catalyst_detail(
  p_marker_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
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
      'source_doc_id',          m.source_doc_id,
      'title',                  m.title,
      'event_date',             m.event_date,
      'end_date',               m.end_date,
      'category_name',          mc.name,
      'category_id',            mc.id,
      'marker_type_name',       mt.name,
      'marker_type_icon',       mt.icon,
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
$$;

-- ---------------------------------------------------------------------------
-- get_event_detail: + source_doc_id on the event object
-- ---------------------------------------------------------------------------
create or replace function public.get_event_detail(
  p_event_id uuid
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
  select jsonb_build_object(
    'id', ev.id,
    'source_doc_id', ev.source_doc_id,
    'space_id', ev.space_id,
    'title', ev.title,
    'event_date', ev.event_date,
    'description', ev.description,
    'priority', ev.priority,
    'tags', to_jsonb(ev.tags),
    'thread_id', ev.thread_id,
    'thread_order', ev.thread_order,
    'created_by', ev.created_by,
    'created_at', ev.created_at,
    'updated_at', ev.updated_at,
    'category', jsonb_build_object(
      'id', ec.id,
      'name', ec.name
    ),
    'entity_level', case
      when ev.trial_id is not null then 'trial'
      when ev.asset_id is not null then 'product'
      when ev.company_id is not null then 'company'
      else 'space'
    end,
    'entity_name', coalesce(t.acronym, t.name, a.name, co.name, 'Industry'),
    'entity_id', coalesce(ev.trial_id, ev.asset_id, ev.company_id),
    'company_name', coalesce(
      co.name,
      co_via_asset.name,
      co_via_trial.name
    ),
    'company_id', coalesce(ev.company_id, co_via_asset.id, co_via_trial.id),
    'asset_id', coalesce(ev.asset_id, a_via_trial.id),
    'sources', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', es.id, 'url', es.url, 'label', es.label)
        order by es.created_at
      )
      from public.event_sources es
      where es.event_id = ev.id
    ), '[]'::jsonb),
    'thread', case when ev.thread_id is not null then (
      select jsonb_build_object(
        'id', et.id,
        'title', et.title,
        'events', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', te.id,
              'title', te.title,
              'event_date', te.event_date,
              'thread_order', te.thread_order
            )
            order by te.thread_order
          )
          from public.events te
          where te.thread_id = et.id
        ), '[]'::jsonb)
      )
      from public.event_threads et
      where et.id = ev.thread_id
    ) else null end,
    'linked_events', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', le.id,
          'title', le.title,
          'event_date', le.event_date,
          'category_name', lec.name
        )
      )
      from (
        select e2.* from public.event_links el
        join public.events e2 on e2.id = el.target_event_id
        where el.source_event_id = ev.id
        union
        select e2.* from public.event_links el
        join public.events e2 on e2.id = el.source_event_id
        where el.target_event_id = ev.id
      ) le
      join public.event_categories lec on lec.id = le.category_id
    ), '[]'::jsonb)
  )
  into result
  from public.events ev
  join public.event_categories ec on ec.id = ev.category_id
  left join public.companies co on co.id = ev.company_id
  left join public.assets a on a.id = ev.asset_id
  left join public.companies co_via_asset on a.id is not null and co_via_asset.id = a.company_id
  left join public.trials t on t.id = ev.trial_id
  left join public.assets a_via_trial on t.id is not null and a_via_trial.id = t.asset_id
  left join public.companies co_via_trial on a_via_trial.id is not null and co_via_trial.id = a_via_trial.company_id
  where ev.id = p_event_id;

  return result;
end;
$$;

do $$
begin
  assert (select count(*) from pg_proc
    where proname in ('get_catalyst_detail', 'get_event_detail')
      and pronamespace = 'public'::regnamespace) = 2,
    'detail RPCs missing after source_doc_id extension';
  raise notice 'smoke: detail RPCs source_doc_id OK';
end$$;

notify pgrst, 'reload schema';
