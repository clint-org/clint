-- migration: 20260528130400_marker_change_payload_full_context
-- purpose: enrich every marker-derived trial_change_events payload with
--   marker_title, marker_type_name, marker_color so the events feed can
--   render full context without RPC joins. Unify multi-field-change capture
--   under a single `changes` key (renaming `secondary_changes`). Add the
--   `changes` map to marker_updated payloads so old/new values render in
--   the feed for every edited field.
--
-- spec: docs/superpowers/specs/2026-05-28-detected-rows-marker-context-design.md
-- supersedes function body from 20260528120000_marker_change_payload_event_date.sql
--   (active signature: uuid, varchar). Trigger registration is unchanged.

create or replace function public._emit_events_from_marker_change(
  p_marker_change_id uuid,
  p_source           varchar(20) default 'analyst'
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker_id      uuid;
  v_space_id       uuid;
  v_change_type    varchar(20);
  v_old            jsonb;
  v_new            jsonb;
  v_changed_at     timestamptz;
  v_assignment     record;
  v_event_type     varchar(40);
  v_payload        jsonb;
  v_changes        jsonb;
  v_old_event_date date;
  v_new_event_date date;
  v_old_end_date   date;
  v_new_end_date   date;
  v_old_title      text;
  v_new_title      text;
  v_old_proj       text;
  v_new_proj       text;
  v_old_type       uuid;
  v_new_type       uuid;
  v_old_descr      text;
  v_new_descr      text;
  v_marker_title   text;
  v_marker_type_name text;
  v_marker_color   text;
  v_from_type_name text;
  v_to_type_name   text;
  v_days_diff      int;
  v_direction      text;
  v_marker_id_for_event uuid;
begin
  select marker_id, space_id, change_type, old_values, new_values, changed_at
    into v_marker_id, v_space_id, v_change_type, v_old, v_new, v_changed_at
    from public.marker_changes
   where id = p_marker_change_id;

  if v_marker_id is null then
    raise exception '_emit_events_from_marker_change: audit row % not found', p_marker_change_id;
  end if;

  v_old_event_date := nullif(v_old ->> 'event_date', '')::date;
  v_new_event_date := nullif(v_new ->> 'event_date', '')::date;
  v_old_end_date   := nullif(v_old ->> 'end_date', '')::date;
  v_new_end_date   := nullif(v_new ->> 'end_date', '')::date;
  v_old_title      := v_old ->> 'title';
  v_new_title      := v_new ->> 'title';
  v_old_proj       := v_old ->> 'projection';
  v_new_proj       := v_new ->> 'projection';
  v_old_type       := nullif(v_old ->> 'marker_type_id', '')::uuid;
  v_new_type       := nullif(v_new ->> 'marker_type_id', '')::uuid;
  v_old_descr      := v_old ->> 'description';
  v_new_descr      := v_new ->> 'description';

  -- resolve marker context for payload stashing. for 'deleted' we read the
  -- pre-delete title from v_old and look up the type by v_old_type.
  v_marker_title := case
    when v_change_type = 'deleted' then v_old_title
    else v_new_title
  end;

  select name, color into v_marker_type_name, v_marker_color
    from public.marker_types
   where id = case
     when v_change_type = 'deleted' then v_old_type
     else v_new_type
   end;

  v_changes := '{}'::jsonb;

  if v_change_type = 'created' then
    v_event_type := 'marker_added';
    v_payload := jsonb_build_object(
      'event_date',       v_new ->> 'event_date',
      'marker_type_id',   v_new ->> 'marker_type_id',
      'projection',       v_new ->> 'projection',
      'marker_title',     v_marker_title,
      'marker_type_name', v_marker_type_name,
      'marker_color',     v_marker_color
    );

  elsif v_change_type = 'deleted' then
    v_event_type := 'marker_removed';
    v_payload := jsonb_build_object(
      'event_date',       v_old ->> 'event_date',
      'marker_type_id',   v_old ->> 'marker_type_id',
      'projection',       v_old ->> 'projection',
      'marker_title',     v_marker_title,
      'marker_type_name', v_marker_type_name,
      'marker_color',     v_marker_color
    );

  elsif v_change_type = 'updated' then
    if v_old_event_date is distinct from v_new_event_date then
      v_event_type := 'date_moved';
      v_days_diff := abs((v_new_event_date - v_old_event_date));
      v_direction := case
        when v_new_event_date > v_old_event_date then 'slip'
        when v_new_event_date < v_old_event_date then 'accelerate'
        else 'none'
      end;
      v_payload := jsonb_build_object(
        'which_date',       'event_date',
        'from',             v_old_event_date,
        'to',               v_new_event_date,
        'days_diff',        v_days_diff,
        'direction',        v_direction,
        'marker_title',     v_marker_title,
        'marker_type_name', v_marker_type_name,
        'marker_color',     v_marker_color
      );
      if v_old_proj is distinct from v_new_proj then
        v_changes := v_changes || jsonb_build_object(
          'projection', jsonb_build_object('from', v_old_proj, 'to', v_new_proj));
      end if;
      if v_old_type is distinct from v_new_type then
        v_changes := v_changes || jsonb_build_object(
          'marker_type_id', jsonb_build_object('from', v_old_type, 'to', v_new_type));
      end if;
      if v_old_title is distinct from v_new_title then
        v_changes := v_changes || jsonb_build_object(
          'title', jsonb_build_object('from', v_old_title, 'to', v_new_title));
      end if;
      if v_old_descr is distinct from v_new_descr then
        v_changes := v_changes || jsonb_build_object(
          'description', jsonb_build_object('from', v_old_descr, 'to', v_new_descr));
      end if;
      if v_old_end_date is distinct from v_new_end_date then
        v_changes := v_changes || jsonb_build_object(
          'end_date', jsonb_build_object('from', v_old_end_date, 'to', v_new_end_date));
      end if;

    elsif v_new_proj = 'actual' and v_old_proj is distinct from 'actual' then
      v_event_type := 'projection_finalized';
      v_payload := jsonb_build_object(
        'from',             v_old_proj,
        'to',               v_new_proj,
        'event_date',       v_new ->> 'event_date',
        'marker_title',     v_marker_title,
        'marker_type_name', v_marker_type_name,
        'marker_color',     v_marker_color
      );
      if v_old_type is distinct from v_new_type then
        v_changes := v_changes || jsonb_build_object(
          'marker_type_id', jsonb_build_object('from', v_old_type, 'to', v_new_type));
      end if;
      if v_old_title is distinct from v_new_title then
        v_changes := v_changes || jsonb_build_object(
          'title', jsonb_build_object('from', v_old_title, 'to', v_new_title));
      end if;
      if v_old_descr is distinct from v_new_descr then
        v_changes := v_changes || jsonb_build_object(
          'description', jsonb_build_object('from', v_old_descr, 'to', v_new_descr));
      end if;
      if v_old_end_date is distinct from v_new_end_date then
        v_changes := v_changes || jsonb_build_object(
          'end_date', jsonb_build_object('from', v_old_end_date, 'to', v_new_end_date));
      end if;

    elsif v_old_type is distinct from v_new_type then
      v_event_type := 'marker_reclassified';
      select name into v_from_type_name from public.marker_types where id = v_old_type;
      select name into v_to_type_name   from public.marker_types where id = v_new_type;
      v_payload := jsonb_build_object(
        'from_type_id',         v_old_type,
        'to_type_id',           v_new_type,
        'from_marker_type_name', v_from_type_name,
        'to_marker_type_name',   v_to_type_name,
        'event_date',           v_new ->> 'event_date',
        'marker_title',         v_marker_title,
        'marker_color',         v_marker_color
      );
      if v_old_title is distinct from v_new_title then
        v_changes := v_changes || jsonb_build_object(
          'title', jsonb_build_object('from', v_old_title, 'to', v_new_title));
      end if;
      if v_old_descr is distinct from v_new_descr then
        v_changes := v_changes || jsonb_build_object(
          'description', jsonb_build_object('from', v_old_descr, 'to', v_new_descr));
      end if;
      if v_old_end_date is distinct from v_new_end_date then
        v_changes := v_changes || jsonb_build_object(
          'end_date', jsonb_build_object('from', v_old_end_date, 'to', v_new_end_date));
      end if;

    elsif v_old_title is distinct from v_new_title
       or v_old_descr is distinct from v_new_descr
       or v_old_end_date is distinct from v_new_end_date
       or v_old_proj is distinct from v_new_proj then
      v_event_type := 'marker_updated';
      -- build the unified `changes` map for every changed field
      if v_old_title is distinct from v_new_title then
        v_changes := v_changes || jsonb_build_object(
          'title', jsonb_build_object('from', v_old_title, 'to', v_new_title));
      end if;
      if v_old_descr is distinct from v_new_descr then
        v_changes := v_changes || jsonb_build_object(
          'description', jsonb_build_object('from', v_old_descr, 'to', v_new_descr));
      end if;
      if v_old_end_date is distinct from v_new_end_date then
        v_changes := v_changes || jsonb_build_object(
          'end_date', jsonb_build_object('from', v_old_end_date, 'to', v_new_end_date));
      end if;
      if v_old_proj is distinct from v_new_proj then
        v_changes := v_changes || jsonb_build_object(
          'projection', jsonb_build_object('from', v_old_proj, 'to', v_new_proj));
      end if;
      -- also derive the back-compat changed_fields array from the same set
      v_payload := jsonb_build_object(
        'changed_fields',   coalesce(
          (select jsonb_agg(k) from jsonb_object_keys(v_changes) as k),
          '[]'::jsonb
        ),
        'event_date',       v_new ->> 'event_date',
        'marker_title',     v_marker_title,
        'marker_type_name', v_marker_type_name,
        'marker_color',     v_marker_color
      );
    else
      return;
    end if;
  else
    raise exception '_emit_events_from_marker_change: unknown change_type %', v_change_type;
  end if;

  if v_changes <> '{}'::jsonb then
    v_payload := v_payload || jsonb_build_object('changes', v_changes);
  end if;

  v_marker_id_for_event := case
    when v_change_type = 'deleted' then null
    else v_marker_id
  end;

  for v_assignment in
    select trial_id
      from public.marker_assignments
     where marker_id = v_marker_id
  loop
    insert into public.trial_change_events (
      trial_id,
      space_id,
      event_type,
      source,
      payload,
      occurred_at,
      observed_at,
      derived_from_marker_change_id,
      marker_id
    ) values (
      v_assignment.trial_id,
      v_space_id,
      v_event_type,
      p_source,
      v_payload,
      v_changed_at,
      now(),
      p_marker_change_id,
      v_marker_id_for_event
    );
  end loop;
end;
$$;

revoke execute on function public._emit_events_from_marker_change(uuid, varchar) from public;

comment on function public._emit_events_from_marker_change(uuid, varchar) is
  'Internal: classify a marker_changes row per spec rules and fan out one trial_change_events row per marker_assignments link. SECURITY DEFINER. Stashes marker_title / marker_type_name / marker_color in payload for every marker event type so the events-feed renderer needs no JOINs. Multi-field simultaneous edits ride in payload.changes (unified key; replaces secondary_changes).';


-- =============================================================================
-- smoke: payload stashing + unified `changes` map + reclassification names
-- =============================================================================
do $$
declare
  v_agency_id    uuid := 'fffffff1-ffff-ffff-ffff-fffffffff001';
  v_tenant_id    uuid := 'fffffff2-ffff-ffff-ffff-fffffffff002';
  v_user_id      uuid := 'fffffff3-ffff-ffff-ffff-fffffffff003';
  v_space_id     uuid := 'fffffff4-ffff-ffff-ffff-fffffffff004';
  v_company_id   uuid := 'fffffff5-ffff-ffff-ffff-fffffffff005';
  v_asset_id     uuid := 'fffffff6-ffff-ffff-ffff-fffffffff006';
  v_trial_id     uuid := 'fffffff7-ffff-ffff-ffff-fffffffff007';
  v_marker_id    uuid;
  -- system marker types seeded by 20260414024141_marker_visual_redesign:
  v_type_a       uuid := 'a0000000-0000-0000-0000-000000000030';  -- Interim Data
  v_type_b       uuid := 'a0000000-0000-0000-0000-000000000031';  -- Full Data
  v_added        jsonb;
  v_removed      jsonb;
  v_updated      jsonb;
  v_date_moved   jsonb;
  v_reclassified jsonb;
  v_audit_id     uuid;
begin
  -- bootstrap hermetic fixture (pattern matches 20260528120000)
  insert into auth.users (id, email)
    values (v_user_id, 'detected-context-smoke@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'DRC Smoke', 'drc-smoke', 'drcsmoke', 'DRC', 'drc@y.z');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'DRC', 'drc-smoke-t', 'drcsmoket', 'DRC');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_user_id);

  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_user_id, 'DRC Smoke Co');

  insert into public.assets (id, space_id, created_by, company_id, name)
    values (v_asset_id, v_space_id, v_user_id, v_company_id, 'DRC Smoke Drug');

  insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
    values (v_trial_id, v_space_id, v_user_id, v_asset_id, 'DRC_TRIAL', 'NCT-DRC-SMOKE');

  -- (1) marker_added smoke. BEFORE INSERT trigger fans out before
  -- marker_assignments is wired up, so re-emit the audit row by hand once
  -- assignments exist. This matches what create_marker() does internally.
  insert into public.markers (space_id, marker_type_id, title, projection, event_date, created_by)
    values (v_space_id, v_type_a, 'Smoke title 1', 'stout', '2030-01-01', v_user_id)
    returning id into v_marker_id;
  insert into public.marker_assignments (marker_id, trial_id)
    values (v_marker_id, v_trial_id);

  select id into v_audit_id
    from public.marker_changes
   where marker_id = v_marker_id and change_type = 'created'
   order by changed_at desc limit 1;
  perform public._emit_events_from_marker_change(v_audit_id, 'analyst');

  select payload into v_added
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'marker_added'
   order by occurred_at desc limit 1;

  if v_added->>'marker_title' is null then
    raise exception 'marker_added FAIL: marker_title missing (got: %)', v_added;
  end if;
  if v_added->>'marker_type_name' is null then
    raise exception 'marker_added FAIL: marker_type_name missing (got: %)', v_added;
  end if;
  if v_added->>'marker_color' is null then
    raise exception 'marker_added FAIL: marker_color missing (got: %)', v_added;
  end if;

  -- (2) marker_updated smoke: multi-field edit (title + description + end_date + projection)
  update public.markers
     set title = 'Smoke title 2',
         description = 'New description',
         end_date = '2030-02-01',
         projection = 'company'
   where id = v_marker_id;

  select payload into v_updated
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'marker_updated'
   order by occurred_at desc limit 1;

  if not (v_updated -> 'changes' ? 'title') then
    raise exception 'marker_updated FAIL: changes.title missing (got: %)', v_updated;
  end if;
  if not (v_updated -> 'changes' ? 'description') then
    raise exception 'marker_updated FAIL: changes.description missing (got: %)', v_updated;
  end if;
  if not (v_updated -> 'changes' ? 'end_date') then
    raise exception 'marker_updated FAIL: changes.end_date missing (got: %)', v_updated;
  end if;
  if not (v_updated -> 'changes' ? 'projection') then
    raise exception 'marker_updated FAIL: changes.projection missing (got: %)', v_updated;
  end if;
  if (v_updated -> 'changes' -> 'title' ->> 'from') is null then
    raise exception 'marker_updated FAIL: changes.title.from missing (got: %)', v_updated;
  end if;
  if (v_updated -> 'changes' -> 'title' ->> 'to') is null then
    raise exception 'marker_updated FAIL: changes.title.to missing (got: %)', v_updated;
  end if;
  if v_updated->>'marker_title' is null then
    raise exception 'marker_updated FAIL: marker_title missing (got: %)', v_updated;
  end if;

  -- (3) date_moved + simultaneous description edit
  update public.markers
     set event_date = '2030-03-01',
         description = 'Another description'
   where id = v_marker_id;

  select payload into v_date_moved
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'date_moved'
   order by occurred_at desc limit 1;

  if not (v_date_moved -> 'changes' ? 'description') then
    raise exception 'date_moved FAIL: changes.description missing (got: %)', v_date_moved;
  end if;
  if v_date_moved->>'marker_title' is null then
    raise exception 'date_moved FAIL: marker_title missing (got: %)', v_date_moved;
  end if;

  -- (4) marker_reclassified + simultaneous end_date edit
  update public.markers
     set marker_type_id = v_type_b,
         end_date = '2030-04-01'
   where id = v_marker_id;

  select payload into v_reclassified
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'marker_reclassified'
   order by occurred_at desc limit 1;

  if v_reclassified->>'from_marker_type_name' is null then
    raise exception 'marker_reclassified FAIL: from_marker_type_name missing (got: %)', v_reclassified;
  end if;
  if v_reclassified->>'to_marker_type_name' is null then
    raise exception 'marker_reclassified FAIL: to_marker_type_name missing (got: %)', v_reclassified;
  end if;
  if not (v_reclassified -> 'changes' ? 'end_date') then
    raise exception 'marker_reclassified FAIL: changes.end_date missing (got: %)', v_reclassified;
  end if;

  -- (5) marker_removed smoke
  delete from public.markers where id = v_marker_id;

  select payload into v_removed
    from public.trial_change_events
   where derived_from_marker_change_id in (
     select id from public.marker_changes where marker_id = v_marker_id and change_type = 'deleted'
   )
   order by occurred_at desc limit 1;

  if v_removed->>'marker_title' is null then
    raise exception 'marker_removed FAIL: marker_title missing (got: %)', v_removed;
  end if;
  if v_removed->>'marker_type_name' is null then
    raise exception 'marker_removed FAIL: marker_type_name missing (got: %)', v_removed;
  end if;

  -- cleanup (reverse dependency order, same pattern as 20260528120000)
  delete from public.trial_change_events where space_id = v_space_id;
  delete from public.marker_changes where space_id = v_space_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;

  raise notice 'detected rows context smoke: PASS';
end $$;
