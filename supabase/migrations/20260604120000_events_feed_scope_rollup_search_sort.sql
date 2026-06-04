-- =============================================================================
-- get_events_page_data: hierarchical scope rollup + server-side search + sort
-- =============================================================================
-- Three changes to the unified feed RPC, all in one recreate:
--
-- (a) Scope rollup for markers + detected. Previously legs 2 (markers) and 3
--     (detected trial_change_events) only honored a `trial` scope, so scoping
--     the feed to an asset/company returned analyst events but silently dropped
--     every marker and detected change beneath it. Both legs now roll up to
--     trial / product(asset) / company, matching leg 1. Space-level scope still
--     excludes markers/detected (they always belong to a trial).
--
-- (b) Normalized hierarchy output. Every leg now emits asset_name, trial_id,
--     and trial_name alongside the existing company_id/name + asset_id, and the
--     detected leg's entity_name is the trial (was the asset) so the row's own
--     level (trial) and name agree. This lets the Events grid render a
--     consistent "level badge + name + parent path" cell.
--
-- (c) Server-side free-text search (p_search) and whitelisted sort
--     (p_sort_field / p_sort_dir). Search ILIKEs across
--     title/category_name/entity_name/company_name/asset_name/change_event_type
--     and applies to all three legs via a `filtered` CTE. Sort is whitelisted to
--     feed_ts|title|category_name|entity_name|priority|source_type and applied
--     in both the paginating CTE and the jsonb_agg so item order matches page
--     order.
--
-- Category already filters the markers leg (mc.id), so no fix needed there.
-- =============================================================================

drop function if exists public.get_events_page_data(
  uuid, date, date, text, uuid, uuid[], text[], text, text, int, int, uuid
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
        or a.id = p_entity_id
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

revoke execute on function public.get_events_page_data(
  uuid, date, date, text, uuid, uuid[], text[], text, text, int, int, uuid, text, text, text
) from public;
grant execute on function public.get_events_page_data(
  uuid, date, date, text, uuid, uuid[], text[], text, text, int, int, uuid, text, text, text
) to anon, authenticated;

comment on function public.get_events_page_data(
  uuid, date, date, text, uuid, uuid[], text[], text, text, int, int, uuid, text, text, text
) is
  'Unified feed RPC returning events, markers, and detected trial changes in a single paginated result. Returns {items: jsonb[], total: bigint}. Entity scope (p_entity_level/p_entity_id) rolls up hierarchically across all three legs: a trial/product(asset)/company scope includes everything beneath it; space-level scope excludes markers/detected. Each item carries the normalized hierarchy (company_id/name, asset_id/asset_name, trial_id/trial_name) and the row''s own entity_level/entity_name. Filters: date range, entity scope, category, tags, priority, source_type (event|marker|detected), free-text p_search (title/category/entity/company/asset/change-type ILIKE). Sort via p_sort_field (feed_ts|title|category_name|entity_name|priority|source_type, default feed_ts) + p_sort_dir (asc|desc, default desc), nulls last, tiebreak id desc, applied to both the page and the item order. Server-side pagination via p_limit/p_offset. p_change_event_id returns a single detected event. SECURITY INVOKER.';

-- =============================================================================
-- smoke: rollup (asset scope returns child-trial marker + detected), search, sort
-- =============================================================================
do $$
declare
  v_agency_id  uuid := 'cccccccc-0001-0001-0001-cccccccccc01';
  v_tenant_id  uuid := 'cccccccc-0002-0002-0002-cccccccccc02';
  v_owner_id   uuid := 'cccccccc-0003-0003-0003-cccccccccc03';
  v_space_id   uuid := 'cccccccc-0004-0004-0004-cccccccccc04';
  v_company_id uuid := 'cccccccc-0005-0005-0005-cccccccccc05';
  v_asset_id   uuid := 'cccccccc-0006-0006-0006-cccccccccc06';
  v_trial_id   uuid := 'cccccccc-0007-0007-0007-cccccccccc07';
  v_cat_id     uuid := 'cccccccc-0008-0008-0008-cccccccccc08';
  v_event_id   uuid := 'cccccccc-0009-0009-0009-cccccccccc09';
  v_ce_id      uuid := 'cccccccc-000b-000b-000b-cccccccccc0b';
  v_mcat_id    uuid := 'cccccccc-000c-000c-000c-cccccccccc0c';
  v_mtype_id   uuid := 'cccccccc-000d-000d-000d-cccccccccc0d';
  v_marker_id  uuid := 'cccccccc-000e-000e-000e-cccccccccc0e';
  v_result jsonb; v_items jsonb; v_row jsonb;
  v_has_marker boolean; v_has_detected boolean;
  v_total_all bigint; v_total_search bigint;
  v_first_title text;
begin
  insert into auth.users (id, email) values (v_owner_id, 'feed-rollup-owner@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'FRO', 'fro', 'fro', 'FRO', 'fro@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'FRO', 'fro-t', 'frot', 'FRO');
  insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant_id, v_owner_id, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by) values (v_space_id, v_tenant_id, 'Primary', v_owner_id);
  insert into public.space_members (space_id, user_id, role) values (v_space_id, v_owner_id, 'owner');
  insert into public.companies (id, space_id, created_by, name) values (v_company_id, v_space_id, v_owner_id, 'Rollup Pharma');
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset_id, v_space_id, v_owner_id, v_company_id, 'RollupAsset');
  insert into public.trials (id, space_id, created_by, asset_id, name, identifier) values (v_trial_id, v_space_id, v_owner_id, v_asset_id, 'Rollup Trial', 'NCT-FRO-001');
  insert into public.event_categories (id, space_id, name, display_order, created_by) values (v_cat_id, v_space_id, 'Regulatory', 1, v_owner_id);
  insert into public.events (id, space_id, created_by, category_id, title, event_date, trial_id)
    values (v_event_id, v_space_id, v_owner_id, v_cat_id, 'Zzz analyst event', current_date, v_trial_id);
  insert into public.trial_change_events (id, trial_id, space_id, event_type, source, payload, occurred_at, observed_at)
    values (v_ce_id, v_trial_id, v_space_id, 'date_moved', 'ctgov', jsonb_build_object('field','primary_completion_date','days_shifted','120'), now(), now());
  insert into public.marker_categories (id, space_id, name, display_order, created_by)
    values (v_mcat_id, v_space_id, 'Clinical Trial', 1, v_owner_id);
  insert into public.marker_types (id, name, shape, fill_style, color, category_id)
    values (v_mtype_id, 'Trial Start', 'circle', 'solid', '#0d9488', v_mcat_id);
  insert into public.markers (id, space_id, marker_type_id, title, event_date, created_by)
    values (v_marker_id, v_space_id, v_mtype_id, 'Aaa trial start', current_date, v_owner_id);
  insert into public.marker_assignments (marker_id, trial_id) values (v_marker_id, v_trial_id);

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  -- 1. ASSET scope must roll up the child trial's marker AND detected change.
  v_result := public.get_events_page_data(v_space_id, p_entity_level := 'product', p_entity_id := v_asset_id);
  v_items := v_result -> 'items';
  v_has_marker := exists (select 1 from jsonb_array_elements(v_items) e where (e ->> 'id')::uuid = v_marker_id and e ->> 'source_type' = 'marker');
  v_has_detected := exists (select 1 from jsonb_array_elements(v_items) e where (e ->> 'id')::uuid = v_ce_id and e ->> 'source_type' = 'detected');
  if not v_has_marker then
    raise exception 'feed-rollup smoke FAIL: asset scope did not include child-trial marker';
  end if;
  if not v_has_detected then
    raise exception 'feed-rollup smoke FAIL: asset scope did not include child-trial detected change';
  end if;

  -- 2. detected row entity_name is the trial (not the asset), with asset as parent.
  select e into v_row from jsonb_array_elements(v_items) e where (e ->> 'id')::uuid = v_ce_id limit 1;
  if (v_row ->> 'entity_name') <> 'Rollup Trial' then
    raise exception 'feed-rollup smoke FAIL: detected entity_name=%, expected the trial', v_row ->> 'entity_name';
  end if;
  if (v_row ->> 'asset_name') <> 'RollupAsset' then
    raise exception 'feed-rollup smoke FAIL: detected asset_name=%, expected RollupAsset', v_row ->> 'asset_name';
  end if;

  -- 3. COMPANY scope also rolls up.
  v_result := public.get_events_page_data(v_space_id, p_entity_level := 'company', p_entity_id := v_company_id);
  v_items := v_result -> 'items';
  if not exists (select 1 from jsonb_array_elements(v_items) e where (e ->> 'id')::uuid = v_marker_id) then
    raise exception 'feed-rollup smoke FAIL: company scope did not include the marker';
  end if;

  -- 4. p_search narrows the result set.
  v_total_all := (public.get_events_page_data(v_space_id) ->> 'total')::bigint;
  v_total_search := (public.get_events_page_data(v_space_id, p_search := 'Zzz analyst') ->> 'total')::bigint;
  if not (v_total_search < v_total_all and v_total_search >= 1) then
    raise exception 'feed-rollup smoke FAIL: search total % did not narrow from %', v_total_search, v_total_all;
  end if;

  -- 5. p_sort_field=title asc puts the lexicographically-first title first.
  v_result := public.get_events_page_data(v_space_id, p_sort_field := 'title', p_sort_dir := 'asc');
  v_first_title := (v_result -> 'items' -> 0) ->> 'title';
  if v_first_title <> 'Aaa trial start' then
    raise exception 'feed-rollup smoke FAIL: title-asc first row was %, expected "Aaa trial start"', v_first_title;
  end if;

  raise notice 'feed-rollup smoke ok: marker+detected roll up to asset/company scope; detected entity_name=trial; search narrows; title sort reorders';

  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.marker_assignments where trial_id = v_trial_id;
  delete from public.markers where space_id = v_space_id;
  delete from public.marker_types where id = v_mtype_id;
  delete from public.marker_categories where space_id = v_space_id;
  delete from public.trial_change_events where space_id = v_space_id;
  delete from public.events where space_id = v_space_id;
  delete from public.event_categories where space_id = v_space_id;
  delete from public.space_members where space_id = v_space_id;
  delete from public.tenant_members where tenant_id = v_tenant_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_owner_id;
  perform set_config('clint.member_guard_cascade', 'off', true);
end$$;
