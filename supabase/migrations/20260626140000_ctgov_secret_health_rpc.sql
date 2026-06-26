-- migration: 20260626140000_ctgov_secret_health_rpc
-- purpose: a side-effect-free, secret-gated probe so the Worker can verify that
--   its runtime secret (CTGOV_WORKER_SECRET, set via `wrangler secret put`) still
--   matches the Supabase vault secret (ctgov_worker_secret). A mismatch makes
--   _verify_ctgov_worker_secret raise 42501 on EVERY CT.gov ingest, failing the
--   whole daily run, and nothing detects the drift itself today -- it is only
--   inferred from a mass-failed run. This RPC backs GET /api/ctgov/secret-health
--   (worker) and the ctgov-secret-health.yml watchdog, naming the drift directly.
--
-- security: SECURITY DEFINER, set search_path = public, secret-gated via
--   _verify_ctgov_worker_secret (raises 42501 on mismatch), revoked from public
--   and granted to anon -- the same trust shape as the other worker-callable
--   RPCs (ingest_ctgov_snapshot, get_trials_for_polling). Side-effect free; reads
--   no application data. Not a Tier 1 governance RPC, so no audit event.

-- Drop-first: a return-type change via create-or-replace would 42P13 on any env
-- where an older shape exists (see 20260625200000). Cheap insurance for a new fn.
drop function if exists public.ctgov_secret_health(text);

create or replace function public.ctgov_secret_health(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $function$
begin
  -- Raises 42501 if p_secret does not match the vault secret. Reaching the
  -- return means the Worker's secret and the vault secret agree.
  perform public._verify_ctgov_worker_secret(p_secret);
  return jsonb_build_object('ok', true);
end;
$function$;

revoke execute on function public.ctgov_secret_health(text) from public;
grant  execute on function public.ctgov_secret_health(text) to anon;

comment on function public.ctgov_secret_health(text) is
  'Worker-callable secret-drift probe. Returns {"ok":true} when p_secret matches the vault secret ctgov_worker_secret; raises 42501 (via _verify_ctgov_worker_secret) on mismatch. Side-effect free. SECURITY DEFINER, anon-grantable -- same trust shape as the other worker RPCs. Backs GET /api/ctgov/secret-health and the ctgov-secret-health watchdog.';

-- PostgREST must see the new function immediately (memory: reload schema after an
-- RPC signature change or the app 404s the new args).
notify pgrst, 'reload schema';

-- =============================================================================
-- smoke: the real vault secret -> {"ok":true}; a wrong secret -> 42501.
-- Skips on any env whose vault has no ctgov_worker_secret (so local/CI without a
-- seeded secret do not fail).
-- =============================================================================
do $$
declare
  v_secret text;
  v_out    jsonb;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'ctgov_worker_secret';
  if v_secret is null then
    raise notice 'ctgov_secret_health smoke: no ctgov_worker_secret in vault, skipping';
    return;
  end if;

  v_out := public.ctgov_secret_health(v_secret);
  if coalesce(v_out->>'ok', '') <> 'true' then
    raise exception 'ctgov_secret_health smoke: expected ok=true for the real secret, got %', v_out;
  end if;

  begin
    perform public.ctgov_secret_health('definitely-not-the-ctgov-secret');
    raise exception 'ctgov_secret_health smoke: a wrong secret should have raised 42501';
  exception
    when insufficient_privilege then
      raise notice 'ctgov_secret_health smoke: PASS (wrong secret -> 42501)';
  end;
end$$;
