-- migration: 20260521121000_drop_legacy_delete_space
-- purpose: drop the legacy public.delete_space(uuid) RPC.
--   replaced by archive_space + restore_space + permanently_delete_space
--   from 20260521120400. all UI, service, integration test, and fixture
--   callers have been migrated. historical migration smoke tests in
--   20260503090000_delete_space_rpc.sql, 20260510001400_audit_instrument_spaces.sql,
--   and 20260521120300_orphan_marker_cleanup.sql call delete_space() in their
--   inline do-blocks; those run earlier in the apply order so the function
--   still exists when they execute.
-- affected objects: drop public.delete_space(uuid).

drop function if exists public.delete_space(uuid);

-- smoke: assert the function is gone after this migration applies.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'delete_space'
  ) then
    raise exception 'drop_legacy_delete_space smoke FAIL: function still exists';
  end if;
  raise notice 'drop_legacy_delete_space smoke test: PASS';
end $$;
