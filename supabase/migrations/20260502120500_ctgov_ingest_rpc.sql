-- migration: 20260502120500_ctgov_ingest_rpc
-- purpose: orchestration RPC the ct.gov worker calls per trial. Wraps the
--   five Task 1.5 helpers into the spec's Ingest pipeline:
--     verify secret -> insert snapshot (idempotent) -> materialize trials
--     -> diff against prior snapshot -> classify diffs into events
--     -> update trials watermark -> return summary jsonb.
-- the function body is a single transaction (plpgsql implicit). any failure
--   rolls back; the worker logs the error and moves to the next trial.
--
-- idempotency: insert ... on conflict (trial_id, ctgov_version) do nothing
--   returning ... into v_snapshot_id, v_is_new. RETURNING does not fire on
--   conflict, so v_snapshot_id is null when we hit a duplicate. The xmax = 0
--   trick distinguishes a freshly inserted row from a no-op even though we
--   already get that signal from the null id; we keep both for clarity.
--
-- security: SECURITY DEFINER with set search_path = public. The first
--   statement is _verify_ctgov_worker_secret which raises 42501 on any
--   secret mismatch. revoke from public, grant to anon: the worker is
--   anon-callable and supplies the secret as the first argument.

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
begin
  -- 1. worker secret gate. raises 42501 on mismatch.
  perform public._verify_ctgov_worker_secret(p_secret);

  -- 2. trial existence + space ownership check. raises distinct sqlstates so
  --    the worker can distinguish "trial deleted while in queue" from
  --    "caller passed the wrong space id".
  select space_id into v_trial_space_id
    from public.trials
   where id = p_trial_id;

  if v_trial_space_id is null then
    raise exception 'trial not found' using errcode = '02000';
  end if;

  if v_trial_space_id <> p_space_id then
    raise exception 'space mismatch' using errcode = '22023';
  end if;

  -- 3. insert snapshot idempotently. RETURNING does not fire on conflict;
  --    v_snapshot_id stays null when (trial_id, ctgov_version) collides.
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

  -- 4. duplicate path: nothing materialized, nothing classified. bump
  --    last_polled_at so the queue ordering reflects the attempt and
  --    return a no-op summary.
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
      'changes_recorded', 0
    );
  end if;

  -- 5a. new snapshot: materialize the ct.gov-owned columns on trials.
  perform public._materialize_trial_from_snapshot(p_trial_id, p_payload);

  -- 5b. fetch the previous snapshot's payload (highest version below
  --     p_version). null when this is the first snapshot for this trial.
  select payload into v_prev_payload
    from public.trial_ctgov_snapshots
   where trial_id = p_trial_id
     and ctgov_version < p_version
   order by ctgov_version desc
   limit 1;

  -- 5c. diff + classify only when there is a prior snapshot to compare to.
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

  -- 6. update trials watermark on success. last_update_posted_date is the
  --    per-trial ct.gov-side watermark; latest_ctgov_version is our own.
  update public.trials
     set last_polled_at          = now(),
         latest_ctgov_version    = p_version,
         last_update_posted_date = p_post_date
   where id = p_trial_id;

  -- 7. summary for the worker's per-trial log line.
  return jsonb_build_object(
    'snapshot_id',      v_snapshot_id,
    'inserted',         true,
    'events_emitted',   v_events_emitted,
    'changes_recorded', v_changes_recorded
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
  'Worker-callable per-trial ingest. Verifies secret, inserts snapshot idempotently, materializes ct.gov columns, diffs against prior snapshot, classifies diffs into typed events, and bumps the trials watermark. Returns jsonb summary {snapshot_id, inserted, events_emitted, changes_recorded}. SECURITY DEFINER, anon-grantable.';

-- =============================================================================
-- smoke tests: end-to-end exercise of the five-helper pipeline through the
-- public RPC. seed.sql runs *after* migrations, so we must bootstrap our
-- own agency/tenant/space/trial fixture inside this do block. fixture is
-- torn down at the end so the smoke test is hermetic and re-runnable.
--
do $$
declare
  v_agency_id     uuid := '99999991-9999-9999-9999-999999999991';
  v_tenant_id     uuid := '99999992-9999-9999-9999-999999999992';
  v_user_id       uuid := '99999993-9999-9999-9999-999999999993';
  v_space_id      uuid := '99999994-9999-9999-9999-999999999994';
  v_other_space   uuid := '99999995-9999-9999-9999-999999999995';
  v_trial_id      uuid := '99999996-9999-9999-9999-999999999996';
  v_company_id    uuid := '99999997-9999-9999-9999-999999999997';
  v_product_id    uuid := '99999998-9999-9999-9999-999999999998';
  v_ta_id         uuid := '99999999-9999-9999-9999-999999999999';
  v_result        jsonb;
  v_snap_count    int;
  v_field_count   int;
  v_event_count   int;
  v_event_type    text;
  v_derived_id    uuid;
  v_threw         boolean;
  v_payload_v1    jsonb := '{"protocolSection":{"statusModule":{"overallStatus":"RECRUITING"}}}'::jsonb;
  v_payload_v2    jsonb := '{"protocolSection":{"statusModule":{"overallStatus":"COMPLETED"}}}'::jsonb;
begin
  -- bootstrap fixture: agency -> tenant -> space (+ a second space for the
  -- mismatch test) -> user -> company -> product -> therapeutic area ->
  -- trial. trial.product_id and trial.therapeutic_area_id are NOT NULL.
  insert into auth.users (id, email)
    values (v_user_id, 'ingest-smoke@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'Ingest Smoke', 'ingest-smoke', 'ingestsmoke', 'IS', 'is@y.z');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'IS', 'ingest-smoke-t', 'ingestsmoket', 'IS');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_user_id);
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_other_space, v_tenant_id, 'Other', v_user_id);

  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_user_id, 'Ingest Smoke Co');

  insert into public.products (id, space_id, created_by, company_id, name)
    values (v_product_id, v_space_id, v_user_id, v_company_id, 'Ingest Smoke Drug');

  insert into public.therapeutic_areas (id, space_id, created_by, name)
    values (v_ta_id, v_space_id, v_user_id, 'Ingest Smoke TA');

  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier)
    values (v_trial_id, v_space_id, v_user_id, v_product_id, v_ta_id, 'INGEST_SMOKE_TRIAL', 'NCT-INGEST-SMOKE');

  -- --- test 1: first ingest succeeds, no diff/event because no prior snapshot.
  v_result := public.ingest_ctgov_snapshot(
    'local-dev-ctgov-secret',
    v_trial_id, v_space_id,
    'NCT-INGEST-SMOKE', 1, '2026-01-01'::date,
    v_payload_v1, 'manual_sync', null
  );
  if (v_result ->> 'inserted')::boolean is not true then
    raise exception 'ingest smoke FAIL test 1: expected inserted=true, got %', v_result;
  end if;
  if (v_result ->> 'events_emitted')::int <> 0 then
    raise exception 'ingest smoke FAIL test 1: first snapshot should emit 0 events, got %', v_result;
  end if;
  if (v_result ->> 'changes_recorded')::int <> 0 then
    raise exception 'ingest smoke FAIL test 1: first snapshot should record 0 changes, got %', v_result;
  end if;
  raise notice 'ingest smoke ok test 1: first ingest -> snapshot only';

  -- --- test 2: duplicate (same trial_id, same version) is a no-op.
  v_result := public.ingest_ctgov_snapshot(
    'local-dev-ctgov-secret',
    v_trial_id, v_space_id,
    'NCT-INGEST-SMOKE', 1, '2026-01-01'::date,
    v_payload_v1, 'manual_sync', null
  );
  if (v_result ->> 'inserted')::boolean is not false then
    raise exception 'ingest smoke FAIL test 2: expected inserted=false on dup, got %', v_result;
  end if;
  if (v_result ->> 'events_emitted')::int <> 0 then
    raise exception 'ingest smoke FAIL test 2: dup must emit 0 events, got %', v_result;
  end if;

  select count(*) into v_snap_count
    from public.trial_ctgov_snapshots
   where trial_id = v_trial_id;
  if v_snap_count <> 1 then
    raise exception 'ingest smoke FAIL test 2: expected 1 snapshot row after dup, got %', v_snap_count;
  end if;
  raise notice 'ingest smoke ok test 2: duplicate ingest is idempotent';

  -- --- test 3: second version with overallStatus change -> 1 field change + 1 event.
  v_result := public.ingest_ctgov_snapshot(
    'local-dev-ctgov-secret',
    v_trial_id, v_space_id,
    'NCT-INGEST-SMOKE', 2, '2026-02-01'::date,
    v_payload_v2, 'manual_sync', null
  );
  if (v_result ->> 'inserted')::boolean is not true then
    raise exception 'ingest smoke FAIL test 3: expected inserted=true, got %', v_result;
  end if;
  if (v_result ->> 'events_emitted')::int <> 1 then
    raise exception 'ingest smoke FAIL test 3: expected 1 event, got %', v_result;
  end if;
  if (v_result ->> 'changes_recorded')::int <> 1 then
    raise exception 'ingest smoke FAIL test 3: expected 1 change, got %', v_result;
  end if;

  select count(*) into v_field_count
    from public.trial_field_changes
   where trial_id = v_trial_id;
  if v_field_count <> 1 then
    raise exception 'ingest smoke FAIL test 3: expected 1 field_change row, got %', v_field_count;
  end if;

  select count(*) into v_event_count
    from public.trial_change_events
   where trial_id = v_trial_id;
  if v_event_count <> 1 then
    raise exception 'ingest smoke FAIL test 3: expected 1 event row, got %', v_event_count;
  end if;

  select event_type, derived_from_change_id
    into v_event_type, v_derived_id
    from public.trial_change_events
   where trial_id = v_trial_id;
  if v_event_type <> 'status_changed' then
    raise exception 'ingest smoke FAIL test 3: expected status_changed event, got %', v_event_type;
  end if;
  if v_derived_id is null then
    raise exception 'ingest smoke FAIL test 3: derived_from_change_id must be populated';
  end if;
  raise notice 'ingest smoke ok test 3: status change -> 1 field_change + 1 status_changed event';

  -- --- test 4: wrong secret raises 42501.
  v_threw := false;
  begin
    perform public.ingest_ctgov_snapshot(
      'wrong-secret',
      v_trial_id, v_space_id,
      'NCT-INGEST-SMOKE', 99, '2026-03-01'::date,
      v_payload_v1, 'manual_sync', null
    );
  exception when sqlstate '42501' then
    v_threw := true;
  end;
  if not v_threw then
    raise exception 'ingest smoke FAIL test 4: wrong secret did not raise 42501';
  end if;
  raise notice 'ingest smoke ok test 4: wrong secret -> 42501';

  -- --- test 5: trial-space mismatch raises 22023.
  v_threw := false;
  begin
    perform public.ingest_ctgov_snapshot(
      'local-dev-ctgov-secret',
      v_trial_id, v_other_space,
      'NCT-INGEST-SMOKE', 99, '2026-03-01'::date,
      v_payload_v1, 'manual_sync', null
    );
  exception when sqlstate '22023' then
    v_threw := true;
  end;
  if not v_threw then
    raise exception 'ingest smoke FAIL test 5: space mismatch did not raise 22023';
  end if;
  raise notice 'ingest smoke ok test 5: space mismatch -> 22023';

  -- cleanup: tear down fixture in reverse-dependency order. deleting the
  -- tenant cascades to spaces, which cascades to the trial, which cascades
  -- to snapshots/field_changes/events. agency must be deleted after the
  -- tenant (tenants_agency_id_fkey is no action). user goes last.
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;

  raise notice 'ingest_ctgov_snapshot smoke test: PASS';
end$$;
