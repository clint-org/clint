-- migration: 20260525100400_extract_source_worker_secret
-- purpose: store a placeholder extract-source worker secret for local development
--          and add the SECURITY DEFINER function that worker-callable RPCs use to
--          verify their first argument before doing anything else.
-- production: operators run vault.create_secret('<random>', 'extract_source_worker_secret')
--   on first deploy and rotate by deleting the row and re-running. The Worker
--   reads EXTRACT_SOURCE_WORKER_SECRET from wrangler secrets and passes it as the
--   first argument to ai_call_open, ai_call_preflight, and ai_call_close.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'extract_source_worker_secret') then
    perform vault.create_secret('local-dev-extract-source-secret', 'extract_source_worker_secret');
  end if;
end$$;

create or replace function public._verify_extract_source_worker_secret(p_secret text)
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
   where name = 'extract_source_worker_secret';
  if v_expected is null or p_secret <> v_expected then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public._verify_extract_source_worker_secret(text) from public;

comment on function public._verify_extract_source_worker_secret(text) is
  'Worker-secret gate. Called by source-extract RPCs (ai_call_open, ai_call_preflight, ai_call_close) as the first statement. Raises 42501 if the supplied secret does not match the vault entry named extract_source_worker_secret.';

-- smoke test (reads actual vault value so it works on both local and remote)
do $$
declare
  v_actual text;
  v_threw boolean := false;
begin
  select decrypted_secret into v_actual
    from vault.decrypted_secrets
   where name = 'extract_source_worker_secret';

  if v_actual is null then
    raise notice 'smoke: no extract_source_worker_secret in vault, skipping verify smoke';
    return;
  end if;

  perform public._verify_extract_source_worker_secret(v_actual);
  raise notice 'verify ok with correct secret';

  begin
    perform public._verify_extract_source_worker_secret('wrong');
  exception when sqlstate '42501' then
    v_threw := true;
  end;

  if not v_threw then
    raise exception 'extract source worker secret smoke FAIL: verify did not reject wrong secret';
  end if;

  raise notice 'verify rejected wrong secret as expected';
  raise notice 'extract source worker secret smoke test: PASS';
end$$;
