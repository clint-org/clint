-- migration: 20260502121200_get_latest_sync_run
-- purpose: read-only RPC returning the most recent ctgov_sync_runs row for
--   the activity page footer. Authenticated users only.
--
-- security: SECURITY INVOKER. The underlying ctgov_sync_runs table already
--   has an RLS policy (ctgov_sync_runs_select) granting SELECT to any
--   authenticated user, so the function inherits that gate.

create or replace function public.get_latest_sync_run()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select to_jsonb(r) from (
    select started_at, ended_at, trials_checked, ncts_with_changes,
           snapshots_written, events_emitted, errors_count, status
    from public.ctgov_sync_runs
    order by started_at desc
    limit 1
  ) r;
$$;

revoke execute on function public.get_latest_sync_run() from public;
grant execute on function public.get_latest_sync_run() to authenticated;

comment on function public.get_latest_sync_run() is
  'Returns the most recent ctgov_sync_runs row as jsonb, or null. Used by the activity page footer.';

-- =============================================================================
-- smoke test: insert one fixture run, call the function as an authenticated
-- user, assert the row round-trips, then clean up.
--
do $$
declare
  v_user_id    uuid := 'cccccccc-cccc-cccc-cccc-cccccccccc01';
  v_run_id     uuid := 'cccccccc-cccc-cccc-cccc-cccccccccc02';
  v_started    timestamptz := now() - interval '14 hours';
  v_ended      timestamptz := now() - interval '14 hours' + interval '6 minutes';
  v_result     jsonb;
  v_existing   int;
begin
  -- Bootstrap an authenticated user so SELECT RLS passes.
  insert into auth.users (id, email)
    values (v_user_id, 'sync-run-smoke@invalid.local');

  -- Capture pre-existing row count so we can assert "latest = ours" without
  -- depending on the table being empty.
  select count(*) into v_existing from public.ctgov_sync_runs;

  insert into public.ctgov_sync_runs (
    id, started_at, ended_at, trials_checked, ncts_with_changes,
    snapshots_written, events_emitted, errors_count, status
  ) values (
    v_run_id, v_started, v_ended, 1247, 23, 23, 47, 0, 'ok'
  );

  -- Authenticate as the test user.
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user_id::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  v_result := public.get_latest_sync_run();

  if v_result is null then
    raise exception 'get_latest_sync_run smoke: returned null when one fixture row exists';
  end if;

  if (v_result->>'trials_checked')::int <> 1247 then
    raise exception 'get_latest_sync_run smoke: expected trials_checked=1247, got %',
      v_result->>'trials_checked';
  end if;

  if (v_result->>'ncts_with_changes')::int <> 23 then
    raise exception 'get_latest_sync_run smoke: expected ncts_with_changes=23, got %',
      v_result->>'ncts_with_changes';
  end if;

  if v_result->>'status' <> 'ok' then
    raise exception 'get_latest_sync_run smoke: expected status=ok, got %',
      v_result->>'status';
  end if;

  -- Reset role for cleanup.
  perform set_config('role', 'postgres', true);

  -- Cleanup: remove fixture row + user.
  delete from public.ctgov_sync_runs where id = v_run_id;
  delete from auth.users where id = v_user_id;

  -- Sanity: row count back to baseline.
  if (select count(*) from public.ctgov_sync_runs) <> v_existing then
    raise exception 'get_latest_sync_run smoke: cleanup left stray rows';
  end if;

  raise notice 'get_latest_sync_run smoke test: PASS';
end$$;
