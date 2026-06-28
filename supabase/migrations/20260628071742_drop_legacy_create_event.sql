-- The old events feature defined create_event with a different signature
-- (20260526120100_shared_entity_create_rpcs.sql). It survived the table drop
-- (plpgsql functions are not cascade-dropped) and now both collides with the new
-- unified create_event and is broken (it references the dropped public.events).
-- Drop it. Also drop the orphaned create_marker (the real signature ends in jsonb,
-- which the initial drop migration missed).
drop function if exists public.create_event(uuid, uuid, text, date, text, text, text[], uuid, uuid, uuid, uuid) cascade;
drop function if exists public.create_marker(uuid, uuid, text, text, date, date, text, text, uuid[], uuid, text, text, text, boolean, jsonb) cascade;

notify pgrst, 'reload schema';
