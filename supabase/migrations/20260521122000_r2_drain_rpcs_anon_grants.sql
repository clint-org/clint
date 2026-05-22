-- migration: 20260521122000_r2_drain_rpcs_anon_grants
-- purpose: fix the execute grants on the r2 drain RPCs. T22
--   (20260521121500_r2_drain_rpcs) granted execute to `authenticated` and
--   revoked from `anon`, mirroring my misread of the CT.gov pattern. The
--   actual CT.gov pattern (20260502120500_ctgov_ingest_rpc) grants execute
--   to `anon` because the cloudflare worker calls PostgREST with the anon
--   apikey and no JWT, which PostgREST treats as the anon role. Defense
--   in depth comes from `_verify_r2_drain_worker_secret(p_secret)` inside
--   the function body, not from the EXECUTE grant.
--
-- Symptom of the bug: PostgREST returns 401 / 42501 "permission denied for
--   function claim_pending_r2_deletes" on every drain invocation; the
--   function body never runs so the worker secret check never happens.
--
-- This migration revokes execute from `authenticated` and grants execute
-- to `anon` for all three drain RPCs. The secret remains the real gate.

revoke execute on function public.claim_pending_r2_deletes(text, int, int) from authenticated;
grant  execute on function public.claim_pending_r2_deletes(text, int, int) to anon;

revoke execute on function public.mark_r2_delete_succeeded(text, uuid) from authenticated;
grant  execute on function public.mark_r2_delete_succeeded(text, uuid) to anon;

revoke execute on function public.mark_r2_delete_failed(text, uuid, int, text) from authenticated;
grant  execute on function public.mark_r2_delete_failed(text, uuid, int, text) to anon;

-- smoke: confirm that as the anon role, the function executes far enough
-- to reach the secret check (i.e., the EXECUTE grant is correct now).
-- Wrong-secret raises 42501 from inside _verify_r2_drain_worker_secret;
-- right-secret succeeds. Either outcome proves the grant flipped; the
-- 42501 we are now ruling out is the GRANT-level reject from before
-- (which surfaces with a different error message and at a different
-- point in the call path).

do $$
declare
  v_secret text;
  v_threw  boolean;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'r2_drain_worker_secret';
  if v_secret is null then
    raise exception 'r2_drain_rpcs_anon_grants smoke FAIL: vault entry r2_drain_worker_secret missing';
  end if;

  set local role anon;

  -- Wrong secret: must raise 42501 from inside the verify helper (the
  -- function body executes; the grant lets us in). If we ever see
  -- "permission denied for function" here, the grant didn't take.
  v_threw := false;
  begin
    perform public.claim_pending_r2_deletes('wrong', 1, 5);
  exception when sqlstate '42501' then
    v_threw := true;
  end;
  if not v_threw then
    raise exception 'r2_drain_rpcs_anon_grants smoke FAIL: wrong-secret call did not raise 42501 from verify helper';
  end if;

  -- Right secret: must succeed (returns zero rows because we have not
  -- seeded anything). The fact that no exception is raised proves the
  -- grant + verify path both work.
  perform public.claim_pending_r2_deletes(v_secret, 1, 5);

  -- mark_succeeded / mark_failed: same role + grant path. Pass an
  -- arbitrary uuid that does not exist so the underlying UPDATE is a
  -- no-op; the assertion is that the call does not raise on grant.
  perform public.mark_r2_delete_succeeded(v_secret, gen_random_uuid());
  perform public.mark_r2_delete_failed(v_secret, gen_random_uuid(), 1, 'smoke');

  reset role;

  raise notice 'r2_drain_rpcs_anon_grants smoke test: PASS';
end$$;
