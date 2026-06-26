-- migration: 20260625130000_restore_phase_materialization_with_acronym
-- purpose: repair an accidental regression. Migration 20260528003300_trial_acronym
--   did CREATE OR REPLACE on _materialize_trial_from_snapshot starting from a
--   STALE pre-phase-truth copy of the function and only added the acronym line.
--   That silently reverted the phase-truth work from 20260521200200 +
--   20260527225705 (fix_phase_end_date_coalesce_order):
--     - phase_type / phase_start_date / phase_end_date are no longer derived
--       from ct.gov;
--     - *_source columns no longer flip to 'ctgov';
--     - phase_changed / phase_start_changed / phase_end_changed events are no
--       longer emitted;
--     - the guard-trigger bypass GUC is no longer set.
--   Net effect since that deploy (2026-05-28): ct.gov syncs stopped updating the
--   phase columns on trials. Trials whose phase_*_source was already 'ctgov' are
--   frozen -- not analyst-editable (guard trigger) and not ct.gov-updated.
--
-- fix: restore the correct function = the 20260527225705 body (phase-truth with
--   the corrected completionDateStruct-first end-date coalesce) PLUS the acronym
--   derivation the 20260528003300 migration intended to add. All date casts use
--   public._safe_iso_date, so this is also partial-date safe.
--
-- backfill: the forward function only runs when a NEW snapshot arrives (post
--   date moved). Trials with stable ct.gov data would otherwise keep their stale
--   phase columns forever. A one-shot backfill re-derives the phase columns from
--   each trial's latest snapshot, ct.gov-wins, WITHOUT emitting change events
--   (direct UPDATE under the guard-bypass GUC). No-event because the per-field
--   classify path (phase_transitioned / date_moved) already captured transitions
--   in the feed during the regression window; re-emitting here would double-count.
--
-- security: SECURITY DEFINER, set search_path = public (matches prior versions).

create or replace function public._materialize_trial_from_snapshot(
  p_trial_id uuid,
  p_payload  jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase                text;
  v_phase_type           text;
  v_phase_start_date     date;
  v_phase_end_date       date;
  v_recruitment          text;
  v_status               text;
  v_study_type           text;
  v_last_update_date     date;
  v_acronym              text;
  v_prev_phase_type      text;
  v_prev_phase_start     date;
  v_prev_phase_end       date;
  v_prev_phase_type_src  text;
  v_prev_phase_start_src text;
  v_prev_phase_end_src   text;
  v_space_id             uuid;
  v_now                  timestamptz := now();
  v_occurred             timestamptz;
begin
  v_phase            := public._map_phase_array(p_payload #> '{protocolSection,designModule,phases}');
  v_recruitment      := p_payload #>> '{protocolSection,statusModule,overallStatus}';
  v_study_type       := p_payload #>> '{protocolSection,designModule,studyType}';
  v_phase_type       := public._derive_phase_type(
                          p_payload #> '{protocolSection,designModule,phases}',
                          v_study_type
                        );
  v_phase_start_date := public._safe_iso_date(p_payload #>> '{protocolSection,statusModule,startDateStruct,date}');
  -- completionDateStruct (trial end) first, primaryCompletionDateStruct (PCD)
  -- as fallback -- per 20260527225705.
  v_phase_end_date   := coalesce(
                          public._safe_iso_date(p_payload #>> '{protocolSection,statusModule,completionDateStruct,date}'),
                          public._safe_iso_date(p_payload #>> '{protocolSection,statusModule,primaryCompletionDateStruct,date}')
                        );
  v_status           := public._derive_status(v_recruitment);
  v_last_update_date := public._safe_iso_date(p_payload #>> '{protocolSection,statusModule,lastUpdatePostDateStruct,date}');
  v_acronym          := nullif(trim(p_payload #>> '{protocolSection,identificationModule,acronym}'), '');
  v_occurred         := coalesce(v_last_update_date::timestamptz, v_now);

  select phase_type, phase_start_date, phase_end_date,
         phase_type_source, phase_start_date_source, phase_end_date_source,
         space_id
    into v_prev_phase_type, v_prev_phase_start, v_prev_phase_end,
         v_prev_phase_type_src, v_prev_phase_start_src, v_prev_phase_end_src,
         v_space_id
    from public.trials where id = p_trial_id;

  perform set_config('clint.materialize_in_progress', 'on', true);

  update public.trials
     set phase                   = coalesce(v_phase, phase),
         phase_type              = coalesce(v_phase_type,       phase_type),
         phase_start_date        = coalesce(v_phase_start_date, phase_start_date),
         phase_end_date          = coalesce(v_phase_end_date,   phase_end_date),
         phase_type_source       = case when v_phase_type       is not null then 'ctgov' else phase_type_source       end,
         phase_start_date_source = case when v_phase_start_date is not null then 'ctgov' else phase_start_date_source end,
         phase_end_date_source   = case when v_phase_end_date   is not null then 'ctgov' else phase_end_date_source   end,
         status                  = coalesce(status, v_status),
         recruitment_status      = coalesce(v_recruitment, recruitment_status),
         study_type              = coalesce(v_study_type, study_type),
         last_update_posted_date = coalesce(v_last_update_date, last_update_posted_date),
         acronym                 = coalesce(v_acronym, acronym),
         ctgov_last_synced_at    = v_now
   where id = p_trial_id;

  perform set_config('clint.materialize_in_progress', 'off', true);

  if v_prev_phase_type is not null and v_phase_type is not null and v_phase_type <> v_prev_phase_type then
    insert into public.trial_change_events (trial_id, space_id, event_type, source, payload, occurred_at)
    values (p_trial_id, v_space_id, 'phase_changed', 'ctgov',
      jsonb_build_object(
        'field',      'phase_type',
        'old_value',  to_jsonb(v_prev_phase_type),
        'new_value',  to_jsonb(v_phase_type),
        'old_source', to_jsonb(v_prev_phase_type_src)
      ),
      v_occurred);
  end if;

  if v_prev_phase_start is not null and v_phase_start_date is not null and v_phase_start_date <> v_prev_phase_start then
    insert into public.trial_change_events (trial_id, space_id, event_type, source, payload, occurred_at)
    values (p_trial_id, v_space_id, 'phase_start_changed', 'ctgov',
      jsonb_build_object(
        'field',      'phase_start_date',
        'old_value',  to_jsonb(v_prev_phase_start),
        'new_value',  to_jsonb(v_phase_start_date),
        'old_source', to_jsonb(v_prev_phase_start_src)
      ),
      v_occurred);
  end if;

  if v_prev_phase_end is not null and v_phase_end_date is not null and v_phase_end_date <> v_prev_phase_end then
    insert into public.trial_change_events (trial_id, space_id, event_type, source, payload, occurred_at)
    values (p_trial_id, v_space_id, 'phase_end_changed', 'ctgov',
      jsonb_build_object(
        'field',      'phase_end_date',
        'old_value',  to_jsonb(v_prev_phase_end),
        'new_value',  to_jsonb(v_phase_end_date),
        'old_source', to_jsonb(v_prev_phase_end_src)
      ),
      v_occurred);
  end if;
end;
$$;

revoke execute on function public._materialize_trial_from_snapshot(uuid, jsonb) from public;

comment on function public._materialize_trial_from_snapshot(uuid, jsonb) is
  'Applies a ct.gov snapshot to the trial row. Derives phase / phase_type / phase_start_date / phase_end_date (completionDateStruct first, then primaryCompletionDateStruct) / status / recruitment_status / study_type / last_update_posted_date / acronym via ct.gov-first coalesce(derived, existing); when ct.gov supplies a non-null phase value the matching *_source flips to ''ctgov''. Emits one trial_change_events row per phase field whose value actually changed (prev non-null AND new differs). Sets the transaction-local GUC clint.materialize_in_progress around its UPDATE so the guard trigger does not block it. All date parsing uses _safe_iso_date so ct.gov month-precision partials never raise.';

-- =============================================================================
-- backfill: refresh stale phase columns from each trial''s latest snapshot,
-- ct.gov-wins, WITHOUT emitting events. Mirrors the forward coalesce.
-- =============================================================================
do $$
begin
  perform set_config('clint.materialize_in_progress', 'on', true);

  with latest_snapshot as (
    select distinct on (trial_id) trial_id, payload
      from public.trial_ctgov_snapshots
     order by trial_id, ctgov_version desc
  ),
  derived as (
    select
      ls.trial_id,
      public._map_phase_array(ls.payload #> '{protocolSection,designModule,phases}') as d_phase,
      public._derive_phase_type(
        ls.payload #> '{protocolSection,designModule,phases}',
        ls.payload #>> '{protocolSection,designModule,studyType}'
      ) as d_phase_type,
      public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,startDateStruct,date}') as d_start,
      coalesce(
        public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,completionDateStruct,date}'),
        public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,primaryCompletionDateStruct,date}')
      ) as d_end,
      nullif(trim(ls.payload #>> '{protocolSection,identificationModule,acronym}'), '') as d_acronym
    from latest_snapshot ls
  )
  update public.trials t
     set phase                   = coalesce(d.d_phase, t.phase),
         phase_type              = coalesce(d.d_phase_type, t.phase_type),
         phase_start_date        = coalesce(d.d_start, t.phase_start_date),
         phase_end_date          = coalesce(d.d_end, t.phase_end_date),
         phase_type_source       = case when d.d_phase_type is not null then 'ctgov' else t.phase_type_source       end,
         phase_start_date_source = case when d.d_start      is not null then 'ctgov' else t.phase_start_date_source end,
         phase_end_date_source   = case when d.d_end        is not null then 'ctgov' else t.phase_end_date_source   end,
         acronym                 = coalesce(d.d_acronym, t.acronym)
    from derived d
   where t.id = d.trial_id
     and (
       t.phase_type       is distinct from coalesce(d.d_phase_type, t.phase_type)
       or t.phase_start_date is distinct from coalesce(d.d_start, t.phase_start_date)
       or t.phase_end_date   is distinct from coalesce(d.d_end, t.phase_end_date)
       or t.acronym          is distinct from coalesce(d.d_acronym, t.acronym)
     );

  perform set_config('clint.materialize_in_progress', 'off', true);
end;
$$;

-- =============================================================================
-- smoke test: phase columns + acronym must both materialize, partials are safe.
-- =============================================================================
do $$
declare
  v_agency_id  uuid := '99999aa1-9999-9999-9999-9999999999a1';
  v_tenant_id  uuid := '99999aa2-9999-9999-9999-9999999999a2';
  v_user_id    uuid := '99999aa3-9999-9999-9999-9999999999a3';
  v_space_id   uuid := '99999aa4-9999-9999-9999-9999999999a4';
  v_company_id uuid := '99999aa5-9999-9999-9999-9999999999a5';
  v_asset_id   uuid := '99999aa6-9999-9999-9999-9999999999a6';
  v_t          uuid := '99999aa8-9999-9999-9999-9999999999a8';
  v_phase_type text;
  v_src        text;
  v_start      date;
  v_end        date;
  v_acronym    text;
  -- primaryCompletionDateStruct is a partial ("2026-04") -- must not raise and
  -- must be ignored by _safe_iso_date; completionDateStruct (full) wins for end.
  v_payload jsonb := '{"protocolSection":{"identificationModule":{"acronym":"SURMOUNT-1"},"designModule":{"phases":["PHASE3"],"studyType":"INTERVENTIONAL"},"statusModule":{"startDateStruct":{"date":"2024-01-15"},"primaryCompletionDateStruct":{"date":"2026-04"},"completionDateStruct":{"date":"2026-12-31"},"lastUpdatePostDateStruct":{"date":"2026-06-01"}}}}'::jsonb;
begin
  insert into auth.users (id, email) values (v_user_id, 'restore-phase-smoke@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'RestorePhase', 'restore-phase', 'restorephase', 'RP', 'rp@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'RP', 'restore-phase-t', 'restorephaset', 'RP');
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_user_id);
  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_user_id, 'RP Co');
  insert into public.assets (id, space_id, created_by, company_id, name)
    values (v_asset_id, v_space_id, v_user_id, v_company_id, 'RP Drug');
  insert into public.trials (id, space_id, created_by, asset_id, name)
    values (v_t, v_space_id, v_user_id, v_asset_id, 'RESTORE_PHASE_TRIAL');

  perform public._materialize_trial_from_snapshot(v_t, v_payload);

  select phase_type, phase_type_source, phase_start_date, phase_end_date, acronym
    into v_phase_type, v_src, v_start, v_end, v_acronym
    from public.trials where id = v_t;

  if v_phase_type <> 'P3' or v_src <> 'ctgov' then
    raise exception 'restore-phase smoke: expected phase_type=P3/ctgov, got %/%', v_phase_type, v_src;
  end if;
  if v_start <> '2024-01-15'::date then
    raise exception 'restore-phase smoke: expected phase_start_date 2024-01-15, got %', v_start;
  end if;
  -- completionDateStruct (full) wins; primaryCompletionDateStruct partial ignored.
  if v_end <> '2026-12-31'::date then
    raise exception 'restore-phase smoke: expected phase_end_date 2026-12-31 (completion wins), got %', v_end;
  end if;
  if v_acronym <> 'SURMOUNT-1' then
    raise exception 'restore-phase smoke: expected acronym SURMOUNT-1, got %', v_acronym;
  end if;

  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;

  raise notice 'restore_phase_materialization_with_acronym smoke test: PASS';
end$$;
