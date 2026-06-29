-- migration: 20260628210000_retire_marker_triggers
-- purpose: drop four dropped-marker-era trigger/changelog helpers that were
--   attached to the now-dropped markers / marker_changes tables. Their
--   triggers were already removed in migration 20260628070739 (Stage 1 table
--   drops). Change history for the unified events table is handled by
--   event_changes + the _log_event_change trigger (migration 20260628071101).
--
-- functions retired:
--   _log_marker_change()
--   _cleanup_orphan_marker()
--   _emit_events_from_marker_change(p_marker_change_id uuid, p_source varchar)
--   backfill_marker_history()
--
-- remaining references to these names in _seed_demo_activity_variety,
-- permanently_delete_space, and update_marker_assignments are SQL comments
-- only; no live code path calls them. Those functions are C2/C5/D1 targets
-- and are not touched here.

drop function if exists public._log_marker_change();
drop function if exists public._cleanup_orphan_marker();
drop function if exists public._emit_events_from_marker_change(p_marker_change_id uuid, p_source character varying);
drop function if exists public.backfill_marker_history();

-- ============================================================================
-- In-file smoke: asserts all four functions are gone, then verifies that
-- event_changes logging still fires. Uses the seeded demo space when present
-- (real create_event path); falls back to a pg_trigger existence check
-- when running against a DB that has no seed data.
-- ============================================================================
do $$
declare
  v_demo_space  uuid    := '00000000-0000-0000-0000-0000000d0100';
  v_demo_user   uuid    := '00000000-0000-0000-0000-00000000000d';
  v_demo_co     uuid    := '00000000-0000-0000-0000-0000000d0200';
  v_et_id       uuid    := 'a0000000-0000-0000-0000-000000000011'; -- Trial Start (system)
  v_fn_count    int;
  v_event_id    uuid;
  v_change_cnt  int;
  v_tg_cnt      int;
  v_demo_exists boolean;
begin
  -- 1. Assert all four retired functions are absent.
  select count(*) into v_fn_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      '_log_marker_change',
      '_cleanup_orphan_marker',
      '_emit_events_from_marker_change',
      'backfill_marker_history'
    );

  if v_fn_count <> 0 then
    raise exception 'SMOKE FAIL: % retired function(s) still present in pg_proc', v_fn_count;
  end if;

  -- 2. Verify event_changes trigger still fires.
  select exists(
    select 1 from public.spaces where id = v_demo_space
  ) into v_demo_exists;

  if v_demo_exists then
    -- Spoof JWT so auth.uid() resolves to the demo owner inside create_event.
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_demo_user, 'role', 'authenticated')::text,
      true
    );

    -- Insert a scratch event via the production create_event path.
    v_event_id := public.create_event(
      v_demo_space,
      v_et_id,
      '_smoke_c1_retire_marker_fns_test',
      current_date,
      'company',
      v_demo_co
    );

    -- Assert _log_event_change fired and wrote a 'created' row.
    select count(*) into v_change_cnt
    from public.event_changes
    where event_id = v_event_id
      and change_type = 'created';

    if v_change_cnt <> 1 then
      raise exception 'SMOKE FAIL: event_changes did not capture the insert (got % rows)', v_change_cnt;
    end if;

    -- Cleanup: delete the event first (trigger writes a 'deleted' row), then
    -- remove all event_changes rows for this scratch event.
    delete from public.events where id = v_event_id;
    delete from public.event_changes where event_id = v_event_id;

    -- Clear JWT spoof.
    perform set_config('request.jwt.claims', '', true);

    raise notice 'SMOKE PASS: 4 retired functions absent; event_changes trigger verified via real insert (event %, 1 change row captured)',
      v_event_id;
  else
    -- Demo space absent: fall back to trigger-existence check.
    select count(*) into v_tg_cnt
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'events'
      and t.tgname = 'events_audit';

    if v_tg_cnt <> 1 then
      raise exception 'SMOKE FAIL: events_audit trigger missing from public.events';
    end if;

    raise notice 'SMOKE PASS: 4 retired functions absent; events_audit trigger present on public.events (demo space absent, skipped real-insert path)';
  end if;
end $$;

notify pgrst, 'reload schema';
