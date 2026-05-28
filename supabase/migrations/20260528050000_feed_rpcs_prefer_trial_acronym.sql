-- migration: 20260528050000_feed_rpcs_prefer_trial_acronym
-- purpose: events feed and event detail RPCs were emitting raw trials.name as
--          entity_name. Since 20260528040000 (commit_source_import fix) the
--          NCT-import path correctly writes the CT.gov briefTitle into
--          trials.name, so analyst-facing surfaces that don't apply the
--          acronym-first convention now show the verbose briefTitle.
--
--          The rest of the app uses `trial.acronym ?? trial.name` for trial
--          labels (dashboard grid, pptx export, engagement landing). The
--          unified feed RPC (20260527120100) and the event detail RPC
--          (20260528012544) predate this and emit raw t.name. Bring both
--          into line.
--
-- depends on: 20260528003300 (trials.acronym column), 20260528040000 (briefTitle in trials.name)
-- touches:    get_events_page_data, get_event_detail
-- security:   SECURITY INVOKER read RPCs, no audit marker needed.

-- =============================================================================
-- recreate get_events_page_data: prefer t.acronym over t.name in all 3 legs
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
  'Unified feed RPC returning events, markers, and detected trial changes in a single paginated result. Returns {items: jsonb[], total: bigint}. Filters: date range, entity scope, category, tags, priority, source_type (event|marker|detected). Server-side pagination via p_limit/p_offset. entity_name uses coalesce(t.acronym, t.name) to match the client-side display convention. SECURITY INVOKER.';

-- =============================================================================
-- recreate get_event_detail: prefer t.acronym over t.name
-- =============================================================================
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

comment on function public.get_event_detail(uuid) is
  'Returns full detail for a single event including sources, thread, and linked events. entity_name uses coalesce(t.acronym, t.name) to match the client-side display convention. SECURITY INVOKER.';

-- =============================================================================
-- smoke tests: acronym preference across all three legs and detail RPC
-- =============================================================================
do $$
declare
  v_agency_id    uuid := 'dddddddd-0001-0001-0001-dddddddddd01';
  v_tenant_id    uuid := 'dddddddd-0002-0002-0002-dddddddddd02';
  v_owner_id     uuid := 'dddddddd-0003-0003-0003-dddddddddd03';
  v_space_id     uuid := 'dddddddd-0004-0004-0004-dddddddddd04';
  v_company_id   uuid := 'dddddddd-0005-0005-0005-dddddddddd05';
  v_asset_id     uuid := 'dddddddd-0006-0006-0006-dddddddddd06';
  v_trial_id     uuid := 'dddddddd-0007-0007-0007-dddddddddd07';
  v_trial2_id    uuid := 'dddddddd-0017-0017-0017-dddddddddd17';
  v_cat_id       uuid := 'dddddddd-0008-0008-0008-dddddddddd08';
  v_event_id     uuid := 'dddddddd-0009-0009-0009-dddddddddd09';
  v_marker_type_id uuid;
  v_marker_id    uuid := 'dddddddd-000a-000a-000a-dddddddddd0a';
  v_marker2_id   uuid := 'dddddddd-001a-001a-001a-dddddddddd1a';
  v_ce_id        uuid := 'dddddddd-000b-000b-000b-dddddddddd0b';
  v_brief_title  text := 'A Very Long Brief Title Describing An Obesity Drug Study In Detail';
  v_acronym      text := 'STEP-1';
  v_result       jsonb;
  v_items        jsonb;
  v_item         jsonb;
  v_detail       jsonb;
begin
  insert into auth.users (id, email) values
    (v_owner_id, 'acronym-feed-owner@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'AF Smoke', 'af-smoke', 'afsmoke', 'AF', 'af@y.z');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'AF', 'af-smoke-t', 'afsmoket', 'AF');

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant_id, v_owner_id, 'owner');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_owner_id);

  insert into public.space_members (space_id, user_id, role)
    values (v_space_id, v_owner_id, 'owner');

  insert into public.companies (id, space_id, created_by, name, logo_url)
    values (v_company_id, v_space_id, v_owner_id, 'AF Pharma', 'https://example.com/logo.png');

  insert into public.assets (id, space_id, created_by, company_id, name)
    values (v_asset_id, v_space_id, v_owner_id, v_company_id, 'WonderAsset');

  -- trial 1: has both briefTitle (stored in name) and acronym
  insert into public.trials (id, space_id, created_by, asset_id, name, acronym, identifier)
    values (v_trial_id, v_space_id, v_owner_id, v_asset_id, v_brief_title, v_acronym, 'NCT-AF-001');

  -- trial 2: has briefTitle in name, no acronym (fallback path)
  insert into public.trials (id, space_id, created_by, asset_id, name, acronym, identifier)
    values (v_trial2_id, v_space_id, v_owner_id, v_asset_id, 'Long Title No Acronym Trial', null, 'NCT-AF-002');

  insert into public.event_categories (id, space_id, name, display_order, created_by)
    values (v_cat_id, v_space_id, 'Regulatory', 1, v_owner_id);

  -- event scoped to trial 1 (acronym path)
  insert into public.events (id, space_id, created_by, category_id, title, event_date, trial_id)
    values (v_event_id, v_space_id, v_owner_id, v_cat_id, 'FDA filing', '2026-05-01'::date, v_trial_id);

  select id into v_marker_type_id from public.marker_types limit 1;

  -- marker on trial 1 (acronym path)
  insert into public.markers (id, space_id, created_by, marker_type_id, title, event_date, projection)
    values (v_marker_id, v_space_id, v_owner_id, v_marker_type_id, 'PDUFA date', '2026-06-15'::date, 'primary');
  insert into public.marker_assignments (marker_id, trial_id)
    values (v_marker_id, v_trial_id);

  -- marker on trial 2 (fallback path: name)
  insert into public.markers (id, space_id, created_by, marker_type_id, title, event_date, projection)
    values (v_marker2_id, v_space_id, v_owner_id, v_marker_type_id, 'Other date', '2026-07-15'::date, 'primary');
  insert into public.marker_assignments (marker_id, trial_id)
    values (v_marker2_id, v_trial2_id);

  -- detected change event on trial 1
  insert into public.trial_change_events (id, trial_id, space_id, event_type, source, payload, occurred_at, observed_at)
    values (v_ce_id, v_trial_id, v_space_id, 'phase_transitioned', 'ctgov',
            jsonb_build_object('from', 'PHASE2', 'to', 'PHASE3'),
            '2026-05-10'::timestamptz, '2026-05-10'::timestamptz);

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  -- =========================================================================
  -- marker leg: trial with acronym -> entity_name = acronym
  v_result := public.get_events_page_data(v_space_id, p_source_type := 'marker');
  v_items  := v_result -> 'items';

  select elem into v_item
  from jsonb_array_elements(v_items) elem
  where (elem ->> 'id')::uuid = v_marker_id
  limit 1;

  if v_item ->> 'entity_name' <> v_acronym then
    raise exception 'acronym feed smoke FAIL marker-with-acronym: expected %, got %',
      v_acronym, v_item ->> 'entity_name';
  end if;
  raise notice 'acronym feed smoke ok: marker leg prefers acronym';

  -- marker leg: trial without acronym -> entity_name = name (briefTitle)
  select elem into v_item
  from jsonb_array_elements(v_items) elem
  where (elem ->> 'id')::uuid = v_marker2_id
  limit 1;

  if v_item ->> 'entity_name' <> 'Long Title No Acronym Trial' then
    raise exception 'acronym feed smoke FAIL marker-no-acronym fallback: got %',
      v_item ->> 'entity_name';
  end if;
  raise notice 'acronym feed smoke ok: marker leg falls back to name when no acronym';

  -- =========================================================================
  -- events leg: trial-scoped event with acronym -> entity_name = acronym
  v_result := public.get_events_page_data(v_space_id, p_source_type := 'event');
  v_items  := v_result -> 'items';

  select elem into v_item
  from jsonb_array_elements(v_items) elem
  where (elem ->> 'id')::uuid = v_event_id
  limit 1;

  if v_item ->> 'entity_name' <> v_acronym then
    raise exception 'acronym feed smoke FAIL event-leg: expected %, got %',
      v_acronym, v_item ->> 'entity_name';
  end if;
  raise notice 'acronym feed smoke ok: events leg prefers acronym';

  -- =========================================================================
  -- detected leg: asset name still wins over trial.acronym (regression check)
  v_result := public.get_events_page_data(v_space_id, p_source_type := 'detected');
  v_items  := v_result -> 'items';

  select elem into v_item
  from jsonb_array_elements(v_items) elem
  where (elem ->> 'id')::uuid = v_ce_id
  limit 1;

  if v_item ->> 'entity_name' <> 'WonderAsset' then
    raise exception 'acronym feed smoke FAIL detected-leg asset-precedence: expected WonderAsset, got %',
      v_item ->> 'entity_name';
  end if;
  raise notice 'acronym feed smoke ok: detected leg keeps asset-name precedence';

  -- =========================================================================
  -- get_event_detail: trial-scoped event with acronym -> entity_name = acronym
  v_detail := public.get_event_detail(v_event_id);
  if v_detail ->> 'entity_name' <> v_acronym then
    raise exception 'acronym feed smoke FAIL get_event_detail: expected %, got %',
      v_acronym, v_detail ->> 'entity_name';
  end if;
  raise notice 'acronym feed smoke ok: get_event_detail prefers acronym';

  -- =========================================================================
  -- cleanup. spaces / tenants AFTER-delete triggers flip the cascade GUC back
  -- to 'off', so explicit member-row deletes must precede parent deletes (see
  -- 20260521120000_r2_pending_deletes_queue.sql:303-307 for the pattern).
  -- Trials, assets, companies, markers, etc. all cascade from the tenant
  -- delete via FK ON DELETE CASCADE, so no need to delete them explicitly.
  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);

  delete from public.trial_change_events where space_id = v_space_id;
  delete from public.markers where space_id = v_space_id;
  delete from public.events where space_id = v_space_id;
  delete from public.event_categories where space_id = v_space_id;
  delete from public.space_members where space_id = v_space_id;
  delete from public.tenant_members where tenant_id = v_tenant_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_owner_id;

  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'acronym feed smoke test: PASS';
end$$;
