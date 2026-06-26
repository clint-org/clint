-- migration: 20260626120000_ctgov_restore_path
-- purpose: add the restore-on-resync path so a trial that returns to ct.gov can
--   be un-withdrawn, and so the manual sync can reach an already-removed trial.
--   Counterpart to 20260625200000_ctgov_withdrawn_trials (mark-withdrawn path).
--
-- design:
--   - get_trials_for_polling gains an optional p_include_withdrawn boolean
--     (default false). The daily queue still excludes withdrawn trials; a manual
--     backfill can pass true to reach a removed trial. The old 2-arg signature
--     is dropped and replaced by a single 3-arg function whose trailing default
--     keeps existing 2-arg callers (worker, app) working unchanged. Keeping both
--     a 2-arg and a 3-arg overload is impossible: a 2-arg call then resolves to
--     "function is not unique" (verified locally), which would break the worker.
--   - ingest_ctgov_snapshot only runs on a successful 200 fetch, so it is the
--     "the record came back" signal. Its final watermark update now also clears
--     ctgov_withdrawn_at, and if the trial WAS withdrawn it emits exactly one
--     trial_restored event. Clearing a non-withdrawn trial is a harmless no-op
--     and emits no event.
--
-- security: get_trials_for_polling stays SECURITY DEFINER, search_path=public,
--   secret-gated via _verify_ctgov_worker_secret (raises 42501 on mismatch),
--   revoked from public and granted to anon -- same shape as the other
--   worker-callable RPCs. Not a Tier 1 governance RPC, so no audit event.
--
-- note on get_activity_feed: the brief asked to add 'trial_restored' to a
--   high_signal whitelist in get_activity_feed. That whitelist no longer exists
--   in the live function: it was removed when get_activity_feed was rebuilt in
--   20260528003300_trial_acronym.sql, and the canonical feed RPC is now
--   get_events_page_data, which surfaces every trial_change_events row with no
--   event_type whitelist (so trial_restored already appears). Re-adding the
--   whitelist here would silently revert that newer logic, so this migration
--   leaves both feed RPCs untouched; feed labeling of trial_restored is owned by
--   the separate feed-mapping work.

-- =============================================================================
-- 1. get_trials_for_polling: optional p_include_withdrawn (default false).
--    Drop the 2-arg signature and replace with a single 3-arg function so a
--    2-arg call resolves unambiguously to it.
-- =============================================================================
drop function if exists public.get_trials_for_polling(text, integer);

create or replace function public.get_trials_for_polling(
  p_secret            text,
  p_limit             integer default 1000,
  p_include_withdrawn boolean default false
)
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
       and (p_include_withdrawn or t.ctgov_withdrawn_at is null)
     order by t.last_polled_at nulls first, t.id
     limit p_limit;
end;
$function$;

revoke execute on function public.get_trials_for_polling(text, integer, boolean) from public;
grant  execute on function public.get_trials_for_polling(text, integer, boolean) to anon;

comment on function public.get_trials_for_polling(text, integer, boolean) is
  'Worker-callable polling queue. Returns NCT-bearing trials ordered by last_polled_at nulls first, id. Excludes ct.gov-withdrawn trials unless p_include_withdrawn is true (manual backfill can reach a removed trial). Verifies worker secret; raises 42501 on mismatch.';

-- =============================================================================
-- 2. ingest_ctgov_snapshot: clear ctgov_withdrawn_at on the success watermark
--    update and emit one trial_restored event if the trial WAS withdrawn.
--    Body reproduced from the live definition with only those additions.
-- =============================================================================
create or replace function public.ingest_ctgov_snapshot(
  p_secret       text,
  p_trial_id     uuid,
  p_space_id     uuid,
  p_nct_id       text,
  p_version      integer,
  p_post_date    date,
  p_payload      jsonb,
  p_fetched_via  text,
  p_module_hints text[] default null::text[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_trial_space_id   uuid;
  v_snapshot_id      uuid;
  v_is_new           boolean;
  v_prev_payload     jsonb;
  v_diff             record;
  v_event            record;
  v_change_id        uuid;
  v_changes_recorded int := 0;
  v_events_emitted   int := 0;
  v_markers_seeded   int := 0;
  v_prev_withdrawn   timestamptz;
begin
  perform public._verify_ctgov_worker_secret(p_secret);

  select space_id into v_trial_space_id
    from public.trials
   where id = p_trial_id;

  if v_trial_space_id is null then
    raise exception 'trial not found' using errcode = '02000';
  end if;

  if v_trial_space_id <> p_space_id then
    raise exception 'space mismatch' using errcode = '22023';
  end if;

  insert into public.trial_ctgov_snapshots (
    trial_id, space_id, nct_id, ctgov_version, last_update_post_date,
    payload, fetched_via, fetched_at
  )
  values (
    p_trial_id, p_space_id, p_nct_id, p_version, p_post_date,
    p_payload, p_fetched_via, now()
  )
  on conflict (trial_id, ctgov_version) do nothing
  returning id, (xmax = 0) into v_snapshot_id, v_is_new;

  if v_snapshot_id is null then
    select id into v_snapshot_id
      from public.trial_ctgov_snapshots
     where trial_id = p_trial_id
       and ctgov_version = p_version;

    -- A successful 200 fetch means the record is live again regardless of
    -- version, so restoration must fire on this duplicate-version path too.
    -- Otherwise a trial removed and then restored at the SAME version it was
    -- last ingested at would stay withdrawn forever. Same logic as the watermark
    -- branch below: capture prior withdrawn state, clear it, and emit one
    -- trial_restored event only if it was set.
    select ctgov_withdrawn_at into v_prev_withdrawn
      from public.trials
     where id = p_trial_id;

    update public.trials
       set last_polled_at     = now(),
           ctgov_withdrawn_at  = null
     where id = p_trial_id;

    if v_prev_withdrawn is not null then
      insert into public.trial_change_events (
        trial_id, space_id, event_type, source, payload, occurred_at
      ) values (
        p_trial_id, p_space_id, 'trial_restored', 'ctgov',
        jsonb_build_object('nct_id', p_nct_id, 'last_update_posted_date', p_post_date),
        now()
      );
    end if;

    return jsonb_build_object(
      'snapshot_id',      v_snapshot_id,
      'inserted',         false,
      'events_emitted',   0,
      'changes_recorded', 0,
      'markers_seeded',   0
    );
  end if;

  perform public._materialize_trial_from_snapshot(p_trial_id, p_payload);
  v_markers_seeded := public._seed_ctgov_markers(p_trial_id, p_payload, v_snapshot_id);

  select payload into v_prev_payload
    from public.trial_ctgov_snapshots
   where trial_id = p_trial_id
     and ctgov_version < p_version
   order by ctgov_version desc
   limit 1;

  if v_prev_payload is not null then
    for v_diff in
      select *
        from public._compute_field_diffs(v_prev_payload, p_payload, p_module_hints)
    loop
      insert into public.trial_field_changes (
        trial_id, space_id, source_snapshot_id,
        field_path, old_value, new_value, observed_at
      ) values (
        p_trial_id, p_space_id, v_snapshot_id,
        v_diff.field_path, v_diff.old_value, v_diff.new_value, now()
      )
      returning id into v_change_id;

      v_changes_recorded := v_changes_recorded + 1;

      for v_event in
        select *
          from public._classify_change(
            v_diff.field_path,
            v_diff.old_value,
            v_diff.new_value,
            p_post_date::timestamptz
          )
      loop
        insert into public.trial_change_events (
          trial_id, space_id, event_type, source,
          payload, occurred_at, observed_at, derived_from_change_id
        ) values (
          p_trial_id, p_space_id, v_event.event_type, 'ctgov',
          v_event.payload, v_event.occurred_at, now(), v_change_id
        );

        v_events_emitted := v_events_emitted + 1;
      end loop;
    end loop;
  end if;

  -- A successful ingest means the record is live on ct.gov again. Capture the
  -- prior withdrawn state, then clear it on the watermark update. If it was set,
  -- emit exactly one trial_restored event.
  select ctgov_withdrawn_at into v_prev_withdrawn
    from public.trials
   where id = p_trial_id;

  update public.trials
     set last_polled_at          = now(),
         latest_ctgov_version    = p_version,
         last_update_posted_date = p_post_date,
         ctgov_withdrawn_at      = null
   where id = p_trial_id;

  if v_prev_withdrawn is not null then
    insert into public.trial_change_events (
      trial_id, space_id, event_type, source, payload, occurred_at
    ) values (
      p_trial_id, p_space_id, 'trial_restored', 'ctgov',
      jsonb_build_object('nct_id', p_nct_id, 'last_update_posted_date', p_post_date),
      now()
    );
  end if;

  return jsonb_build_object(
    'snapshot_id',      v_snapshot_id,
    'inserted',         true,
    'events_emitted',   v_events_emitted,
    'changes_recorded', v_changes_recorded,
    'markers_seeded',   v_markers_seeded
  );
end;
$function$;

-- PostgREST must see the new get_trials_for_polling signature immediately (see
-- memory: reload schema after RPC signature change or the app 404s the new args).
notify pgrst, 'reload schema';

-- =============================================================================
-- smoke test: withdrawn trial is excluded from the default queue but included
-- when p_include_withdrawn is true; a successful ingest clears the flag and
-- emits exactly one trial_restored event; a second ingest emits no further
-- restore event. Distinct UUID set from the 20260625200000 smoke.
-- =============================================================================
do $$
declare
  v_agency_id  uuid := '7e570001-7e57-7e57-7e57-7e5700000001';
  v_tenant_id  uuid := '7e570002-7e57-7e57-7e57-7e5700000002';
  v_user_id    uuid := '7e570003-7e57-7e57-7e57-7e5700000003';
  v_space_id   uuid := '7e570004-7e57-7e57-7e57-7e5700000004';
  v_company_id uuid := '7e570005-7e57-7e57-7e57-7e5700000005';
  v_asset_id   uuid := '7e570006-7e57-7e57-7e57-7e5700000006';
  v_t          uuid := '7e570008-7e57-7e57-7e57-7e5700000008';
  v_secret     text;
  v_marked     int;
  v_withdrawn  timestamptz;
  v_in_default int;
  v_in_incl    int;
  v_restored   int;
  v_payload_v1 jsonb := '{"protocolSection":{"statusModule":{"overallStatus":"RECRUITING"}}}'::jsonb;
  v_payload_v2 jsonb := '{"protocolSection":{"statusModule":{"overallStatus":"COMPLETED"}}}'::jsonb;
begin
  -- Resolve the env's actual worker secret from the vault (seeded locally,
  -- operator-set on dev/prod). Skip the smoke if no secret exists.
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'ctgov_worker_secret';
  if v_secret is null then
    raise notice 'ctgov_restore_path smoke: no ctgov_worker_secret in vault, skipping';
    return;
  end if;

  insert into auth.users (id, email) values (v_user_id, 'restore-smoke@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'Restore', 'restore-co', 'restoreco', 'RS', 'rs@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'RS', 'restore-t', 'restoret', 'RS');
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_user_id);
  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_user_id, 'RS Co');
  insert into public.assets (id, space_id, created_by, company_id, name)
    values (v_asset_id, v_space_id, v_user_id, v_company_id, 'RS Drug');
  insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
    values (v_t, v_space_id, v_user_id, v_asset_id, 'RESTORE_TRIAL', 'NCT-RESTORE-SMOKE');

  -- mark withdrawn so it leaves the default queue
  v_marked := public.mark_trials_ctgov_withdrawn(v_secret, array[v_t]);
  if v_marked <> 1 then
    raise exception 'restore smoke: expected 1 newly withdrawn, got %', v_marked;
  end if;

  -- default queue excludes the withdrawn trial
  select count(*) into v_in_default
    from public.get_trials_for_polling(v_secret, 100000) q
   where q.trial_id = v_t;
  if v_in_default <> 0 then
    raise exception 'restore smoke: withdrawn trial must be excluded from default queue, found %', v_in_default;
  end if;

  -- include-withdrawn queue includes it
  select count(*) into v_in_incl
    from public.get_trials_for_polling(v_secret, 100000, true) q
   where q.trial_id = v_t;
  if v_in_incl <> 1 then
    raise exception 'restore smoke: include-withdrawn queue must include the trial, found %', v_in_incl;
  end if;

  -- first ingest: the record came back -> clears flag + emits one trial_restored
  perform public.ingest_ctgov_snapshot(
    v_secret, v_t, v_space_id,
    'NCT-RESTORE-SMOKE', 1, '2026-01-01'::date,
    v_payload_v1, 'manual_sync', null
  );

  select ctgov_withdrawn_at into v_withdrawn from public.trials where id = v_t;
  if v_withdrawn is not null then
    raise exception 'restore smoke: ctgov_withdrawn_at should be cleared, got %', v_withdrawn;
  end if;

  select count(*) into v_restored
    from public.trial_change_events
   where trial_id = v_t
     and event_type = 'trial_restored'
     and payload ? 'last_update_posted_date';
  if v_restored <> 1 then
    raise exception 'restore smoke: expected 1 trial_restored event with last_update_posted_date, got %', v_restored;
  end if;

  -- second ingest (new version, trial already live) -> no further restore event
  perform public.ingest_ctgov_snapshot(
    v_secret, v_t, v_space_id,
    'NCT-RESTORE-SMOKE', 2, '2026-02-01'::date,
    v_payload_v2, 'manual_sync', null
  );

  select count(*) into v_restored
    from public.trial_change_events
   where trial_id = v_t
     and event_type = 'trial_restored';
  if v_restored <> 1 then
    raise exception 'restore smoke: second ingest must not emit another trial_restored event, got %', v_restored;
  end if;

  -- duplicate-version restore: a trial removed and restored at the SAME version
  -- it was last ingested at must still be un-withdrawn via the early-return path.
  -- Re-mark withdrawn, then ingest the SAME version/post_date that already exists
  -- (snapshot conflict -> early-return branch). Assert the flag is cleared and a
  -- second trial_restored event was emitted on that path (count 1 -> 2).
  v_marked := public.mark_trials_ctgov_withdrawn(v_secret, array[v_t]);
  if v_marked <> 1 then
    raise exception 'restore smoke: expected 1 re-withdrawn before same-version ingest, got %', v_marked;
  end if;

  perform public.ingest_ctgov_snapshot(
    v_secret, v_t, v_space_id,
    'NCT-RESTORE-SMOKE', 2, '2026-02-01'::date,
    v_payload_v2, 'manual_sync', null
  );

  select ctgov_withdrawn_at into v_withdrawn from public.trials where id = v_t;
  if v_withdrawn is not null then
    raise exception 'restore smoke: same-version ingest must clear ctgov_withdrawn_at, got %', v_withdrawn;
  end if;

  select count(*) into v_restored
    from public.trial_change_events
   where trial_id = v_t
     and event_type = 'trial_restored';
  if v_restored <> 2 then
    raise exception 'restore smoke: same-version (early-return) ingest must emit one more trial_restored event (expected 2 total), got %', v_restored;
  end if;

  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;

  raise notice 'ctgov_restore_path smoke test: PASS';
end$$;
