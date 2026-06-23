-- migration: r2_drain_volume_guard
-- purpose (WS1 materials durability):
--   1. mark_r2_delete_deferred: record a delete that R2 refused because the object
--      is still under its 7-day bucket lock (error 10069). Stamps last_error but
--      does NOT advance attempt_count, so the row stays claimable and the drain
--      retries it on a later daily run once the lock expires. Without this, lock
--      rejections would burn the 5-attempt budget and orphan the object.
--   2. r2_drain_control + r2_drain_gate: a deny-by-default volume guard. Before a
--      run deletes anything, the worker calls r2_drain_gate; if the count of
--      brand-new (attempted_at IS NULL) pending deletes exceeds the cap, the gate
--      returns allowed=false and the worker deletes nothing. A one-shot override
--      (set by the approve workflow) raises the cap for a single run.
-- all functions are worker-secret gated via _verify_r2_drain_worker_secret.

create table public.r2_drain_control (
  id                   int primary key default 1 check (id = 1),
  max_per_run          int not null default 200,
  override_max         int,
  override_set_at      timestamptz,
  override_consumed_at timestamptz,
  last_paused_at       timestamptz,
  last_paused_count    int
);
insert into public.r2_drain_control (id) values (1) on conflict (id) do nothing;

revoke all on public.r2_drain_control from public, anon, authenticated;

comment on table public.r2_drain_control is
  'WS1 single-row control for the r2-drain volume guard. max_per_run is the deny-by-default cap on brand-new pending deletes per run; override_* is a one-shot raise set by the approve workflow; last_paused_* records the most recent guard trip for the monitor workflow. Written by r2_drain_gate (SECURITY DEFINER) and by operators via direct SQL (GHA approve/monitor with DB creds).';

create or replace function public.mark_r2_delete_deferred(
  p_secret text,
  p_id     uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._verify_r2_drain_worker_secret(p_secret);
  update public.r2_pending_deletes
     set last_error = p_reason
   where id = p_id;
end;
$$;

revoke execute on function public.mark_r2_delete_deferred(text, uuid, text) from public, anon;
grant  execute on function public.mark_r2_delete_deferred(text, uuid, text) to authenticated;

comment on function public.mark_r2_delete_deferred(text, uuid, text) is
  'R2 drain RPC (WS1). Worker-secret gated. Records that a delete was deferred because the object is still under its R2 bucket lock (error 10069). Leaves attempt_count unchanged so the row is retried on a later run after the lock expires.';

create or replace function public.r2_drain_gate(p_secret text)
returns table (
  allowed           boolean,
  unattempted_count int,
  effective_cap     int,
  reason            text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new      int;
  v_base_cap int;
  v_override int;
  v_consumed timestamptz;
  v_eff_cap  int;
begin
  perform public._verify_r2_drain_worker_secret(p_secret);

  select count(*) into v_new
    from public.r2_pending_deletes
   where succeeded_at is null
     and attempted_at is null;

  select max_per_run, override_max, override_consumed_at
    into v_base_cap, v_override, v_consumed
    from public.r2_drain_control
   where id = 1;

  v_eff_cap := v_base_cap;
  if v_override is not null and v_consumed is null then
    v_eff_cap := greatest(v_base_cap, v_override);
  end if;

  if v_new > v_eff_cap then
    update public.r2_drain_control
       set last_paused_at = now(), last_paused_count = v_new
     where id = 1;
    return query select false, v_new, v_eff_cap, 'volume_exceeded'::text;
    return;
  end if;

  if v_override is not null and v_consumed is null and v_new > v_base_cap then
    update public.r2_drain_control set override_consumed_at = now() where id = 1;
  end if;

  return query select true, v_new, v_eff_cap, 'ok'::text;
end;
$$;

revoke execute on function public.r2_drain_gate(text) from public, anon;
grant  execute on function public.r2_drain_gate(text) to authenticated;

comment on function public.r2_drain_gate(text) is
  'R2 drain RPC (WS1). Worker-secret gated. Deny-by-default volume guard: returns allowed=false (deleting nothing) when the count of brand-new pending deletes (attempted_at IS NULL) exceeds the effective cap. A one-shot override raises the cap for a single run and is consumed on use. Records the trip in r2_drain_control for the monitor workflow.';

notify pgrst, 'reload schema';

do $$
declare
  v_secret  text;
  v_allowed boolean;
  v_new     int;
  v_cap     int;
  v_id      uuid;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'r2_drain_worker_secret';
  if v_secret is null then
    raise exception 'r2_drain_volume_guard smoke FAIL: vault entry missing';
  end if;

  delete from public.r2_pending_deletes;
  update public.r2_drain_control set max_per_run = 3, override_max = null, override_set_at = null, override_consumed_at = null where id = 1;

  select allowed into v_allowed from public.r2_drain_gate(v_secret);
  if not v_allowed then raise exception 'smoke FAIL: empty queue should be allowed'; end if;

  insert into public.r2_pending_deletes (file_path)
  select 'materials/smoke/' || gen_random_uuid() || '/x.pdf' from generate_series(1,5);
  select allowed, unattempted_count, effective_cap into v_allowed, v_new, v_cap from public.r2_drain_gate(v_secret);
  if v_allowed or v_new <> 5 then raise exception 'smoke FAIL: 5 new over cap 3 should deny (got allowed=%, new=%)', v_allowed, v_new; end if;

  update public.r2_drain_control set override_max = 10, override_set_at = now(), override_consumed_at = null where id = 1;
  select allowed into v_allowed from public.r2_drain_gate(v_secret);
  if not v_allowed then raise exception 'smoke FAIL: override should permit the run'; end if;
  if (select override_consumed_at from public.r2_drain_control where id = 1) is null then
    raise exception 'smoke FAIL: override should be consumed after use';
  end if;

  select allowed into v_allowed from public.r2_drain_gate(v_secret);
  if v_allowed then raise exception 'smoke FAIL: consumed override should not permit a second run'; end if;

  select id into v_id from public.r2_pending_deletes limit 1;
  perform public.mark_r2_delete_deferred(v_secret, v_id, 'deferred: object locked (10069)');
  if (select attempt_count from public.r2_pending_deletes where id = v_id) <> 0 then
    raise exception 'smoke FAIL: defer must not advance attempt_count';
  end if;

  delete from public.r2_pending_deletes;
  update public.r2_drain_control set max_per_run = 200, override_max = null, override_set_at = null, override_consumed_at = null, last_paused_at = null, last_paused_count = null where id = 1;

  raise notice 'r2_drain_volume_guard smoke test: PASS';
end$$;
