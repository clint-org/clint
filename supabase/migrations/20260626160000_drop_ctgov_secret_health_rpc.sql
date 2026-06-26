-- migration: 20260626160000_drop_ctgov_secret_health_rpc
-- purpose: remove the ctgov_secret_health probe added in 20260626140000. The
--   dedicated secret-drift watcher it backed was dropped (a scheduled GitHub
--   Actions probe could not reach /api/ctgov/secret-health -- Cloudflare's managed
--   challenge 403s server-side callers on all /api/* paths), and the probe is
--   redundant: a drifted CTGOV_WORKER_SECRET already fails every ingest with 42501,
--   so the run lands status=failed and ctgov-sync-health opens a ctgov-sync-failure
--   issue. No worker route calls this RPC anymore.

drop function if exists public.ctgov_secret_health(text);

-- PostgREST must drop the function from its schema cache.
notify pgrst, 'reload schema';
