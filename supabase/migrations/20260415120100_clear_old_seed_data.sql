-- migration: 20260415120100_clear_old_seed_data
-- purpose: clear old seed_pharma_demo() data from existing spaces so the new
--          seed_demo_data(space_id) orchestrator can repopulate on next visit.
--          deletion order respects NO ACTION foreign keys.

do $$
declare
  s record;
begin
  for s in
    select id from public.spaces
  loop
    -- 1. tables with NO ACTION FKs (must delete before parents)
    delete from public.trial_notes where space_id = s.id;
    delete from public.trials where space_id = s.id;
    delete from public.products where space_id = s.id;
    delete from public.companies where space_id = s.id;

    -- 2. remaining space-scoped data (CASCADE from space, but explicit for clarity)
    delete from public.markers where space_id = s.id;
    delete from public.marker_notifications where space_id = s.id;
    delete from public.events where space_id = s.id;
    delete from public.event_threads where space_id = s.id;
    delete from public.therapeutic_areas where space_id = s.id;
    delete from public.mechanisms_of_action where space_id = s.id;
    delete from public.routes_of_administration where space_id = s.id;
  end loop;
end;
$$;
