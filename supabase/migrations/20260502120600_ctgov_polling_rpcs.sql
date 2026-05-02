-- migration: 20260502120600_ctgov_polling_rpcs
-- purpose: three worker-callable RPCs that bracket each cron run:
--   get_trials_for_polling -- pull the "least recently polled first" queue,
--   record_sync_run        -- write the per-invocation observability row,
--   bulk_update_last_polled -- bump last_polled_at for trials the worker
--     decided not to ingest (no change vs watermark) so they sort to the
--     back of the queue on the next run.
-- all three verify the worker secret as their first statement, are
--   SECURITY DEFINER with set search_path = public, revoke from public,
--   grant to anon (worker calls anon-callable with the secret).
-- bulk_update_last_polled is consolidated here rather than in a later
--   migration (the plan flagged it as movable); keeping the polling
--   queue and watermark mutators co-located reads cleanly.

-- =============================================================================
-- get_trials_for_polling: returns the next batch of trials the worker should
-- check for ct.gov updates. Ordered "never polled, then oldest poll first";
-- (last_polled_at, id) is a deterministic tie-breaker so the same fixture
-- under tests yields the same first row.
--
create or replace function public.get_trials_for_polling(
  p_secret text,
  p_limit  int default 1000
) returns table(
  trial_id                uuid,
  space_id                uuid,
  nct_id                  text,
  last_update_posted_date date
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._verify_ctgov_worker_secret(p_secret);

  return query
    select t.id,
           t.space_id,
           t.identifier::text,
           t.last_update_posted_date
      from public.trials t
     where t.identifier is not null
     order by t.last_polled_at nulls first, t.id
     limit p_limit;
end;
$$;

revoke execute on function public.get_trials_for_polling(text, int) from public;
grant  execute on function public.get_trials_for_polling(text, int) to anon;

comment on function public.get_trials_for_polling(text, int) is
  'Worker-callable polling queue. Returns NCT-bearing trials ordered by last_polled_at nulls first, id. Verifies worker secret; raises 42501 on mismatch.';

-- =============================================================================
-- record_sync_run: write one observability row per scheduled invocation.
-- p_status must be 'success' | 'partial' | 'failed'; we validate explicitly
-- and raise 22023 (invalid_parameter_value) on any other value so the worker
-- does not silently log a malformed status that the UI would then render.
--
create or replace function public.record_sync_run(
  p_secret            text,
  p_started_at        timestamptz,
  p_ended_at          timestamptz,
  p_trials_checked    int,
  p_ncts_with_changes int,
  p_snapshots_written int,
  p_events_emitted    int,
  p_errors_count      int,
  p_error_summary     jsonb,
  p_status            text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public._verify_ctgov_worker_secret(p_secret);

  if p_status not in ('success', 'partial', 'failed') then
    raise exception 'invalid status %', p_status using errcode = '22023';
  end if;

  insert into public.ctgov_sync_runs (
    started_at, ended_at, trials_checked, ncts_with_changes,
    snapshots_written, events_emitted, errors_count, error_summary, status
  ) values (
    p_started_at, p_ended_at, p_trials_checked, p_ncts_with_changes,
    p_snapshots_written, p_events_emitted, p_errors_count, p_error_summary, p_status
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.record_sync_run(
  text, timestamptz, timestamptz, int, int, int, int, int, jsonb, text
) from public;
grant  execute on function public.record_sync_run(
  text, timestamptz, timestamptz, int, int, int, int, int, jsonb, text
) to anon;

comment on function public.record_sync_run(
  text, timestamptz, timestamptz, int, int, int, int, int, jsonb, text
) is
  'Worker-callable sync-run logger. Inserts one ctgov_sync_runs row per cron invocation; returns the new id. p_status must be success|partial|failed (else 22023). Verifies worker secret; raises 42501 on mismatch.';

-- =============================================================================
-- bulk_update_last_polled: bump last_polled_at to now() for the supplied
-- trial ids. Used by the poller after a "no change vs watermark" batch so
-- those trials drop to the back of the queue without an ingest call.
-- Returns the affected row count.
--
create or replace function public.bulk_update_last_polled(
  p_secret    text,
  p_trial_ids uuid[]
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  perform public._verify_ctgov_worker_secret(p_secret);

  update public.trials
     set last_polled_at = now()
   where id = any(p_trial_ids);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.bulk_update_last_polled(text, uuid[]) from public;
grant  execute on function public.bulk_update_last_polled(text, uuid[]) to anon;

comment on function public.bulk_update_last_polled(text, uuid[]) is
  'Worker-callable batched watermark update. Sets last_polled_at = now() for every trial id in p_trial_ids; returns the affected row count. Verifies worker secret; raises 42501 on mismatch.';

-- =============================================================================
-- smoke tests: bootstrap a hermetic fixture (agency -> tenant -> space ->
-- user -> company -> product -> therapeutic_area -> two trials, one with an
-- NCT and one without) and exercise each RPC. seed.sql runs after migrations
-- so we cannot rely on it; the fixture is torn down at the end.
--
do $$
declare
  v_agency_id      uuid := '88888881-8888-8888-8888-888888888881';
  v_tenant_id      uuid := '88888882-8888-8888-8888-888888888882';
  v_user_id        uuid := '88888883-8888-8888-8888-888888888883';
  v_space_id       uuid := '88888884-8888-8888-8888-888888888884';
  v_company_id     uuid := '88888885-8888-8888-8888-888888888885';
  v_product_id     uuid := '88888886-8888-8888-8888-888888888886';
  v_ta_id          uuid := '88888887-8888-8888-8888-888888888887';
  v_trial_with_id  uuid := '88888888-8888-8888-8888-888888888888';
  v_trial_no_id    uuid := '88888889-8888-8888-8888-888888888889';
  v_trial_old      uuid := '8888888a-8888-8888-8888-88888888888a';
  v_seen_first     uuid;
  v_seen_second    uuid;
  v_queue_count    int;
  v_run_id         uuid;
  v_run_count      int;
  v_polled_count   int;
  v_updated        int;
  v_threw          boolean;
begin
  -- bootstrap fixture.
  insert into auth.users (id, email)
    values (v_user_id, 'polling-smoke@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'Polling Smoke', 'polling-smoke', 'pollingsmoke', 'PS', 'ps@y.z');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'PS', 'polling-smoke-t', 'pollingsmoket', 'PS');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_user_id);

  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_user_id, 'Polling Smoke Co');

  insert into public.products (id, space_id, created_by, company_id, name)
    values (v_product_id, v_space_id, v_user_id, v_company_id, 'Polling Smoke Drug');

  insert into public.therapeutic_areas (id, space_id, created_by, name)
    values (v_ta_id, v_space_id, v_user_id, 'Polling Smoke TA');

  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier)
    values (v_trial_with_id, v_space_id, v_user_id, v_product_id, v_ta_id, 'POLLING_SMOKE_NCT', 'NCT-POLLING-SMOKE');

  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier)
    values (v_trial_no_id, v_space_id, v_user_id, v_product_id, v_ta_id, 'POLLING_SMOKE_NO_NCT', null);

  -- --- test 1: get_trials_for_polling returns NCT-bearing trials only.
  -- the fixture has one NCT-bearing trial; the no-NCT trial must be excluded.
  -- we filter the rpc result to fixture rows so any unrelated seed trials
  -- (none right now, but defensive) do not perturb the assertion.
  select count(*) into v_queue_count
    from public.get_trials_for_polling('local-dev-ctgov-secret', 1000) q
   where q.trial_id in (v_trial_with_id, v_trial_no_id);
  if v_queue_count <> 1 then
    raise exception 'polling smoke FAIL test 1: expected 1 fixture trial in queue, got %', v_queue_count;
  end if;

  select q.trial_id into v_seen_first
    from public.get_trials_for_polling('local-dev-ctgov-secret', 1000) q
   where q.trial_id in (v_trial_with_id, v_trial_no_id);
  if v_seen_first <> v_trial_with_id then
    raise exception 'polling smoke FAIL test 1: queue returned %, expected NCT-bearing trial %', v_seen_first, v_trial_with_id;
  end if;
  raise notice 'polling smoke ok test 1: queue returns NCT-bearing trials only';

  -- --- test 2: ordering. add a second NCT-bearing trial polled 1 day ago,
  -- and set the first trial's last_polled_at = null. The null must come first.
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, last_polled_at)
    values (v_trial_old, v_space_id, v_user_id, v_product_id, v_ta_id, 'POLLING_SMOKE_OLD', 'NCT-POLLING-OLD', now() - interval '1 day');

  update public.trials set last_polled_at = null where id = v_trial_with_id;

  -- pull the first two fixture rows in queue order. row_number assigns ords
  -- by the rpc's own ordering (it returns rows already sorted).
  select sub.trial_id into v_seen_first from (
    select q.trial_id, row_number() over () as ord
      from public.get_trials_for_polling('local-dev-ctgov-secret', 1000) q
     where q.trial_id in (v_trial_with_id, v_trial_old)
  ) sub where sub.ord = 1;
  if v_seen_first <> v_trial_with_id then
    raise exception 'polling smoke FAIL test 2: nulls-first violated; first fixture row %, expected %', v_seen_first, v_trial_with_id;
  end if;

  select sub.trial_id into v_seen_second from (
    select q.trial_id, row_number() over () as ord
      from public.get_trials_for_polling('local-dev-ctgov-secret', 1000) q
     where q.trial_id in (v_trial_with_id, v_trial_old)
  ) sub where sub.ord = 2;
  if v_seen_second <> v_trial_old then
    raise exception 'polling smoke FAIL test 2: second fixture row %, expected %', v_seen_second, v_trial_old;
  end if;
  raise notice 'polling smoke ok test 2: queue ordering nulls first then oldest poll';

  -- --- test 3: record_sync_run happy path.
  v_run_id := public.record_sync_run(
    'local-dev-ctgov-secret',
    now() - interval '1 minute', now(),
    10, 3, 2, 5, 0, '{}'::jsonb, 'success'
  );
  if v_run_id is null then
    raise exception 'polling smoke FAIL test 3: record_sync_run returned null id';
  end if;
  select count(*) into v_run_count from public.ctgov_sync_runs where id = v_run_id;
  if v_run_count <> 1 then
    raise exception 'polling smoke FAIL test 3: expected 1 sync_run row, got %', v_run_count;
  end if;
  raise notice 'polling smoke ok test 3: record_sync_run inserted row';

  -- --- test 4: record_sync_run rejects bad status.
  v_threw := false;
  begin
    perform public.record_sync_run(
      'local-dev-ctgov-secret',
      now() - interval '1 minute', now(),
      0, 0, 0, 0, 0, '{}'::jsonb, 'banana'
    );
  exception when sqlstate '22023' then
    v_threw := true;
  end;
  if not v_threw then
    raise exception 'polling smoke FAIL test 4: bad status did not raise 22023';
  end if;
  raise notice 'polling smoke ok test 4: bad status rejected with 22023';

  -- --- test 5: bulk_update_last_polled bumps watermarks.
  -- clear last_polled_at on both NCT-bearing trials, then bulk-update them.
  update public.trials
     set last_polled_at = null
   where id in (v_trial_with_id, v_trial_old);

  v_updated := public.bulk_update_last_polled(
    'local-dev-ctgov-secret',
    array[v_trial_with_id, v_trial_old]::uuid[]
  );
  if v_updated <> 2 then
    raise exception 'polling smoke FAIL test 5: expected 2 rows updated, got %', v_updated;
  end if;

  select count(*) into v_polled_count
    from public.trials
   where id in (v_trial_with_id, v_trial_old)
     and last_polled_at is not null;
  if v_polled_count <> 2 then
    raise exception 'polling smoke FAIL test 5: expected 2 rows with last_polled_at set, got %', v_polled_count;
  end if;
  raise notice 'polling smoke ok test 5: bulk_update_last_polled updated 2 rows';

  -- --- test 6a: wrong secret on get_trials_for_polling raises 42501.
  v_threw := false;
  begin
    perform * from public.get_trials_for_polling('wrong-secret', 10);
  exception when sqlstate '42501' then
    v_threw := true;
  end;
  if not v_threw then
    raise exception 'polling smoke FAIL test 6a: get_trials_for_polling did not reject wrong secret';
  end if;
  raise notice 'polling smoke ok test 6a: get_trials_for_polling wrong secret -> 42501';

  -- --- test 6b: wrong secret on record_sync_run raises 42501.
  v_threw := false;
  begin
    perform public.record_sync_run(
      'wrong-secret',
      now(), now(), 0, 0, 0, 0, 0, '{}'::jsonb, 'success'
    );
  exception when sqlstate '42501' then
    v_threw := true;
  end;
  if not v_threw then
    raise exception 'polling smoke FAIL test 6b: record_sync_run did not reject wrong secret';
  end if;
  raise notice 'polling smoke ok test 6b: record_sync_run wrong secret -> 42501';

  -- --- test 6c: wrong secret on bulk_update_last_polled raises 42501.
  v_threw := false;
  begin
    perform public.bulk_update_last_polled('wrong-secret', array[v_trial_with_id]::uuid[]);
  exception when sqlstate '42501' then
    v_threw := true;
  end;
  if not v_threw then
    raise exception 'polling smoke FAIL test 6c: bulk_update_last_polled did not reject wrong secret';
  end if;
  raise notice 'polling smoke ok test 6c: bulk_update_last_polled wrong secret -> 42501';

  -- cleanup. tenant cascade -> spaces -> trials -> snapshots etc.; sync_runs
  -- have no fk to fixture so we delete the row we wrote explicitly. agency
  -- after tenant (no-action fk). user last.
  delete from public.ctgov_sync_runs where id = v_run_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;

  raise notice 'polling rpcs smoke test: PASS';
end$$;
