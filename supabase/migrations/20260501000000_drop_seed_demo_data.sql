-- Drop the seed_demo_data RPC and its helpers.
--
-- Background: pre-migration-75 the access model gave tenant owners implicit
-- visibility of all spaces in their tenant, and `provision_tenant`
-- auto-created a default "Workspace" space. In that world, "empty space" was
-- unambiguous (the owner just made it), and `landscape-state.service` would
-- auto-call `seed_demo_data` on first load to populate Boehringer/Azurity
-- demo data so the user saw something.
--
-- That heuristic is wrong post-migration-75 / migration-80:
--   - Spaces are real engagements named by analysts (e.g. "Survodutide
--     Pipeline"); auto-seeding Boehringer demo data into a real engagement's
--     first load would be destructive.
--   - Empty-from-this-user's-view is now ambiguous: it can mean the analyst
--     hasn't populated yet, OR the firewall hid all rows because the user
--     isn't a space member. Auto-seed in the firewall case fails the
--     INSERTs, surfaces "Failed to load data" toast, and (worse) presented
--     a tenant-scope leak: any signed-in user could trigger seed_demo_data
--     since the RPC only checked auth.uid() is not null.
--
-- The auto-seed call was removed from landscape-state.service.ts in the same
-- change set as this migration; this migration drops the now-unreferenced
-- RPCs from the schema. Demo data, if needed for sales/marketing in the
-- future, will be a separate explicit flow with proper permission gates.

drop function if exists public.seed_demo_data(uuid);
drop function if exists public._seed_demo_companies(uuid, uuid);
drop function if exists public._seed_demo_events(uuid, uuid);
drop function if exists public._seed_demo_markers(uuid, uuid);
drop function if exists public._seed_demo_moa_roa(uuid, uuid);
drop function if exists public._seed_demo_notifications(uuid, uuid);
drop function if exists public._seed_demo_products(uuid, uuid);
drop function if exists public._seed_demo_therapeutic_areas(uuid, uuid);
drop function if exists public._seed_demo_trial_notes(uuid, uuid);
drop function if exists public._seed_demo_trials(uuid, uuid);
