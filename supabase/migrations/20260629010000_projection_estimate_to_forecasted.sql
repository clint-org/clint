-- Rename projection tier 'estimate' -> 'forecasted'.
-- On a fresh db reset this is a no-op: events_table.sql already emits the
-- forecasted-only CHECK constraint, and no seed inserts 'estimate' rows.
-- The UPDATE is the defensive data migration for any pre-existing data on an
-- environment that had events with projection='estimate' before this branch
-- is applied. The CHECK constraint is already correct in events_table.sql
-- (branch undeployed), so no constraint alteration is needed here.
update public.events set projection = 'forecasted' where projection = 'estimate';

notify pgrst, 'reload schema';
