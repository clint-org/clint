-- Task S5: drop events.source_url (the final sources-model cleanup).
--
-- All citations now live in public.event_sources (written atomically by
-- create_event from p_sources), and the CT.gov registry link is derived by
-- readers via public.event_registry_url(trials.identifier). The legacy
-- events.source_url column is therefore write-dead and read-redundant. Drop it.
--
-- ORDER MATTERS. A plpgsql function that references a dropped column raises
-- 42703 at CALL time (a time-bomb, not a definition-time error), so every
-- function that still touches events.source_url is redefined from its LIVE body
-- FIRST, then the column is dropped last. The two writers (create_event,
-- update_event) keep their p_source_url parameter as a vestigial, accepted-but-
-- ignored argument: positional SQL callers (seed.sql, seed_events_model_qa,
-- commit_source_import) pass null for it positionally, and removing it would
-- shift their argument lists and break them. The param is dropped in Stage 3.
--
-- Each function below is reproduced byte-identical to its current definition
-- except for the removal of the events.source_url reference.

-- 1. create_event: stop WRITING source_url (param kept, now vestigial).
create or replace function public.create_event(p_space_id uuid, p_event_type_id uuid, p_title text, p_event_date date, p_anchor_type text, p_anchor_id uuid default null::uuid, p_projection text default 'actual'::text, p_date_precision text default 'exact'::text, p_end_date date default null::date, p_end_date_precision text default 'exact'::text, p_is_ongoing boolean default false, p_description text default null::text, p_source_url text default null::text, p_significance text default null::text, p_visibility text default null::text, p_source_doc_id uuid default null::uuid, p_sources jsonb default null::jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_id uuid; v_ok boolean;
begin
  if not public.has_space_access(p_space_id, array['owner','editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_is_ongoing and p_end_date is not null then
    raise exception 'an ongoing event cannot have an end date' using errcode = '22023';
  end if;
  if p_anchor_type not in ('space','company','asset','trial') then
    raise exception 'invalid anchor_type' using errcode = '22023';
  end if;
  if p_anchor_type <> 'space' and p_anchor_id is null then
    raise exception 'anchor_id required for anchor_type %', p_anchor_type using errcode = '22023';
  end if;
  -- anchor entity must live in the space
  if p_anchor_type = 'company' then
    select exists(select 1 from public.companies where id = p_anchor_id and space_id = p_space_id) into v_ok;
  elsif p_anchor_type = 'asset' then
    select exists(select 1 from public.assets where id = p_anchor_id and space_id = p_space_id) into v_ok;
  elsif p_anchor_type = 'trial' then
    select exists(select 1 from public.trials where id = p_anchor_id and space_id = p_space_id) into v_ok;
  else v_ok := true; end if;
  if not v_ok then raise exception 'anchor % not in space %', p_anchor_id, p_space_id using errcode = '42501'; end if;

  -- p_source_url is vestigial: citations flow through p_sources / event_sources.
  -- The param is kept for positional-caller stability and dropped in Stage 3.
  insert into public.events (space_id, event_type_id, title, event_date, anchor_type, anchor_id,
    projection, date_precision, end_date, end_date_precision, is_ongoing, description,
    significance, visibility, source_doc_id)
  values (p_space_id, p_event_type_id, p_title, p_event_date, p_anchor_type, p_anchor_id,
    p_projection, p_date_precision, p_end_date, p_end_date_precision, p_is_ongoing, p_description,
    p_significance, p_visibility, p_source_doc_id)
  returning id into v_id;

  -- Atomic inline source insert (same definer tx). Skip empty/blank urls;
  -- sort_order = array ordinal so the stored order is deterministic.
  if p_sources is not null then
    insert into public.event_sources (event_id, url, label, sort_order)
    select v_id, (s.elem->>'url'), (s.elem->>'label'), (s.ord)::int
    from jsonb_array_elements(p_sources) with ordinality as s(elem, ord)
    where coalesce(s.elem->>'url','') <> '';
  end if;

  return v_id;
end; $function$;

-- 2. update_event: stop WRITING source_url (param kept, now vestigial).
-- Preserves the task-CA Activity emit (trial_change_events row) byte-identical.
create or replace function public.update_event(p_event_id uuid, p_title text, p_event_date date, p_projection text, p_date_precision text, p_end_date date, p_end_date_precision text, p_is_ongoing boolean, p_description text, p_source_url text, p_significance text, p_visibility text, p_no_longer_expected boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_space          uuid;
  v_old_event_date date;
  v_anchor_type    text;
  v_anchor_id      uuid;
  v_old_title      text;
  v_old_description text;
  v_event_type     text;
begin
  -- capture-before: read the old row's space + the fields the Activity emit
  -- needs (event_date / anchor / title / description) in a single lookup.
  select space_id, event_date, anchor_type, anchor_id, title, description
    into v_space, v_old_event_date, v_anchor_type, v_anchor_id, v_old_title, v_old_description
    from public.events where id = p_event_id;
  if v_space is null then raise exception 'event not found' using errcode = 'P0002'; end if;
  if not public.has_space_access(v_space, array['owner','editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_is_ongoing and p_end_date is not null then
    raise exception 'an ongoing event cannot have an end date' using errcode = '22023';
  end if;
  -- p_source_url is vestigial: citations flow through p_sources / event_sources.
  -- The param is kept for positional-caller stability and dropped in Stage 3.
  update public.events set
    title = p_title, event_date = p_event_date, projection = p_projection, date_precision = p_date_precision,
    end_date = p_end_date, end_date_precision = p_end_date_precision, is_ongoing = p_is_ongoing,
    description = p_description, significance = p_significance,
    visibility = p_visibility, no_longer_expected = p_no_longer_expected
  where id = p_event_id;

  -- Activity emit (task CA gap b). trial_change_events is the Activity-feed
  -- source and trial_id is NOT NULL, so we emit ONLY for trial-anchored events.
  -- LIMITATION: company-/asset-anchored event edits do not reach Activity in
  -- v1, and the manage marker inline-edit path (which does NOT call this RPC)
  -- emits nothing until Stage 3 routes all edits through update_event.
  if v_anchor_type = 'trial' and v_anchor_id is not null
     and (v_old_event_date is distinct from p_event_date
          or v_old_title is distinct from p_title
          or v_old_description is distinct from p_description) then
    v_event_type := case when v_old_event_date is distinct from p_event_date
                         then 'date_moved' else 'event_edited' end;
    insert into public.trial_change_events
      (trial_id, space_id, event_type, source, payload, occurred_at, event_id)
    values (
      v_anchor_id,
      v_space,
      v_event_type,
      'analyst',
      case when v_event_type = 'date_moved'
           then jsonb_build_object(
             'which_date', 'event_date',
             'from',       v_old_event_date,
             'to',         p_event_date,
             'days_diff',  case when v_old_event_date is not null and p_event_date is not null
                                then p_event_date - v_old_event_date else null end,
             'direction',  case when v_old_event_date is null or p_event_date is null then null
                                when p_event_date > v_old_event_date then 'slip'
                                when p_event_date < v_old_event_date then 'accelerate'
                                else 'none' end
           )
           else jsonb_build_object('title', p_title)
      end,
      now(),
      p_event_id
    );
  end if;
end;
$function$;

-- 3a. _dashboard_anchor_events: drop the source_url output key (keep sources + registry_url).
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

-- 3b. get_catalyst_detail: drop the source_url output key (keep sources + registry_url).
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

-- 3c. get_events_page_data: drop the source_url output key. source_url appears
-- in three coupled positions (events-leg select, detected-leg union-balancing
-- alias, enriched item key); all three are removed together so the UNION ALL
-- stays balanced. The sources[] + registry_url keys (S2) are kept.
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

-- 3d. get_key_catalysts: drop the source_url output key (keep sources + registry_url).
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

-- 4. Drop the column now that nothing reads or writes it.
alter table public.events drop column source_url;

-- Post-drop smoke: prove no surviving events.source_url reference time-bombs at
-- CALL time (a stale reference would raise 42703 here, not at definition time).
-- Data-conditional on the demo space, self-cleaning, prod-safe.
do $smoke$
declare
  v_demo_space constant uuid := '00000000-0000-0000-0000-0000000d0100';
  v_seed record;
  v_event_id uuid;
  v_page jsonb;
  v_has_col boolean;
begin
  -- Column is gone (schema-level assertion, runs regardless of demo data).
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events' and column_name = 'source_url'
  ) into v_has_col;
  if v_has_col then
    raise exception 'S5 smoke: events.source_url still present after drop';
  end if;

  if not exists (select 1 from public.spaces where id = v_demo_space) then
    raise notice 'S5 smoke skipped: demo space % absent (prod-safe)', v_demo_space;
    return;
  end if;

  -- Borrow an existing trial-anchored event so create_event's anchor + type are
  -- valid for the space; spoof the owner JWT for the has_space_access gate.
  select e.event_type_id, e.anchor_type, e.anchor_id
    into v_seed
  from public.events e
  where e.space_id = v_demo_space and e.anchor_type = 'trial' and e.anchor_id is not null
  limit 1;

  if v_seed.event_type_id is null then
    raise notice 'S5 smoke skipped: no trial-anchored seed event in demo space % (prod-safe)', v_demo_space;
    return;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', (select created_by from public.spaces where id = v_demo_space),
                      'role', 'authenticated')::text, true);

  -- create_event WITH p_sources: exercises the insert (no source_url column) +
  -- the atomic event_sources write. A surviving column ref would 42703 here.
  v_event_id := public.create_event(
    p_space_id      => v_demo_space,
    p_event_type_id => v_seed.event_type_id,
    p_title         => 'S5 smoke scratch event',
    p_event_date    => current_date,
    p_anchor_type   => v_seed.anchor_type,
    p_anchor_id     => v_seed.anchor_id,
    p_source_url    => 'https://example.com/vestigial-ignored',
    p_sources       => jsonb_build_array(jsonb_build_object('url', 'https://example.com/cite', 'label', 'Cite'))
  );
  if v_event_id is null then
    raise exception 'S5 smoke: create_event returned null';
  end if;

  -- update_event (vestigial p_source_url passed positionally): exercises the
  -- UPDATE that no longer writes source_url + the CA Activity emit path.
  perform public.update_event(
    v_event_id, 'S5 smoke scratch event (edited)', current_date,
    'actual', 'exact', null, 'exact', false, 'edited description',
    'https://example.com/vestigial-ignored', null, null, false);

  -- A read RPC must return without error post-drop.
  v_page := public.get_events_page_data(p_space_id => v_demo_space);
  if jsonb_typeof(v_page -> 'items') is distinct from 'array' then
    raise exception 'S5 smoke: get_events_page_data items is not an array';
  end if;

  -- Clean up the scratch event (event_sources + trial_change_events cascade /
  -- reference it; delete children first, then the event).
  delete from public.trial_change_events where event_id = v_event_id;
  delete from public.event_sources where event_id = v_event_id;
  delete from public.events where id = v_event_id;

  perform set_config('request.jwt.claims', null, true);

  raise notice 'S5 smoke PASS: column dropped; create_event/update_event/get_events_page_data run clean on demo space %', v_demo_space;
end;
$smoke$;

notify pgrst, 'reload schema';
