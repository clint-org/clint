-- migration: 20260503060000_seed_ctgov_markers_on_sync
-- purpose: auto-create the three Clinical Trial category system markers
--   that have a direct CT.gov source -- Trial Start, Primary Completion
--   Date (PCD), and Trial End -- whenever ingest_ctgov_snapshot runs and
--   the trial doesn't already have a marker of that type. before this
--   migration, even after the prior migration auto-filled phase_type /
--   phase_start_date / phase_end_date / status, freshly-synced trials
--   still rendered with no marker pins on the timeline because markers
--   were entirely analyst-curated and the CT.gov ingest path didn't
--   touch them. the three markers in this cut are the only ones whose
--   source is unambiguously inside CT.gov; everything else in the
--   marker catalog (Topline Data, Regulatory Filing, Approval, LOE,
--   etc.) needs FDA / EMA / Orange Book / press-release feeds and is
--   out of scope here.
--
-- behavior:
--   - new helper public._seed_ctgov_markers(p_trial_id, p_payload,
--     p_snapshot_id) returns int (count of markers created). For each
--     of the 3 marker types it: looks up the existing marker_assignments
--     for trial+type, skips if one exists, extracts the date from the
--     snapshot, skips if no date, then inserts a markers row + a
--     marker_assignments link.
--
--     marker_type ids are the system seed UUIDs from supabase/seed.sql:
--       Trial Start                  a0000000-0000-0000-0000-000000000011
--       Primary Completion Date      a0000000-0000-0000-0000-000000000008
--       Trial End                    a0000000-0000-0000-0000-000000000012
--
--     projection mapping:
--       startDateStruct.type='ACTUAL'      -> projection='actual'
--       startDateStruct.type='ANTICIPATED' -> projection='company'
--       (and same for the other two date structs; missing .type is
--        treated as ANTICIPATED so we don't default to a "locked" state
--        for a date CT.gov hasn't confirmed)
--     is_projected is the markers table's generated column and follows
--     automatically (true when projection <> 'actual').
--
--     attribution:
--       title       = the marker_type name (e.g. "Trial Start")
--       description = "Auto-derived from clinicaltrials.gov"
--       source_url  = https://clinicaltrials.gov/study/<NCT>
--       metadata    = {source:'ctgov', field:<path>, snapshot_id, ctgov_date_type}
--       created_by  = the trial's created_by (worker is anon, has no
--                     auth.uid(); markers.created_by is NOT NULL)
--
--   - dedup semantic: "skip if any marker of that type is already
--     assigned to the trial" -- analyst-set or auto-seeded, doesn't
--     matter. this means CT.gov is allowed to fill in a marker that
--     wasn't there before (e.g. PCD added on a later snapshot), but
--     also means an analyst who deletes an auto-seeded marker WILL see
--     it re-created on the next sync. accepted trade-off for now;
--     remediating that requires a "previously deleted" flag we don't
--     track yet.
--
--   - ingest_ctgov_snapshot is updated to call _seed_ctgov_markers
--     after _materialize_trial_from_snapshot on the new-snapshot path.
--     return summary jsonb gains a markers_seeded field.
--
--   - one-time backfill applies the helper to every existing trial
--     using its latest snapshot, so already-synced trials get the
--     markers without waiting for the next CT.gov pull.
--
-- affected objects:
--   - new function: public._seed_ctgov_markers(uuid, jsonb, uuid)
--   - replaced function: public.ingest_ctgov_snapshot(...)
--   - data: public.markers + public.marker_assignments (backfill)

-- =============================================================================
-- 1. _seed_ctgov_markers
-- =============================================================================

create or replace function public._seed_ctgov_markers(
  p_trial_id    uuid,
  p_payload     jsonb,
  p_snapshot_id uuid
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space_id    uuid;
  v_created_by  uuid;
  v_nct         text;
  v_source_url  text;
  v_count       int  := 0;

  -- per-marker working vars, reused across the three blocks
  v_event_date  date;
  v_date_type   text;
  v_projection  text;
  v_marker_id   uuid;
  v_exists      boolean;

  -- marker_type uuids from supabase/seed.sql (system marker_types).
  c_start_id    constant uuid := 'a0000000-0000-0000-0000-000000000011';
  c_pcd_id      constant uuid := 'a0000000-0000-0000-0000-000000000008';
  c_end_id      constant uuid := 'a0000000-0000-0000-0000-000000000012';
begin
  select space_id, created_by, identifier
    into v_space_id, v_created_by, v_nct
    from public.trials
   where id = p_trial_id;

  -- markers.created_by is NOT NULL with FK to auth.users; we need a real
  -- user. Worker is anon and auth.uid() is null in this context, so the
  -- only reliable identity we have is the analyst who created the trial.
  if v_created_by is null then
    return 0;
  end if;

  v_source_url := case
    when v_nct is not null and v_nct <> ''
      then 'https://clinicaltrials.gov/study/' || v_nct
    else null
  end;

  -- ---------------------------------------------------------------------
  -- Trial Start
  -- ---------------------------------------------------------------------
  select exists (
    select 1
      from public.marker_assignments ma
      join public.markers m on m.id = ma.marker_id
     where ma.trial_id = p_trial_id
       and m.marker_type_id = c_start_id
  ) into v_exists;

  if not v_exists then
    v_event_date := nullif(p_payload #>> '{protocolSection,statusModule,startDateStruct,date}', '')::date;
    if v_event_date is not null then
      v_date_type  := upper(coalesce(
                        nullif(p_payload #>> '{protocolSection,statusModule,startDateStruct,type}', ''),
                        'ANTICIPATED'
                      ));
      v_projection := case when v_date_type = 'ACTUAL' then 'actual' else 'company' end;

      insert into public.markers (
        space_id, marker_type_id, title, projection, event_date,
        description, source_url, metadata, created_by
      ) values (
        v_space_id, c_start_id, 'Trial Start', v_projection, v_event_date,
        'Auto-derived from clinicaltrials.gov',
        v_source_url,
        jsonb_build_object(
          'source',          'ctgov',
          'field',           'startDateStruct.date',
          'snapshot_id',     p_snapshot_id,
          'ctgov_date_type', v_date_type
        ),
        v_created_by
      )
      returning id into v_marker_id;

      insert into public.marker_assignments (marker_id, trial_id)
        values (v_marker_id, p_trial_id);

      v_count := v_count + 1;
    end if;
  end if;

  -- ---------------------------------------------------------------------
  -- Primary Completion Date (PCD)
  -- ---------------------------------------------------------------------
  select exists (
    select 1
      from public.marker_assignments ma
      join public.markers m on m.id = ma.marker_id
     where ma.trial_id = p_trial_id
       and m.marker_type_id = c_pcd_id
  ) into v_exists;

  if not v_exists then
    v_event_date := nullif(p_payload #>> '{protocolSection,statusModule,primaryCompletionDateStruct,date}', '')::date;
    if v_event_date is not null then
      v_date_type  := upper(coalesce(
                        nullif(p_payload #>> '{protocolSection,statusModule,primaryCompletionDateStruct,type}', ''),
                        'ANTICIPATED'
                      ));
      v_projection := case when v_date_type = 'ACTUAL' then 'actual' else 'company' end;

      insert into public.markers (
        space_id, marker_type_id, title, projection, event_date,
        description, source_url, metadata, created_by
      ) values (
        v_space_id, c_pcd_id, 'Primary Completion Date (PCD)', v_projection, v_event_date,
        'Auto-derived from clinicaltrials.gov',
        v_source_url,
        jsonb_build_object(
          'source',          'ctgov',
          'field',           'primaryCompletionDateStruct.date',
          'snapshot_id',     p_snapshot_id,
          'ctgov_date_type', v_date_type
        ),
        v_created_by
      )
      returning id into v_marker_id;

      insert into public.marker_assignments (marker_id, trial_id)
        values (v_marker_id, p_trial_id);

      v_count := v_count + 1;
    end if;
  end if;

  -- ---------------------------------------------------------------------
  -- Trial End
  -- ---------------------------------------------------------------------
  select exists (
    select 1
      from public.marker_assignments ma
      join public.markers m on m.id = ma.marker_id
     where ma.trial_id = p_trial_id
       and m.marker_type_id = c_end_id
  ) into v_exists;

  if not v_exists then
    v_event_date := nullif(p_payload #>> '{protocolSection,statusModule,completionDateStruct,date}', '')::date;
    if v_event_date is not null then
      v_date_type  := upper(coalesce(
                        nullif(p_payload #>> '{protocolSection,statusModule,completionDateStruct,type}', ''),
                        'ANTICIPATED'
                      ));
      v_projection := case when v_date_type = 'ACTUAL' then 'actual' else 'company' end;

      insert into public.markers (
        space_id, marker_type_id, title, projection, event_date,
        description, source_url, metadata, created_by
      ) values (
        v_space_id, c_end_id, 'Trial End', v_projection, v_event_date,
        'Auto-derived from clinicaltrials.gov',
        v_source_url,
        jsonb_build_object(
          'source',          'ctgov',
          'field',           'completionDateStruct.date',
          'snapshot_id',     p_snapshot_id,
          'ctgov_date_type', v_date_type
        ),
        v_created_by
      )
      returning id into v_marker_id;

      insert into public.marker_assignments (marker_id, trial_id)
        values (v_marker_id, p_trial_id);

      v_count := v_count + 1;
    end if;
  end if;

  return v_count;
end;
$$;

revoke execute on function public._seed_ctgov_markers(uuid, jsonb, uuid) from public;

comment on function public._seed_ctgov_markers(uuid, jsonb, uuid) is
  'Auto-creates the three Clinical Trial category markers (Trial Start, PCD, Trial End) for a synced trial when none exist of that type. Inserts into markers + marker_assignments, attributes to trials.created_by, tags metadata with source=ctgov for future provenance lookups. CT.gov date_type ACTUAL maps to projection=actual; ANTICIPATED (or missing) maps to projection=company. Idempotent on rerun (skips per-type when an assignment already exists). Returns the number of markers created.';

-- =============================================================================
-- 2. ingest_ctgov_snapshot (replace, add markers_seeded to summary)
-- =============================================================================
-- Same body as 20260502120500_ctgov_ingest_rpc.sql with one new call to
-- _seed_ctgov_markers immediately after _materialize_trial_from_snapshot,
-- and markers_seeded added to the return summary jsonb.

create or replace function public.ingest_ctgov_snapshot(
  p_secret       text,
  p_trial_id     uuid,
  p_space_id     uuid,
  p_nct_id       text,
  p_version      int,
  p_post_date    date,
  p_payload      jsonb,
  p_fetched_via  text,
  p_module_hints text[] default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trial_space_id   uuid;
  v_snapshot_id      uuid;
  v_is_new           boolean;
  v_prev_payload     jsonb;
  v_diff             record;
  v_event            record;
  v_change_id        uuid;
  v_changes_recorded int := 0;
  v_events_emitted   int := 0;
  v_markers_seeded   int := 0;
begin
  perform public._verify_ctgov_worker_secret(p_secret);

  select space_id into v_trial_space_id
    from public.trials
   where id = p_trial_id;

  if v_trial_space_id is null then
    raise exception 'trial not found' using errcode = '02000';
  end if;

  if v_trial_space_id <> p_space_id then
    raise exception 'space mismatch' using errcode = '22023';
  end if;

  insert into public.trial_ctgov_snapshots (
    trial_id, space_id, nct_id, ctgov_version, last_update_post_date,
    payload, fetched_via, fetched_at
  )
  values (
    p_trial_id, p_space_id, p_nct_id, p_version, p_post_date,
    p_payload, p_fetched_via, now()
  )
  on conflict (trial_id, ctgov_version) do nothing
  returning id, (xmax = 0) into v_snapshot_id, v_is_new;

  if v_snapshot_id is null then
    select id into v_snapshot_id
      from public.trial_ctgov_snapshots
     where trial_id = p_trial_id
       and ctgov_version = p_version;

    update public.trials
       set last_polled_at = now()
     where id = p_trial_id;

    return jsonb_build_object(
      'snapshot_id',      v_snapshot_id,
      'inserted',         false,
      'events_emitted',   0,
      'changes_recorded', 0,
      'markers_seeded',   0
    );
  end if;

  perform public._materialize_trial_from_snapshot(p_trial_id, p_payload);
  v_markers_seeded := public._seed_ctgov_markers(p_trial_id, p_payload, v_snapshot_id);

  select payload into v_prev_payload
    from public.trial_ctgov_snapshots
   where trial_id = p_trial_id
     and ctgov_version < p_version
   order by ctgov_version desc
   limit 1;

  if v_prev_payload is not null then
    for v_diff in
      select *
        from public._compute_field_diffs(v_prev_payload, p_payload, p_module_hints)
    loop
      insert into public.trial_field_changes (
        trial_id, space_id, source_snapshot_id,
        field_path, old_value, new_value, observed_at
      ) values (
        p_trial_id, p_space_id, v_snapshot_id,
        v_diff.field_path, v_diff.old_value, v_diff.new_value, now()
      )
      returning id into v_change_id;

      v_changes_recorded := v_changes_recorded + 1;

      for v_event in
        select *
          from public._classify_change(
            v_diff.field_path,
            v_diff.old_value,
            v_diff.new_value,
            p_post_date::timestamptz
          )
      loop
        insert into public.trial_change_events (
          trial_id, space_id, event_type, source,
          payload, occurred_at, observed_at, derived_from_change_id
        ) values (
          p_trial_id, p_space_id, v_event.event_type, 'ctgov',
          v_event.payload, v_event.occurred_at, now(), v_change_id
        );

        v_events_emitted := v_events_emitted + 1;
      end loop;
    end loop;
  end if;

  update public.trials
     set last_polled_at          = now(),
         latest_ctgov_version    = p_version,
         last_update_posted_date = p_post_date
   where id = p_trial_id;

  return jsonb_build_object(
    'snapshot_id',      v_snapshot_id,
    'inserted',         true,
    'events_emitted',   v_events_emitted,
    'changes_recorded', v_changes_recorded,
    'markers_seeded',   v_markers_seeded
  );
end;
$$;

revoke execute on function public.ingest_ctgov_snapshot(
  text, uuid, uuid, text, int, date, jsonb, text, text[]
) from public;

grant execute on function public.ingest_ctgov_snapshot(
  text, uuid, uuid, text, int, date, jsonb, text, text[]
) to anon;

comment on function public.ingest_ctgov_snapshot(
  text, uuid, uuid, text, int, date, jsonb, text, text[]
) is
  'Worker-callable per-trial ingest. Verifies secret, inserts snapshot idempotently, materializes ct.gov columns, seeds the three Clinical Trial markers (Trial Start, PCD, Trial End) when missing, diffs against prior snapshot, classifies diffs into typed events, and bumps the trials watermark. Returns jsonb summary {snapshot_id, inserted, events_emitted, changes_recorded, markers_seeded}. SECURITY DEFINER, anon-grantable.';

-- =============================================================================
-- 3. one-time backfill: seed markers for already-synced trials
-- =============================================================================
-- For every trial with at least one snapshot, run _seed_ctgov_markers
-- against the latest snapshot. Idempotent because the helper itself
-- skips any marker_type that already has an assignment to the trial.

do $$
declare
  v_trial          record;
  v_total_seeded   int := 0;
  v_per_trial      int;
begin
  for v_trial in
    select distinct on (s.trial_id)
      s.trial_id,
      s.id        as snapshot_id,
      s.payload
    from public.trial_ctgov_snapshots s
    order by s.trial_id, s.ctgov_version desc
  loop
    v_per_trial := public._seed_ctgov_markers(
      v_trial.trial_id, v_trial.payload, v_trial.snapshot_id
    );
    v_total_seeded := v_total_seeded + v_per_trial;
  end loop;

  if v_total_seeded > 0 then
    raise notice '_seed_ctgov_markers backfill: seeded % markers across existing trials', v_total_seeded;
  end if;
end $$;

-- =============================================================================
-- 4. end-to-end smoke: hermetic fixture exercises the new path inside
--    ingest_ctgov_snapshot. Mirrors the structure of the existing
--    20260502120500 ingest smoke so that future readers pattern-match.
-- =============================================================================

do $$
declare
  v_agency_id    uuid := '88888881-8888-8888-8888-888888888881';
  v_tenant_id    uuid := '88888882-8888-8888-8888-888888888882';
  v_user_id      uuid := '88888883-8888-8888-8888-888888888883';
  v_space_id     uuid := '88888884-8888-8888-8888-888888888884';
  v_trial_id     uuid := '88888885-8888-8888-8888-888888888885';
  v_company_id   uuid := '88888886-8888-8888-8888-888888888886';
  v_product_id   uuid := '88888887-8888-8888-8888-888888888887';
  v_ta_id        uuid := '88888888-8888-8888-8888-888888888888';
  v_payload      jsonb := jsonb_build_object(
    'protocolSection', jsonb_build_object(
      'statusModule', jsonb_build_object(
        'overallStatus', 'RECRUITING',
        'startDateStruct',
          jsonb_build_object('date', '2024-03-01', 'type', 'ACTUAL'),
        'primaryCompletionDateStruct',
          jsonb_build_object('date', '2026-09-15', 'type', 'ANTICIPATED'),
        'completionDateStruct',
          jsonb_build_object('date', '2027-03-15', 'type', 'ANTICIPATED')
      ),
      'designModule', jsonb_build_object(
        'phases',     jsonb_build_array('PHASE3'),
        'studyType',  'INTERVENTIONAL'
      )
    )
  );
  v_result          jsonb;
  v_marker_count    int;
  v_marker          record;
  v_pcd_marker      record;
begin
  -- bootstrap. Mirrors the surface_rpcs smoke (20260502120800) pattern --
  -- the markers BEFORE INSERT trigger fan-out path needs tenant_members +
  -- space_members rows in place to satisfy downstream constraint checks;
  -- omitting them surfaces as a misleading marker_changes FK error.
  insert into auth.users (id, email)
    values (v_user_id, 'marker-seed-smoke@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'Marker Seed Smoke', 'marker-seed-smoke', 'markerseedsmoke', 'MS', 'ms@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'MS', 'marker-seed-smoke-t', 'markerseedsmoket', 'MS');
  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant_id, v_user_id, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_user_id);
  insert into public.space_members (space_id, user_id, role)
    values (v_space_id, v_user_id, 'owner');
  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_user_id, 'MS Co');
  insert into public.products (id, space_id, created_by, company_id, name)
    values (v_product_id, v_space_id, v_user_id, v_company_id, 'MS Drug');
  insert into public.therapeutic_areas (id, space_id, created_by, name)
    values (v_ta_id, v_space_id, v_user_id, 'MS TA');
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier)
    values (v_trial_id, v_space_id, v_user_id, v_product_id, v_ta_id, 'MARKER_SEED_SMOKE', 'NCT99887766');

  -- test 1: first ingest seeds all three markers
  v_result := public.ingest_ctgov_snapshot(
    'local-dev-ctgov-secret',
    v_trial_id, v_space_id,
    'NCT99887766', 1, '2026-01-01'::date,
    v_payload, 'manual_sync', null
  );
  if (v_result ->> 'markers_seeded')::int <> 3 then
    raise exception 'marker seed smoke FAIL test 1: expected 3 markers, got %', v_result;
  end if;

  select count(*) into v_marker_count
    from public.marker_assignments where trial_id = v_trial_id;
  if v_marker_count <> 3 then
    raise exception 'marker seed smoke FAIL test 1: expected 3 marker_assignments, got %', v_marker_count;
  end if;

  -- test 2: second ingest of a higher version is a no-op for marker seeding
  -- (markers already exist for all three types). diff/event path still runs
  -- but markers_seeded must be 0.
  v_result := public.ingest_ctgov_snapshot(
    'local-dev-ctgov-secret',
    v_trial_id, v_space_id,
    'NCT99887766', 2, '2026-02-01'::date,
    v_payload || jsonb_build_object(
      'protocolSection', jsonb_build_object(
        'statusModule', jsonb_build_object(
          'overallStatus', 'COMPLETED',
          'startDateStruct',
            jsonb_build_object('date', '2024-03-01', 'type', 'ACTUAL'),
          'primaryCompletionDateStruct',
            jsonb_build_object('date', '2026-09-15', 'type', 'ANTICIPATED'),
          'completionDateStruct',
            jsonb_build_object('date', '2027-03-15', 'type', 'ANTICIPATED')
        ),
        'designModule', jsonb_build_object(
          'phases',     jsonb_build_array('PHASE3'),
          'studyType',  'INTERVENTIONAL'
        )
      )
    ),
    'manual_sync', null
  );
  if (v_result ->> 'markers_seeded')::int <> 0 then
    raise exception 'marker seed smoke FAIL test 2: expected 0 markers on rerun, got %', v_result;
  end if;

  -- test 3: PCD marker has the right shape (projection=company because
  -- CT.gov said ANTICIPATED, source=ctgov, source_url present, the type
  -- is the PCD system marker)
  select m.projection, m.event_date, m.source_url, m.metadata, m.marker_type_id
    into v_pcd_marker
    from public.markers m
    join public.marker_assignments ma on ma.marker_id = m.id
   where ma.trial_id = v_trial_id
     and m.marker_type_id = 'a0000000-0000-0000-0000-000000000008';

  if v_pcd_marker.projection <> 'company' then
    raise exception 'marker seed smoke FAIL test 3: PCD projection expected ''company'', got %', v_pcd_marker.projection;
  end if;
  if v_pcd_marker.event_date <> '2026-09-15'::date then
    raise exception 'marker seed smoke FAIL test 3: PCD event_date expected 2026-09-15, got %', v_pcd_marker.event_date;
  end if;
  if v_pcd_marker.source_url <> 'https://clinicaltrials.gov/study/NCT99887766' then
    raise exception 'marker seed smoke FAIL test 3: PCD source_url unexpected: %', v_pcd_marker.source_url;
  end if;
  if v_pcd_marker.metadata ->> 'source' <> 'ctgov' then
    raise exception 'marker seed smoke FAIL test 3: PCD metadata.source expected ''ctgov'', got %', v_pcd_marker.metadata ->> 'source';
  end if;

  -- test 4: trial start should be projection=actual because CT.gov said ACTUAL.
  select m.projection
    into v_pcd_marker -- reusing record var
    from public.markers m
    join public.marker_assignments ma on ma.marker_id = m.id
   where ma.trial_id = v_trial_id
     and m.marker_type_id = 'a0000000-0000-0000-0000-000000000011';
  if v_pcd_marker.projection <> 'actual' then
    raise exception 'marker seed smoke FAIL test 4: Trial Start projection expected ''actual'', got %', v_pcd_marker.projection;
  end if;

  -- cleanup. flip the cascade-bypass GUC the way 20260502120800 does so
  -- the member-self-protection guards don't fire during the cascade.
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.markers where space_id = v_space_id;
  delete from public.space_members where space_id = v_space_id;
  delete from public.tenant_members where tenant_id = v_tenant_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;
  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice '_seed_ctgov_markers smoke: PASS (created 3 markers, idempotent on rerun, projection mapped correctly)';
end $$;
