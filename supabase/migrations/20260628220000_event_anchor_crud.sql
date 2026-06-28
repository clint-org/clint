-- migration: 20260628220000_event_anchor_crud
-- purpose: retire the dropped-marker-era update_marker_assignments RPC. The
--   manage/trials marker authoring path (MarkerService) now writes the unified
--   events table: inserts go through create_event with a single trial anchor,
--   and metadata / partial updates / deletes are inline events writes. There is
--   no separate assignment concept under the single-anchor model, so the
--   update_marker_assignments(uuid, uuid[]) RPC has no remaining caller.
--
-- the live signature (confirmed via \df) is:
--   public.update_marker_assignments(p_marker_id uuid, p_trial_ids uuid[])
--
-- no other backend changes here: create_event / update_event and their grants
-- are untouched.

drop function if exists public.update_marker_assignments(uuid, uuid[]);

-- ============================================================================
-- In-file smoke: assert the RPC is gone. Self-contained and prod-safe (no data
-- dependency); mirrors the to_regprocedure guard style of the A-phase smokes.
-- ============================================================================
do $$
begin
  if to_regprocedure('public.update_marker_assignments(uuid, uuid[])') is not null then
    raise exception 'SMOKE FAIL: update_marker_assignments(uuid, uuid[]) still present after drop';
  end if;

  raise notice 'SMOKE PASS: update_marker_assignments retired; marker CRUD now writes events';
end;
$$;

notify pgrst, 'reload schema';
