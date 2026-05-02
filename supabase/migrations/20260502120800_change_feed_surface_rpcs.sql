-- migration: 20260502120800_change_feed_surface_rpcs
-- purpose: six SECURITY INVOKER RPCs for the UI read path:
--     get_activity_feed            -- paged change feed for the Activity page,
--                                     What-Changed widget, Intel feed mixer
--     get_trial_activity           -- recent events scoped to one trial
--     get_marker_history           -- analyst audit log for one marker
--     trigger_single_trial_sync    -- auth-validate, return NCT for client
--                                     to forward to the Worker
--     update_space_field_visibility -- owner-only writer for the per-space
--                                     ctgov_field_visibility jsonb
--     recompute_trial_change_events -- owner-only admin utility that replays
--                                     snapshots through the diff/classify
--                                     pipeline (used after watch-list edits)
--
-- security: all six are SECURITY INVOKER. RLS on the underlying tables would
--   already filter rows by has_space_access, but we explicitly raise 42501
--   up-front so callers see a deterministic error rather than an empty page
--   when they lack access. revoke from public, grant to authenticated.
--
-- pagination: get_activity_feed uses two-axis keyset pagination on
--   (observed_at desc, id desc). caller passes the (limit+1)th row's
--   (observed_at, id) pair back as (p_cursor_observed_at, p_cursor_id); we
--   return limit+1 rows so the caller can detect "more pages exist". the
--   id tie-breaker is part of the cursor predicate, not just the sort, so
--   ties on observed_at -- common because postgres now() returns
--   transaction-start time and a single ingest can emit many events sharing
--   the same observed_at -- never cause unread rows to be skipped. the
--   compound predicate is `observed_at < cursor_observed_at OR
--   (observed_at = cursor_observed_at AND id < cursor_id)`.
--
-- marker_title fallback: marker_id has on-delete-set-null so survived markers
--   join cleanly. for events whose marker has since been deleted (marker_id
--   null but derived_from_marker_change_id set), we read the title out of
--   marker_changes.new_values (preferred) or old_values (deletes). the
--   audit row is not FK-protected by marker_id, so it always survives.

-- =============================================================================
-- RPC 1. get_activity_feed: paged unified change feed for one space.
--
-- drop the old 4-arg signature explicitly so this migration is reentrant on a
-- database where a previous deploy installed the single-axis cursor.
drop function if exists public.get_activity_feed(uuid, jsonb, timestamptz, int);

create or replace function public.get_activity_feed(
  p_space_id              uuid,
  p_filters               jsonb       default '{}'::jsonb,
  p_cursor_observed_at    timestamptz default null,
  p_cursor_id             uuid        default null,
  p_limit                 int         default 50
) returns setof jsonb
language plpgsql
security invoker
stable
set search_path = public
as $$
declare
  v_event_types  text[];
  v_sources      text[];
  v_trial_ids    uuid[];
  v_date_range   text;
  v_whitelist    text;
  v_since        timestamptz;
begin
  if not public.has_space_access(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- unpack filters; missing keys mean "no filter on that axis".
  v_event_types := case
    when p_filters ? 'event_types'
      then array(select jsonb_array_elements_text(p_filters -> 'event_types'))
    else null
  end;
  v_sources := case
    when p_filters ? 'sources'
      then array(select jsonb_array_elements_text(p_filters -> 'sources'))
    else null
  end;
  v_trial_ids := case
    when p_filters ? 'trial_ids'
      then array(select (jsonb_array_elements_text(p_filters -> 'trial_ids'))::uuid)
    else null
  end;
  v_date_range := p_filters ->> 'date_range';
  v_whitelist  := p_filters ->> 'whitelist';

  v_since := case v_date_range
    when '7d'  then now() - interval '7 days'
    when '30d' then now() - interval '30 days'
    when 'all' then null
    else null
  end;

  return query
    select jsonb_build_object(
      'id',               e.id,
      'trial_id',         e.trial_id,
      'space_id',         e.space_id,
      'event_type',       e.event_type,
      'source',           e.source,
      'payload',          e.payload,
      'occurred_at',      e.occurred_at,
      'observed_at',      e.observed_at,
      'marker_id',        e.marker_id,
      'trial_name',       t.name,
      'trial_identifier', t.identifier,
      'marker_title',     coalesce(
        m.title,
        case
          when mc.change_type in ('created', 'updated')
            then mc.new_values ->> 'title'
          when mc.change_type = 'deleted'
            then mc.old_values ->> 'title'
          else null
        end
      )
    )
      from public.trial_change_events e
      join public.trials t on t.id = e.trial_id
      left join public.markers m on m.id = e.marker_id
      left join public.marker_changes mc on mc.id = e.derived_from_marker_change_id
     where e.space_id = p_space_id
       and (
         p_cursor_observed_at is null
         or e.observed_at < p_cursor_observed_at
         or (e.observed_at = p_cursor_observed_at and (p_cursor_id is null or e.id < p_cursor_id))
       )
       and (v_event_types is null or e.event_type = any(v_event_types))
       and (v_sources is null or e.source = any(v_sources))
       and (v_trial_ids is null or e.trial_id = any(v_trial_ids))
       and (v_since is null or e.observed_at >= v_since)
       and (
         v_whitelist is null
         or (
           v_whitelist = 'high_signal'
           and (
             (e.event_type = 'date_moved' and (e.payload ->> 'days_diff')::int > 90)
             or e.event_type = 'phase_transitioned'
             or (e.event_type = 'status_changed'
                 and (e.payload ->> 'to') in ('COMPLETED', 'TERMINATED', 'WITHDRAWN', 'SUSPENDED'))
             or e.event_type = 'sponsor_changed'
             or e.event_type = 'trial_withdrawn'
           )
         )
       )
     order by e.observed_at desc, e.id desc
     limit p_limit + 1;
end;
$$;

revoke execute on function public.get_activity_feed(uuid, jsonb, timestamptz, uuid, int) from public;
grant  execute on function public.get_activity_feed(uuid, jsonb, timestamptz, uuid, int) to authenticated;

comment on function public.get_activity_feed(uuid, jsonb, timestamptz, uuid, int) is
  'Paged unified change feed for one space. Filters via jsonb (event_types, sources, trial_ids, date_range 7d|30d|all, whitelist=high_signal). Two-axis keyset pagination on (observed_at desc, id desc): caller passes the (limit+1)th row''s (observed_at, id) pair back as (p_cursor_observed_at, p_cursor_id), and the predicate is `observed_at < cursor OR (observed_at = cursor AND id < cursor_id)` so events sharing observed_at within a single ingest are never skipped. Returns limit+1 rows so caller can detect more pages. Joins trial name+identifier and marker title (with fallback to marker_changes for deleted markers). SECURITY INVOKER; raises 42501 if caller lacks has_space_access.';

-- =============================================================================
-- RPC 2. get_trial_activity: recent events for one trial. No cursor.
--
create or replace function public.get_trial_activity(
  p_trial_id uuid,
  p_limit    int default 25
) returns setof jsonb
language plpgsql
security invoker
stable
set search_path = public
as $$
declare
  v_space_id uuid;
begin
  select space_id into v_space_id
    from public.trials
   where id = p_trial_id;

  if v_space_id is null then
    raise exception 'trial not found' using errcode = '02000';
  end if;

  if not public.has_space_access(v_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select jsonb_build_object(
      'id',               e.id,
      'trial_id',         e.trial_id,
      'space_id',         e.space_id,
      'event_type',       e.event_type,
      'source',           e.source,
      'payload',          e.payload,
      'occurred_at',      e.occurred_at,
      'observed_at',      e.observed_at,
      'marker_id',        e.marker_id,
      'trial_name',       t.name,
      'trial_identifier', t.identifier,
      'marker_title',     coalesce(
        m.title,
        case
          when mc.change_type in ('created', 'updated')
            then mc.new_values ->> 'title'
          when mc.change_type = 'deleted'
            then mc.old_values ->> 'title'
          else null
        end
      )
    )
      from public.trial_change_events e
      join public.trials t on t.id = e.trial_id
      left join public.markers m on m.id = e.marker_id
      left join public.marker_changes mc on mc.id = e.derived_from_marker_change_id
     where e.trial_id = p_trial_id
     order by e.observed_at desc, e.id desc
     limit p_limit;
end;
$$;

revoke execute on function public.get_trial_activity(uuid, int) from public;
grant  execute on function public.get_trial_activity(uuid, int) to authenticated;

comment on function public.get_trial_activity(uuid, int) is
  'Recent change events for one trial; same row shape as get_activity_feed. SECURITY INVOKER; raises 02000 if trial not found, 42501 if caller lacks has_space_access on the trial''s space.';

-- =============================================================================
-- RPC 3. get_marker_history: full audit log for one marker.
-- marker_id is not a FK on marker_changes, so rows survive marker deletion.
-- the access check uses the space_id stored on the audit row itself.
--
create or replace function public.get_marker_history(
  p_marker_id uuid
) returns setof jsonb
language plpgsql
security invoker
stable
set search_path = public
as $$
declare
  v_space_id uuid;
begin
  -- pick any matching audit row's space_id (all rows for the same marker
  -- share the same space_id). null means the marker has no audit history,
  -- which is functionally equivalent to "marker does not exist" for this RPC.
  select space_id into v_space_id
    from public.marker_changes
   where marker_id = p_marker_id
   limit 1;

  if v_space_id is null then
    -- no rows; return empty set without leaking access info.
    return;
  end if;

  if not public.has_space_access(v_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select jsonb_build_object(
      'id',                mc.id,
      'marker_id',         mc.marker_id,
      'change_type',       mc.change_type,
      'old_values',        mc.old_values,
      'new_values',        mc.new_values,
      'changed_at',        mc.changed_at,
      'changed_by_email',  u.email
    )
      from public.marker_changes mc
      left join auth.users u on u.id = mc.changed_by
     where mc.marker_id = p_marker_id
     order by mc.changed_at desc, mc.id desc;
end;
$$;

revoke execute on function public.get_marker_history(uuid) from public;
grant  execute on function public.get_marker_history(uuid) to authenticated;

comment on function public.get_marker_history(uuid) is
  'Full marker_changes audit log for one marker, joined to author email. Survives marker deletion (marker_id is not FK-protected). SECURITY INVOKER; raises 42501 if caller lacks has_space_access on the recorded space.';

-- =============================================================================
-- RPC 4. trigger_single_trial_sync: auth-validate, return NCT for client.
-- the actual HTTP POST to the Worker happens client-side; this RPC just
-- gates the action behind owner|editor access and surfaces the NCT identifier.
--
create or replace function public.trigger_single_trial_sync(
  p_trial_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_space_id   uuid;
  v_identifier text;
begin
  select space_id, identifier
    into v_space_id, v_identifier
    from public.trials
   where id = p_trial_id;

  if v_space_id is null then
    raise exception 'trial not found' using errcode = '02000';
  end if;

  if not public.has_space_access(v_space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_identifier is null or v_identifier = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_nct_id');
  end if;

  return jsonb_build_object('ok', true, 'nct_id', v_identifier);
end;
$$;

revoke execute on function public.trigger_single_trial_sync(uuid) from public;
grant  execute on function public.trigger_single_trial_sync(uuid) to authenticated;

comment on function public.trigger_single_trial_sync(uuid) is
  'Validates owner|editor access and returns {ok, nct_id} or {ok: false, reason: no_nct_id}. The HTTP call to the Worker happens client-side. SECURITY INVOKER; raises 02000 if trial missing, 42501 if caller lacks owner|editor.';

-- =============================================================================
-- RPC 5. update_space_field_visibility: owner-only writer for per-space
-- ctgov_field_visibility jsonb. shape: { surface_key: [field_path, ...] }.
--
create or replace function public.update_space_field_visibility(
  p_space_id    uuid,
  p_visibility  jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.has_space_access(p_space_id, array['owner']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.spaces
     set ctgov_field_visibility = p_visibility
   where id = p_space_id;
end;
$$;

revoke execute on function public.update_space_field_visibility(uuid, jsonb) from public;
grant  execute on function public.update_space_field_visibility(uuid, jsonb) to authenticated;

comment on function public.update_space_field_visibility(uuid, jsonb) is
  'Owner-only writer for spaces.ctgov_field_visibility. Shape: { surface_key: [field_path, ...] }. SECURITY INVOKER; raises 42501 if caller is not space owner.';

-- =============================================================================
-- RPC 6. recompute_trial_change_events: owner-only admin utility. Replays the
-- diff/classify pipeline over historical snapshots so the change feed reflects
-- a current watch-list configuration. CT.gov-source rows only -- analyst-source
-- rows (from marker activity) are not touched.
--
-- behavior:
--   1. delete trial_field_changes for this trial.
--   2. delete trial_change_events for this trial where source = 'ctgov'.
--   3. walk trial_ctgov_snapshots ordered by ctgov_version asc; for each
--      consecutive pair (prev, curr), run _compute_field_diffs and
--      _classify_change, INSERT new field_change + event rows.
--   4. re-materialize trials columns from the latest snapshot.
--   5. return the count of events emitted.
--
create or replace function public.recompute_trial_change_events(
  p_trial_id uuid
) returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_space_id          uuid;
  v_prev              record;
  v_curr              record;
  v_diff              record;
  v_event             record;
  v_change_id         uuid;
  v_events_emitted    int := 0;
  v_latest_payload    jsonb;
begin
  select space_id into v_space_id
    from public.trials
   where id = p_trial_id;

  if v_space_id is null then
    raise exception 'trial not found' using errcode = '02000';
  end if;

  if not public.has_space_access(v_space_id, array['owner']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 1. wipe ct.gov-derived rows. analyst-source events untouched.
  delete from public.trial_change_events
   where trial_id = p_trial_id
     and source = 'ctgov';

  delete from public.trial_field_changes
   where trial_id = p_trial_id;

  -- 2. iterate snapshots in version order, holding the previous payload.
  v_prev := null;
  for v_curr in
    select id, payload, last_update_post_date
      from public.trial_ctgov_snapshots
     where trial_id = p_trial_id
     order by ctgov_version asc
  loop
    if v_prev is not null then
      for v_diff in
        select *
          from public._compute_field_diffs(v_prev.payload, v_curr.payload, null)
      loop
        insert into public.trial_field_changes (
          trial_id, space_id, source_snapshot_id,
          field_path, old_value, new_value, observed_at
        ) values (
          p_trial_id, v_space_id, v_curr.id,
          v_diff.field_path, v_diff.old_value, v_diff.new_value, now()
        )
        returning id into v_change_id;

        for v_event in
          select *
            from public._classify_change(
              v_diff.field_path,
              v_diff.old_value,
              v_diff.new_value,
              v_curr.last_update_post_date::timestamptz
            )
        loop
          insert into public.trial_change_events (
            trial_id, space_id, event_type, source,
            payload, occurred_at, observed_at, derived_from_change_id
          ) values (
            p_trial_id, v_space_id, v_event.event_type, 'ctgov',
            v_event.payload, v_event.occurred_at, now(), v_change_id
          );

          v_events_emitted := v_events_emitted + 1;
        end loop;
      end loop;
    end if;
    v_prev := v_curr;
  end loop;

  -- 3. re-materialize from the latest snapshot so the trials columns reflect
  --    current state (no-op when there are zero snapshots).
  select payload into v_latest_payload
    from public.trial_ctgov_snapshots
   where trial_id = p_trial_id
   order by ctgov_version desc
   limit 1;

  if v_latest_payload is not null then
    perform public._materialize_trial_from_snapshot(p_trial_id, v_latest_payload);
  end if;

  return v_events_emitted;
end;
$$;

revoke execute on function public.recompute_trial_change_events(uuid) from public;
grant  execute on function public.recompute_trial_change_events(uuid) to authenticated;

comment on function public.recompute_trial_change_events(uuid) is
  'Owner-only admin utility. Wipes CT.gov-source change rows for one trial then replays the diff+classify pipeline across historical snapshots, ordered by ctgov_version. Returns total events emitted. Re-materializes trials columns from the latest snapshot. SECURITY INVOKER; raises 02000 if trial missing, 42501 if caller is not space owner.';

-- =============================================================================
-- smoke tests: bootstrap a hermetic agency / tenant / space / user / trial
-- fixture. test as the space-owner user (set request.jwt.claim.sub to that
-- user's id). cleanup at the end cascades via tenant + agency + auth.users.
--
do $$
declare
  v_agency_id        uuid := 'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_tenant_id        uuid := 'aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_owner_id         uuid := 'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_other_id         uuid := 'aaaaaaa4-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_editor_id        uuid := 'aaaaaaa5-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_space_id         uuid := 'aaaaaaa6-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  v_company_id       uuid := 'aaaaaaa7-aaaa-aaaa-aaaa-aaaaaaaaaaa7';
  v_product_id       uuid := 'aaaaaaa8-aaaa-aaaa-aaaa-aaaaaaaaaaa8';
  v_ta_id            uuid := 'aaaaaaa9-aaaa-aaaa-aaaa-aaaaaaaaaab1';
  v_trial_a_id       uuid := 'aaaaaaab-aaaa-aaaa-aaaa-aaaaaaaaaab2';
  v_trial_b_id       uuid := 'aaaaaaac-aaaa-aaaa-aaaa-aaaaaaaaaab3';
  v_trial_no_nct_id  uuid := 'aaaaaaad-aaaa-aaaa-aaaa-aaaaaaaaaab4';
  v_marker_type_id   uuid;
  v_marker_a_id      uuid := 'aaaaaaae-aaaa-aaaa-aaaa-aaaaaaaaaab5';
  v_marker_b_id      uuid := 'aaaaaaaf-aaaa-aaaa-aaaa-aaaaaaaaaab6';
  v_event_id_1       uuid := 'aaaaaab1-aaaa-aaaa-aaaa-aaaaaaaaaab7';
  v_event_id_2       uuid := 'aaaaaab2-aaaa-aaaa-aaaa-aaaaaaaaaab8';
  v_event_id_3       uuid := 'aaaaaab3-aaaa-aaaa-aaaa-aaaaaaaaaab9';
  v_obs_1            timestamptz := now() - interval '1 day';
  v_obs_2            timestamptz := now() - interval '2 hours';
  v_obs_3            timestamptz := now() - interval '10 minutes';
  v_rows             jsonb[];
  v_row              jsonb;
  v_count            int;
  v_threw            boolean;
  v_result           jsonb;
  v_int              int;
  v_visibility       jsonb;
  v_cursor           timestamptz;
  v_cursor_id        uuid;
  v_tie_obs          timestamptz := '2026-04-01 12:00:00+00'::timestamptz;
  v_tie_id_1         uuid := 'aaaaaac1-aaaa-aaaa-aaaa-aaaaaaaaaac1';
  v_tie_id_2         uuid := 'aaaaaac2-aaaa-aaaa-aaaa-aaaaaaaaaac2';
  v_tie_id_3         uuid := 'aaaaaac3-aaaa-aaaa-aaaa-aaaaaaaaaac3';
  v_third_id         uuid;
  v_payload_v1       jsonb := '{"protocolSection":{"statusModule":{"overallStatus":"RECRUITING"}}}'::jsonb;
  v_payload_v2       jsonb := '{"protocolSection":{"statusModule":{"overallStatus":"COMPLETED"}}}'::jsonb;
  v_payload_v3       jsonb := '{"protocolSection":{"statusModule":{"overallStatus":"TERMINATED"}}}'::jsonb;
begin
  -- bootstrap fixture.
  insert into auth.users (id, email) values
    (v_owner_id,  'surface-owner@invalid.local'),
    (v_other_id,  'surface-other@invalid.local'),
    (v_editor_id, 'surface-editor@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'Surface Smoke', 'surface-smoke', 'surfacesmoke', 'SS', 'ss@y.z');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'SS', 'surface-smoke-t', 'surfacesmoket', 'SS');

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant_id, v_owner_id, 'owner');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_owner_id);

  insert into public.space_members (space_id, user_id, role) values
    (v_space_id, v_owner_id,  'owner'),
    (v_space_id, v_editor_id, 'editor');

  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_owner_id, 'Surface Smoke Co');

  insert into public.products (id, space_id, created_by, company_id, name)
    values (v_product_id, v_space_id, v_owner_id, v_company_id, 'Surface Smoke Drug');

  insert into public.therapeutic_areas (id, space_id, created_by, name)
    values (v_ta_id, v_space_id, v_owner_id, 'Surface Smoke TA');

  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier) values
    (v_trial_a_id,      v_space_id, v_owner_id, v_product_id, v_ta_id, 'TRIAL_A',      'NCT-SURFACE-A'),
    (v_trial_b_id,      v_space_id, v_owner_id, v_product_id, v_ta_id, 'TRIAL_B',      'NCT-SURFACE-B'),
    (v_trial_no_nct_id, v_space_id, v_owner_id, v_product_id, v_ta_id, 'TRIAL_NO_NCT', null);

  -- act as the owner for all reads.
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  -- =========================================================================
  -- test 1: get_activity_feed happy path with date_range '30d'.
  -- note: status_changed.to is a non-terminal value (ACTIVE_NOT_RECRUITING)
  -- so it does not match the high_signal whitelist used in test 3.
  insert into public.trial_change_events (
    id, trial_id, space_id, event_type, source, payload, occurred_at, observed_at
  ) values
    (v_event_id_1, v_trial_a_id, v_space_id, 'status_changed', 'ctgov',
     jsonb_build_object('from', 'RECRUITING', 'to', 'ACTIVE_NOT_RECRUITING'),
     v_obs_1, v_obs_1),
    (v_event_id_2, v_trial_a_id, v_space_id, 'phase_transitioned', 'ctgov',
     jsonb_build_object('from', 'PHASE2', 'to', 'PHASE3'),
     v_obs_2, v_obs_2);

  v_rows := array(
    select e from public.get_activity_feed(v_space_id, jsonb_build_object('date_range', '30d')) as e
  );
  if array_length(v_rows, 1) <> 2 then
    raise exception 'surface smoke FAIL test 1: expected 2 rows, got %', array_length(v_rows, 1);
  end if;
  if (v_rows[1] ->> 'observed_at')::timestamptz < (v_rows[2] ->> 'observed_at')::timestamptz then
    raise exception 'surface smoke FAIL test 1: rows not in observed_at desc order';
  end if;
  if v_rows[1] ->> 'trial_name' <> 'TRIAL_A' then
    raise exception 'surface smoke FAIL test 1: trial_name not joined, got %', v_rows[1] ->> 'trial_name';
  end if;
  if v_rows[1] ->> 'trial_identifier' <> 'NCT-SURFACE-A' then
    raise exception 'surface smoke FAIL test 1: trial_identifier not joined, got %', v_rows[1] ->> 'trial_identifier';
  end if;
  raise notice 'surface smoke ok test 1: get_activity_feed happy path joined trial';

  -- =========================================================================
  -- test 2: event_type filter narrows to one type.
  v_rows := array(
    select e from public.get_activity_feed(
      v_space_id,
      jsonb_build_object('event_types', jsonb_build_array('status_changed'))
    ) as e
  );
  if array_length(v_rows, 1) <> 1 then
    raise exception 'surface smoke FAIL test 2: expected 1 row after filter, got %', array_length(v_rows, 1);
  end if;
  if v_rows[1] ->> 'event_type' <> 'status_changed' then
    raise exception 'surface smoke FAIL test 2: wrong event_type, got %', v_rows[1] ->> 'event_type';
  end if;
  raise notice 'surface smoke ok test 2: get_activity_feed event_type filter';

  -- =========================================================================
  -- test 3: whitelist=high_signal returns phase_transitioned but not marker_updated.
  insert into public.trial_change_events (
    trial_id, space_id, event_type, source, payload, occurred_at, observed_at
  ) values
    (v_trial_a_id, v_space_id, 'marker_updated', 'analyst',
     jsonb_build_object('changed_fields', jsonb_build_array('title')),
     now() - interval '5 minutes',
     now() - interval '5 minutes');

  v_rows := array(
    select e from public.get_activity_feed(
      v_space_id,
      jsonb_build_object('whitelist', 'high_signal')
    ) as e
  );
  if array_length(v_rows, 1) <> 1 then
    raise exception 'surface smoke FAIL test 3: expected 1 row in high_signal, got %', array_length(v_rows, 1);
  end if;
  if v_rows[1] ->> 'event_type' <> 'phase_transitioned' then
    raise exception 'surface smoke FAIL test 3: expected phase_transitioned, got %', v_rows[1] ->> 'event_type';
  end if;
  raise notice 'surface smoke ok test 3: get_activity_feed whitelist=high_signal';

  -- =========================================================================
  -- test 4: cursor pagination. clean slate, insert 3 events with distinct
  -- observed_at, request limit=2, expect 3 rows back (limit+1). Then page.
  delete from public.trial_change_events where space_id = v_space_id;

  insert into public.trial_change_events (
    id, trial_id, space_id, event_type, source, payload, occurred_at, observed_at
  ) values
    (v_event_id_1, v_trial_a_id, v_space_id, 'status_changed', 'ctgov',
     jsonb_build_object('from', 'RECRUITING', 'to', 'COMPLETED'),
     v_obs_1, v_obs_1),
    (v_event_id_2, v_trial_a_id, v_space_id, 'phase_transitioned', 'ctgov',
     jsonb_build_object('from', 'PHASE2', 'to', 'PHASE3'),
     v_obs_2, v_obs_2),
    (v_event_id_3, v_trial_a_id, v_space_id, 'sponsor_changed', 'ctgov',
     jsonb_build_object('from', 'X', 'to', 'Y'),
     v_obs_3, v_obs_3);

  v_rows := array(
    select e from public.get_activity_feed(v_space_id, '{}'::jsonb, null, null, 2) as e
  );
  if array_length(v_rows, 1) <> 3 then
    raise exception 'surface smoke FAIL test 4a: expected 3 rows (limit+1), got %', array_length(v_rows, 1);
  end if;

  -- the second row's (observed_at, id) is the next cursor pair. callers
  -- passing them back will see strictly older rows, i.e. just the third event.
  v_cursor    := (v_rows[2] ->> 'observed_at')::timestamptz;
  v_cursor_id := (v_rows[2] ->> 'id')::uuid;
  v_rows := array(
    select e from public.get_activity_feed(
      v_space_id, '{}'::jsonb, v_cursor, v_cursor_id, 2
    ) as e
  );
  if array_length(v_rows, 1) <> 1 then
    raise exception 'surface smoke FAIL test 4b: expected 1 row after cursor, got %',
      array_length(v_rows, 1);
  end if;
  raise notice 'surface smoke ok test 4: get_activity_feed cursor pagination';

  -- =========================================================================
  -- test 4c: tie-breaker. insert 3 events sharing one observed_at literal.
  -- with a single-axis cursor on observed_at alone, page 2 would skip ALL
  -- ties; with the (observed_at, id) compound predicate, page 2 returns the
  -- last tied row in id-desc order. clean slate first so only these 3 rows
  -- match the cursor predicate.
  delete from public.trial_change_events where space_id = v_space_id;

  insert into public.trial_change_events (
    id, trial_id, space_id, event_type, source, payload, occurred_at, observed_at
  ) values
    (v_tie_id_1, v_trial_a_id, v_space_id, 'status_changed', 'ctgov',
     jsonb_build_object('from', 'RECRUITING', 'to', 'COMPLETED'),
     v_tie_obs, v_tie_obs),
    (v_tie_id_2, v_trial_a_id, v_space_id, 'phase_transitioned', 'ctgov',
     jsonb_build_object('from', 'PHASE2', 'to', 'PHASE3'),
     v_tie_obs, v_tie_obs),
    (v_tie_id_3, v_trial_a_id, v_space_id, 'sponsor_changed', 'ctgov',
     jsonb_build_object('from', 'X', 'to', 'Y'),
     v_tie_obs, v_tie_obs);

  -- limit=2 should return 3 rows (limit+1) in id-desc order, all with the
  -- same observed_at.
  v_rows := array(
    select e from public.get_activity_feed(v_space_id, '{}'::jsonb, null, null, 2) as e
  );
  if array_length(v_rows, 1) <> 3 then
    raise exception 'surface smoke FAIL test 4c: expected 3 tied rows (limit+1), got %',
      array_length(v_rows, 1);
  end if;

  -- the third id in the original ordering (id desc, all sharing observed_at)
  -- is the smallest of the three uuids.
  v_third_id := (v_rows[3] ->> 'id')::uuid;
  v_cursor    := (v_rows[2] ->> 'observed_at')::timestamptz;
  v_cursor_id := (v_rows[2] ->> 'id')::uuid;

  -- with the cursor pair, expect exactly 1 row (the third tied id). a
  -- single-axis cursor would return 0 rows here -- this is the regression.
  v_rows := array(
    select e from public.get_activity_feed(
      v_space_id, '{}'::jsonb, v_cursor, v_cursor_id, 2
    ) as e
  );
  if array_length(v_rows, 1) <> 1 then
    raise exception 'surface smoke FAIL test 4c: expected 1 row after tied cursor, got %',
      array_length(v_rows, 1);
  end if;
  if (v_rows[1] ->> 'id')::uuid <> v_third_id then
    raise exception 'surface smoke FAIL test 4c: expected id=% after tied cursor, got %',
      v_third_id, v_rows[1] ->> 'id';
  end if;
  raise notice 'surface smoke ok test 4c: get_activity_feed tie-breaker on observed_at';

  -- =========================================================================
  -- test 5: access denied for a user who is not a space member.
  perform set_config('request.jwt.claim.sub', v_other_id::text, true);
  v_threw := false;
  begin
    perform public.get_activity_feed(v_space_id, '{}'::jsonb);
  exception when sqlstate '42501' then
    v_threw := true;
  end;
  if not v_threw then
    raise exception 'surface smoke FAIL test 5: non-member did not raise 42501';
  end if;
  raise notice 'surface smoke ok test 5: get_activity_feed denies non-member';

  -- back to owner.
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  -- =========================================================================
  -- test 6: get_trial_activity scopes to one trial.
  insert into public.trial_change_events (
    trial_id, space_id, event_type, source, payload, occurred_at, observed_at
  ) values
    (v_trial_b_id, v_space_id, 'status_changed', 'ctgov',
     jsonb_build_object('from', 'RECRUITING', 'to', 'TERMINATED'),
     now() - interval '30 minutes',
     now() - interval '30 minutes');

  v_rows := array(
    select e from public.get_trial_activity(v_trial_a_id, 25) as e
  );
  if array_length(v_rows, 1) <> 3 then
    raise exception 'surface smoke FAIL test 6: expected 3 events for trial A, got %',
      array_length(v_rows, 1);
  end if;
  for v_row in select unnest(v_rows) loop
    if (v_row ->> 'trial_id')::uuid <> v_trial_a_id then
      raise exception 'surface smoke FAIL test 6: leaked event from a different trial';
    end if;
  end loop;
  raise notice 'surface smoke ok test 6: get_trial_activity scopes to one trial';

  -- =========================================================================
  -- test 7: get_marker_history happy path with author email join.
  -- create a marker_type, then two markers via INSERT (the trigger fires and
  -- writes 'created' rows into marker_changes). updating one marker writes a
  -- second 'updated' row.
  select id into v_marker_type_id from public.marker_types limit 1;

  -- act as the owner so auth.uid() picks them up for changed_by.
  insert into public.markers (id, space_id, created_by, marker_type_id, title, event_date, projection)
    values (v_marker_a_id, v_space_id, v_owner_id, v_marker_type_id, 'Marker A title',
            current_date, 'primary');

  update public.markers
     set title = 'Marker A title (revised)'
   where id = v_marker_a_id;

  v_rows := array(
    select r from public.get_marker_history(v_marker_a_id) as r
  );
  if array_length(v_rows, 1) <> 2 then
    raise exception 'surface smoke FAIL test 7: expected 2 audit rows for marker A, got %',
      array_length(v_rows, 1);
  end if;
  if v_rows[1] ->> 'changed_by_email' <> 'surface-owner@invalid.local' then
    raise exception 'surface smoke FAIL test 7: changed_by_email not joined, got %',
      v_rows[1] ->> 'changed_by_email';
  end if;
  raise notice 'surface smoke ok test 7: get_marker_history happy path with email join';

  -- =========================================================================
  -- test 8: history survives marker deletion (marker_id is not a FK).
  insert into public.markers (id, space_id, created_by, marker_type_id, title, event_date, projection)
    values (v_marker_b_id, v_space_id, v_owner_id, v_marker_type_id, 'Marker B title',
            current_date, 'primary');

  delete from public.markers where id = v_marker_b_id;

  -- expect 2 audit rows: 'created' + 'deleted'.
  v_rows := array(
    select r from public.get_marker_history(v_marker_b_id) as r
  );
  if array_length(v_rows, 1) <> 2 then
    raise exception 'surface smoke FAIL test 8: expected 2 history rows after deletion, got %',
      array_length(v_rows, 1);
  end if;
  raise notice 'surface smoke ok test 8: get_marker_history survives marker deletion';

  -- =========================================================================
  -- test 9: trigger_single_trial_sync returns ok+nct_id for trial with NCT.
  v_result := public.trigger_single_trial_sync(v_trial_a_id);
  if (v_result ->> 'ok')::boolean is not true then
    raise exception 'surface smoke FAIL test 9: expected ok=true, got %', v_result;
  end if;
  if v_result ->> 'nct_id' <> 'NCT-SURFACE-A' then
    raise exception 'surface smoke FAIL test 9: expected nct_id=NCT-SURFACE-A, got %',
      v_result ->> 'nct_id';
  end if;
  raise notice 'surface smoke ok test 9: trigger_single_trial_sync returns ok+nct_id';

  -- =========================================================================
  -- test 10: trigger_single_trial_sync returns no_nct_id for trial without identifier.
  v_result := public.trigger_single_trial_sync(v_trial_no_nct_id);
  if (v_result ->> 'ok')::boolean is not false then
    raise exception 'surface smoke FAIL test 10: expected ok=false, got %', v_result;
  end if;
  if v_result ->> 'reason' <> 'no_nct_id' then
    raise exception 'surface smoke FAIL test 10: expected reason=no_nct_id, got %',
      v_result ->> 'reason';
  end if;
  raise notice 'surface smoke ok test 10: trigger_single_trial_sync returns no_nct_id';

  -- =========================================================================
  -- test 11: update_space_field_visibility happy path as space owner.
  v_visibility := jsonb_build_object(
    'trial_detail', jsonb_build_array('protocolSection.sponsorCollaboratorsModule.leadSponsor.name')
  );
  perform public.update_space_field_visibility(v_space_id, v_visibility);

  select ctgov_field_visibility into v_result
    from public.spaces
   where id = v_space_id;
  if v_result <> v_visibility then
    raise exception 'surface smoke FAIL test 11: visibility not persisted, got %', v_result;
  end if;
  raise notice 'surface smoke ok test 11: update_space_field_visibility persists';

  -- =========================================================================
  -- test 12: update_space_field_visibility denied for editor (non-owner).
  perform set_config('request.jwt.claim.sub', v_editor_id::text, true);
  v_threw := false;
  begin
    perform public.update_space_field_visibility(v_space_id, '{}'::jsonb);
  exception when sqlstate '42501' then
    v_threw := true;
  end;
  if not v_threw then
    raise exception 'surface smoke FAIL test 12: editor was allowed to write visibility';
  end if;
  raise notice 'surface smoke ok test 12: update_space_field_visibility denies editor';

  -- back to owner.
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  -- =========================================================================
  -- test 13: recompute_trial_change_events. insert 3 snapshots with status
  -- transitions; expect 2 events emitted (one per consecutive pair).
  -- pre-clean any prior change rows for trial A so the count is deterministic.
  delete from public.trial_change_events
   where trial_id = v_trial_a_id
     and source = 'ctgov';
  delete from public.trial_field_changes where trial_id = v_trial_a_id;
  delete from public.trial_ctgov_snapshots where trial_id = v_trial_a_id;

  insert into public.trial_ctgov_snapshots (
    trial_id, space_id, nct_id, ctgov_version, last_update_post_date,
    payload, fetched_via, fetched_at
  ) values
    (v_trial_a_id, v_space_id, 'NCT-SURFACE-A', 1, '2026-01-01'::date,
     v_payload_v1, 'manual_sync', now()),
    (v_trial_a_id, v_space_id, 'NCT-SURFACE-A', 2, '2026-02-01'::date,
     v_payload_v2, 'manual_sync', now()),
    (v_trial_a_id, v_space_id, 'NCT-SURFACE-A', 3, '2026-03-01'::date,
     v_payload_v3, 'manual_sync', now());

  v_int := public.recompute_trial_change_events(v_trial_a_id);
  if v_int <> 2 then
    raise exception 'surface smoke FAIL test 13: expected 2 events emitted, got %', v_int;
  end if;

  select count(*) into v_count
    from public.trial_change_events
   where trial_id = v_trial_a_id
     and source = 'ctgov';
  if v_count <> 2 then
    raise exception 'surface smoke FAIL test 13: expected 2 ctgov events on disk, got %', v_count;
  end if;

  select count(*) into v_count
    from public.trial_field_changes
   where trial_id = v_trial_a_id;
  if v_count <> 2 then
    raise exception 'surface smoke FAIL test 13: expected 2 field_change rows on disk, got %', v_count;
  end if;
  raise notice 'surface smoke ok test 13: recompute_trial_change_events emits 2 events from 3 snapshots';

  -- =========================================================================
  -- cleanup.
  -- markers FIRST: the BEFORE DELETE trigger on markers writes audit rows
  -- to marker_changes (which has a FK on space_id). if markers were deleted
  -- by the tenant -> spaces cascade, the audit insert would race the cascade
  -- and could fail FK validation. deleting markers up-front avoids that.
  -- members SECOND (with the cascade flag forced on) so the self-protection
  -- guards on space_members / tenant_members do not fire during the cascade.
  -- then tenant -> agency -> auth.users.
  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);

  delete from public.markers where space_id = v_space_id;
  delete from public.space_members where space_id = v_space_id;
  delete from public.tenant_members where tenant_id = v_tenant_id;
  delete from public.tenants  where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id in (v_owner_id, v_other_id, v_editor_id);

  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'surface rpcs smoke test: PASS';
end$$;
