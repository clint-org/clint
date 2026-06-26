-- migration: 20260625140000_ctgov_withdrawn_trials
-- purpose: stop trials that have been removed from ct.gov (HTTP 404 on full
--   pull) from being re-fetched and re-logged as an error on every daily sync.
--   Before this, a withdrawn NCT (observed: NCT04882961) was marked polled but
--   still re-entered the queue every run (the whole queue is re-polled daily),
--   404'd again, and pushed a 404 into error_summary -> status=partial forever.
--
-- design (chosen approach: mark withdrawn + stop polling):
--   - trials.ctgov_withdrawn_at: timestamp a trial was first observed missing
--     from ct.gov. ct.gov-owned, null for live trials.
--   - get_trials_for_polling excludes withdrawn trials, so they leave the queue.
--   - mark_trials_ctgov_withdrawn(secret, uuid[]): worker-callable, secret-gated.
--     Stamps ctgov_withdrawn_at once (where still null), emits a single
--     trial_withdrawn event per newly-withdrawn trial, and bumps last_polled_at.
--     Idempotent: re-marking an already-withdrawn trial is a no-op (no second
--     event). The worker calls this on a 404 instead of logging a hard error.
--
-- security: mark_trials_ctgov_withdrawn is SECURITY DEFINER, search_path=public,
--   secret-gated via _verify_ctgov_worker_secret (raises 42501 on mismatch),
--   revoked from public and granted to anon -- same shape as the other
--   worker-callable RPCs (ingest_ctgov_snapshot, bulk_update_last_polled). Not a
--   Tier 1 governance RPC, so no audit event.

-- 1. column
alter table public.trials
  add column if not exists ctgov_withdrawn_at timestamptz;

comment on column public.trials.ctgov_withdrawn_at is
  'When ct.gov first returned 404 for this trial''s NCT during a poll (i.e. the study was removed/withdrawn from the registry). Null for live trials. ct.gov-owned. Set by mark_trials_ctgov_withdrawn; excludes the trial from get_trials_for_polling so it is no longer re-fetched daily.';

-- 2. exclude withdrawn trials from the polling queue
create or replace function public.get_trials_for_polling(p_secret text, p_limit integer default 1000)
returns table(trial_id uuid, space_id uuid, nct_id text, last_update_posted_date date, latest_ctgov_version integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  perform public._verify_ctgov_worker_secret(p_secret);

  return query
    select t.id,
           t.space_id,
           t.identifier::text,
           t.last_update_posted_date,
           t.latest_ctgov_version
      from public.trials t
     where t.identifier is not null
       and t.ctgov_withdrawn_at is null
     order by t.last_polled_at nulls first, t.id
     limit p_limit;
end;
$function$;

-- 3. worker RPC: mark trials withdrawn (idempotent, emits one-time event)
create or replace function public.mark_trials_ctgov_withdrawn(
  p_secret    text,
  p_trial_ids uuid[]
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   record;
  v_count int := 0;
begin
  perform public._verify_ctgov_worker_secret(p_secret);

  if p_trial_ids is null or array_length(p_trial_ids, 1) is null then
    return 0;
  end if;

  -- Stamp + bump only the trials that are not already withdrawn. RETURNING the
  -- transitioning rows lets us emit exactly one trial_withdrawn event each.
  for v_row in
    update public.trials t
       set ctgov_withdrawn_at = now(),
           last_polled_at     = now()
     where t.id = any(p_trial_ids)
       and t.ctgov_withdrawn_at is null
    returning t.id, t.space_id, t.identifier
  loop
    insert into public.trial_change_events (
      trial_id, space_id, event_type, source, payload, occurred_at
    ) values (
      v_row.id, v_row.space_id, 'trial_withdrawn', 'ctgov',
      jsonb_build_object('nct_id', v_row.identifier, 'reason', 'ctgov_404'),
      now()
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.mark_trials_ctgov_withdrawn(text, uuid[]) from public;
grant execute on function public.mark_trials_ctgov_withdrawn(text, uuid[]) to anon;

comment on function public.mark_trials_ctgov_withdrawn(text, uuid[]) is
  'Worker-callable. Marks each given trial withdrawn (ctgov_withdrawn_at=now()) the first time it is reported, emits one trial_withdrawn event per newly-withdrawn trial, and bumps last_polled_at. Idempotent: already-withdrawn trials are skipped (no duplicate event). Withdrawn trials are excluded from get_trials_for_polling. SECURITY DEFINER, secret-gated, anon-grantable. Returns the count of trials newly marked withdrawn.';

-- PostgREST must see the new function immediately (see memory: reload schema
-- after RPC signature change or the app 404s the new args).
notify pgrst, 'reload schema';

-- =============================================================================
-- smoke test: mark withdrawn -> column set + one event + excluded from queue;
-- re-mark -> idempotent (no second event).
-- =============================================================================
do $$
declare
  v_agency_id  uuid := '99999bb1-9999-9999-9999-9999999999b1';
  v_tenant_id  uuid := '99999bb2-9999-9999-9999-9999999999b2';
  v_user_id    uuid := '99999bb3-9999-9999-9999-9999999999b3';
  v_space_id   uuid := '99999bb4-9999-9999-9999-9999999999b4';
  v_company_id uuid := '99999bb5-9999-9999-9999-9999999999b5';
  v_asset_id   uuid := '99999bb6-9999-9999-9999-9999999999b6';
  v_t          uuid := '99999bb8-9999-9999-9999-9999999999b8';
  v_secret     text;
  v_marked     int;
  v_withdrawn  timestamptz;
  v_events     int;
  v_in_queue   int;
begin
  -- Resolve the configured worker secret from the vault, the same source
  -- _verify_ctgov_worker_secret reads. Hardcoding the local-dev value here made
  -- the smoke fail (42501) on any environment whose secret had been rotated away
  -- from it (dev/prod), since the gate compares against the live vault entry --
  -- not a fixed string -- and that failure rolls back the whole migration,
  -- blocking every deploy. Reading it here keeps the smoke environment-agnostic.
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'ctgov_worker_secret';
  if v_secret is null then
    raise exception 'withdrawn smoke: ctgov_worker_secret is not configured in the vault';
  end if;

  insert into auth.users (id, email) values (v_user_id, 'withdrawn-smoke@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'Withdrawn', 'withdrawn-co', 'withdrawnco', 'WD', 'wd@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'WD', 'withdrawn-t', 'withdrawnt', 'WD');
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_user_id);
  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_user_id, 'WD Co');
  insert into public.assets (id, space_id, created_by, company_id, name)
    values (v_asset_id, v_space_id, v_user_id, v_company_id, 'WD Drug');
  insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
    values (v_t, v_space_id, v_user_id, v_asset_id, 'WITHDRAWN_TRIAL', 'NCT-WITHDRAWN-SMOKE');

  -- before: trial is in the polling queue
  select count(*) into v_in_queue
    from public.get_trials_for_polling(v_secret, 100000) q
   where q.trial_id = v_t;
  if v_in_queue <> 1 then
    raise exception 'withdrawn smoke: live trial should be in queue, found %', v_in_queue;
  end if;

  -- mark withdrawn
  v_marked := public.mark_trials_ctgov_withdrawn(v_secret, array[v_t]);
  if v_marked <> 1 then
    raise exception 'withdrawn smoke: expected 1 newly withdrawn, got %', v_marked;
  end if;

  select ctgov_withdrawn_at into v_withdrawn from public.trials where id = v_t;
  if v_withdrawn is null then
    raise exception 'withdrawn smoke: ctgov_withdrawn_at not set';
  end if;

  select count(*) into v_events
    from public.trial_change_events
   where trial_id = v_t and event_type = 'trial_withdrawn';
  if v_events <> 1 then
    raise exception 'withdrawn smoke: expected 1 trial_withdrawn event, got %', v_events;
  end if;

  -- after: trial is gone from the queue
  select count(*) into v_in_queue
    from public.get_trials_for_polling(v_secret, 100000) q
   where q.trial_id = v_t;
  if v_in_queue <> 0 then
    raise exception 'withdrawn smoke: withdrawn trial should be excluded from queue, found %', v_in_queue;
  end if;

  -- idempotent: re-mark is a no-op, no second event
  v_marked := public.mark_trials_ctgov_withdrawn(v_secret, array[v_t]);
  if v_marked <> 0 then
    raise exception 'withdrawn smoke: re-mark should report 0 newly withdrawn, got %', v_marked;
  end if;
  select count(*) into v_events
    from public.trial_change_events
   where trial_id = v_t and event_type = 'trial_withdrawn';
  if v_events <> 1 then
    raise exception 'withdrawn smoke: re-mark must not emit a second event, got %', v_events;
  end if;

  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;

  raise notice 'ctgov_withdrawn_trials smoke test: PASS';
end$$;
