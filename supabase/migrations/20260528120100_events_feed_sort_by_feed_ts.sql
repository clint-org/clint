-- 20260528120100_events_feed_sort_by_feed_ts.sql
-- Sort the unified events feed by a full timestamptz (feed_ts) so same-day
-- rows order deterministically by arrival, not by random UUID tiebreaker.
-- Each leg's feed_ts:
--   events:   ev.created_at
--   markers:  m.created_at
--   detected: coalesce(ce.observed_at, ce.occurred_at)
-- Date-range filters (p_date_from, p_date_to) also shift to feed_ts so the
-- "Logged" column header in the UI matches its filter semantics.

-- =============================================================================
-- recreate get_events_page_data: add feed_ts column, sort by feed_ts desc
-- =============================================================================
drop function if exists public.get_events_page_data(
  uuid, date, date, text, uuid, uuid[], text[], text, text, int, int
);

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
  p_offset        int      default 0
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
  if p_tags = '{}' then p_tags := null; end if;

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
      null::text as company_logo_url
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
        or (p_entity_level in ('product', 'asset') and a_via_trial.id = p_entity_id)
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
      null::text as company_logo_url
    from public.markers m
    join public.marker_assignments ma on ma.marker_id = m.id
    join public.trials t on t.id = ma.trial_id
    join public.assets a on a.id = t.asset_id
    join public.companies co on co.id = a.company_id
    join public.marker_types mt on mt.id = m.marker_type_id
    join public.marker_categories mc on mc.id = mt.category_id
    where m.space_id = p_space_id
      and (p_source_type is null or p_source_type = 'marker')
      and (p_date_from is null or m.created_at::date >= p_date_from)
      and (p_date_to is null or m.created_at::date <= p_date_to)
      and (p_tags is null)
      and (p_priority is null)
      and (p_category_ids is null or mc.id = any(p_category_ids))
      and (p_entity_level is null or p_entity_level = 'trial')
      and (
        p_entity_id is null
        or t.id = p_entity_id
        or a.id = p_entity_id
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
          initcap(replace(ce.payload ->> 'field', '_', ' '))
          || ' moved ' || (ce.payload ->> 'days_shifted')
          || ' days'
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
      case
        when ce.event_type = 'phase_transitioned' then 'high'
        when ce.event_type = 'trial_withdrawn' then 'high'
        when ce.event_type = 'sponsor_changed' then 'high'
        when ce.event_type = 'status_changed'
          and upper(ce.payload ->> 'to') in ('COMPLETED', 'TERMINATED', 'WITHDRAWN', 'SUSPENDED')
          then 'high'
        when ce.event_type = 'date_moved'
          and abs((ce.payload ->> 'days_shifted')::int) > 60
          then 'high'
        else null
      end::text as priority,
      'trial'::text as entity_level,
      coalesce(a.name, t.acronym, t.name) as entity_name,
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
      co.logo_url::text as company_logo_url
    from public.trial_change_events ce
    join public.trials t on t.id = ce.trial_id
    left join public.assets a on a.id = t.asset_id
    left join public.companies co on a.id is not null and co.id = a.company_id
    where ce.space_id = p_space_id
      and (p_source_type is null or p_source_type = 'detected')
      and (p_date_from is null or coalesce(ce.observed_at, ce.occurred_at)::date >= p_date_from)
      and (p_date_to is null or coalesce(ce.observed_at, ce.occurred_at)::date <= p_date_to)
      and (p_entity_level is null or p_entity_level = 'trial')
      and (
        p_entity_id is null
        or ce.trial_id = p_entity_id
      )
      and (
        p_priority is null
        or p_priority = case
          when ce.event_type = 'phase_transitioned' then 'high'
          when ce.event_type = 'trial_withdrawn' then 'high'
          when ce.event_type = 'sponsor_changed' then 'high'
          when ce.event_type = 'status_changed'
            and upper(ce.payload ->> 'to') in ('COMPLETED', 'TERMINATED', 'WITHDRAWN', 'SUSPENDED')
            then 'high'
          when ce.event_type = 'date_moved'
            and abs((ce.payload ->> 'days_shifted')::int) > 60
            then 'high'
          else null
        end
      )
  ),
  counted as (
    select
      uf.*,
      count(*) over() as total_count
    from unified_feed uf
    order by uf.feed_ts desc, uf.id desc
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'items', coalesce(
      jsonb_agg(
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
          'company_name', r.company_name,
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
          'company_logo_url', r.company_logo_url
        )
        order by r.feed_ts desc, r.id desc
      ),
      '[]'::jsonb
    ),
    'total', coalesce(max(r.total_count), 0)
  )
  into v_result
  from counted r;

  return v_result;
end;
$$;

revoke execute on function public.get_events_page_data(
  uuid, date, date, text, uuid, uuid[], text[], text, text, int, int
) from public;
grant execute on function public.get_events_page_data(
  uuid, date, date, text, uuid, uuid[], text[], text, text, int, int
) to anon, authenticated;

comment on function public.get_events_page_data(
  uuid, date, date, text, uuid, uuid[], text[], text, text, int, int
) is
  'Unified feed RPC returning events, markers, and detected trial changes in a single paginated result. Returns {items: jsonb[], total: bigint}. Filters: date range, entity scope, category, tags, priority, source_type (event|marker|detected). Server-side pagination via p_limit/p_offset. Sorted by feed_ts desc (full timestamptz) for deterministic within-day ordering. feed_ts: events=created_at, markers=created_at, detected=coalesce(observed_at,occurred_at). Date filters also apply on feed_ts::date. SECURITY INVOKER.';

-- =============================================================================
-- smoke test: verify feed_ts is present and within-day ordering is correct.
-- uses a hermetic fixture in the ffffffff-* UUID namespace (distinct from
-- dddddddd-* used by acronym smoke and eeeeeee-* used by payload smoke).
-- =============================================================================
do $$
declare
  v_agency_id    uuid := 'ffffffff-0001-0001-0001-ffffffffffff';
  v_tenant_id    uuid := 'ffffffff-0002-0002-0002-ffffffffffff';
  v_owner_id     uuid := 'ffffffff-0003-0003-0003-ffffffffffff';
  v_space_id     uuid := 'ffffffff-0004-0004-0004-ffffffffffff';
  v_company_id   uuid := 'ffffffff-0005-0005-0005-ffffffffffff';
  v_asset_id     uuid := 'ffffffff-0006-0006-0006-ffffffffffff';
  v_trial_id     uuid := 'ffffffff-0007-0007-0007-ffffffffffff';
  v_cat_id       uuid := 'ffffffff-0008-0008-0008-ffffffffffff';
  v_event1_id    uuid := 'ffffffff-0009-0009-0009-ffffffffffff';
  v_event2_id    uuid := 'ffffffff-000a-000a-000a-ffffffffffff';
  v_result       jsonb;
  v_items        jsonb;
  v_item0        jsonb;
  v_item1        jsonb;
  v_ts0          timestamptz;
  v_ts1          timestamptz;
  v_earlier_ts   timestamptz := '2030-01-01 10:00:00+00'::timestamptz;
  v_later_ts     timestamptz := '2030-01-01 10:01:00+00'::timestamptz;
begin
  insert into auth.users (id, email)
    values (v_owner_id, 'feed-ts-smoke@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'FTS Smoke', 'fts-smoke', 'ftssmoke', 'FTS', 'fts@y.z');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'FTS', 'fts-smoke-t', 'ftssmoket', 'FTS');

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant_id, v_owner_id, 'owner');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_owner_id);

  insert into public.space_members (space_id, user_id, role)
    values (v_space_id, v_owner_id, 'owner');

  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_owner_id, 'FTS Pharma');

  insert into public.assets (id, space_id, created_by, company_id, name)
    values (v_asset_id, v_space_id, v_owner_id, v_company_id, 'FTSAsset');

  insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
    values (v_trial_id, v_space_id, v_owner_id, v_asset_id, 'FTS Trial', 'NCT-FTS-001');

  insert into public.event_categories (id, space_id, name, display_order, created_by)
    values (v_cat_id, v_space_id, 'Regulatory', 1, v_owner_id);

  -- event 1: created earlier (10:00); same calendar day as event 2.
  insert into public.events (id, space_id, created_by, category_id, title, event_date, trial_id, created_at)
    values (v_event1_id, v_space_id, v_owner_id, v_cat_id, 'Earlier event', '2030-01-01'::date, v_trial_id, v_earlier_ts);

  -- event 2: created later (10:01); same calendar day as event 1.
  insert into public.events (id, space_id, created_by, category_id, title, event_date, trial_id, created_at)
    values (v_event2_id, v_space_id, v_owner_id, v_cat_id, 'Later event', '2030-01-01'::date, v_trial_id, v_later_ts);

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  v_result := public.get_events_page_data(v_space_id, p_source_type := 'event');
  v_items  := v_result -> 'items';

  -- assert feed_ts field is present in the first item
  v_item0 := v_items -> 0;
  if v_item0 ->> 'feed_ts' is null then
    raise exception 'feed_ts smoke FAIL: feed_ts field missing from result item (got: %)', v_item0;
  end if;
  raise notice 'feed_ts smoke ok: feed_ts field is present';

  -- find the two items by id and assert ordering (later created_at sorts first)
  select elem into v_item0
    from jsonb_array_elements(v_items) elem
    where (elem ->> 'id')::uuid = v_event2_id
    limit 1;

  select elem into v_item1
    from jsonb_array_elements(v_items) elem
    where (elem ->> 'id')::uuid = v_event1_id
    limit 1;

  v_ts0 := (v_item0 ->> 'feed_ts')::timestamptz;
  v_ts1 := (v_item1 ->> 'feed_ts')::timestamptz;

  if v_ts0 is null then
    raise exception 'feed_ts smoke FAIL: feed_ts is null on event2 item';
  end if;
  if v_ts1 is null then
    raise exception 'feed_ts smoke FAIL: feed_ts is null on event1 item';
  end if;
  if v_ts0 <= v_ts1 then
    raise exception 'feed_ts smoke FAIL: later event (%) should have feed_ts > earlier event (%), got % <= %',
      v_event2_id, v_event1_id, v_ts0, v_ts1;
  end if;
  raise notice 'feed_ts smoke ok: later event has greater feed_ts (% > %)', v_ts0, v_ts1;

  -- also assert the items array is ordered with later event first (position 0)
  if (v_items -> 0 ->> 'id')::uuid <> v_event2_id then
    raise exception 'feed_ts smoke FAIL: first item should be the later event (%), got %',
      v_event2_id, v_items -> 0 ->> 'id';
  end if;
  raise notice 'feed_ts smoke ok: items[0] is the later-created event (correct desc order)';

  -- cleanup
  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);

  delete from public.events where space_id = v_space_id;
  delete from public.event_categories where space_id = v_space_id;
  delete from public.space_members where space_id = v_space_id;
  delete from public.tenant_members where tenant_id = v_tenant_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_owner_id;

  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'feed_ts smoke test: PASS';
end$$;
