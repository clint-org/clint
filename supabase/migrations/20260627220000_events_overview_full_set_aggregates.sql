-- Events overview: compute DISTRIBUTION, the "in window" count, the
-- high-priority count, and the MOST RECENT list over the FULL filtered set,
-- not just the loaded page.
--
-- get_events_page_data previously returned only the page of `items` (+ total),
-- and the client derived the overview pane from that page (max p_limit rows).
-- So a category's share and the "N in window" number reflected only what was on
-- screen: the histogram showed "Approval 1" while 25 approvals existed, and
-- "25 in window" while the filter actually matched 27 (the page cap was 25).
-- This returns server-side aggregates over the whole filtered set:
--   * total                -> count over the full filtered set (unchanged value)
--   * high_priority_count  -> high-priority rows in the full filtered set
--   * distribution         -> per-category counts (+ a representative marker
--                             glyph) over the full filtered set
--   * recent               -> the 3 latest rows by event_date over the full set
--
-- Same 16-arg signature as 20260627200000 (no DROP / no overload change); the
-- ONLY change is the final projection. An `enriched` CTE builds each row's JSON
-- once so the page slice, the recent list, and the distribution all reuse it.

create or replace function public.get_events_page_data(
  p_space_id      uuid,
  p_date_from     date     default null,
  p_date_to       date     default null,
  p_entity_level  text     default null,
  p_entity_id     uuid     default null,
  p_category_ids  uuid[]   default null,
  p_tags          text[]   default null,
  p_priority      text     default null,
  p_source_type   text     default null,
  p_limit         int      default 50,
  p_offset        int      default 0,
  p_change_event_id uuid   default null,
  p_search        text     default null,
  p_sort_field    text     default 'feed_ts',
  p_sort_dir      text     default 'desc',
  p_category_names text[]  default null
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_category_ids = '{}' then p_category_ids := null; end if;
  if p_category_names = '{}' then p_category_names := null; end if;
  if p_tags = '{}' then p_tags := null; end if;
  if p_search is not null and btrim(p_search) = '' then p_search := null; end if;

  with unified_feed as (
    -- leg 1: events (human-authored)
    select
      'event'::text as source_type,
      ev.id,
      ev.title,
      ev.event_date,
      ec.name as category_name,
      ec.id as category_id,
      ev.priority,
      case
        when ev.trial_id is not null then 'trial'
        when ev.asset_id is not null then 'product'
        when ev.company_id is not null then 'company'
        else 'space'
      end as entity_level,
      coalesce(t.acronym, t.name, a.name, co.name, 'Industry') as entity_name,
      coalesce(ev.trial_id, ev.asset_id, ev.company_id) as entity_id,
      coalesce(co.name, co_via_asset.name, co_via_trial.name) as company_name,
      ev.tags,
      ev.thread_id is not null as has_thread,
      ev.thread_id,
      ev.description,
      null::text as source_url,
      ev.created_at,
      ev.created_at as feed_ts,
      null::text as change_event_type,
      null::jsonb as change_payload,
      null::text as change_source,
      false as has_annotation,
      null::text as observed_at,
      null::text as company_logo_url,
      coalesce(ev.company_id, co_via_asset.id, co_via_trial.id) as company_id,
      coalesce(ev.asset_id, a_via_trial.id) as asset_id,
      coalesce(a.name, a_via_trial.name) as asset_name,
      ev.trial_id as trial_id,
      coalesce(t.acronym, t.name) as trial_name,
      null::boolean as is_projected,
      null::text as marker_type_shape,
      null::text as marker_type_color,
      null::text as marker_type_inner_mark,
      null::text as category_color
    from public.events ev
    join public.event_categories ec on ec.id = ev.category_id
    left join public.companies co on co.id = ev.company_id
    left join public.assets a on a.id = ev.asset_id
    left join public.companies co_via_asset on a.id is not null and co_via_asset.id = a.company_id
    left join public.trials t on t.id = ev.trial_id
    left join public.assets a_via_trial on t.id is not null and a_via_trial.id = t.asset_id
    left join public.companies co_via_trial on a_via_trial.id is not null and co_via_trial.id = a_via_trial.company_id
    where ev.space_id = p_space_id
      and (p_source_type is null or p_source_type = 'event')
      and p_change_event_id is null
      and (p_date_from is null or ev.created_at::date >= p_date_from)
      and (p_date_to is null or ev.created_at::date <= p_date_to)
      and (p_priority is null or ev.priority = p_priority)
      and (p_tags is null or ev.tags && p_tags)
      and (p_category_ids is null or ec.id = any(p_category_ids))
      and (
        p_entity_level is null
        or (p_entity_level = 'space' and ev.company_id is null and ev.asset_id is null and ev.trial_id is null)
        or (p_entity_level = 'company' and (ev.company_id is not null or ev.asset_id is not null or ev.trial_id is not null))
        or (p_entity_level in ('product', 'asset') and (ev.asset_id is not null or ev.trial_id is not null))
        or (p_entity_level = 'trial' and ev.trial_id is not null)
      )
      and (
        p_entity_id is null
        or ev.company_id = p_entity_id
        or ev.asset_id = p_entity_id
        or ev.trial_id   = p_entity_id
        or (p_entity_level in ('product', 'asset') and exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = p_entity_id))
        or (p_entity_level = 'company' and (co_via_asset.id = p_entity_id or co_via_trial.id = p_entity_id))
      )

    union all

    -- leg 2: markers
    select
      'marker'::text as source_type,
      m.id,
      m.title,
      m.event_date,
      mc.name as category_name,
      mc.id as category_id,
      null::text as priority,
      'trial'::text as entity_level,
      coalesce(t.acronym, t.name) as entity_name,
      t.id as entity_id,
      co.name as company_name,
      '{}'::text[] as tags,
      false as has_thread,
      null::uuid as thread_id,
      m.description,
      m.source_url,
      m.created_at,
      m.created_at as feed_ts,
      null::text as change_event_type,
      null::jsonb as change_payload,
      null::text as change_source,
      false as has_annotation,
      null::text as observed_at,
      null::text as company_logo_url,
      co.id as company_id,
      a.id as asset_id,
      a.name as asset_name,
      t.id as trial_id,
      coalesce(t.acronym, t.name) as trial_name,
      m.is_projected as is_projected,
      mt.shape::text as marker_type_shape,
      mt.color::text as marker_type_color,
      mt.inner_mark::text as marker_type_inner_mark,
      mt.color::text as category_color
    from public.markers m
    join public.marker_assignments ma on ma.marker_id = m.id
    join public.trials t on t.id = ma.trial_id
    join public.assets a on a.id = t.asset_id
    join public.companies co on co.id = a.company_id
    join public.marker_types mt on mt.id = m.marker_type_id
    join public.marker_categories mc on mc.id = mt.category_id
    where m.space_id = p_space_id
      and (p_source_type is null or p_source_type = 'marker')
      and p_change_event_id is null
      and (p_date_from is null or m.created_at::date >= p_date_from)
      and (p_date_to is null or m.created_at::date <= p_date_to)
      and (p_tags is null)
      and (p_priority is null)
      and (p_category_ids is null or mc.id = any(p_category_ids))
      and (p_entity_level is null or p_entity_level in ('trial', 'product', 'asset', 'company'))
      and (
        p_entity_id is null
        or t.id = p_entity_id
        or exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = p_entity_id)
        or co.id = p_entity_id
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
      case when t.identifier is not null
        then 'https://clinicaltrials.gov/study/' || t.identifier
        else null
      end as source_url,
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
          -- A representative marker's glyph for marker categories so the bar can
          -- carry the shape/color (null for event / detected categories).
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
$$;

-- Smoke: the function must run and return the new overview keys (the brittle
-- part is the enriched/aggregate rewrite of the final projection). Running
-- against an empty space id exercises the projection and the coalesce-to-empty
-- paths without needing data.
do $$
declare
  v jsonb;
begin
  v := public.get_events_page_data(
    p_space_id := '00000000-0000-0000-0000-000000000000'::uuid
  );
  if v is null
     or not (v ? 'items')
     or not (v ? 'total')
     or not (v ? 'distribution')
     or not (v ? 'high_priority_count')
     or not (v ? 'recent') then
    raise exception 'get_events_page_data overview smoke failed: %', v;
  end if;
end;
$$;

notify pgrst, 'reload schema';
