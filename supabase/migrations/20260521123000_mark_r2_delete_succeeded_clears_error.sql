-- migration: 20260521123000_mark_r2_delete_succeeded_clears_error
-- purpose: update mark_r2_delete_succeeded to clear last_error when
--   stamping succeeded_at. Without this, a row that fails on attempt N
--   and succeeds on attempt N+1 keeps the stale error message forever,
--   which makes the queue table look like it has unresolved errors even
--   when every row has succeeded. Observed in prod with the synthetic
--   test row from the T22 / T23 rollout, which carried a
--   mark_r2_delete_succeeded JSON-parse error after the drain recovered.

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
     set succeeded_at = now(),
         last_error   = null
   where id = p_id;
end;
$$;

revoke execute on function public.mark_r2_delete_succeeded(text, uuid) from public, authenticated;
grant  execute on function public.mark_r2_delete_succeeded(text, uuid) to anon;

comment on function public.mark_r2_delete_succeeded(text, uuid) is
  'R2 drain RPC. Worker-secret gated. Marks the row as succeeded after R2 confirms the object was deleted. Clears last_error on success so rows that recover after a transient failure no longer carry a stale error string.';

-- smoke: a row with a stale last_error gets it cleared on mark_succeeded.
do $$
declare
  v_secret  text;
  v_id      uuid;
  v_last    text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'r2_drain_worker_secret';
  if v_secret is null then
    raise exception 'smoke FAIL: vault entry r2_drain_worker_secret missing';
  end if;

  insert into public.r2_pending_deletes (file_path, attempt_count, last_error)
    values ('smoke/' || gen_random_uuid()::text || '/x.pdf', 2, 'transient')
    returning id into v_id;

  perform public.mark_r2_delete_succeeded(v_secret, v_id);

  select last_error into v_last from public.r2_pending_deletes where id = v_id;
  if v_last is not null then
    raise exception 'smoke FAIL: last_error not cleared on succeeded (got %)', v_last;
  end if;

  delete from public.r2_pending_deletes where id = v_id;

  raise notice 'mark_r2_delete_succeeded_clears_error smoke test: PASS';
end$$;
