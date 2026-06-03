-- migration: 20260528120000_marker_change_payload_event_date
-- purpose: add event_date to the payload of marker_updated and
-- marker_reclassified events so the client formatter can render a
-- consistent date label on every marker-related detected row.
--
-- previously:
--   marker_updated payload:       { changed_fields: [...] }
--   marker_reclassified payload:  { from_type_id, to_type_id }
-- after this migration:
--   marker_updated payload:       { changed_fields: [...], event_date: "YYYY-MM-DD" }
--   marker_reclassified payload:  { from_type_id, to_type_id, event_date: "YYYY-MM-DD" }
--
-- all other branches (marker_added, marker_removed, date_moved,
-- projection_finalized) are unchanged; they already carry event_date.
--
-- technique: create or replace function replaces the body in-place.
-- the active signature is (uuid, varchar) introduced in
-- 20260526120100_shared_entity_create_rpcs.sql. the trigger registration
-- is not repeated here; it remains active unchanged.

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
      if v_old_proj is distinct from v_new_proj then
        v_secondary := v_secondary || jsonb_build_object(
          'projection', jsonb_build_object('from', v_old_proj, 'to', v_new_proj));
      end if;
      if v_old_type is distinct from v_new_type then
        v_secondary := v_secondary || jsonb_build_object(
          'marker_type_id', jsonb_build_object('from', v_old_type, 'to', v_new_type));
      end if;
      if v_old_title is distinct from v_new_title then
        v_secondary := v_secondary || jsonb_build_object(
          'title', jsonb_build_object('from', v_old_title, 'to', v_new_title));
      end if;
      if v_old_descr is distinct from v_new_descr then
        v_secondary := v_secondary || jsonb_build_object(
          'description', jsonb_build_object('from', v_old_descr, 'to', v_new_descr));
      end if;
      if v_old_end_date is distinct from v_new_end_date then
        v_secondary := v_secondary || jsonb_build_object(
          'end_date', jsonb_build_object('from', v_old_end_date, 'to', v_new_end_date));
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
          'marker_type_id', jsonb_build_object('from', v_old_type, 'to', v_new_type));
      end if;
      if v_old_title is distinct from v_new_title then
        v_secondary := v_secondary || jsonb_build_object(
          'title', jsonb_build_object('from', v_old_title, 'to', v_new_title));
      end if;
      if v_old_descr is distinct from v_new_descr then
        v_secondary := v_secondary || jsonb_build_object(
          'description', jsonb_build_object('from', v_old_descr, 'to', v_new_descr));
      end if;
      if v_old_end_date is distinct from v_new_end_date then
        v_secondary := v_secondary || jsonb_build_object(
          'end_date', jsonb_build_object('from', v_old_end_date, 'to', v_new_end_date));
      end if;

    elsif v_old_type is distinct from v_new_type then
      v_event_type := 'marker_reclassified';
      -- CHANGED: include event_date so the client formatter can render a date label.
      v_payload := jsonb_build_object(
        'from_type_id', v_old_type,
        'to_type_id',   v_new_type,
        'event_date',   v_new ->> 'event_date'
      );
      if v_old_title is distinct from v_new_title then
        v_secondary := v_secondary || jsonb_build_object(
          'title', jsonb_build_object('from', v_old_title, 'to', v_new_title));
      end if;
      if v_old_descr is distinct from v_new_descr then
        v_secondary := v_secondary || jsonb_build_object(
          'description', jsonb_build_object('from', v_old_descr, 'to', v_new_descr));
      end if;
      if v_old_end_date is distinct from v_new_end_date then
        v_secondary := v_secondary || jsonb_build_object(
          'end_date', jsonb_build_object('from', v_old_end_date, 'to', v_new_end_date));
      end if;

    elsif v_old_title is distinct from v_new_title
       or v_old_descr is distinct from v_new_descr
       or v_old_end_date is distinct from v_new_end_date
       or v_old_proj is distinct from v_new_proj then
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
      -- CHANGED: include event_date so the client formatter can render a date label.
      v_payload := jsonb_build_object(
        'changed_fields', to_jsonb(v_changed_fields),
        'event_date',     v_new ->> 'event_date'
      );
    else
      return;
    end if;
  else
    raise exception '_emit_events_from_marker_change: unknown change_type %', v_change_type;
  end if;

  if v_secondary <> '{}'::jsonb then
    v_payload := v_payload || jsonb_build_object('secondary_changes', v_secondary);
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
  'Internal: classify a marker_changes row per spec rules and fan out one trial_change_events row per marker_assignments link. p_source defaults to analyst; pass source_import for AI-extracted markers. SECURITY DEFINER. Called by _log_marker_change, backfill_marker_history, and create_marker. marker_updated and marker_reclassified payloads now include event_date.';


-- =============================================================================
-- smoke test: verify event_date appears in marker_updated and
-- marker_reclassified payloads. builds a hermetic fixture (same pattern as
-- the parent migration) because seed.sql runs after migrations.
--
do $$
declare
  v_agency_id   uuid := 'eeeeeee1-eeee-eeee-eeee-eeeeeeeeee01';
  v_tenant_id   uuid := 'eeeeeee2-eeee-eeee-eeee-eeeeeeeeee02';
  v_user_id     uuid := 'eeeeeee3-eeee-eeee-eeee-eeeeeeeeee03';
  v_space_id    uuid := 'eeeeeee4-eeee-eeee-eeee-eeeeeeeeee04';
  v_company_id  uuid := 'eeeeeee5-eeee-eeee-eeee-eeeeeeeeee05';
  v_asset_id    uuid := 'eeeeeee6-eeee-eeee-eeee-eeeeeeeeee06';
  v_trial_id    uuid := 'eeeeeee8-eeee-eeee-eeee-eeeeeeeeee08';
  v_marker_id   uuid;
  -- system marker types seeded by 20260414024141_marker_visual_redesign.
  v_type_a      uuid := 'a0000000-0000-0000-0000-000000000030';  -- Interim Data
  v_type_b      uuid := 'a0000000-0000-0000-0000-000000000031';  -- Full Data
  v_updated_payload      jsonb;
  v_reclassified_payload jsonb;
begin
  -- bootstrap hermetic fixture.
  insert into auth.users (id, email)
    values (v_user_id, 'payload-event-date-smoke@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'PED Smoke', 'ped-smoke', 'pedsmoke', 'PED', 'ped@y.z');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'PED', 'ped-smoke-t', 'pedsmoket', 'PED');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_user_id);

  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_user_id, 'PED Smoke Co');

  -- assets table (renamed from products in 20260524120200_rename_products_to_assets.sql)
  insert into public.assets (id, space_id, created_by, company_id, name)
    values (v_asset_id, v_space_id, v_user_id, v_company_id, 'PED Smoke Drug');

  insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
    values (v_trial_id, v_space_id, v_user_id, v_asset_id, 'PED_SMOKE_TRIAL', 'NCT-PED-SMOKE');

  -- insert a marker and wire an assignment so subsequent UPDATEs fan out.
  insert into public.markers (space_id, marker_type_id, title, projection, event_date, created_by)
  values (v_space_id, v_type_a, 'Smoke marker', 'stout', '2030-01-01', v_user_id)
  returning id into v_marker_id;

  insert into public.marker_assignments (marker_id, trial_id)
    values (v_marker_id, v_trial_id);

  -- trigger marker_updated by changing the title (no event_date change).
  update public.markers set title = 'Smoke marker 2' where id = v_marker_id;

  select payload into v_updated_payload
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'marker_updated'
   order by occurred_at desc limit 1;

  if v_updated_payload->>'event_date' is null then
    raise exception 'marker payload smoke FAIL: marker_updated missing event_date in payload (got: %)', v_updated_payload;
  end if;

  -- trigger marker_reclassified by changing the marker_type_id.
  update public.markers set marker_type_id = v_type_b where id = v_marker_id;

  select payload into v_reclassified_payload
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'marker_reclassified'
   order by occurred_at desc limit 1;

  if v_reclassified_payload->>'event_date' is null then
    raise exception 'marker payload smoke FAIL: marker_reclassified missing event_date in payload (got: %)', v_reclassified_payload;
  end if;

  -- cleanup: tear down fixture in reverse-dependency order.
  delete from public.markers where space_id = v_space_id;
  delete from public.trial_change_events where space_id = v_space_id;
  delete from public.marker_changes where space_id = v_space_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;

  raise notice 'marker payload smoke ok: event_date present on marker_updated and marker_reclassified';
end $$;
