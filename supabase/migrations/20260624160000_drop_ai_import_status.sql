-- Drop the obsolete ai_import_status RPC.
--
-- ai_import_status was a cents-based pre-check for the import-page status strip,
-- created in 20260527130000. Its body reads ai_config.daily_cost_cap_cents and
-- derives spent_today_cents from per-call cost. The AI limits hardening
-- (20260624150050) dropped daily_cost_cap_cents and moved spend control to a
-- deterministic token cap. Because ai_import_status is an old-style (string
-- body) `language sql` function, the column drop did not error -- the function
-- silently became a runtime time-bomb that now raises
-- `column c.daily_cost_cap_cents does not exist` (42703) on every call.
--
-- The import page now sources its quota status from get_tenant_ai_status
-- (token-based, privacy-correct: owners get a usage percentage, non-owners get
-- only ai_enabled). Nothing else references ai_import_status, so drop it.

drop function if exists public.ai_import_status(uuid);

-- Smoke: the function must be gone.
do $$
begin
  assert not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'ai_import_status'
  ), 'ai_import_status should be dropped';
  raise notice 'smoke: ai_import_status dropped OK';
end;
$$;

notify pgrst, 'reload schema';
