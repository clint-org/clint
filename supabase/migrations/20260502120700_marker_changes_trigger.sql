-- migration: 20260502120700_marker_changes_trigger
-- purpose: install the analyst-side audit pipeline for markers.
--   1. _emit_events_from_marker_change(p_marker_change_id) walks the audit
--      row, classifies the diff per the spec ("Markers audit log and
--      classifier" / "Classifier" table), fans out via marker_assignments,
--      and inserts one typed row into trial_change_events per assigned
--      trial. tie-breaker: date_moved wins; other simultaneously-changed
--      material fields ride in payload.secondary_changes.
--   2. _log_marker_change() is the BEFORE INSERT/UPDATE/DELETE trigger on
--      public.markers. SECURITY DEFINER so writes succeed regardless of
--      the editing user's RLS perms. inserts into marker_changes only
--      when a material field actually differs (UPDATE path), then calls
--      _emit_events_from_marker_change for fanout. BEFORE timing is used
--      so that on DELETE, marker_assignments rows are still present when
--      the classifier fans out (the assignments cascade away once the
--      DELETE statement's RI cascades fire). Audit + events are still
--      written inside the same transaction as the DELETE, so a rollback
--      of the parent statement also rolls back the audit.
--   3. backfill_marker_history() one-shot synthesizes a 'created' audit
--      row for every existing marker (using the marker's own created_at /
--      created_by) and runs the classifier so the activity feed is
--      non-empty on day 1.
--
-- material fields tracked: event_date, end_date, title, projection,
--   marker_type_id, description. all other columns (source_url, metadata,
--   created_by, timestamps, generated is_projected, id, space_id) are
--   non-material and never produce an audit row by themselves.
--
-- security: _emit and _log are SECURITY DEFINER, both have execute revoked
--   from public (no direct callers). backfill_marker_history is granted to
--   authenticated so platform admins can run it once after deploy.
--
-- Cascade-delete hazard: if a future RPC deletes a `spaces` row, the cascade
-- to `markers` fires this BEFORE DELETE trigger which inserts new audit rows
-- referencing the same `space_id`. Postgres RI cascade ordering between
-- `markers` and `marker_changes` deletions is not guaranteed, so depending on
-- order the new audit rows may end up dangling (silently orphaned) or be
-- cleaned up by the cascade. Any future delete-space flow MUST explicitly
-- DELETE FROM markers WHERE space_id = X first to avoid this. The smoke test
-- at the bottom of this file follows that pattern. (Spaces are not currently
-- deletable via any RPC, so this is forward-guidance only.)

-- =============================================================================
-- 1. classifier: walk a marker_changes row, fan out to trial_change_events.
--
create or replace function public._emit_events_from_marker_change(
  p_marker_change_id uuid
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
  v_secondary      jsonb;
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
  v_changed_fields text[];
  v_days_diff      int;
  v_direction      text;
  v_marker_id_for_event uuid;
begin
  -- load the audit row.
  select marker_id, space_id, change_type, old_values, new_values, changed_at
    into v_marker_id, v_space_id, v_change_type, v_old, v_new, v_changed_at
    from public.marker_changes
   where id = p_marker_change_id;

  if v_marker_id is null then
    raise exception '_emit_events_from_marker_change: audit row % not found', p_marker_change_id;
  end if;

  -- materialize the six material fields out of the payloads up front so
  -- the per-assignment loop is straight comparison logic.
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

  -- classify once (event_type + payload are the same for every assignment).
  v_secondary := '{}'::jsonb;

  if v_change_type = 'created' then
    v_event_type := 'marker_added';
    v_payload := jsonb_build_object(
      'event_date',     v_new ->> 'event_date',
      'marker_type_id', v_new ->> 'marker_type_id',
      'projection',     v_new ->> 'projection'
    );

  elsif v_change_type = 'deleted' then
    v_event_type := 'marker_removed';
    v_payload := jsonb_build_object(
      'event_date',     v_old ->> 'event_date',
      'marker_type_id', v_old ->> 'marker_type_id',
      'projection',     v_old ->> 'projection'
    );

  elsif v_change_type = 'updated' then
    -- priority order:
    --   1. event_date change       -> date_moved
    --   2. projection -> 'actual'  -> projection_finalized
    --   3. marker_type_id change   -> marker_reclassified
    --   4. title or description    -> marker_updated
    -- losing material fields (that still changed) ride in secondary_changes.

    if v_old_event_date is distinct from v_new_event_date then
      v_event_type := 'date_moved';
      v_days_diff := abs((v_new_event_date - v_old_event_date));
      v_direction := case
        when v_new_event_date > v_old_event_date then 'slip'
        when v_new_event_date < v_old_event_date then 'accelerate'
        else 'none'
      end;
      v_payload := jsonb_build_object(
        'which_date', 'event_date',
        'from',       v_old_event_date,
        'to',         v_new_event_date,
        'days_diff',  v_days_diff,
        'direction',  v_direction
      );

      -- secondary: any other material field that also changed.
      if v_old_proj is distinct from v_new_proj then
        v_secondary := v_secondary || jsonb_build_object(
          'projection', jsonb_build_object('from', v_old_proj, 'to', v_new_proj)
        );
      end if;
      if v_old_type is distinct from v_new_type then
        v_secondary := v_secondary || jsonb_build_object(
          'marker_type_id', jsonb_build_object('from', v_old_type, 'to', v_new_type)
        );
      end if;
      if v_old_title is distinct from v_new_title then
        v_secondary := v_secondary || jsonb_build_object(
          'title', jsonb_build_object('from', v_old_title, 'to', v_new_title)
        );
      end if;
      if v_old_descr is distinct from v_new_descr then
        v_secondary := v_secondary || jsonb_build_object(
          'description', jsonb_build_object('from', v_old_descr, 'to', v_new_descr)
        );
      end if;
      if v_old_end_date is distinct from v_new_end_date then
        v_secondary := v_secondary || jsonb_build_object(
          'end_date', jsonb_build_object('from', v_old_end_date, 'to', v_new_end_date)
        );
      end if;

    elsif v_new_proj = 'actual' and v_old_proj is distinct from 'actual' then
      v_event_type := 'projection_finalized';
      v_payload := jsonb_build_object(
        'from',       v_old_proj,
        'to',         v_new_proj,
        'event_date', v_new ->> 'event_date'
      );
      if v_old_type is distinct from v_new_type then
        v_secondary := v_secondary || jsonb_build_object(
          'marker_type_id', jsonb_build_object('from', v_old_type, 'to', v_new_type)
        );
      end if;
      if v_old_title is distinct from v_new_title then
        v_secondary := v_secondary || jsonb_build_object(
          'title', jsonb_build_object('from', v_old_title, 'to', v_new_title)
        );
      end if;
      if v_old_descr is distinct from v_new_descr then
        v_secondary := v_secondary || jsonb_build_object(
          'description', jsonb_build_object('from', v_old_descr, 'to', v_new_descr)
        );
      end if;
      if v_old_end_date is distinct from v_new_end_date then
        v_secondary := v_secondary || jsonb_build_object(
          'end_date', jsonb_build_object('from', v_old_end_date, 'to', v_new_end_date)
        );
      end if;

    elsif v_old_type is distinct from v_new_type then
      v_event_type := 'marker_reclassified';
      v_payload := jsonb_build_object(
        'from_type_id', v_old_type,
        'to_type_id',   v_new_type
      );
      if v_old_title is distinct from v_new_title then
        v_secondary := v_secondary || jsonb_build_object(
          'title', jsonb_build_object('from', v_old_title, 'to', v_new_title)
        );
      end if;
      if v_old_descr is distinct from v_new_descr then
        v_secondary := v_secondary || jsonb_build_object(
          'description', jsonb_build_object('from', v_old_descr, 'to', v_new_descr)
        );
      end if;
      if v_old_end_date is distinct from v_new_end_date then
        v_secondary := v_secondary || jsonb_build_object(
          'end_date', jsonb_build_object('from', v_old_end_date, 'to', v_new_end_date)
        );
      end if;

    elsif v_old_title is distinct from v_new_title
       or v_old_descr is distinct from v_new_descr
       or v_old_end_date is distinct from v_new_end_date
       or v_old_proj is distinct from v_new_proj then
      -- nothing higher-priority changed; bundle the remaining material
      -- fields under marker_updated. end_date has no dedicated event type
      -- in the spec, so it lands here too. projection-only changes between
      -- two non-actual values (e.g. stout -> primary) also land here, since
      -- projection_finalized fires only when the new value is 'actual'.
      v_changed_fields := array[]::text[];
      if v_old_title is distinct from v_new_title then
        v_changed_fields := array_append(v_changed_fields, 'title');
      end if;
      if v_old_descr is distinct from v_new_descr then
        v_changed_fields := array_append(v_changed_fields, 'description');
      end if;
      if v_old_end_date is distinct from v_new_end_date then
        v_changed_fields := array_append(v_changed_fields, 'end_date');
      end if;
      if v_old_proj is distinct from v_new_proj then
        v_changed_fields := array_append(v_changed_fields, 'projection');
      end if;
      v_event_type := 'marker_updated';
      v_payload := jsonb_build_object(
        'changed_fields', to_jsonb(v_changed_fields)
      );

    else
      -- Defensive: if no material field actually differs, return without
      -- emitting. The trigger's diff guard should make this unreachable,
      -- but kept for safety.
      return;
    end if;

  else
    raise exception '_emit_events_from_marker_change: unknown change_type %', v_change_type;
  end if;

  -- attach secondary_changes if any losing-priority field changed.
  if v_secondary <> '{}'::jsonb then
    v_payload := v_payload || jsonb_build_object('secondary_changes', v_secondary);
  end if;

  -- the marker FK on trial_change_events is on delete set null. for a
  -- 'deleted' audit, even though the trigger runs BEFORE the actual row
  -- removal, the marker is about to vanish in the same statement and the
  -- FK would set the column to null at constraint-check time anyway; we
  -- store null up front to reflect the post-statement state and to avoid
  -- a transient pointer to a row that is being deleted. for 'created' /
  -- 'updated' the marker remains and we keep the link so the UI can
  -- hydrate live data.
  v_marker_id_for_event := case
    when v_change_type = 'deleted' then null
    else v_marker_id
  end;

  -- fan out: one event per (marker_change, trial assignment).
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
      'analyst',
      v_payload,
      v_changed_at,
      now(),
      p_marker_change_id,
      v_marker_id_for_event
    );
  end loop;
end;
$$;

revoke execute on function public._emit_events_from_marker_change(uuid) from public;

comment on function public._emit_events_from_marker_change(uuid) is
  'Internal: classify a marker_changes row per spec rules and fan out one trial_change_events row per marker_assignments link. SECURITY DEFINER. Called only by _log_marker_change and backfill_marker_history.';


-- =============================================================================
-- 2. trigger function: BEFORE INSERT/UPDATE/DELETE on markers.
--
create or replace function public._log_marker_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_audit_id    uuid;
  v_old_payload jsonb;
  v_new_payload jsonb;
  v_changed_by  uuid;
begin
  v_changed_by := auth.uid();

  if tg_op = 'INSERT' then
    v_new_payload := jsonb_build_object(
      'event_date',     new.event_date,
      'end_date',       new.end_date,
      'title',          new.title,
      'projection',     new.projection,
      'marker_type_id', new.marker_type_id,
      'description',    new.description
    );

    insert into public.marker_changes (
      marker_id, space_id, change_type, old_values, new_values, changed_by, changed_at
    ) values (
      new.id, new.space_id, 'created', null, v_new_payload, v_changed_by, now()
    )
    returning id into v_audit_id;

    perform public._emit_events_from_marker_change(v_audit_id);
    return new;

  elsif tg_op = 'UPDATE' then
    -- short-circuit when no material field changed. is distinct from
    -- handles nulls in either side.
    if new.event_date     is not distinct from old.event_date
       and new.end_date   is not distinct from old.end_date
       and new.title      is not distinct from old.title
       and new.projection is not distinct from old.projection
       and new.marker_type_id is not distinct from old.marker_type_id
       and new.description is not distinct from old.description then
      return new;
    end if;

    v_old_payload := jsonb_build_object(
      'event_date',     old.event_date,
      'end_date',       old.end_date,
      'title',          old.title,
      'projection',     old.projection,
      'marker_type_id', old.marker_type_id,
      'description',    old.description
    );
    v_new_payload := jsonb_build_object(
      'event_date',     new.event_date,
      'end_date',       new.end_date,
      'title',          new.title,
      'projection',     new.projection,
      'marker_type_id', new.marker_type_id,
      'description',    new.description
    );

    insert into public.marker_changes (
      marker_id, space_id, change_type, old_values, new_values, changed_by, changed_at
    ) values (
      new.id, new.space_id, 'updated', v_old_payload, v_new_payload, v_changed_by, now()
    )
    returning id into v_audit_id;

    perform public._emit_events_from_marker_change(v_audit_id);
    return new;

  elsif tg_op = 'DELETE' then
    v_old_payload := jsonb_build_object(
      'event_date',     old.event_date,
      'end_date',       old.end_date,
      'title',          old.title,
      'projection',     old.projection,
      'marker_type_id', old.marker_type_id,
      'description',    old.description
    );

    insert into public.marker_changes (
      marker_id, space_id, change_type, old_values, new_values, changed_by, changed_at
    ) values (
      old.id, old.space_id, 'deleted', v_old_payload, null, v_changed_by, now()
    )
    returning id into v_audit_id;

    perform public._emit_events_from_marker_change(v_audit_id);
    return old;
  end if;

  return null;
end;
$$;

revoke execute on function public._log_marker_change() from public;

comment on function public._log_marker_change() is
  'Internal trigger function: writes marker_changes audit rows on INSERT / UPDATE / DELETE of public.markers (UPDATE only when a material field differs) and calls _emit_events_from_marker_change for fanout. BEFORE timing is required because marker_assignments are cascade-deleted; an AFTER DELETE trigger would see zero assignments at fan-out time. SECURITY DEFINER.';

create trigger markers_audit
before insert or update or delete on public.markers
for each row execute function public._log_marker_change();


-- =============================================================================
-- 3. backfill: synthesize 'created' audit rows for existing markers and
-- run the classifier. one-shot, SECURITY DEFINER, granted to authenticated.
--
create or replace function public.backfill_marker_history()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      record;
  v_audit_id uuid;
  v_count    int := 0;
begin
  for v_row in
    select id, space_id, event_date, end_date, title, projection,
           marker_type_id, description, created_at, created_by
      from public.markers
  loop
    insert into public.marker_changes (
      marker_id, space_id, change_type, old_values, new_values, changed_by, changed_at
    ) values (
      v_row.id,
      v_row.space_id,
      'created',
      null,
      jsonb_build_object(
        'event_date',     v_row.event_date,
        'end_date',       v_row.end_date,
        'title',          v_row.title,
        'projection',     v_row.projection,
        'marker_type_id', v_row.marker_type_id,
        'description',    v_row.description
      ),
      v_row.created_by,
      v_row.created_at
    )
    returning id into v_audit_id;

    perform public._emit_events_from_marker_change(v_audit_id);

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.backfill_marker_history() from public;
grant execute on function public.backfill_marker_history() to authenticated;

comment on function public.backfill_marker_history() is
  'One-shot: synthesize a created marker_changes row for every existing public.markers row (using its own created_at / created_by) and run the classifier. Returns count of audit rows written. Intended to be invoked once after deploy by a platform admin. SECURITY DEFINER, granted to authenticated.';


-- =============================================================================
-- smoke tests: bootstrap a hermetic fixture, exercise the trigger paths,
-- and tear down. seed.sql runs after migrations so the smoke must build
-- its own agency / tenant / space / company / product / TA / trial.
--
do $$
declare
  v_agency_id   uuid := '88888881-8888-8888-8888-888888888881';
  v_tenant_id   uuid := '88888882-8888-8888-8888-888888888882';
  v_user_id     uuid := '88888883-8888-8888-8888-888888888883';
  v_space_id    uuid := '88888884-8888-8888-8888-888888888884';
  v_company_id  uuid := '88888885-8888-8888-8888-888888888885';
  v_product_id  uuid := '88888886-8888-8888-8888-888888888886';
  v_ta_id       uuid := '88888887-8888-8888-8888-888888888887';
  v_trial_id    uuid := '88888888-8888-8888-8888-888888888888';
  v_marker_id   uuid;
  v_marker2_id  uuid;
  v_marker3_id  uuid;
  v_orphan_id   uuid;
  v_audit_id    uuid;
  v_event_id    uuid;
  v_event_count int;
  v_audit_count int;
  v_event_type  varchar(40);
  v_payload     jsonb;
  v_marker_id_on_event uuid;
  v_derived_id  uuid;
  v_backfill_count int;
  -- system marker types seeded by 20260414024141_marker_visual_redesign.
  v_type_a      uuid := 'a0000000-0000-0000-0000-000000000030';  -- Interim Data
  v_type_b      uuid := 'a0000000-0000-0000-0000-000000000031';  -- Full Data
begin
  -- bootstrap fixture.
  insert into auth.users (id, email)
    values (v_user_id, 'marker-trigger-smoke@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'MT Smoke', 'mt-smoke', 'mtsmoke', 'MT', 'mt@y.z');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'MT', 'mt-smoke-t', 'mtsmoket', 'MT');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_user_id);

  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_user_id, 'MT Smoke Co');

  insert into public.products (id, space_id, created_by, company_id, name)
    values (v_product_id, v_space_id, v_user_id, v_company_id, 'MT Smoke Drug');

  insert into public.therapeutic_areas (id, space_id, created_by, name)
    values (v_ta_id, v_space_id, v_user_id, 'MT Smoke TA');

  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier)
    values (v_trial_id, v_space_id, v_user_id, v_product_id, v_ta_id, 'MT_SMOKE_TRIAL', 'NCT-MT-SMOKE');

  -- --- test 1: insert + assignment + insert second marker -> marker_added.
  -- order: first marker (no assignments at insert -> 0 events), then add
  -- assignment, then a second marker we will use for subsequent UPDATE
  -- tests; that second insert has no assignments at insert time either.
  -- to test the fan-out path on INSERT specifically, we use a third marker
  -- below in test 9. for test 1 we verify the audit row alone.
  v_marker_id := gen_random_uuid();
  insert into public.markers (
    id, space_id, marker_type_id, title, projection, event_date, created_by
  ) values (
    v_marker_id, v_space_id, v_type_a, 'M1 Initial', 'stout', '2026-06-01', v_user_id
  );

  select count(*) into v_audit_count
    from public.marker_changes
   where marker_id = v_marker_id and change_type = 'created';
  if v_audit_count <> 1 then
    raise exception 'marker trigger smoke FAIL test 1: expected 1 created audit, got %', v_audit_count;
  end if;

  -- now wire the assignment so subsequent UPDATEs fan out.
  insert into public.marker_assignments (marker_id, trial_id)
    values (v_marker_id, v_trial_id);

  raise notice 'marker trigger smoke ok 1: insert -> marker_added audit row';

  -- --- test 2: UPDATE event_date -> date_moved (slip 30 days), no secondary.
  update public.markers
     set event_date = '2026-07-01'
   where id = v_marker_id;

  select count(*) into v_event_count
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'date_moved';
  if v_event_count <> 1 then
    raise exception 'marker trigger smoke FAIL test 2: expected 1 date_moved event, got %', v_event_count;
  end if;

  select payload into v_payload
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'date_moved';

  if (v_payload ->> 'days_diff')::int <> 30 then
    raise exception 'marker trigger smoke FAIL test 2: expected days_diff=30, got %', v_payload;
  end if;
  if v_payload ->> 'direction' <> 'slip' then
    raise exception 'marker trigger smoke FAIL test 2: expected direction=slip, got %', v_payload;
  end if;
  if v_payload ? 'secondary_changes' then
    raise exception 'marker trigger smoke FAIL test 2: secondary_changes should be absent, got %', v_payload;
  end if;

  raise notice 'marker trigger smoke ok 2: event_date update -> date_moved (slip, 30d, no secondary)';

  -- --- test 3: UPDATE event_date AND title -> date_moved wins, title in secondary.
  update public.markers
     set event_date = '2026-08-15',
         title      = 'M1 Renamed'
   where id = v_marker_id;

  select count(*) into v_event_count
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'date_moved';
  if v_event_count <> 2 then
    raise exception 'marker trigger smoke FAIL test 3: expected 2 cumulative date_moved events, got %', v_event_count;
  end if;

  select payload into v_payload
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'date_moved'
   order by observed_at desc
   limit 1;

  if not (v_payload -> 'secondary_changes' ? 'title') then
    raise exception 'marker trigger smoke FAIL test 3: expected secondary_changes.title, got %', v_payload;
  end if;

  raise notice 'marker trigger smoke ok 3: date+title update -> date_moved wins, title in secondary';

  -- --- test 4: UPDATE only title -> marker_updated.
  update public.markers
     set title = 'M1 Renamed Again'
   where id = v_marker_id;

  select count(*) into v_event_count
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'marker_updated';
  if v_event_count <> 1 then
    raise exception 'marker trigger smoke FAIL test 4: expected 1 marker_updated event, got %', v_event_count;
  end if;

  select payload into v_payload
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'marker_updated';

  if not (v_payload -> 'changed_fields') ? 'title' then
    raise exception 'marker trigger smoke FAIL test 4: expected changed_fields to include title, got %', v_payload;
  end if;

  raise notice 'marker trigger smoke ok 4: title-only update -> marker_updated with changed_fields';

  -- --- test 5: UPDATE marker_type_id -> marker_reclassified.
  update public.markers
     set marker_type_id = v_type_b
   where id = v_marker_id;

  select count(*) into v_event_count
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'marker_reclassified';
  if v_event_count <> 1 then
    raise exception 'marker trigger smoke FAIL test 5: expected 1 marker_reclassified event, got %', v_event_count;
  end if;

  select payload into v_payload
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'marker_reclassified';

  if (v_payload ->> 'from_type_id')::uuid <> v_type_a then
    raise exception 'marker trigger smoke FAIL test 5: expected from_type_id=%, got %', v_type_a, v_payload;
  end if;
  if (v_payload ->> 'to_type_id')::uuid <> v_type_b then
    raise exception 'marker trigger smoke FAIL test 5: expected to_type_id=%, got %', v_type_b, v_payload;
  end if;

  raise notice 'marker trigger smoke ok 5: marker_type_id update -> marker_reclassified';

  -- --- test 6: UPDATE projection 'stout' -> 'actual' -> projection_finalized.
  update public.markers
     set projection = 'actual'
   where id = v_marker_id;

  select count(*) into v_event_count
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'projection_finalized';
  if v_event_count <> 1 then
    raise exception 'marker trigger smoke FAIL test 6: expected 1 projection_finalized event, got %', v_event_count;
  end if;

  select payload into v_payload
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'projection_finalized';

  if v_payload ->> 'from' <> 'stout' or v_payload ->> 'to' <> 'actual' then
    raise exception 'marker trigger smoke FAIL test 6: expected from=stout to=actual, got %', v_payload;
  end if;

  raise notice 'marker trigger smoke ok 6: projection stout->actual -> projection_finalized';

  -- --- test 7: UPDATE non-material field (metadata) -> no audit, no event.
  select count(*) into v_audit_count
    from public.marker_changes
   where marker_id = v_marker_id;
  select count(*) into v_event_count
    from public.trial_change_events
   where marker_id = v_marker_id;

  update public.markers
     set metadata = '{"foo":"bar"}'::jsonb,
         source_url = 'https://example.invalid/m1'
   where id = v_marker_id;

  if (select count(*) from public.marker_changes where marker_id = v_marker_id) <> v_audit_count then
    raise exception 'marker trigger smoke FAIL test 7: non-material update wrote a marker_changes row';
  end if;
  if (select count(*) from public.trial_change_events where marker_id = v_marker_id) <> v_event_count then
    raise exception 'marker trigger smoke FAIL test 7: non-material update wrote a trial_change_events row';
  end if;

  raise notice 'marker trigger smoke ok 7: non-material update is a no-op';

  -- --- test 8: DELETE marker -> marker_removed, marker_id null on event row,
  -- derived_from_marker_change_id set so the UI can recover old title.
  delete from public.markers where id = v_marker_id;

  select count(*) into v_audit_count
    from public.marker_changes
   where marker_id = v_marker_id and change_type = 'deleted';
  if v_audit_count <> 1 then
    raise exception 'marker trigger smoke FAIL test 8: expected 1 deleted audit row, got %', v_audit_count;
  end if;

  select count(*) into v_event_count
    from public.trial_change_events
   where event_type = 'marker_removed'
     and derived_from_marker_change_id in (
       select id from public.marker_changes
        where marker_id = v_marker_id and change_type = 'deleted'
     );
  if v_event_count <> 1 then
    raise exception 'marker trigger smoke FAIL test 8: expected 1 marker_removed event, got %', v_event_count;
  end if;

  select marker_id, derived_from_marker_change_id
    into v_marker_id_on_event, v_derived_id
    from public.trial_change_events
   where event_type = 'marker_removed'
     and derived_from_marker_change_id in (
       select id from public.marker_changes
        where marker_id = v_marker_id and change_type = 'deleted'
     )
   limit 1;
  if v_marker_id_on_event is not null then
    raise exception 'marker trigger smoke FAIL test 8: marker_id on event must be null after delete, got %', v_marker_id_on_event;
  end if;
  if v_derived_id is null then
    raise exception 'marker trigger smoke FAIL test 8: derived_from_marker_change_id must be set';
  end if;

  raise notice 'marker trigger smoke ok 8: delete -> marker_removed (marker_id null, derived link kept)';

  -- --- test 9: marker with zero assignments -> audit row, zero events.
  v_orphan_id := gen_random_uuid();
  insert into public.markers (
    id, space_id, marker_type_id, title, projection, event_date, created_by
  ) values (
    v_orphan_id, v_space_id, v_type_a, 'Orphan', 'actual', '2026-09-01', v_user_id
  );

  select count(*) into v_audit_count
    from public.marker_changes
   where marker_id = v_orphan_id;
  if v_audit_count <> 1 then
    raise exception 'marker trigger smoke FAIL test 9: expected 1 audit row for orphan, got %', v_audit_count;
  end if;

  select count(*) into v_event_count
    from public.trial_change_events
   where derived_from_marker_change_id in (
     select id from public.marker_changes where marker_id = v_orphan_id
   );
  if v_event_count <> 0 then
    raise exception 'marker trigger smoke FAIL test 9: orphan should produce 0 events, got %', v_event_count;
  end if;

  raise notice 'marker trigger smoke ok 9: zero-assignment marker -> 1 audit, 0 events';

  -- --- test 10: backfill_marker_history synthesizes created rows + events.
  -- create a marker manually in a way that bypasses the trigger so backfill
  -- has work to do: easier path is to clear out audits + events for a
  -- specific known marker first, then run backfill and verify it writes.
  -- pre-clean: delete audit+events for the orphan, then verify backfill
  -- restores exactly one created row for it.
  delete from public.trial_change_events
   where derived_from_marker_change_id in (
     select id from public.marker_changes where marker_id = v_orphan_id
   );
  delete from public.marker_changes where marker_id = v_orphan_id;

  -- create a second marker (with assignment) likewise pre-cleaned so we can
  -- verify backfill fans out events for an assigned marker.
  v_marker2_id := gen_random_uuid();
  insert into public.markers (
    id, space_id, marker_type_id, title, projection, event_date, created_by
  ) values (
    v_marker2_id, v_space_id, v_type_a, 'M2 Backfill', 'actual', '2026-10-01', v_user_id
  );
  insert into public.marker_assignments (marker_id, trial_id)
    values (v_marker2_id, v_trial_id);

  -- the trigger already wrote a 'created' audit + 0 events (no assignment
  -- at insert time, then assignment came after). clear it so backfill is
  -- the only producer for this marker.
  delete from public.trial_change_events
   where derived_from_marker_change_id in (
     select id from public.marker_changes where marker_id = v_marker2_id
   );
  delete from public.marker_changes where marker_id = v_marker2_id;

  v_backfill_count := public.backfill_marker_history();
  if v_backfill_count < 2 then
    raise exception 'marker trigger smoke FAIL test 10: expected backfill_count >= 2, got %', v_backfill_count;
  end if;

  -- orphan got a created audit row, zero events.
  if (select count(*) from public.marker_changes
        where marker_id = v_orphan_id and change_type = 'created') <> 1 then
    raise exception 'marker trigger smoke FAIL test 10: orphan missing backfilled created row';
  end if;
  if (select count(*) from public.trial_change_events
        where derived_from_marker_change_id in (
          select id from public.marker_changes where marker_id = v_orphan_id
        )) <> 0 then
    raise exception 'marker trigger smoke FAIL test 10: orphan should have 0 backfilled events';
  end if;

  -- M2 got created + 1 fanout event of type marker_added.
  if (select count(*) from public.marker_changes
        where marker_id = v_marker2_id and change_type = 'created') <> 1 then
    raise exception 'marker trigger smoke FAIL test 10: M2 missing backfilled created row';
  end if;
  if (select count(*) from public.trial_change_events
        where derived_from_marker_change_id in (
          select id from public.marker_changes where marker_id = v_marker2_id
        ) and event_type = 'marker_added') <> 1 then
    raise exception 'marker trigger smoke FAIL test 10: M2 missing backfilled marker_added event';
  end if;

  raise notice 'marker trigger smoke ok 10: backfill_marker_history -> created rows + fanout events';

  -- --- test 11: UPDATE projection between two non-actual values
  -- ('stout' -> 'primary') -> marker_updated with projection in
  -- changed_fields, and zero projection_finalized events on this trial.
  v_marker3_id := gen_random_uuid();
  insert into public.markers (
    id, space_id, marker_type_id, title, projection, event_date, created_by
  ) values (
    v_marker3_id, v_space_id, v_type_a, 'M3 Projection Shift', 'stout', '2026-11-01', v_user_id
  );
  insert into public.marker_assignments (marker_id, trial_id)
    values (v_marker3_id, v_trial_id);

  -- snapshot the trial-level projection_finalized count before the update so
  -- we can assert the update contributed zero of them.
  select count(*) into v_event_count
    from public.trial_change_events
   where trial_id = v_trial_id and event_type = 'projection_finalized';

  update public.markers
     set projection = 'primary'
   where id = v_marker3_id;

  if (select count(*) from public.trial_change_events
        where marker_id = v_marker3_id and event_type = 'marker_updated') <> 1 then
    raise exception 'marker trigger smoke FAIL test 11: expected 1 marker_updated event for marker3, got %',
      (select count(*) from public.trial_change_events
         where marker_id = v_marker3_id and event_type = 'marker_updated');
  end if;

  select payload into v_payload
    from public.trial_change_events
   where marker_id = v_marker3_id and event_type = 'marker_updated';

  if not (v_payload -> 'changed_fields') ? 'projection' then
    raise exception 'marker trigger smoke FAIL test 11: expected changed_fields to include projection, got %', v_payload;
  end if;

  -- the update must NOT have produced any projection_finalized event for
  -- this trial (count must be unchanged from the pre-update snapshot).
  if (select count(*) from public.trial_change_events
        where trial_id = v_trial_id and event_type = 'projection_finalized') <> v_event_count then
    raise exception 'marker trigger smoke FAIL test 11: stout->primary unexpectedly emitted projection_finalized';
  end if;

  -- belt-and-suspenders: assert zero projection_finalized rows exist
  -- specifically tied to marker3.
  if (select count(*) from public.trial_change_events
        where marker_id = v_marker3_id and event_type = 'projection_finalized') <> 0 then
    raise exception 'marker trigger smoke FAIL test 11: marker3 must have 0 projection_finalized events';
  end if;

  raise notice 'marker trigger smoke ok 11: projection stout->primary -> marker_updated (projection in changed_fields), no projection_finalized';

  -- cleanup: tear down fixture in reverse-dependency order. markers must
  -- be deleted explicitly before spaces (and their tenant) so the BEFORE
  -- DELETE trigger sees a still-present space row when writing the
  -- 'deleted' marker_changes audit. Then drop the audit/event rows that
  -- reference the space before the space itself goes away.
  delete from public.markers where space_id = v_space_id;
  delete from public.trial_change_events where space_id = v_space_id;
  delete from public.marker_changes where space_id = v_space_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;

  raise notice 'markers audit trigger + classifier smoke test: PASS';
end$$;
