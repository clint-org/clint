-- migration: 20260521200200_trial_phase_ctgov_truth
-- purpose: flip _materialize_trial_from_snapshot from analyst-wins reverse
--   coalesce to ct.gov-wins forward coalesce on phase_type / phase_start_date
--   / phase_end_date. stamp the matching *_source columns whenever ct.gov
--   supplies a value. emit one trial_change_events row per field that
--   actually changed (prev non-null AND new differs). add a BEFORE UPDATE
--   trigger that blocks direct writes to 'ctgov'-locked fields; materialize
--   bypasses the trigger via a transaction-local GUC.
-- affected objects:
--   - function public._materialize_trial_from_snapshot(uuid, jsonb) (replace)
--   - function public._guard_ctgov_locked_phase_fields() (create)
--   - trigger trg_guard_ctgov_locked_phase_fields on public.trials (create)
-- depends on: previous migration 20260521195224_trial_phase_source_columns
-- security: function bodies are SECURITY DEFINER with set search_path = public,
--   matching the prior _materialize_trial_from_snapshot. revoke from public.

-- =============================================================================
-- 1. replace _materialize_trial_from_snapshot
-- =============================================================================
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
  -- derive from snapshot
  v_phase            := public._map_phase_array(p_payload #> '{protocolSection,designModule,phases}');
  v_recruitment      := p_payload #>> '{protocolSection,statusModule,overallStatus}';
  v_study_type       := p_payload #>> '{protocolSection,designModule,studyType}';
  v_phase_type       := public._derive_phase_type(
                          p_payload #> '{protocolSection,designModule,phases}',
                          v_study_type
                        );
  v_phase_start_date := public._safe_iso_date(p_payload #>> '{protocolSection,statusModule,startDateStruct,date}');
  v_phase_end_date   := coalesce(
                          public._safe_iso_date(p_payload #>> '{protocolSection,statusModule,primaryCompletionDateStruct,date}'),
                          public._safe_iso_date(p_payload #>> '{protocolSection,statusModule,completionDateStruct,date}')
                        );
  v_status           := public._derive_status(v_recruitment);
  v_last_update_date := public._safe_iso_date(p_payload #>> '{protocolSection,statusModule,lastUpdatePostDateStruct,date}');
  v_occurred         := coalesce(v_last_update_date::timestamptz, v_now);

  -- snapshot previous values (and space_id) for diff + event insert
  select phase_type, phase_start_date, phase_end_date,
         phase_type_source, phase_start_date_source, phase_end_date_source,
         space_id
    into v_prev_phase_type, v_prev_phase_start, v_prev_phase_end,
         v_prev_phase_type_src, v_prev_phase_start_src, v_prev_phase_end_src,
         v_space_id
    from public.trials where id = p_trial_id;

  -- allow this function's own UPDATE to bypass the guard trigger
  perform set_config('clint.materialize_in_progress', 'on', true);

  -- write (ct.gov-first coalesce; stamp source when ct.gov supplied a value)
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
         ctgov_last_synced_at    = v_now
   where id = p_trial_id;

  -- reset the bypass flag so it does not bleed into other statements in the txn
  perform set_config('clint.materialize_in_progress', 'off', true);

  -- emit one event per field that actually changed (prev non-null and new differs).
  -- seeding (prev null) emits nothing. no-op syncs (new == prev) emit nothing.
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
  'Applies a ct.gov snapshot to the trial row. phase / phase_type / phase_start_date / phase_end_date / status / recruitment_status / study_type / last_update_posted_date use ct.gov-first coalesce(derived, existing); when ct.gov supplies a non-null value the matching *_source flips to ''ctgov''. When the derived value is null (e.g. phases:["NA"]), the existing column and source survive. Emits one row into trial_change_events per phase field (phase_type, phase_start_date, phase_end_date) whose value actually changed (prev non-null AND new differs). Sets the transaction-local GUC clint.materialize_in_progress around its UPDATE so the guard trigger does not block it.';

-- =============================================================================
-- 2. guard trigger: block direct UPDATE to ctgov-locked fields
-- =============================================================================
create or replace function public._guard_ctgov_locked_phase_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- bypass when materialize is the caller (set via transaction-local GUC)
  if current_setting('clint.materialize_in_progress', true) = 'on' then
    return new;
  end if;

  if new.phase_type is distinct from old.phase_type and old.phase_type_source = 'ctgov' then
    raise exception 'phase_type is managed by ct.gov for this trial; cannot update directly. Remove the NCT or wait for the next ct.gov sync.'
      using errcode = 'P0001';
  end if;
  if new.phase_start_date is distinct from old.phase_start_date and old.phase_start_date_source = 'ctgov' then
    raise exception 'phase_start_date is managed by ct.gov for this trial; cannot update directly.'
      using errcode = 'P0001';
  end if;
  if new.phase_end_date is distinct from old.phase_end_date and old.phase_end_date_source = 'ctgov' then
    raise exception 'phase_end_date is managed by ct.gov for this trial; cannot update directly.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public._guard_ctgov_locked_phase_fields() is
  'BEFORE UPDATE trigger function on public.trials. Rejects writes that change phase_type / phase_start_date / phase_end_date when the matching *_source column is ''ctgov''. Bypasses when current_setting(''clint.materialize_in_progress'', true) = ''on'', which _materialize_trial_from_snapshot sets transaction-locally before its UPDATE.';

create trigger trg_guard_ctgov_locked_phase_fields
  before update on public.trials
  for each row
  execute function public._guard_ctgov_locked_phase_fields();

-- =============================================================================
-- inline psql smoke: 11 cases per spec
-- =============================================================================
do $$
declare
  v_agency_id   uuid := '99999771-9999-9999-9999-999999999771';
  v_tenant_id   uuid := '99999772-9999-9999-9999-999999999772';
  v_user_id     uuid := '99999773-9999-9999-9999-999999999773';
  v_space_id    uuid := '99999774-9999-9999-9999-999999999774';
  v_company_id  uuid := '99999775-9999-9999-9999-999999999775';
  v_product_id  uuid := '99999776-9999-9999-9999-999999999776';
  v_ta_id       uuid := '99999777-9999-9999-9999-999999999777';
  v_t           uuid := '99999778-9999-9999-9999-999999999778';
  v_threw       boolean;
  v_count       int;
  v_event_type  text;
  v_old_source  text;
  v_event_source text;
  v_phase_type  text;
  v_src         text;
  v_payload_p2  jsonb := '{"protocolSection":{"designModule":{"phases":["PHASE2"]},"statusModule":{"startDateStruct":{"date":"2024-01-01"},"primaryCompletionDateStruct":{"date":"2025-12-31"},"lastUpdatePostDateStruct":{"date":"2026-05-01"}}}}'::jsonb;
  v_payload_p3  jsonb := '{"protocolSection":{"designModule":{"phases":["PHASE3"]},"statusModule":{"startDateStruct":{"date":"2024-01-01"},"primaryCompletionDateStruct":{"date":"2025-12-31"},"lastUpdatePostDateStruct":{"date":"2026-06-01"}}}}'::jsonb;
  v_payload_p3_start_moved jsonb := '{"protocolSection":{"designModule":{"phases":["PHASE3"]},"statusModule":{"startDateStruct":{"date":"2024-06-01"},"primaryCompletionDateStruct":{"date":"2026-06-30"},"lastUpdatePostDateStruct":{"date":"2026-07-01"}}}}'::jsonb;
  v_payload_na  jsonb := '{"protocolSection":{"designModule":{"phases":["NA"],"studyType":"INTERVENTIONAL"},"statusModule":{}}}'::jsonb;
begin
  insert into auth.users (id, email) values (v_user_id, 'phase-truth-smoke@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'PhaseTruth', 'phase-truth', 'phasetruth', 'PT', 'pt@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'PT', 'phase-truth-t', 'phasetrutht', 'PT');
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_user_id);
  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_user_id, 'PT Co');
  insert into public.products (id, space_id, created_by, company_id, name)
    values (v_product_id, v_space_id, v_user_id, v_company_id, 'PT Drug');
  insert into public.therapeutic_areas (id, space_id, created_by, name)
    values (v_ta_id, v_space_id, v_user_id, 'PT TA');

  -- ===== test 1: materialize over null row -> ctgov source, no events (seeding)
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier)
    values (v_t, v_space_id, v_user_id, v_product_id, v_ta_id, 'TEST_1_SEED', 'NCT99999998');
  perform public._materialize_trial_from_snapshot(v_t, v_payload_p2);

  select phase_type, phase_type_source into v_phase_type, v_src from public.trials where id = v_t;
  if v_phase_type <> 'P2' or v_src <> 'ctgov' then
    raise exception 'test 1 FAIL: expected phase_type=P2 source=ctgov, got %, %', v_phase_type, v_src;
  end if;

  select count(*) into v_count
    from public.trial_change_events
   where trial_id = v_t and event_type in ('phase_changed', 'phase_start_changed', 'phase_end_changed');
  if v_count <> 0 then
    raise exception 'test 1 FAIL: seeding should emit 0 events, got %', v_count;
  end if;
  raise notice 'test 1 ok: seeding writes ctgov source, no events';

  -- ===== test 2: materialize over ctgov-source P2 with new P3 -> phase_changed event
  perform public._materialize_trial_from_snapshot(v_t, v_payload_p3);

  select count(*) into v_count
    from public.trial_change_events
   where trial_id = v_t and event_type = 'phase_changed';
  if v_count <> 1 then raise exception 'test 2 FAIL: expected 1 phase_changed event, got %', v_count; end if;

  select event_type, source, payload ->> 'old_source'
    into v_event_type, v_event_source, v_old_source
    from public.trial_change_events
   where trial_id = v_t and event_type = 'phase_changed';

  if v_event_source <> 'ctgov' then raise exception 'test 2 FAIL: expected source=ctgov, got %', v_event_source; end if;
  if v_old_source <> 'ctgov' then raise exception 'test 2 FAIL: expected old_source=ctgov, got %', v_old_source; end if;
  raise notice 'test 2 ok: P2->P3 emits phase_changed with source=ctgov, old_source=ctgov';

  -- clear events for the next test
  delete from public.trial_change_events where trial_id = v_t;

  -- ===== test 3: start_date only changes -> only phase_start_changed
  perform public._materialize_trial_from_snapshot(v_t, v_payload_p3_start_moved);

  select count(*) into v_count from public.trial_change_events where trial_id = v_t and event_type = 'phase_start_changed';
  if v_count <> 1 then raise exception 'test 3 FAIL: expected 1 phase_start_changed, got %', v_count; end if;
  -- end date moved too in this payload (2025-12-31 -> 2026-06-30), so phase_end_changed should also fire
  select count(*) into v_count from public.trial_change_events where trial_id = v_t and event_type = 'phase_end_changed';
  if v_count <> 1 then raise exception 'test 3 FAIL: expected 1 phase_end_changed, got %', v_count; end if;
  select count(*) into v_count from public.trial_change_events where trial_id = v_t and event_type = 'phase_changed';
  if v_count <> 0 then raise exception 'test 3 FAIL: phase unchanged, expected 0 phase_changed events, got %', v_count; end if;
  raise notice 'test 3 ok: dates changed -> phase_start_changed + phase_end_changed, no phase_changed';

  delete from public.trial_change_events where trial_id = v_t;

  -- ===== test 4: no-op sync (same payload) -> 0 events
  perform public._materialize_trial_from_snapshot(v_t, v_payload_p3_start_moved);
  select count(*) into v_count from public.trial_change_events where trial_id = v_t;
  if v_count <> 0 then raise exception 'test 4 FAIL: no-op sync, expected 0 events, got %', v_count; end if;
  raise notice 'test 4 ok: no-op sync emits 0 events';

  -- ===== test 5: derive returns null (phases:["NA"]) against existing ctgov P3 -> unchanged, no events
  perform public._materialize_trial_from_snapshot(v_t, v_payload_na);
  select phase_type, phase_type_source into v_phase_type, v_src from public.trials where id = v_t;
  if v_phase_type <> 'P3' or v_src <> 'ctgov' then
    raise exception 'test 5 FAIL: NA derive should leave existing untouched, got %, %', v_phase_type, v_src;
  end if;
  select count(*) into v_count from public.trial_change_events where trial_id = v_t;
  if v_count <> 0 then raise exception 'test 5 FAIL: NA derive should emit 0 events, got %', v_count; end if;
  raise notice 'test 5 ok: NA derive leaves row untouched, no events';

  -- ===== test 6: analyst-source override gets overwritten by ctgov
  -- bypass the guard trigger to set up the analyst-source state
  perform set_config('clint.materialize_in_progress', 'on', true);
  update public.trials
     set phase_type = 'P3', phase_type_source = 'analyst'
   where id = v_t;
  perform set_config('clint.materialize_in_progress', 'off', true);

  delete from public.trial_change_events where trial_id = v_t;
  perform public._materialize_trial_from_snapshot(v_t, v_payload_p2);

  select phase_type, phase_type_source into v_phase_type, v_src from public.trials where id = v_t;
  if v_phase_type <> 'P2' or v_src <> 'ctgov' then
    raise exception 'test 6 FAIL: expected P2/ctgov after override overwrite, got %, %', v_phase_type, v_src;
  end if;
  select payload ->> 'old_source' into v_old_source
    from public.trial_change_events
   where trial_id = v_t and event_type = 'phase_changed';
  if v_old_source <> 'analyst' then
    raise exception 'test 6 FAIL: expected old_source=analyst in event payload, got %', v_old_source;
  end if;
  raise notice 'test 6 ok: analyst override overwritten, event payload old_source=analyst';

  -- ===== test 7: guard trigger blocks direct UPDATE on ctgov-locked phase_type
  v_threw := false;
  begin
    update public.trials set phase_type = 'P1' where id = v_t;
  exception when sqlstate 'P0001' then
    v_threw := true;
  end;
  if not v_threw then raise exception 'test 7 FAIL: direct update on ctgov-locked phase_type did not raise'; end if;
  raise notice 'test 7 ok: guard trigger blocks update on ctgov-locked phase_type';

  -- ===== test 8: guard trigger allows no-op update (same value) on ctgov-locked field
  v_threw := false;
  begin
    update public.trials set phase_type = 'P2' where id = v_t;
  exception when sqlstate 'P0001' then v_threw := true;
  end;
  if v_threw then raise exception 'test 8 FAIL: no-op update on ctgov-locked field was rejected'; end if;
  raise notice 'test 8 ok: guard trigger allows no-op update';

  -- ===== test 9: guard trigger does not block updates to other columns on ctgov-locked trial
  v_threw := false;
  begin
    update public.trials set notes = 'guard test' where id = v_t;
  exception when others then v_threw := true;
  end;
  if v_threw then raise exception 'test 9 FAIL: guard trigger blocked unrelated column update'; end if;
  raise notice 'test 9 ok: guard trigger does not block unrelated columns';

  -- ===== test 10: analyst-source field is editable via direct UPDATE
  perform set_config('clint.materialize_in_progress', 'on', true);
  update public.trials
     set phase_type = 'OBS', phase_type_source = 'analyst'
   where id = v_t;
  perform set_config('clint.materialize_in_progress', 'off', true);

  v_threw := false;
  begin
    update public.trials set phase_type = 'P4', phase_type_source = 'analyst' where id = v_t;
  exception when others then v_threw := true;
  end;
  if v_threw then raise exception 'test 10 FAIL: update on analyst-source field was rejected'; end if;
  raise notice 'test 10 ok: analyst-source field is editable';

  -- ===== test 11: payload structure includes field/old_value/new_value/old_source
  delete from public.trial_change_events where trial_id = v_t;
  -- restore to ctgov P3 first, then change
  perform public._materialize_trial_from_snapshot(v_t, v_payload_p3);
  delete from public.trial_change_events where trial_id = v_t;
  perform public._materialize_trial_from_snapshot(v_t, v_payload_p2);

  select payload into v_phase_type from public.trial_change_events where trial_id = v_t and event_type = 'phase_changed';
  -- check all four keys are present
  if v_phase_type::jsonb ->> 'field'      <> 'phase_type' then raise exception 'test 11 FAIL: payload.field'; end if;
  if v_phase_type::jsonb ->> 'old_value'  is null         then raise exception 'test 11 FAIL: payload.old_value missing'; end if;
  if v_phase_type::jsonb ->> 'new_value'  is null         then raise exception 'test 11 FAIL: payload.new_value missing'; end if;
  if v_phase_type::jsonb ? 'old_source'  is not true     then raise exception 'test 11 FAIL: payload.old_source key missing'; end if;
  raise notice 'test 11 ok: event payload has field / old_value / new_value / old_source';

  -- cleanup
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;

  raise notice 'trial_phase_ctgov_truth smoke test: PASS';
end$$;
