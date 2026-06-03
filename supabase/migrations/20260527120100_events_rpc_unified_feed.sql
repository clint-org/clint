-- migration: 20260527120100_events_rpc_unified_feed
-- purpose: extend get_events_page_data with a third UNION leg for
--          trial_change_events ("detected" source type) and server-side
--          pagination. the return shape changes from a flat jsonb array to
--          { items: jsonb[], total: bigint } so the client can drive
--          server-side paging.
--
-- depends on: 20260527120000_change_event_annotations (T1)
-- spec: docs/specs/unified-feed-merge/spec.md (T2)

-- drop the existing function signature before recreating
drop function if exists public.get_events_page_data(
  uuid, date, date, text, uuid, uuid[], text[], text, text, int, int
);

-- =============================================================================
-- helper: humanize a phase enum value
-- 'PHASE1' -> 'Phase 1', 'PHASE2' -> 'Phase 2', 'PHASE3' -> 'Phase 3',
-- 'PHASE4' -> 'Phase 4', 'EARLY_PHASE1' -> 'Early phase 1',
-- 'NA' -> 'N/A'
-- =============================================================================
create or replace function public._humanize_phase(val text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case upper(val)
    when 'PHASE1'       then 'Phase 1'
    when 'PHASE2'       then 'Phase 2'
    when 'PHASE3'       then 'Phase 3'
    when 'PHASE4'       then 'Phase 4'
    when 'EARLY_PHASE1' then 'Early phase 1'
    when 'NA'           then 'N/A'
    else initcap(replace(val, '_', ' '))
  end;
$$;

-- =============================================================================
-- helper: humanize a trial status enum value
-- 'RECRUITING' -> 'Recruiting'
-- 'ACTIVE_NOT_RECRUITING' -> 'Active, not recruiting'
-- 'NOT_YET_RECRUITING' -> 'Not yet recruiting'
-- 'COMPLETED' -> 'Completed', etc.
-- =============================================================================
create or replace function public._humanize_status(val text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case upper(val)
    when 'RECRUITING'               then 'Recruiting'
    when 'ACTIVE_NOT_RECRUITING'    then 'Active, not recruiting'
    when 'NOT_YET_RECRUITING'       then 'Not yet recruiting'
    when 'COMPLETED'                then 'Completed'
    when 'TERMINATED'               then 'Terminated'
    when 'WITHDRAWN'                then 'Withdrawn'
    when 'SUSPENDED'                then 'Suspended'
    when 'ENROLLING_BY_INVITATION'  then 'Enrolling by invitation'
    when 'AVAILABLE'                then 'Available'
    when 'NO_LONGER_AVAILABLE'      then 'No longer available'
    when 'APPROVED_FOR_MARKETING'   then 'Approved for marketing'
    when 'TEMPORARILY_NOT_AVAILABLE' then 'Temporarily not available'
    when 'WITHHELD'                 then 'Withheld'
    when 'UNKNOWN_STATUS'           then 'Unknown status'
    else initcap(replace(val, '_', ' '))
  end;
$$;

-- =============================================================================
-- main RPC: get_events_page_data
-- =============================================================================
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
    -- =====================================================================
    -- leg 1: events (human-authored intelligence)
    -- =====================================================================
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
      coalesce(t.name, a.name, co.name, 'Industry') as entity_name,
      coalesce(ev.trial_id, ev.asset_id, ev.company_id) as entity_id,
      coalesce(co.name, co_via_asset.name, co_via_trial.name) as company_name,
      ev.tags,
      ev.thread_id is not null as has_thread,
      ev.thread_id,
      ev.description,
      null::text as source_url,
      ev.created_at,
      -- new columns (null for events)
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
      and (p_date_from is null or ev.event_date >= p_date_from)
      and (p_date_to is null or ev.event_date <= p_date_to)
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

    -- =====================================================================
    -- leg 2: markers (catalyst markers)
    -- =====================================================================
    select
      'marker'::text as source_type,
      m.id,
      m.title,
      m.event_date,
      mc.name as category_name,
      mc.id as category_id,
      null::text as priority,
      'trial'::text as entity_level,
      t.name as entity_name,
      t.id as entity_id,
      co.name as company_name,
      '{}'::text[] as tags,
      false as has_thread,
      null::uuid as thread_id,
      m.description,
      m.source_url,
      m.created_at,
      -- new columns (null for markers)
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
      and (p_date_from is null or m.event_date >= p_date_from)
      and (p_date_to is null or m.event_date <= p_date_to)
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

    -- =====================================================================
    -- leg 3: trial_change_events (detected CT.gov changes)
    -- =====================================================================
    select
      'detected'::text as source_type,
      ce.id,
      -- title: humanized summary from event_type + payload
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
      -- category_name: derived from event_type group
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
      -- priority: high_signal rules
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
      coalesce(a.name, t.name) as entity_name,
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
      -- new columns for detected events
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
      and (p_date_from is null or ce.occurred_at::date >= p_date_from)
      and (p_date_to is null or ce.occurred_at::date <= p_date_to)
      -- entity_level: detected events are always trial-scoped
      and (p_entity_level is null or p_entity_level = 'trial')
      -- entity_id: filter on trial_id when scoped to trial
      and (
        p_entity_id is null
        or ce.trial_id = p_entity_id
      )
      -- category_ids: not applicable for detected events (no FK)
      -- tags: not applicable for detected events
      -- priority: filter on computed priority
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
  -- =====================================================================
  -- paginated result with total count
  -- =====================================================================
  counted as (
    select
      uf.*,
      count(*) over() as total_count
    from unified_feed uf
    order by uf.event_date desc, uf.id desc
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
        order by r.event_date desc, r.id desc
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
  'Unified feed RPC returning events, markers, and detected trial changes in a single paginated result. Returns {items: jsonb[], total: bigint}. Filters: date range, entity scope, category, tags, priority, source_type (event|marker|detected). Server-side pagination via p_limit/p_offset. SECURITY INVOKER.';

-- =============================================================================
-- smoke tests
-- =============================================================================
do $$
declare
  v_agency_id    uuid := 'cccccccc-0001-0001-0001-cccccccccc01';
  v_tenant_id    uuid := 'cccccccc-0002-0002-0002-cccccccccc02';
  v_owner_id     uuid := 'cccccccc-0003-0003-0003-cccccccccc03';
  v_space_id     uuid := 'cccccccc-0004-0004-0004-cccccccccc04';
  v_company_id   uuid := 'cccccccc-0005-0005-0005-cccccccccc05';
  v_asset_id     uuid := 'cccccccc-0006-0006-0006-cccccccccc06';
  v_trial_id     uuid := 'cccccccc-0007-0007-0007-cccccccccc07';
  v_cat_id       uuid := 'cccccccc-0008-0008-0008-cccccccccc08';
  v_event_id     uuid := 'cccccccc-0009-0009-0009-cccccccccc09';
  v_marker_type_id uuid;
  v_marker_id    uuid := 'cccccccc-000a-000a-000a-cccccccccc0a';
  v_ce_id_1      uuid := 'cccccccc-000b-000b-000b-cccccccccc0b';
  v_ce_id_2      uuid := 'cccccccc-000c-000c-000c-cccccccccc0c';
  v_ce_id_3      uuid := 'cccccccc-000d-000d-000d-cccccccccc0d';
  v_ce_id_4      uuid := 'cccccccc-000e-000e-000e-cccccccccc0e';
  v_result       jsonb;
  v_items        jsonb;
  v_total        int;
  v_item         jsonb;
  v_count        int;
  v_source_types text[];
begin
  -- =========================================================================
  -- bootstrap hermetic fixture
  insert into auth.users (id, email) values
    (v_owner_id, 'unified-feed-owner@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'UF Smoke', 'uf-smoke', 'ufsmoke', 'UF', 'uf@y.z');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'UF', 'uf-smoke-t', 'ufsmoket', 'UF');

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant_id, v_owner_id, 'owner');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_owner_id);

  insert into public.space_members (space_id, user_id, role)
    values (v_space_id, v_owner_id, 'owner');

  insert into public.companies (id, space_id, created_by, name, logo_url)
    values (v_company_id, v_space_id, v_owner_id, 'UF Pharma', 'https://example.com/logo.png');

  insert into public.assets (id, space_id, created_by, company_id, name)
    values (v_asset_id, v_space_id, v_owner_id, v_company_id, 'Wonderdrug');

  insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
    values (v_trial_id, v_space_id, v_owner_id, v_asset_id, 'TRIAL_UF', 'NCT-UF-001');

  -- insert an event category
  insert into public.event_categories (id, space_id, name, display_order, created_by)
    values (v_cat_id, v_space_id, 'Regulatory', 1, v_owner_id);

  -- insert a human event
  insert into public.events (id, space_id, created_by, category_id, title, event_date, trial_id)
    values (v_event_id, v_space_id, v_owner_id, v_cat_id, 'FDA filing', '2026-05-01'::date, v_trial_id);

  -- insert a marker
  select id into v_marker_type_id from public.marker_types limit 1;
  insert into public.markers (id, space_id, created_by, marker_type_id, title, event_date, projection)
    values (v_marker_id, v_space_id, v_owner_id, v_marker_type_id, 'PDUFA date', '2026-06-15'::date, 'primary');
  insert into public.marker_assignments (marker_id, trial_id)
    values (v_marker_id, v_trial_id);

  -- insert detected change events
  insert into public.trial_change_events (
    id, trial_id, space_id, event_type, source, payload, occurred_at, observed_at
  ) values
    (v_ce_id_1, v_trial_id, v_space_id, 'phase_transitioned', 'ctgov',
     jsonb_build_object('from', 'PHASE2', 'to', 'PHASE3'),
     '2026-05-10'::timestamptz, '2026-05-10'::timestamptz),
    (v_ce_id_2, v_trial_id, v_space_id, 'status_changed', 'ctgov',
     jsonb_build_object('from', 'RECRUITING', 'to', 'COMPLETED'),
     '2026-05-12'::timestamptz, '2026-05-12'::timestamptz),
    (v_ce_id_3, v_trial_id, v_space_id, 'date_moved', 'ctgov',
     jsonb_build_object('field', 'primary_completion_date', 'days_shifted', '90'),
     '2026-05-14'::timestamptz, '2026-05-14'::timestamptz),
    (v_ce_id_4, v_trial_id, v_space_id, 'sponsor_changed', 'ctgov',
     jsonb_build_object('from', 'OldSponsor', 'to', 'NewSponsor'),
     '2026-05-15'::timestamptz, '2026-05-15'::timestamptz);

  -- act as the owner
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  -- =========================================================================
  -- test 1: p_source_type = NULL returns all three source types
  v_result := public.get_events_page_data(v_space_id);

  v_items := v_result -> 'items';
  v_total := (v_result ->> 'total')::int;

  if v_items is null or jsonb_typeof(v_items) <> 'array' then
    raise exception 'unified feed smoke FAIL test 1: items is not an array';
  end if;
  if v_total < 3 then
    raise exception 'unified feed smoke FAIL test 1: expected total >= 3, got %', v_total;
  end if;

  -- collect distinct source_types
  select array_agg(distinct s)
  into v_source_types
  from jsonb_array_elements(v_items) elem,
       lateral (select elem ->> 'source_type' as s) x;

  if not ('event' = any(v_source_types)) then
    raise exception 'unified feed smoke FAIL test 1: missing source_type=event';
  end if;
  if not ('marker' = any(v_source_types)) then
    raise exception 'unified feed smoke FAIL test 1: missing source_type=marker';
  end if;
  if not ('detected' = any(v_source_types)) then
    raise exception 'unified feed smoke FAIL test 1: missing source_type=detected';
  end if;
  raise notice 'unified feed smoke ok test 1: all three source types present';

  -- =========================================================================
  -- test 2: p_source_type = 'detected' returns only detected items
  v_result := public.get_events_page_data(v_space_id, p_source_type := 'detected');
  v_items := v_result -> 'items';
  v_total := (v_result ->> 'total')::int;

  if v_total <> 4 then
    raise exception 'unified feed smoke FAIL test 2: expected total = 4 detected, got %', v_total;
  end if;

  select count(distinct s)
  into v_count
  from jsonb_array_elements(v_items) elem,
       lateral (select elem ->> 'source_type' as s) x
  where s <> 'detected';

  if v_count > 0 then
    raise exception 'unified feed smoke FAIL test 2: non-detected items leaked through';
  end if;
  raise notice 'unified feed smoke ok test 2: source_type=detected filter works';

  -- =========================================================================
  -- test 3: p_source_type = 'event' returns only events (no detected)
  v_result := public.get_events_page_data(v_space_id, p_source_type := 'event');
  v_items := v_result -> 'items';
  v_total := (v_result ->> 'total')::int;

  if v_total <> 1 then
    raise exception 'unified feed smoke FAIL test 3: expected total = 1 event, got %', v_total;
  end if;

  v_item := v_items -> 0;
  if v_item ->> 'source_type' <> 'event' then
    raise exception 'unified feed smoke FAIL test 3: expected source_type=event, got %', v_item ->> 'source_type';
  end if;
  raise notice 'unified feed smoke ok test 3: source_type=event filter excludes detected';

  -- =========================================================================
  -- test 4: server-side pagination (p_limit = 1, total should be > 1)
  v_result := public.get_events_page_data(v_space_id, p_limit := 1);
  v_items := v_result -> 'items';
  v_total := (v_result ->> 'total')::int;

  if jsonb_array_length(v_items) <> 1 then
    raise exception 'unified feed smoke FAIL test 4: expected 1 item with limit=1, got %',
      jsonb_array_length(v_items);
  end if;
  if v_total <= 1 then
    raise exception 'unified feed smoke FAIL test 4: expected total > 1, got %', v_total;
  end if;
  raise notice 'unified feed smoke ok test 4: pagination returns 1 item with correct total=%', v_total;

  -- =========================================================================
  -- test 5: category mapping for phase_transitioned -> 'Phase'
  v_result := public.get_events_page_data(v_space_id, p_source_type := 'detected');
  v_items := v_result -> 'items';

  select elem into v_item
  from jsonb_array_elements(v_items) elem
  where elem ->> 'change_event_type' = 'phase_transitioned'
  limit 1;

  if v_item is null then
    raise exception 'unified feed smoke FAIL test 5: no phase_transitioned event found';
  end if;
  if v_item ->> 'category_name' <> 'Phase' then
    raise exception 'unified feed smoke FAIL test 5: expected category_name=Phase, got %',
      v_item ->> 'category_name';
  end if;
  if v_item ->> 'title' <> 'Phase: Phase 2 -> Phase 3' then
    raise exception 'unified feed smoke FAIL test 5: expected humanized title, got %',
      v_item ->> 'title';
  end if;
  raise notice 'unified feed smoke ok test 5: category mapping phase_transitioned -> Phase, title humanized';

  -- =========================================================================
  -- test 6: priority mapping (phase_transitioned = high, status_changed to
  --         COMPLETED = high, sponsor_changed = high, date_moved 90 days = high)
  -- phase_transitioned
  select elem into v_item
  from jsonb_array_elements(v_items) elem
  where elem ->> 'change_event_type' = 'phase_transitioned'
  limit 1;
  if v_item ->> 'priority' <> 'high' then
    raise exception 'unified feed smoke FAIL test 6a: phase_transitioned priority should be high, got %',
      v_item ->> 'priority';
  end if;

  -- status_changed to COMPLETED
  select elem into v_item
  from jsonb_array_elements(v_items) elem
  where elem ->> 'change_event_type' = 'status_changed'
  limit 1;
  if v_item ->> 'priority' <> 'high' then
    raise exception 'unified feed smoke FAIL test 6b: status_changed to COMPLETED priority should be high, got %',
      v_item ->> 'priority';
  end if;

  -- sponsor_changed
  select elem into v_item
  from jsonb_array_elements(v_items) elem
  where elem ->> 'change_event_type' = 'sponsor_changed'
  limit 1;
  if v_item ->> 'priority' <> 'high' then
    raise exception 'unified feed smoke FAIL test 6c: sponsor_changed priority should be high, got %',
      v_item ->> 'priority';
  end if;

  -- date_moved 90 days (> 60 threshold)
  select elem into v_item
  from jsonb_array_elements(v_items) elem
  where elem ->> 'change_event_type' = 'date_moved'
  limit 1;
  if v_item ->> 'priority' <> 'high' then
    raise exception 'unified feed smoke FAIL test 6d: date_moved 90 days priority should be high, got %',
      v_item ->> 'priority';
  end if;

  raise notice 'unified feed smoke ok test 6: priority mapping correct for all high_signal cases';

  -- =========================================================================
  -- test 7: new columns present on detected rows (change_event_type, change_payload,
  --         change_source, has_annotation, observed_at, company_logo_url, source_url)
  select elem into v_item
  from jsonb_array_elements(v_items) elem
  where elem ->> 'source_type' = 'detected'
  limit 1;

  if v_item ->> 'change_event_type' is null then
    raise exception 'unified feed smoke FAIL test 7: change_event_type is null for detected';
  end if;
  if v_item -> 'change_payload' is null then
    raise exception 'unified feed smoke FAIL test 7: change_payload is null for detected';
  end if;
  if v_item ->> 'change_source' is null then
    raise exception 'unified feed smoke FAIL test 7: change_source is null for detected';
  end if;
  if v_item ->> 'entity_name' <> 'Wonderdrug' then
    raise exception 'unified feed smoke FAIL test 7: entity_name should be asset name Wonderdrug, got %',
      v_item ->> 'entity_name';
  end if;
  if v_item ->> 'company_name' <> 'UF Pharma' then
    raise exception 'unified feed smoke FAIL test 7: company_name should be UF Pharma, got %',
      v_item ->> 'company_name';
  end if;
  if v_item ->> 'company_logo_url' <> 'https://example.com/logo.png' then
    raise exception 'unified feed smoke FAIL test 7: company_logo_url mismatch, got %',
      v_item ->> 'company_logo_url';
  end if;
  if v_item ->> 'source_url' <> 'https://clinicaltrials.gov/study/NCT-UF-001' then
    raise exception 'unified feed smoke FAIL test 7: source_url mismatch, got %',
      v_item ->> 'source_url';
  end if;
  raise notice 'unified feed smoke ok test 7: new columns correct on detected rows';

  -- =========================================================================
  -- test 8: annotation indicator
  -- insert an annotation on ce_id_1, verify has_annotation = true
  insert into public.change_event_annotations (change_event_id, space_id, body)
    values (v_ce_id_1, v_space_id, 'Test annotation');

  v_result := public.get_events_page_data(v_space_id, p_source_type := 'detected');
  v_items := v_result -> 'items';

  select elem into v_item
  from jsonb_array_elements(v_items) elem
  where (elem ->> 'id')::uuid = v_ce_id_1
  limit 1;

  if (v_item ->> 'has_annotation')::boolean is not true then
    raise exception 'unified feed smoke FAIL test 8: has_annotation should be true for annotated event';
  end if;

  -- verify non-annotated event has has_annotation = false
  select elem into v_item
  from jsonb_array_elements(v_items) elem
  where (elem ->> 'id')::uuid = v_ce_id_2
  limit 1;

  if (v_item ->> 'has_annotation')::boolean is not false then
    raise exception 'unified feed smoke FAIL test 8: has_annotation should be false for non-annotated event';
  end if;
  raise notice 'unified feed smoke ok test 8: annotation indicator works';

  -- =========================================================================
  -- test 9: new columns are null for event/marker rows
  v_result := public.get_events_page_data(v_space_id, p_source_type := 'event');
  v_items := v_result -> 'items';
  v_item := v_items -> 0;

  if v_item -> 'change_event_type' <> 'null'::jsonb then
    raise exception 'unified feed smoke FAIL test 9: change_event_type should be null for events, got %',
      v_item ->> 'change_event_type';
  end if;
  if v_item -> 'change_payload' <> 'null'::jsonb then
    raise exception 'unified feed smoke FAIL test 9: change_payload should be null for events';
  end if;
  if (v_item ->> 'has_annotation')::boolean is not false then
    raise exception 'unified feed smoke FAIL test 9: has_annotation should be false for events';
  end if;
  raise notice 'unified feed smoke ok test 9: new columns null for event rows';

  -- =========================================================================
  -- cleanup
  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);

  delete from public.change_event_annotations where space_id = v_space_id;
  delete from public.trial_change_events where space_id = v_space_id;
  delete from public.markers where space_id = v_space_id;
  delete from public.events where space_id = v_space_id;
  delete from public.event_categories where space_id = v_space_id;
  delete from public.space_members where space_id = v_space_id;
  delete from public.tenant_members where tenant_id = v_tenant_id;
  delete from public.tenants  where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_owner_id;

  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'unified feed smoke test: PASS';
end$$;
