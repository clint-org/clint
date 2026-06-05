-- Phase 3: get_events_page_data surfaces a trial's feed items on EVERY asset it
-- tests. The asset-scoped filters matched only the trial's primary asset
-- (a_via_trial.id / a.id = p_entity_id); they now match trial membership via
-- trial_assets, so a master-protocol trial's events, markers, and detected changes
-- appear on each member asset's timeline / entity-events panel. Body is the
-- definition from 20260604120000 with only those three scope predicates changed
-- (the display asset_id/asset_name still resolve to the primary asset).

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
  p_sort_dir      text     default 'desc'
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
      coalesce(t.acronym, t.name) as trial_name
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
      coalesce(t.acronym, t.name) as trial_name
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
      coalesce(t.acronym, t.name) as trial_name
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
  filtered as (
    select uf.*
    from unified_feed uf
    where p_search is null
      or uf.title ilike '%' || p_search || '%'
      or uf.category_name ilike '%' || p_search || '%'
      or uf.entity_name ilike '%' || p_search || '%'
      or coalesce(uf.company_name, '') ilike '%' || p_search || '%'
      or coalesce(uf.asset_name, '') ilike '%' || p_search || '%'
      or coalesce(uf.change_event_type, '') ilike '%' || p_search || '%'
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
  counted as (
    -- sort_text / sort_ts are real columns of `ranked` here, so they resolve
    -- inside the CASE order-by expressions (output aliases would not).
    select *
    from ranked
    order by
      case when p_sort_dir = 'asc'  then sort_ts end asc nulls last,
      case when p_sort_dir <> 'asc' then sort_ts end desc nulls last,
      case when p_sort_dir = 'asc'  then sort_text end asc nulls last,
      case when p_sort_dir <> 'asc' then sort_text end desc nulls last,
      feed_ts desc, id desc
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
          'company_logo_url', r.company_logo_url
        )
        order by
          case when p_sort_dir = 'asc'  then r.sort_ts end asc nulls last,
          case when p_sort_dir <> 'asc' then r.sort_ts end desc nulls last,
          case when p_sort_dir = 'asc'  then r.sort_text end asc nulls last,
          case when p_sort_dir <> 'asc' then r.sort_text end desc nulls last,
          r.feed_ts desc, r.id desc
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

-- Smoke: a marker on a two-asset trial appears when the feed is scoped to the
-- trial's SECONDARY asset (not just the primary).
do $$
declare
  v_owner   uuid := 'ffff3030-0001-0001-0001-ffffffff0001';
  v_agency  uuid := 'ffff3030-0002-0002-0002-ffffffff0002';
  v_tenant  uuid := 'ffff3030-0003-0003-0003-ffffffff0003';
  v_space   uuid := 'ffff3030-0004-0004-0004-ffffffff0004';
  v_company uuid := 'ffff3030-0005-0005-0005-ffffffff0005';
  v_asset_a uuid := 'ffff3030-0006-0006-0006-ffffffff0006';
  v_asset_b uuid := 'ffff3030-0007-0007-0007-ffffffff0007';
  v_mcat    uuid := 'ffff3030-0008-0008-0008-ffffffff0008';
  v_mtype   uuid := 'ffff3030-0009-0009-0009-ffffffff0009';
  v_marker  uuid := 'ffff3030-000a-000a-000a-ffffffff000a';
  v_trial   uuid;
  v_result  jsonb;
  v_has     boolean;
begin
  insert into auth.users (id, email) values (v_owner, 'ev-ma-smoke@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency, 'Ev', 'ev', 'ev', 'Ev', 'ev@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant, v_agency, 'Ev', 'ev-t', 'evt', 'Ev');
  insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_owner, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by) values (v_space, v_tenant, 'Primary', v_owner);
  insert into public.space_members (space_id, user_id, role) values (v_space, v_owner, 'owner');
  insert into public.companies (id, space_id, created_by, name) values (v_company, v_space, v_owner, 'Ev Pharma');
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset_a, v_space, v_owner, v_company, 'EvAssetA');
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset_b, v_space, v_owner, v_company, 'EvAssetB');

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  v_trial := public.create_trial(v_space, v_asset_a, 'Ev Trial', 'NCT-EV-001', 'Active', 'P3', null, null, null, null);
  perform public.set_trial_assets(v_trial, array[v_asset_a, v_asset_b], v_asset_a);

  insert into public.marker_categories (id, space_id, name, display_order, created_by)
    values (v_mcat, v_space, 'Clinical Trial', 1, v_owner);
  insert into public.marker_types (id, name, shape, fill_style, color, category_id)
    values (v_mtype, 'Trial Start', 'circle', 'solid', '#0d9488', v_mcat);
  insert into public.markers (id, space_id, marker_type_id, title, event_date, created_by)
    values (v_marker, v_space, v_mtype, 'Ev marker', current_date, v_owner);
  insert into public.marker_assignments (marker_id, trial_id) values (v_marker, v_trial);

  -- Scope the feed to the SECONDARY asset (b): the trial's marker must appear.
  v_result := public.get_events_page_data(v_space, p_entity_level := 'product', p_entity_id := v_asset_b);
  v_has := exists (
    select 1 from jsonb_array_elements(v_result -> 'items') e
    where (e ->> 'id')::uuid = v_marker and e ->> 'source_type' = 'marker'
  );
  if not v_has then
    raise exception 'ev-ma FAIL: trial marker not surfaced under secondary asset_b';
  end if;

  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.marker_assignments where trial_id = v_trial;
  delete from public.markers where space_id = v_space;
  delete from public.marker_types where id = v_mtype;
  delete from public.marker_categories where space_id = v_space;
  delete from public.space_members where space_id = v_space;
  delete from public.tenant_members where tenant_id = v_tenant;
  delete from public.tenants where id = v_tenant;
  delete from public.agencies where id = v_agency;
  delete from auth.users where id = v_owner;
  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'ev-ma smoke ok: trial feed item surfaces under its secondary asset';
end $$;
