-- migration: 20260521121500_r2_drain_rpcs
-- purpose: replace direct-table PostgREST access for the r2_pending_deletes
--   queue with a worker-secret-gated RPC surface, matching the CT.gov pattern
--   from 20260502120300. revokes the service_role write grants added in
--   20260521120000 so the cloudflare worker no longer needs a service_role
--   key in its env.
-- production: operators run vault.create_secret('<random>', 'r2_drain_worker_secret')
--   on first deploy and rotate by deleting the row and re-running. The Worker
--   reads R2_WORKER_SECRET from wrangler secrets and passes it as the first
--   argument to every drain RPC.

-- =============================================================================
-- vault entry + verify helper
-- =============================================================================

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'r2_drain_worker_secret') then
    perform vault.create_secret('local-dev-r2-drain-secret', 'r2_drain_worker_secret');
  end if;
end$$;

create or replace function public._verify_r2_drain_worker_secret(p_secret text)
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
   where name = 'r2_drain_worker_secret';
  if v_expected is null or p_secret <> v_expected then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public._verify_r2_drain_worker_secret(text) from public;

comment on function public._verify_r2_drain_worker_secret(text) is
  'Worker-secret gate for the r2-drain cloudflare worker. Called by claim_pending_r2_deletes, mark_r2_delete_succeeded, and mark_r2_delete_failed as the first statement. Raises 42501 if the supplied secret does not match the vault entry named r2_drain_worker_secret.';

-- =============================================================================
-- claim_pending_r2_deletes: returns up to N pending rows.
-- uses FOR UPDATE SKIP LOCKED so concurrent drain invocations cannot claim
-- the same rows. attempted_at is set inside this call so the worker does not
-- need a separate update for the attempt observation.
-- =============================================================================

create or replace function public.claim_pending_r2_deletes(
  p_secret       text,
  p_batch_size   int default 50,
  p_max_attempts int default 5
)
returns table (
  id            uuid,
  file_path     text,
  attempt_count int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._verify_r2_drain_worker_secret(p_secret);

  return query
    with claimed as (
      select q.id
      from public.r2_pending_deletes q
      where q.succeeded_at is null
        and q.attempt_count < p_max_attempts
      order by q.queued_at
      limit greatest(p_batch_size, 1)
      for update skip locked
    )
    update public.r2_pending_deletes q
       set attempted_at = now()
      from claimed
     where q.id = claimed.id
    returning q.id, q.file_path, q.attempt_count;
end;
$$;

revoke execute on function public.claim_pending_r2_deletes(text, int, int) from public, anon;
grant  execute on function public.claim_pending_r2_deletes(text, int, int) to authenticated;

comment on function public.claim_pending_r2_deletes(text, int, int) is
  'R2 drain RPC. Worker-secret gated. Atomically claims up to p_batch_size pending rows (FOR UPDATE SKIP LOCKED) and stamps attempted_at. Returns id, file_path, and current attempt_count for each claimed row. Caller follows up with mark_r2_delete_succeeded or mark_r2_delete_failed per row.';

-- =============================================================================
-- mark_r2_delete_succeeded
-- =============================================================================

create or replace function public.mark_r2_delete_succeeded(
  p_secret text,
  p_id     uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._verify_r2_drain_worker_secret(p_secret);
  update public.r2_pending_deletes
     set succeeded_at = now()
   where id = p_id;
end;
$$;

revoke execute on function public.mark_r2_delete_succeeded(text, uuid) from public, anon;
grant  execute on function public.mark_r2_delete_succeeded(text, uuid) to authenticated;

comment on function public.mark_r2_delete_succeeded(text, uuid) is
  'R2 drain RPC. Worker-secret gated. Marks the row as succeeded after R2 confirms the object was deleted.';

-- =============================================================================
-- mark_r2_delete_failed
-- =============================================================================

create or replace function public.mark_r2_delete_failed(
  p_secret        text,
  p_id            uuid,
  p_attempt_count int,
  p_error         text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._verify_r2_drain_worker_secret(p_secret);
  update public.r2_pending_deletes
     set attempt_count = p_attempt_count,
         last_error    = p_error
   where id = p_id;
end;
$$;

revoke execute on function public.mark_r2_delete_failed(text, uuid, int, text) from public, anon;
grant  execute on function public.mark_r2_delete_failed(text, uuid, int, text) to authenticated;

comment on function public.mark_r2_delete_failed(text, uuid, int, text) is
  'R2 drain RPC. Worker-secret gated. Records a failed delete attempt: increments attempt_count and captures the error message. Once attempt_count reaches the drain configured max, the row stops being claimed by future claim_pending_r2_deletes calls.';

-- =============================================================================
-- revoke service_role direct-table writes on r2_pending_deletes
-- (added in 20260521120000_r2_pending_deletes_queue.sql, now unnecessary
-- because the worker reaches the table only through the RPCs above).
-- service_role retains the implicit privilege to bypass RLS for SELECT;
-- inserts still come from the materials AFTER DELETE trigger which runs as
-- the table owner via SECURITY DEFINER on the trigger function.
-- =============================================================================

revoke insert, update, delete on public.r2_pending_deletes from service_role;

comment on table public.r2_pending_deletes is
  'Queue of materials.file_path entries enqueued by the AFTER DELETE trigger on public.materials when a material row is deleted. Drained by the cloudflare worker scheduled handler via claim_pending_r2_deletes / mark_r2_delete_succeeded / mark_r2_delete_failed, all worker-secret gated. service_role has no direct write access; the only writers are the AFTER DELETE trigger and the SECURITY DEFINER drain RPCs.';

-- =============================================================================
-- smoke test
-- =============================================================================

do $$
declare
  v_secret      text;
  v_threw       boolean;
  v_claimed     int;
  v_succeeded   timestamptz;
  v_attempt     int;
  v_error       text;
  v_dummy_path  text := 'materials/smoke/' || gen_random_uuid()::text || '/x.pdf';
  v_dummy_path2 text := 'materials/smoke/' || gen_random_uuid()::text || '/y.pdf';
  v_target_id   uuid;
  v_target_id2  uuid;
begin
  -- read the live vault entry so this smoke works against whichever value
  -- the operator provisioned: the local-dev placeholder when running
  -- supabase db reset, or a production-rotated random string when pushing
  -- to a linked remote project. hardcoding 'local-dev-r2-drain-secret' here
  -- would force the smoke to fail on any remote whose vault has been rotated.
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'r2_drain_worker_secret';
  if v_secret is null then
    raise exception 'r2_drain_rpcs smoke FAIL: vault entry r2_drain_worker_secret is missing; expected the prior do-block to create it';
  end if;

  -- start from a clean queue. earlier-migration smoke tests insert into this
  -- table as part of their own assertions; we cannot assume the table is empty
  -- when we run, so empty it here and rely on our own seeded ids for the
  -- assertions below.
  delete from public.r2_pending_deletes;

  -- seed two pending rows directly via INSERT bypass (we are running as the
  -- migration role here, which has table-owner privileges).
  insert into public.r2_pending_deletes (file_path) values (v_dummy_path) returning id into v_target_id;
  insert into public.r2_pending_deletes (file_path) values (v_dummy_path2) returning id into v_target_id2;

  -- unauthorized: wrong secret.
  v_threw := false;
  begin
    perform public.claim_pending_r2_deletes('wrong', 10, 5);
  exception when sqlstate '42501' then
    v_threw := true;
  end;
  if not v_threw then
    raise exception 'r2_drain_rpcs smoke FAIL: wrong secret was accepted by claim';
  end if;

  -- claim with correct secret: returns both rows and stamps attempted_at.
  select count(*) into v_claimed
    from public.claim_pending_r2_deletes(v_secret, 10, 5);
  if v_claimed <> 2 then
    raise exception 'r2_drain_rpcs smoke FAIL: expected 2 claimed rows, got %', v_claimed;
  end if;

  -- mark first row succeeded.
  perform public.mark_r2_delete_succeeded(v_secret, v_target_id);
  select succeeded_at into v_succeeded from public.r2_pending_deletes where id = v_target_id;
  if v_succeeded is null then
    raise exception 'r2_drain_rpcs smoke FAIL: succeeded_at was not stamped on mark_succeeded';
  end if;

  -- mark second row failed with attempt_count = 1.
  perform public.mark_r2_delete_failed(v_secret, v_target_id2, 1, 'transient: simulated');
  select attempt_count, last_error
    into v_attempt, v_error
    from public.r2_pending_deletes
   where id = v_target_id2;
  if v_attempt <> 1 or v_error <> 'transient: simulated' then
    raise exception 'r2_drain_rpcs smoke FAIL: mark_failed did not update attempt_count or last_error (got %, %)', v_attempt, v_error;
  end if;

  -- subsequent claim should only return the failed row (succeeded one is gone).
  select count(*) into v_claimed
    from public.claim_pending_r2_deletes(v_secret, 10, 5);
  if v_claimed <> 1 then
    raise exception 'r2_drain_rpcs smoke FAIL: expected 1 remaining pending row after success, got %', v_claimed;
  end if;

  -- bump the failing row to attempt_count = 5 (the default cap). future claims
  -- must skip it because attempt_count >= max_attempts.
  perform public.mark_r2_delete_failed(v_secret, v_target_id2, 5, 'gave up');
  select count(*) into v_claimed
    from public.claim_pending_r2_deletes(v_secret, 10, 5);
  if v_claimed <> 0 then
    raise exception 'r2_drain_rpcs smoke FAIL: expected 0 claimable rows after max attempts hit, got %', v_claimed;
  end if;

  -- teardown: clean both our seeded rows.
  delete from public.r2_pending_deletes where id in (v_target_id, v_target_id2);

  raise notice 'r2_drain_rpcs smoke test: PASS';
end$$;
