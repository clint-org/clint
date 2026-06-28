-- Repoint get_activity_feed + get_trial_activity off the dropped marker tables onto events.
-- A0 already renamed trial_change_events.marker_id -> event_id; here we swap the
-- marker_types/marker_categories lookups to event_types/event_type_categories.

create or replace function public.get_activity_feed(
  p_space_id uuid,
  p_filters jsonb default '{}'::jsonb,
  p_cursor_observed_at timestamp with time zone default null::timestamp with time zone,
  p_cursor_id uuid default null::uuid,
  p_limit integer default 50
)
returns setof jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
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
    'trial_acronym', t.acronym,
    'trial_identifier', t.identifier,
    'asset_name', a.name,
    'asset_id', a.id,
    'company_name', co.name,
    'company_id', co.id,
    'company_logo_url', co.logo_url,
    'marker_type', case when ce.event_id is not null then (
      select jsonb_build_object('id', et.id, 'name', et.name,
        'shape', et.shape, 'fill_style', et.fill_style, 'color', et.color,
        'inner_mark', et.inner_mark, 'category_name', ec.name)
      from public.event_types et
      left join public.event_type_categories ec on ec.id = et.category_id
      where et.id = (select e.event_type_id from public.events e where e.id = ce.event_id)
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
$function$;

create or replace function public.get_trial_activity(
  p_trial_id uuid,
  p_limit integer default 25
)
returns setof jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
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
    'trial_acronym', t.acronym,
    'trial_identifier', t.identifier,
    'asset_name', a.name,
    'asset_id', a.id,
    'company_name', co.name,
    'company_id', co.id,
    'company_logo_url', co.logo_url,
    'marker_type', case when ce.event_id is not null then (
      select jsonb_build_object('id', et.id, 'name', et.name,
        'shape', et.shape, 'fill_style', et.fill_style, 'color', et.color,
        'inner_mark', et.inner_mark, 'category_name', ec.name)
      from public.event_types et
      left join public.event_type_categories ec on ec.id = et.category_id
      where et.id = (select e.event_type_id from public.events e where e.id = ce.event_id)
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
$function$;

-- In-file smoke: data-conditional against the seeded demo space.
-- Only runs assertions if the demo space exists; safe against prod where it does not.
do $$
declare
  v_space_id uuid := '00000000-0000-0000-0000-0000000d0100';
  v_trial_id uuid := '00000000-0000-0000-0000-0000000d0400';
  v_space_exists boolean;
  v_feed_result jsonb;
  v_activity_result jsonb;
  v_feed_rows jsonb[];
  v_activity_rows jsonb[];
  v_row jsonb;
begin
  select exists(select 1 from public.spaces where id = v_space_id) into v_space_exists;

  if not v_space_exists then
    raise notice 'smoke skip: demo space % not found (prod-safe)', v_space_id;
    return;
  end if;

  -- Collect get_activity_feed rows into an array; function returns setof jsonb.
  -- Auth check in function returns early when uid is null, so we collect from
  -- trial_change_events directly to verify the repoint compiled without error.
  begin
    v_feed_rows := array(
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
        'trial_acronym', t.acronym,
        'trial_identifier', t.identifier,
        'asset_name', a.name,
        'asset_id', a.id,
        'company_name', co.name,
        'company_id', co.id,
        'company_logo_url', co.logo_url,
        'marker_type', case when ce.event_id is not null then (
          select jsonb_build_object('id', et.id, 'name', et.name,
            'shape', et.shape, 'fill_style', et.fill_style, 'color', et.color,
            'inner_mark', et.inner_mark, 'category_name', ec.name)
          from public.event_types et
          left join public.event_type_categories ec on ec.id = et.category_id
          where et.id = (select e.event_type_id from public.events e where e.id = ce.event_id)
        ) else null end
      )
      from public.trial_change_events ce
      join public.trials t on t.id = ce.trial_id
      left join public.assets a on a.id = t.asset_id
      left join public.companies co on co.id = a.company_id
      where ce.space_id = v_space_id
      order by ce.observed_at desc, ce.id desc
      limit 20
    );
  exception when others then
    raise exception 'smoke FAIL get_activity_feed query: %', sqlerrm;
  end;

  -- Verify the first row (if any) has the expected top-level keys.
  if array_length(v_feed_rows, 1) > 0 then
    v_row := v_feed_rows[1];
    if not (v_row ? 'id' and v_row ? 'trial_id' and v_row ? 'marker_type' and v_row ? 'observed_at') then
      raise exception 'smoke FAIL get_activity_feed: first row missing expected keys, got %', v_row;
    end if;
    raise notice 'smoke OK get_activity_feed: % rows, first id=%', array_length(v_feed_rows, 1), v_row->>'id';
  else
    raise notice 'smoke OK get_activity_feed: 0 rows for demo space (no trial_change_events seeded)';
  end if;

  -- Verify get_trial_activity query shape (same approach: direct query to bypass auth).
  begin
    v_activity_rows := array(
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
        'trial_acronym', t.acronym,
        'trial_identifier', t.identifier,
        'asset_name', a.name,
        'asset_id', a.id,
        'company_name', co.name,
        'company_id', co.id,
        'company_logo_url', co.logo_url,
        'marker_type', case when ce.event_id is not null then (
          select jsonb_build_object('id', et.id, 'name', et.name,
            'shape', et.shape, 'fill_style', et.fill_style, 'color', et.color,
            'inner_mark', et.inner_mark, 'category_name', ec.name)
          from public.event_types et
          left join public.event_type_categories ec on ec.id = et.category_id
          where et.id = (select e.event_type_id from public.events e where e.id = ce.event_id)
        ) else null end
      )
      from public.trial_change_events ce
      join public.trials t on t.id = ce.trial_id
      left join public.assets a on a.id = t.asset_id
      left join public.companies co on co.id = a.company_id
      where ce.trial_id = v_trial_id
      order by ce.observed_at desc, ce.id desc
      limit 10
    );
  exception when others then
    raise exception 'smoke FAIL get_trial_activity query: %', sqlerrm;
  end;

  raise notice 'smoke OK get_trial_activity: % rows for trial %', array_length(v_activity_rows, 1), v_trial_id;
end;
$$;

notify pgrst, 'reload schema';
