-- migration: 20260502120300_ctgov_worker_secret
-- purpose: store a placeholder ctgov worker secret for local development and
--   add the SECURITY DEFINER function that the worker-callable RPCs use to
--   verify their first argument before doing anything else.
-- production: operators run vault.create_secret('<random>', 'ctgov_worker_secret')
--   on first deploy and rotate by deleting the row and re-running. The Worker
--   reads CTGOV_WORKER_SECRET from wrangler secrets and passes it as the first
--   argument to every cron-called RPC.
-- note: this is the first migration in the repo to use Supabase Vault;
--   vault.secrets and vault.decrypted_secrets are provided by the supabase_vault
--   extension which ships enabled by default in local Supabase.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'ctgov_worker_secret') then
    perform vault.create_secret('local-dev-ctgov-secret', 'ctgov_worker_secret');
  end if;
end$$;

create or replace function public._verify_ctgov_worker_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_expected text;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'ctgov_worker_secret';
  if v_expected is null or p_secret <> v_expected then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public._verify_ctgov_worker_secret(text) from public;

comment on function public._verify_ctgov_worker_secret(text) is
  'Worker-secret gate. Called by cron RPCs (get_trials_for_polling, ingest_ctgov_snapshot, record_sync_run) as the first statement. Raises 42501 if the supplied secret does not match the vault entry named ctgov_worker_secret.';

-- =============================================================================
-- smoke test: correct secret succeeds, wrong secret raises 42501.
--
do $$
declare
  v_threw boolean := false;
begin
  perform public._verify_ctgov_worker_secret('local-dev-ctgov-secret');
  raise notice 'verify ok with correct secret';

  begin
    perform public._verify_ctgov_worker_secret('wrong');
  exception when sqlstate '42501' then
    v_threw := true;
  end;

  if not v_threw then
    raise exception 'ctgov worker secret smoke FAIL: verify did not reject wrong secret';
  end if;

  raise notice 'verify rejected wrong secret as expected';
  raise notice 'ctgov worker secret smoke test: PASS';
end$$;
