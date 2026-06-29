-- Task S2: read RPCs emit event sources + derived registry link (A-derived read path)
--
-- S1a added public.event_sources (attached citations) + the public.event_registry_url(text)
-- helper; S1b made create_event write sources atomically. This migration makes the READ
-- RPCs surface them, ADDITIVELY:
--   * 'sources'      -- attached citations from event_sources, ordered (sort_order, created_at)
--   * 'registry_url' -- derived CT.gov link via event_registry_url(), only for trial anchors
--
-- This is additive: source_url is intentionally KEPT (a later task drops the column and
-- these keys together). get_events_page_data additionally consolidates its one hardcoded
-- 'https://clinicaltrials.gov/study/' literal onto the helper; that derived value feeds the
-- new registry_url key. All other logic (filters, ordering, pagination, envelope) is
-- preserved byte-identical from each function's live body.
--
-- RPCs redefined: _dashboard_anchor_events, get_events_page_data, get_catalyst_detail,
-- get_key_catalysts.

-- ---------------------------------------------------------------------------
-- _dashboard_anchor_events: events anchored to a single entity for the timeline.
-- ---------------------------------------------------------------------------
create or replace function public._dashboard_anchor_events(p_anchor_type text, p_anchor_id uuid, p_space_id uuid, p_start_year integer, p_end_year integer)
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
        'sources', (
          select coalesce(
            jsonb_agg(jsonb_build_object('url', es.url, 'label', es.label)
                      order by es.sort_order, es.created_at),
            '[]'::jsonb)
          from public.event_sources es where es.event_id = e.id
        ),
        'registry_url', case
          when e.anchor_type = 'trial'
            then public.event_registry_url((select t.identifier from public.trials t where t.id = e.anchor_id))
          else null
        end,
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

-- ---------------------------------------------------------------------------
-- get_catalyst_detail: single event detail for the catalyst / event detail panel.
-- ---------------------------------------------------------------------------
create or replace function public.get_catalyst_detail(p_marker_id uuid)
  returns jsonb
  language plpgsql
  stable
  set search_path to ''
as $function$
declare
  v_catalyst jsonb;
begin
  select
    jsonb_build_object(
      'marker_id',              e.id,
      'source_doc_id',          e.source_doc_id,
      'title',                  e.title,
      'event_date',             e.event_date,
      'date_precision',         e.date_precision,
      'end_date',               e.end_date,
      'end_date_precision',     e.end_date_precision,
      'is_ongoing',             e.is_ongoing,
      'category_name',          ec.name,
      'category_id',            et.category_id,
      'marker_type_name',       et.name,
      'marker_type_color',      et.color,
      'marker_type_shape',      et.shape,
      'marker_type_inner_mark', et.inner_mark,
      'is_projected',           e.is_projected,
      'projection',             e.projection,
      'no_longer_expected',     e.no_longer_expected,
      'company_name',           co.name,
      'company_id',             co.id,
      'company_logo_url',       co.logo_url,
      'asset_name',             a.name,
      'asset_id',               a.id,
      'trial_name',             t.name,
      'trial_acronym',          t.acronym,
      'trial_id',               t.id,
      'trial_phase',            t.phase,
      'recruitment_status',     t.recruitment_status,
      'description',            e.description,
      'source_url',             e.source_url,
      'sources', (
        select coalesce(
          jsonb_agg(jsonb_build_object('url', es.url, 'label', es.label)
                    order by es.sort_order, es.created_at),
          '[]'::jsonb)
        from public.event_sources es where es.event_id = e.id
      ),
      'registry_url', case
        when e.anchor_type = 'trial' then public.event_registry_url(t.identifier)
        else null
      end,
      'metadata',               e.metadata,
      'ctgov_last_synced_at',   t.ctgov_last_synced_at
    )
  into v_catalyst
  from public.events e
  join public.event_types et on et.id = e.event_type_id
  join public.event_type_categories ec on ec.id = et.category_id
  -- Trial anchor: events.anchor_id is the trial id.
  left join public.trials t
    on e.anchor_type = 'trial' and t.id = e.anchor_id
  -- Asset: either the trial's asset, or a direct asset anchor.
  left join public.assets a
    on a.id = coalesce(t.asset_id,
                       case when e.anchor_type = 'asset' then e.anchor_id end)
  -- Company: either the asset's company, or a direct company anchor.
  left join public.companies co
    on co.id = coalesce(a.company_id,
                        case when e.anchor_type = 'company' then e.anchor_id end)
  where e.id = p_marker_id;

  if v_catalyst is null then
    return null;
  end if;

  -- upcoming_markers / related_events feeds are not yet rebuilt on the events
  -- model; return empty arrays so the detail panel renders without them.
  return jsonb_build_object(
    'catalyst',         v_catalyst,
    'upcoming_markers', '[]'::jsonb,
    'related_events',   '[]'::jsonb
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- get_key_catalysts: upcoming key catalysts list for the overview.
-- ---------------------------------------------------------------------------
create or replace function public.get_key_catalysts(p_space_id uuid, p_category_ids uuid[] default null::uuid[], p_company_id uuid default null::uuid, p_asset_id uuid default null::uuid)
  returns jsonb
  language plpgsql
  stable
  set search_path to ''
as $function$
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
        'category_name',    ec.name,
        'category_id',      ec.id,
        'marker_type_name', et.name,
        'marker_type_color', et.color,
        'marker_type_shape', et.shape,
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
        'source_url',       m.source_url,
        'sources', (
          select coalesce(
            jsonb_agg(jsonb_build_object('url', es.url, 'label', es.label)
                      order by es.sort_order, es.created_at),
            '[]'::jsonb)
          from public.event_sources es where es.event_id = m.id
        ),
        'registry_url', case
          when m.anchor_type = 'trial' then public.event_registry_url(t.identifier)
          else null
        end
      ) as row_data,
      m.event_date,
      m.title
    from public.events m
    join public.event_types et on et.id = m.event_type_id
    join public.event_type_categories ec on ec.id = et.category_id
    left join public.trials t on m.anchor_type = 'trial' and t.id = m.anchor_id
    left join public.assets a on a.id = t.asset_id
    left join public.companies co on co.id = a.company_id
    where m.space_id = p_space_id
      and m.event_date >= current_date
      and m.no_longer_expected = false
      and (p_category_ids is null or ec.id = any(p_category_ids))
      and (p_company_id is null or co.id = p_company_id)
      and (p_asset_id is null or a.id = p_asset_id)
  ) sub;

  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- get_events_page_data: unified events feed (events + detected CT.gov changes).
-- Adds 'sources' + 'registry_url' to each item and consolidates the one hardcoded
-- CT.gov literal onto the event_registry_url() helper.
-- ---------------------------------------------------------------------------
create or replace function public.get_events_page_data(p_space_id uuid, p_date_from date default null::date, p_date_to date default null::date, p_entity_level text default null::text, p_entity_id uuid default null::uuid, p_category_ids uuid[] default null::uuid[], p_tags text[] default null::text[], p_priority text default null::text, p_source_type text default null::text, p_limit integer default 50, p_offset integer default 0, p_change_event_id uuid default null::uuid, p_search text default null::text, p_sort_field text default 'feed_ts'::text, p_sort_dir text default 'desc'::text, p_category_names text[] default null::text[])
  returns jsonb
  language plpgsql
  stable
  set search_path to ''
as $function$
declare
  v_result jsonb;
begin
  if p_category_ids = '{}' then p_category_ids := null; end if;
  if p_category_names = '{}' then p_category_names := null; end if;
  if p_tags = '{}' then p_tags := null; end if;
  if p_search is not null and btrim(p_search) = '' then p_search := null; end if;

  with unified_feed as (
    -- merged leg: events (human-authored + markers, now one unified table)
    select
      'event'::text as source_type,
      ev.id,
      ev.title,
      ev.event_date,
      ec.name as category_name,
      ec.id as category_id,
      ev.significance as priority,
      case ev.anchor_type
        when 'trial' then 'trial'
        when 'asset' then 'product'
        when 'company' then 'company'
        else 'space'
      end as entity_level,
      case ev.anchor_type
        when 'trial' then coalesce(t.acronym, t.name)
        when 'asset' then a.name
        when 'company' then co.name
        else 'Industry'
      end as entity_name,
      ev.anchor_id as entity_id,
      co.name as company_name,
      '{}'::text[] as tags,
      false as has_thread,
      null::uuid as thread_id,
      ev.description,
      ev.source_url,
      (
        select coalesce(
          jsonb_agg(jsonb_build_object('url', es.url, 'label', es.label)
                    order by es.sort_order, es.created_at),
          '[]'::jsonb)
        from public.event_sources es where es.event_id = ev.id
      ) as sources,
      case when ev.anchor_type = 'trial'
        then public.event_registry_url(t.identifier)
        else null
      end as registry_url,
      ev.created_at,
      ev.created_at as feed_ts,
      null::text as change_event_type,
      null::jsonb as change_payload,
      null::text as change_source,
      false as has_annotation,
      null::text as observed_at,
      null::text as company_logo_url,
      co.id as company_id,
      a.id as asset_id,
      a.name as asset_name,
      case when ev.anchor_type = 'trial' then t.id else null end as trial_id,
      case when ev.anchor_type = 'trial' then coalesce(t.acronym, t.name) else null end as trial_name,
      ev.is_projected as is_projected,
      et.shape::text as marker_type_shape,
      et.color::text as marker_type_color,
      et.inner_mark::text as marker_type_inner_mark,
      et.color::text as category_color
    from public.events ev
    join public.event_types et on et.id = ev.event_type_id
    join public.event_type_categories ec on ec.id = et.category_id
    left join public.trials t on ev.anchor_type = 'trial' and t.id = ev.anchor_id
    left join public.assets a on (ev.anchor_type = 'asset' and a.id = ev.anchor_id)
                              or (t.id is not null and a.id = t.asset_id)
    left join public.companies co on (ev.anchor_type = 'company' and co.id = ev.anchor_id)
                                  or (a.id is not null and co.id = a.company_id)
    where ev.space_id = p_space_id
      and (p_source_type is null or p_source_type = 'event')
      and p_change_event_id is null
      and (p_date_from is null or ev.created_at::date >= p_date_from)
      and (p_date_to is null or ev.created_at::date <= p_date_to)
      and (p_priority is null or ev.significance = p_priority)
      and (p_tags is null)
      and (p_category_ids is null or ec.id = any(p_category_ids))
      and (
        p_entity_level is null
        or (p_entity_level = 'space' and ev.anchor_type = 'space')
        or (p_entity_level = 'company' and co.id is not null)
        or (p_entity_level in ('product', 'asset') and a.id is not null)
        or (p_entity_level = 'trial' and t.id is not null)
      )
      and (
        p_entity_id is null
        or co.id = p_entity_id
        or a.id = p_entity_id
        or t.id = p_entity_id
        or (p_entity_level in ('product', 'asset') and exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = p_entity_id))
      )

    union all

    -- leg 3: trial_change_events (detected CT.gov changes)
    select
      'detected'::text as source_type,
      ce.id,
      case ce.event_type
        when 'phase_transitioned' then
          'Phase: ' || public._humanize_phase(ce.payload ->> 'from')
          || ' -> ' || public._humanize_phase(ce.payload ->> 'to')
        when 'status_changed' then
          'Status: ' || public._humanize_status(ce.payload ->> 'from')
          || ' -> ' || public._humanize_status(ce.payload ->> 'to')
        when 'date_moved' then
          concat_ws(
            ' ',
            case
              when ce.payload ->> 'which_date' = 'event_date'
                and nullif(ce.payload ->> 'marker_title', '') is not null
                then (ce.payload ->> 'marker_title') || ': event date'
              else initcap(replace(coalesce(ce.payload ->> 'which_date', 'date'), '_', ' '))
            end,
            case when ce.payload ->> 'direction' = 'accelerate'
              then 'pulled forward' else 'delayed' end,
            case when (ce.payload ->> 'days_diff') ~ '^-?\d+$'
              then abs((ce.payload ->> 'days_diff')::int)::text || ' days' end
          )
        when 'trial_withdrawn' then
          'Trial withdrawn from CT.gov'
        when 'enrollment_target_changed' then
          'Enrollment target: '
          || coalesce(ce.payload ->> 'from', '?')
          || ' -> ' || coalesce(ce.payload ->> 'to', '?')
        when 'sponsor_changed' then
          'Sponsor: '
          || coalesce(ce.payload ->> 'from', '?')
          || ' -> ' || coalesce(ce.payload ->> 'to', '?')
        else
          initcap(replace(ce.event_type, '_', ' '))
      end as title,
      ce.occurred_at::date as event_date,
      case ce.event_type
        when 'status_changed'              then 'Trial status'
        when 'trial_withdrawn'             then 'Trial status'
        when 'date_moved'                  then 'Timeline'
        when 'projection_finalized'        then 'Timeline'
        when 'phase_transitioned'          then 'Phase'
        when 'enrollment_target_changed'   then 'Protocol design'
        when 'arm_added'                   then 'Protocol design'
        when 'arm_removed'                 then 'Protocol design'
        when 'intervention_changed'        then 'Protocol design'
        when 'outcome_measure_changed'     then 'Protocol design'
        when 'eligibility_criteria_changed' then 'Protocol design'
        when 'eligibility_changed'         then 'Protocol design'
        when 'marker_added'                then 'Catalyst lifecycle'
        when 'marker_removed'              then 'Catalyst lifecycle'
        when 'marker_updated'              then 'Catalyst lifecycle'
        when 'marker_reclassified'         then 'Catalyst lifecycle'
        when 'sponsor_changed'             then 'Catalyst lifecycle'
        else 'Other'
      end as category_name,
      null::uuid as category_id,
      null::text as priority,
      'trial'::text as entity_level,
      coalesce(t.acronym, t.name) as entity_name,
      ce.trial_id as entity_id,
      co.name as company_name,
      '{}'::text[] as tags,
      false as has_thread,
      null::uuid as thread_id,
      null::text as description,
      public.event_registry_url(t.identifier) as source_url,
      '[]'::jsonb as sources,
      public.event_registry_url(t.identifier) as registry_url,
      ce.observed_at as created_at,
      coalesce(ce.observed_at, ce.occurred_at) as feed_ts,
      ce.event_type::text as change_event_type,
      ce.payload as change_payload,
      ce.source::text as change_source,
      exists(
        select 1
        from public.change_event_annotations ann
        where ann.change_event_id = ce.id
      ) as has_annotation,
      ce.observed_at::text as observed_at,
      co.logo_url::text as company_logo_url,
      co.id as company_id,
      t.asset_id as asset_id,
      a.name as asset_name,
      ce.trial_id as trial_id,
      coalesce(t.acronym, t.name) as trial_name,
      null::boolean as is_projected,
      null::text as marker_type_shape,
      null::text as marker_type_color,
      null::text as marker_type_inner_mark,
      null::text as category_color
    from public.trial_change_events ce
    join public.trials t on t.id = ce.trial_id
    left join public.assets a on a.id = t.asset_id
    left join public.companies co on a.id is not null and co.id = a.company_id
    where ce.space_id = p_space_id
      and (p_source_type is null or p_source_type = 'detected')
      and (p_change_event_id is null or ce.id = p_change_event_id)
      and (p_date_from is null or coalesce(ce.observed_at, ce.occurred_at)::date >= p_date_from)
      and (p_date_to is null or coalesce(ce.observed_at, ce.occurred_at)::date <= p_date_to)
      and (p_entity_level is null or p_entity_level in ('trial', 'product', 'asset', 'company'))
      and (
        p_entity_id is null
        or ce.trial_id = p_entity_id
        or exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = p_entity_id)
        or co.id = p_entity_id
      )
      and (p_priority is null)
  ),
  filtered as (
    select uf.*
    from unified_feed uf
    where (p_category_names is null or uf.category_name = any(p_category_names))
      and (
        p_search is null
        or uf.title ilike '%' || p_search || '%'
        or uf.category_name ilike '%' || p_search || '%'
        or uf.entity_name ilike '%' || p_search || '%'
        or coalesce(uf.company_name, '') ilike '%' || p_search || '%'
        or coalesce(uf.asset_name, '') ilike '%' || p_search || '%'
        or coalesce(uf.change_event_type, '') ilike '%' || p_search || '%'
      )
  ),
  ranked as (
    select
      f.*,
      count(*) over() as total_count,
      case p_sort_field
        when 'title'         then lower(f.title)
        when 'category_name' then lower(f.category_name)
        when 'entity_name'   then lower(f.entity_name)
        when 'priority'      then f.priority
        when 'source_type'   then f.source_type
        else null
      end as sort_text,
      case
        when p_sort_field in ('title', 'category_name', 'entity_name', 'priority', 'source_type')
          then null::timestamptz
        else f.feed_ts
      end as sort_ts
    from filtered f
  ),
  enriched as (
    -- Build each filtered row's JSON once so the page slice, the recent list,
    -- and the distribution all reuse it. sort_text / sort_ts are real columns
    -- of `ranked` here, so they resolve inside the CASE order-by expressions
    -- below (output aliases would not).
    select
      r.*,
      jsonb_build_object(
        'source_type', r.source_type,
        'id', r.id,
        'title', r.title,
        'event_date', r.event_date,
        'feed_ts', r.feed_ts,
        'category_name', r.category_name,
        'category_id', r.category_id,
        'priority', r.priority,
        'entity_level', r.entity_level,
        'entity_name', r.entity_name,
        'entity_id', r.entity_id,
        'company_id', r.company_id,
        'company_name', r.company_name,
        'asset_id', r.asset_id,
        'asset_name', r.asset_name,
        'trial_id', r.trial_id,
        'trial_name', r.trial_name,
        'tags', to_jsonb(r.tags),
        'has_thread', r.has_thread,
        'thread_id', r.thread_id,
        'description', r.description,
        'source_url', r.source_url,
        'sources', r.sources,
        'registry_url', r.registry_url,
        'change_event_type', r.change_event_type,
        'change_payload', r.change_payload,
        'change_source', r.change_source,
        'has_annotation', r.has_annotation,
        'observed_at', r.observed_at,
        'company_logo_url', r.company_logo_url,
        'is_projected', r.is_projected,
        'marker_type_shape', r.marker_type_shape,
        'marker_type_color', r.marker_type_color,
        'marker_type_inner_mark', r.marker_type_inner_mark,
        'category_color', r.category_color
      ) as item
    from ranked r
  )
  select jsonb_build_object(
    -- Page slice: the user's sort + limit/offset.
    'items', (
      select coalesce(
        jsonb_agg(
          e.item
          order by
            case when p_sort_dir = 'asc'  then e.sort_ts end asc nulls last,
            case when p_sort_dir <> 'asc' then e.sort_ts end desc nulls last,
            case when p_sort_dir = 'asc'  then e.sort_text end asc nulls last,
            case when p_sort_dir <> 'asc' then e.sort_text end desc nulls last,
            e.feed_ts desc, e.id desc
        ),
        '[]'::jsonb
      )
      from (
        select *
        from enriched
        order by
          case when p_sort_dir = 'asc'  then sort_ts end asc nulls last,
          case when p_sort_dir <> 'asc' then sort_ts end desc nulls last,
          case when p_sort_dir = 'asc'  then sort_text end asc nulls last,
          case when p_sort_dir <> 'asc' then sort_text end desc nulls last,
          feed_ts desc, id desc
        limit p_limit offset p_offset
      ) e
    ),
    -- Everything below summarizes the FULL filtered set (not just the page) so
    -- the overview pane -- distribution, "in window" count, recent -- is
    -- accurate no matter how many rows are loaded.
    'total', (select count(*) from filtered),
    'high_priority_count', (select count(*) from filtered where priority = 'high'),
    'distribution', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'name', d.name,
            'count', d.count,
            'marker_type_shape', d.marker_type_shape,
            'marker_type_color', d.marker_type_color,
            'marker_type_inner_mark', d.marker_type_inner_mark,
            'category_color', d.category_color
          )
          order by d.count desc, d.name
        ),
        '[]'::jsonb
      )
      from (
        select
          f.category_name as name,
          count(*) as count,
          -- A representative event type's glyph for categories so the bar can
          -- carry the shape/color (null for detected categories).
          (array_agg(f.marker_type_shape)      filter (where f.marker_type_shape is not null))[1] as marker_type_shape,
          (array_agg(f.marker_type_color)      filter (where f.marker_type_color is not null))[1] as marker_type_color,
          (array_agg(f.marker_type_inner_mark) filter (where f.marker_type_inner_mark is not null))[1] as marker_type_inner_mark,
          (array_agg(f.category_color)         filter (where f.category_color is not null))[1] as category_color
        from filtered f
        group by f.category_name
      ) d
    ),
    'recent', (
      select coalesce(
        jsonb_agg(rf.item order by rf.event_date desc, rf.feed_ts desc, rf.id desc),
        '[]'::jsonb
      )
      from (
        select e.item, e.event_date, e.feed_ts, e.id
        from enriched e
        order by e.event_date desc, e.feed_ts desc, e.id desc
        limit 3
      ) rf
    )
  )
  into v_result;

  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- In-file smoke: data-conditional on the demo space, self-cleaning, prod-safe.
-- Asserts each redefined RPC returns without error AND that the relevant
-- item/detail object now carries a 'sources' (jsonb array) + 'registry_url' key.
-- ---------------------------------------------------------------------------
do $smoke$
declare
  v_demo_space constant uuid := '00000000-0000-0000-0000-0000000d0100';
  v_event_id uuid;
  v_trial_anchor record;
  v_page jsonb;
  v_item jsonb;
  v_detail jsonb;
  v_catalyst jsonb;
  v_anchor jsonb;
  v_key jsonb;
begin
  if not exists (select 1 from public.spaces where id = v_demo_space) then
    raise notice 'S2 smoke skipped: demo space % absent (prod-safe)', v_demo_space;
    return;
  end if;

  -- get_events_page_data: items carry sources (array) + registry_url.
  v_page := public.get_events_page_data(p_space_id => v_demo_space);
  if jsonb_typeof(v_page -> 'items') is distinct from 'array' then
    raise exception 'S2 smoke: get_events_page_data items is not an array';
  end if;
  if jsonb_array_length(v_page -> 'items') > 0 then
    v_item := v_page -> 'items' -> 0;
    if not (v_item ? 'sources') or jsonb_typeof(v_item -> 'sources') is distinct from 'array' then
      raise exception 'S2 smoke: get_events_page_data item missing sources array';
    end if;
    if not (v_item ? 'registry_url') then
      raise exception 'S2 smoke: get_events_page_data item missing registry_url key';
    end if;
  end if;

  -- get_catalyst_detail: catalyst carries sources (array) + registry_url.
  select e.id into v_event_id
  from public.events e where e.space_id = v_demo_space limit 1;
  if v_event_id is not null then
    v_detail := public.get_catalyst_detail(v_event_id);
    v_catalyst := v_detail -> 'catalyst';
    if not (v_catalyst ? 'sources') or jsonb_typeof(v_catalyst -> 'sources') is distinct from 'array' then
      raise exception 'S2 smoke: get_catalyst_detail missing sources array';
    end if;
    if not (v_catalyst ? 'registry_url') then
      raise exception 'S2 smoke: get_catalyst_detail missing registry_url key';
    end if;
  end if;

  -- _dashboard_anchor_events: anchored event items carry sources + registry_url.
  select e.anchor_type, e.anchor_id into v_trial_anchor
  from public.events e where e.space_id = v_demo_space limit 1;
  if v_trial_anchor.anchor_id is not null then
    v_anchor := public._dashboard_anchor_events(
      v_trial_anchor.anchor_type, v_trial_anchor.anchor_id, v_demo_space, null, null);
    if jsonb_typeof(v_anchor) is distinct from 'array' then
      raise exception 'S2 smoke: _dashboard_anchor_events did not return an array';
    end if;
    if jsonb_array_length(v_anchor) > 0 then
      if not (v_anchor -> 0 ? 'sources') or jsonb_typeof(v_anchor -> 0 -> 'sources') is distinct from 'array' then
        raise exception 'S2 smoke: _dashboard_anchor_events item missing sources array';
      end if;
      if not (v_anchor -> 0 ? 'registry_url') then
        raise exception 'S2 smoke: _dashboard_anchor_events item missing registry_url key';
      end if;
    end if;
  end if;

  -- get_key_catalysts: returns without error; rows (if any) carry sources + registry_url.
  v_key := public.get_key_catalysts(v_demo_space);
  if jsonb_typeof(v_key) is distinct from 'array' then
    raise exception 'S2 smoke: get_key_catalysts did not return an array';
  end if;
  if jsonb_array_length(v_key) > 0 then
    if not (v_key -> 0 ? 'sources') or jsonb_typeof(v_key -> 0 -> 'sources') is distinct from 'array' then
      raise exception 'S2 smoke: get_key_catalysts row missing sources array';
    end if;
    if not (v_key -> 0 ? 'registry_url') then
      raise exception 'S2 smoke: get_key_catalysts row missing registry_url key';
    end if;
  end if;

  raise notice 'S2 smoke PASS: 4 read RPCs emit sources[] + registry_url on demo space %', v_demo_space;
end;
$smoke$;

notify pgrst, 'reload schema';
