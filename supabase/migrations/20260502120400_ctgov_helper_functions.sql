-- migration: 20260502120400_ctgov_helper_functions
-- purpose: define the five plpgsql helpers that drive the ct.gov ingest
--   pipeline (snapshot -> diff -> classified events). these are pure
--   building blocks: ingest_ctgov_snapshot (Task 1.6) calls them in
--   sequence, and recompute_trial_change_events (Task 1.9) replays diffs
--   from snapshots when the watch list or classifier changes.
--
-- functions, in dependency order:
--   1. _map_phase_array(jsonb) -> text          (helper for #2)
--   2. _materialize_trial_from_snapshot(uuid, jsonb) -> void
--   3. _path_in_hinted_modules(text, text[]) -> boolean (helper for #4)
--   4. _compute_field_diffs(jsonb, jsonb, text[]) -> setof(field_path, ...)
--   5. _classify_change(text, jsonb, jsonb) -> setof(event_type, ...)
--
-- the ct.gov watch list (15 paths) and classifier rules live in
--   docs/superpowers/specs/2026-05-02-trial-change-feed-design.md under
--   "Helper functions" / "Event taxonomy". see that spec when adding new
--   paths or event types; this file is the canonical implementation.

-- =============================================================================
-- 1. _map_phase_array: ports mapPhase() from ctgov-sync.service.ts.
--    NULL or empty input returns NULL. otherwise joins enums with '/'
--    and replaces each known token with its human-readable form. ordering
--    matters: EARLY_PHASE1 must run before PHASE1 so the prefix wins.
--
create or replace function public._map_phase_array(p_phases jsonb)
returns text
language plpgsql
immutable
as $$
declare
  v_arr   text[];
  v_joined text;
begin
  if p_phases is null or jsonb_typeof(p_phases) <> 'array' then
    return null;
  end if;

  select array_agg(value::text)
    into v_arr
    from jsonb_array_elements_text(p_phases);

  if v_arr is null or array_length(v_arr, 1) is null then
    return null;
  end if;

  v_joined := array_to_string(v_arr, '/');
  v_joined := replace(v_joined, 'EARLY_PHASE1', 'Early Phase 1');
  v_joined := replace(v_joined, 'PHASE1', 'Phase 1');
  v_joined := replace(v_joined, 'PHASE2', 'Phase 2');
  v_joined := replace(v_joined, 'PHASE3', 'Phase 3');
  v_joined := replace(v_joined, 'PHASE4', 'Phase 4');
  v_joined := replace(v_joined, 'NA', 'N/A');
  return v_joined;
end;
$$;

comment on function public._map_phase_array(jsonb) is
  'Converts a ct.gov phases array (e.g. ["PHASE2","PHASE3"]) to the human-readable string stored in trials.phase (e.g. "Phase 2/Phase 3"). Ports mapPhase from ctgov-sync.service.ts. NULL or empty array returns NULL.';

-- =============================================================================
-- 2. _materialize_trial_from_snapshot: applies the ct.gov-owned subset of
--    fields from a snapshot payload onto the trials row. ONE partial
--    UPDATE; coalesce keeps the existing value when a path is missing.
--    NEVER touches analyst-owned columns (name, notes, display_order,
--    product_id, therapeutic_area_id, phase_type, phase_start_date,
--    phase_end_date). called only by ingest_ctgov_snapshot.
--
create or replace function public._materialize_trial_from_snapshot(
  p_trial_id uuid,
  p_payload  jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase            text;
  v_recruitment      text;
  v_study_type       text;
  v_last_update_date date;
begin
  v_phase            := public._map_phase_array(p_payload #> '{protocolSection,designModule,phases}');
  v_recruitment      := p_payload #>> '{protocolSection,statusModule,overallStatus}';
  v_study_type       := p_payload #>> '{protocolSection,designModule,studyType}';
  v_last_update_date := nullif(p_payload #>> '{protocolSection,statusModule,lastUpdatePostDateStruct,date}', '')::date;

  update public.trials
     set phase                   = coalesce(v_phase, phase),
         recruitment_status      = coalesce(v_recruitment, recruitment_status),
         study_type              = coalesce(v_study_type, study_type),
         last_update_posted_date = coalesce(v_last_update_date, last_update_posted_date),
         ctgov_last_synced_at    = now()
   where id = p_trial_id;
end;
$$;

revoke execute on function public._materialize_trial_from_snapshot(uuid, jsonb) from public;

comment on function public._materialize_trial_from_snapshot(uuid, jsonb) is
  'Applies the ct.gov-owned subset of a snapshot payload onto trials via one partial UPDATE. coalesce(derived, existing) keeps prior values when a path is missing. Never touches analyst-owned columns. Called by ingest_ctgov_snapshot.';

-- =============================================================================
-- 3. _path_in_hinted_modules: returns true when any element of
--    p_module_hints appears as a dot-segment in p_field_path. used by
--    _compute_field_diffs to skip paths whose containing module is not in
--    the ct.gov-supplied moduleLabels hints.
--
create or replace function public._path_in_hinted_modules(
  p_field_path   text,
  p_module_hints text[]
) returns boolean
language sql
immutable
as $$
  select exists (
    select 1
      from unnest(string_to_array(p_field_path, '.')) as seg
     where seg = any(p_module_hints)
  );
$$;

comment on function public._path_in_hinted_modules(text, text[]) is
  'Returns true when any element of p_module_hints matches a dot-segment of p_field_path. Used to skip diff paths whose containing module is not in the ct.gov-supplied moduleLabels hints.';

-- =============================================================================
-- 4. _compute_field_diffs: walks the curated 15-path watch list, returns
--    one row per path that differs between p_old and p_new. when
--    p_module_hints is non-null, paths whose module is not in the hint
--    set are skipped (a small CPU optimization for partial-update fetches
--    coming through /api/int/).
--
create or replace function public._compute_field_diffs(
  p_old          jsonb,
  p_new          jsonb,
  p_module_hints text[] default null
) returns table (
  field_path text,
  old_value  jsonb,
  new_value  jsonb
)
language plpgsql
immutable
as $$
declare
  v_paths text[] := array[
    'protocolSection.statusModule.overallStatus',
    'protocolSection.statusModule.startDateStruct.date',
    'protocolSection.statusModule.primaryCompletionDateStruct.date',
    'protocolSection.statusModule.completionDateStruct.date',
    'protocolSection.designModule.phases',
    'protocolSection.designModule.enrollmentInfo.count',
    'protocolSection.armsInterventionsModule.armGroups',
    'protocolSection.armsInterventionsModule.interventions',
    'protocolSection.outcomesModule.primaryOutcomes',
    'protocolSection.outcomesModule.secondaryOutcomes',
    'protocolSection.sponsorCollaboratorsModule.leadSponsor.name',
    'protocolSection.eligibilityModule.eligibilityCriteria',
    'protocolSection.eligibilityModule.sex',
    'protocolSection.eligibilityModule.minimumAge',
    'protocolSection.eligibilityModule.maximumAge'
  ];
  v_path text;
  v_keys text[];
  v_old  jsonb;
  v_new  jsonb;
begin
  foreach v_path in array v_paths loop
    if p_module_hints is not null
       and not public._path_in_hinted_modules(v_path, p_module_hints) then
      continue;
    end if;

    v_keys := string_to_array(v_path, '.');
    v_old  := p_old #> v_keys;
    v_new  := p_new #> v_keys;

    if v_old is distinct from v_new then
      field_path := v_path;
      old_value  := v_old;
      new_value  := v_new;
      return next;
    end if;
  end loop;
end;
$$;

revoke execute on function public._compute_field_diffs(jsonb, jsonb, text[]) from public;

comment on function public._compute_field_diffs(jsonb, jsonb, text[]) is
  'Iterates the 15-path ct.gov watch list and emits one row per path that differs between p_old and p_new. p_module_hints (optional) skips paths whose containing module is not in the hint set.';

-- =============================================================================
-- 5. _classify_change: turns one field-level diff into 0..N typed events.
--    one row out per logical event; multi-row for arms/interventions/
--    outcome-measures because each added/removed/modified entry is its
--    own user-visible event. occurred_at is supplied by the caller via
--    p_occurred_at (defaulting to now() for ad-hoc invocations); the
--    ingest RPC (Task 1.6) and recompute RPC (Task 1.9) pass the
--    snapshot's last_update_post_date so events line up with the source
--    of truth instead of wall-clock time at ingest.
--
--    payload shapes match the spec's "Event taxonomy" tables exactly.
--    arrays of objects (armGroups, interventions, outcomes) are matched
--    by their natural key: armGroups -> label, interventions -> name,
--    outcomes -> measure. natural-key matching means null-keyed entries
--    cannot be matched symmetrically and intentionally produce no events
--    on either side.
--
create or replace function public._classify_change(
  p_field_path  text,
  p_old         jsonb,
  p_new         jsonb,
  p_occurred_at timestamptz default now()
) returns table (
  event_type  text,
  payload     jsonb,
  occurred_at timestamptz
)
language plpgsql
stable
as $$
declare
  v_old_date  date;
  v_new_date  date;
  v_days_diff int;
  v_direction text;
  v_which     text;
  v_old_count numeric;
  v_new_count numeric;
  v_pct       numeric;
  v_arm       jsonb;
  v_intv      jsonb;
  v_outcome   jsonb;
  v_outcome_kind text;
  v_old_labels text[];
  v_new_labels text[];
  v_old_names  text[];
  v_new_names  text[];
  v_old_keys   text[];
  v_new_keys   text[];
  v_added      jsonb;
  v_removed    jsonb;
  v_modified   jsonb;
begin
  -- statusModule.overallStatus -> status_changed
  if p_field_path = 'protocolSection.statusModule.overallStatus' then
    event_type  := 'status_changed';
    payload     := jsonb_build_object(
      'from', case when p_old is null then null::text else p_old #>> '{}' end,
      'to',   case when p_new is null then null::text else p_new #>> '{}' end
    );
    occurred_at := p_occurred_at;
    return next;
    return;
  end if;

  -- statusModule.{start|primaryCompletion|completion}DateStruct.date -> date_moved
  if p_field_path in (
       'protocolSection.statusModule.startDateStruct.date',
       'protocolSection.statusModule.primaryCompletionDateStruct.date',
       'protocolSection.statusModule.completionDateStruct.date'
  ) then
    v_which := case p_field_path
                 when 'protocolSection.statusModule.startDateStruct.date'              then 'start'
                 when 'protocolSection.statusModule.primaryCompletionDateStruct.date' then 'primary_completion'
                 when 'protocolSection.statusModule.completionDateStruct.date'        then 'study_completion'
               end;
    v_old_date  := nullif(p_old #>> '{}', '')::date;
    v_new_date  := nullif(p_new #>> '{}', '')::date;
    -- If either side is null or unparseable, days_diff and direction are
    -- emitted as null. Downstream consumers filtering on days_diff > N
    -- should handle null explicitly.
    if v_old_date is not null and v_new_date is not null then
      v_days_diff := v_new_date - v_old_date;
      v_direction := case when v_days_diff > 0 then 'slip' else 'accelerate' end;
    else
      v_days_diff := null;
      v_direction := null;
    end if;
    event_type  := 'date_moved';
    payload     := jsonb_build_object(
      'which_date', v_which,
      'from',       p_old #>> '{}',
      'to',         p_new #>> '{}',
      'days_diff',  v_days_diff,
      'direction',  v_direction
    );
    occurred_at := p_occurred_at;
    return next;
    return;
  end if;

  -- designModule.phases -> phase_transitioned
  if p_field_path = 'protocolSection.designModule.phases' then
    event_type  := 'phase_transitioned';
    payload     := jsonb_build_object(
      'from', coalesce(p_old, '[]'::jsonb),
      'to',   coalesce(p_new, '[]'::jsonb)
    );
    occurred_at := p_occurred_at;
    return next;
    return;
  end if;

  -- designModule.enrollmentInfo.count -> enrollment_target_changed
  if p_field_path = 'protocolSection.designModule.enrollmentInfo.count' then
    v_old_count := case when p_old is null then null else (p_old #>> '{}')::numeric end;
    v_new_count := case when p_new is null then null else (p_new #>> '{}')::numeric end;
    if v_old_count is not null and v_old_count <> 0 and v_new_count is not null then
      v_pct := round(((v_new_count - v_old_count) / v_old_count) * 100, 2);
    else
      v_pct := null;
    end if;
    event_type  := 'enrollment_target_changed';
    payload     := jsonb_build_object(
      'from',           v_old_count,
      'to',             v_new_count,
      'percent_change', v_pct
    );
    occurred_at := p_occurred_at;
    return next;
    return;
  end if;

  -- armsInterventionsModule.armGroups -> arm_added / arm_removed
  -- compare by 'label'; one row per added arm and one per removed arm.
  -- Assumes labels are unique within the array. Duplicate keys produce
  -- undefined add/remove ordering. CT.gov v2 does not allow duplicates
  -- in practice. Null-keyed entries are skipped on both sides since
  -- they cannot be matched symmetrically.
  if p_field_path = 'protocolSection.armsInterventionsModule.armGroups' then
    select coalesce(array_agg(elem ->> 'label'), array[]::text[])
      into v_old_labels
      from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) elem;
    select coalesce(array_agg(elem ->> 'label'), array[]::text[])
      into v_new_labels
      from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) elem;

    -- arm_added: present in new, missing in old
    for v_arm in
      select elem
        from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) elem
       where not ((elem ->> 'label') = any(v_old_labels))
    loop
      event_type  := 'arm_added';
      payload     := jsonb_build_object(
        'arm_label',   v_arm ->> 'label',
        'arm_type',    v_arm ->> 'type',
        'description', v_arm ->> 'description'
      );
      occurred_at := p_occurred_at;
      return next;
    end loop;

    -- arm_removed: present in old, missing in new
    for v_arm in
      select elem
        from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) elem
       where not ((elem ->> 'label') = any(v_new_labels))
    loop
      event_type  := 'arm_removed';
      payload     := jsonb_build_object(
        'arm_label', v_arm ->> 'label',
        'arm_type',  v_arm ->> 'type'
      );
      occurred_at := p_occurred_at;
      return next;
    end loop;
    return;
  end if;

  -- armsInterventionsModule.interventions -> intervention_changed
  -- one event with added/removed lists, matched by 'name'.
  -- Assumes names are unique within the array. Duplicate keys produce
  -- undefined add/remove ordering. CT.gov v2 does not allow duplicates
  -- in practice. Null-keyed entries are skipped on both sides since
  -- they cannot be matched symmetrically.
  if p_field_path = 'protocolSection.armsInterventionsModule.interventions' then
    select coalesce(array_agg(elem ->> 'name'), array[]::text[])
      into v_old_names
      from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) elem;
    select coalesce(array_agg(elem ->> 'name'), array[]::text[])
      into v_new_names
      from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) elem;

    select coalesce(jsonb_agg(jsonb_build_object('name', elem ->> 'name', 'type', elem ->> 'type')), '[]'::jsonb)
      into v_added
      from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) elem
     where not ((elem ->> 'name') = any(v_old_names));

    select coalesce(jsonb_agg(jsonb_build_object('name', elem ->> 'name', 'type', elem ->> 'type')), '[]'::jsonb)
      into v_removed
      from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) elem
     where not ((elem ->> 'name') = any(v_new_names));

    event_type  := 'intervention_changed';
    payload     := jsonb_build_object('added', v_added, 'removed', v_removed);
    occurred_at := p_occurred_at;
    return next;
    return;
  end if;

  -- outcomesModule.{primary|secondary}Outcomes -> outcome_measure_changed
  -- one event with added/removed/modified, matched by 'measure' (outcome label).
  -- Assumes measures are unique within the array. Duplicate keys produce
  -- undefined add/remove ordering. CT.gov v2 does not allow duplicates
  -- in practice. Null-keyed entries are skipped on both sides since
  -- they cannot be matched symmetrically.
  if p_field_path in (
       'protocolSection.outcomesModule.primaryOutcomes',
       'protocolSection.outcomesModule.secondaryOutcomes'
  ) then
    v_outcome_kind := case p_field_path
                        when 'protocolSection.outcomesModule.primaryOutcomes'   then 'primary'
                        when 'protocolSection.outcomesModule.secondaryOutcomes' then 'secondary'
                      end;

    select coalesce(array_agg(elem ->> 'measure'), array[]::text[])
      into v_old_keys
      from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) elem;
    select coalesce(array_agg(elem ->> 'measure'), array[]::text[])
      into v_new_keys
      from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) elem;

    -- added: in new, not in old
    select coalesce(jsonb_agg(elem), '[]'::jsonb)
      into v_added
      from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) elem
     where not ((elem ->> 'measure') = any(v_old_keys));

    -- removed: in old, not in new
    select coalesce(jsonb_agg(elem), '[]'::jsonb)
      into v_removed
      from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) elem
     where not ((elem ->> 'measure') = any(v_new_keys));

    -- modified: same measure, different other fields (description/timeFrame).
    select coalesce(jsonb_agg(jsonb_build_object('measure', n ->> 'measure', 'from', o, 'to', n)), '[]'::jsonb)
      into v_modified
      from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) n
      join jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) o
        on (n ->> 'measure') is not null and (n ->> 'measure') = (o ->> 'measure')
     where n is distinct from o;

    event_type  := 'outcome_measure_changed';
    payload     := jsonb_build_object(
      'outcome_kind', v_outcome_kind,
      'added',        v_added,
      'removed',      v_removed,
      'modified',     v_modified
    );
    occurred_at := p_occurred_at;
    return next;
    return;
  end if;

  -- sponsorCollaboratorsModule.leadSponsor.name -> sponsor_changed
  if p_field_path = 'protocolSection.sponsorCollaboratorsModule.leadSponsor.name' then
    event_type  := 'sponsor_changed';
    payload     := jsonb_build_object(
      'from', p_old #>> '{}',
      'to',   p_new #>> '{}'
    );
    occurred_at := p_occurred_at;
    return next;
    return;
  end if;

  -- eligibilityModule.eligibilityCriteria -> eligibility_criteria_changed
  if p_field_path = 'protocolSection.eligibilityModule.eligibilityCriteria' then
    event_type  := 'eligibility_criteria_changed';
    payload     := jsonb_build_object(
      'old_length', coalesce(length(p_old #>> '{}'), 0),
      'new_length', coalesce(length(p_new #>> '{}'), 0)
    );
    occurred_at := p_occurred_at;
    return next;
    return;
  end if;

  -- eligibilityModule.{sex|minimumAge|maximumAge} -> eligibility_changed
  if p_field_path in (
       'protocolSection.eligibilityModule.sex',
       'protocolSection.eligibilityModule.minimumAge',
       'protocolSection.eligibilityModule.maximumAge'
  ) then
    v_which := case p_field_path
                 when 'protocolSection.eligibilityModule.sex'        then 'sex'
                 when 'protocolSection.eligibilityModule.minimumAge' then 'minimum_age'
                 when 'protocolSection.eligibilityModule.maximumAge' then 'maximum_age'
               end;
    event_type  := 'eligibility_changed';
    payload     := jsonb_build_object(
      'which_field', v_which,
      'from',        p_old #>> '{}',
      'to',          p_new #>> '{}'
    );
    occurred_at := p_occurred_at;
    return next;
    return;
  end if;

  -- unknown path: emit nothing (caller already wrote the raw diff to
  -- trial_field_changes; events are best-effort interpretation).
end;
$$;

revoke execute on function public._classify_change(text, jsonb, jsonb, timestamptz) from public;

comment on function public._classify_change(text, jsonb, jsonb, timestamptz) is
  'Maps one ct.gov field-level diff to 0..N typed events. Multi-row for arms (one per added/removed). Payload shapes match the spec''s "Event taxonomy" tables. p_occurred_at stamps every emitted event; the ingest and recompute RPCs pass the snapshot last_update_post_date so events line up with the source of truth rather than wall-clock time at ingest. Stable: no side effects, output a pure function of inputs.';

-- =============================================================================
-- smoke tests: each helper exercised once. failures raise; happy paths
-- raise notice. behavioral test of materialize is deferred to the ingest
-- RPC's smoke test in Task 1.6 because building a valid trials fixture
-- inside a do block requires more FK chasing than the safety it buys
-- here; we settle for "function compiles + no error on no-op update".
--
do $$
declare
  v_diff_count       int;
  v_diff_path        text;
  v_class_count      int;
  v_class_type       text;
  v_class_payload    jsonb;
  v_class_occurred   timestamptz;
  v_phantom_id       uuid := gen_random_uuid();
begin
  -- helper 1: _map_phase_array
  if public._map_phase_array('["PHASE2","PHASE3"]'::jsonb) is distinct from 'Phase 2/Phase 3' then
    raise exception 'helper 1 FAIL: phase array mapping wrong, got %',
      public._map_phase_array('["PHASE2","PHASE3"]'::jsonb);
  end if;
  if public._map_phase_array(null) is not null then
    raise exception 'helper 1 FAIL: null input did not return null';
  end if;
  if public._map_phase_array('[]'::jsonb) is not null then
    raise exception 'helper 1 FAIL: empty array did not return null';
  end if;
  if public._map_phase_array('["EARLY_PHASE1"]'::jsonb) is distinct from 'Early Phase 1' then
    raise exception 'helper 1 FAIL: early phase 1 not mapped';
  end if;
  raise notice 'helper 1 ok: _map_phase_array';

  -- helper 2: _materialize_trial_from_snapshot (compile + no-op safety).
  -- using a phantom uuid: UPDATE matches 0 rows but raises no error.
  perform public._materialize_trial_from_snapshot(
    v_phantom_id,
    '{"protocolSection":{"statusModule":{"overallStatus":"COMPLETED"}}}'::jsonb
  );
  raise notice 'helper 2 ok: _materialize_trial_from_snapshot (no-op invocation, behavioral test deferred to Task 1.6)';

  -- helper 3: _path_in_hinted_modules
  if not public._path_in_hinted_modules(
       'protocolSection.statusModule.overallStatus',
       array['statusModule', 'designModule']
     ) then
    raise exception 'helper 3 FAIL: hint match should be true';
  end if;
  if public._path_in_hinted_modules(
       'protocolSection.statusModule.overallStatus',
       array['eligibilityModule']
     ) then
    raise exception 'helper 3 FAIL: hint mismatch should be false';
  end if;
  raise notice 'helper 3 ok: _path_in_hinted_modules';

  -- helper 4: _compute_field_diffs detects overallStatus change
  select count(*), max(field_path)
    into v_diff_count, v_diff_path
    from public._compute_field_diffs(
      '{"protocolSection":{"statusModule":{"overallStatus":"RECRUITING"}}}'::jsonb,
      '{"protocolSection":{"statusModule":{"overallStatus":"COMPLETED"}}}'::jsonb
    );
  if v_diff_count <> 1 then
    raise exception 'helper 4 FAIL: expected 1 diff row, got %', v_diff_count;
  end if;
  if v_diff_path <> 'protocolSection.statusModule.overallStatus' then
    raise exception 'helper 4 FAIL: wrong field_path %', v_diff_path;
  end if;
  -- module hint filter: same diff but hint excludes statusModule -> 0 rows
  select count(*)
    into v_diff_count
    from public._compute_field_diffs(
      '{"protocolSection":{"statusModule":{"overallStatus":"RECRUITING"}}}'::jsonb,
      '{"protocolSection":{"statusModule":{"overallStatus":"COMPLETED"}}}'::jsonb,
      array['eligibilityModule']
    );
  if v_diff_count <> 0 then
    raise exception 'helper 4 FAIL: module hint filter should suppress diff, got %', v_diff_count;
  end if;
  raise notice 'helper 4 ok: _compute_field_diffs';

  -- helper 5: _classify_change emits date_moved with days_diff=90, direction=slip
  select count(*) into v_class_count
    from public._classify_change(
      'protocolSection.statusModule.primaryCompletionDateStruct.date',
      to_jsonb('2027-01-01'::text),
      to_jsonb('2027-04-01'::text)
    );
  if v_class_count <> 1 then
    raise exception 'helper 5 FAIL: expected 1 event row, got %', v_class_count;
  end if;

  select event_type, payload
    into v_class_type, v_class_payload
    from public._classify_change(
      'protocolSection.statusModule.primaryCompletionDateStruct.date',
      to_jsonb('2027-01-01'::text),
      to_jsonb('2027-04-01'::text)
    )
   limit 1;
  if v_class_type <> 'date_moved' then
    raise exception 'helper 5 FAIL: expected date_moved, got %', v_class_type;
  end if;
  if v_class_payload ->> 'days_diff' <> '90' then
    raise exception 'helper 5 FAIL: expected days_diff=90, got %', v_class_payload ->> 'days_diff';
  end if;
  if v_class_payload ->> 'direction' <> 'slip' then
    raise exception 'helper 5 FAIL: expected direction=slip, got %', v_class_payload ->> 'direction';
  end if;
  if v_class_payload ->> 'which_date' <> 'primary_completion' then
    raise exception 'helper 5 FAIL: expected which_date=primary_completion, got %', v_class_payload ->> 'which_date';
  end if;

  -- helper 5b: explicit p_occurred_at is honored (instead of now())
  select occurred_at into v_class_occurred
    from public._classify_change(
      'protocolSection.statusModule.overallStatus',
      to_jsonb('RECRUITING'::text),
      to_jsonb('COMPLETED'::text),
      '2026-04-01 00:00:00+00'::timestamptz
    );
  if v_class_occurred is distinct from '2026-04-01 00:00:00+00'::timestamptz then
    raise exception 'helper 5 FAIL: p_occurred_at override not honored, got %', v_class_occurred;
  end if;
  raise notice 'helper 5 ok: _classify_change';

  raise notice 'ctgov helper functions smoke test: PASS';
end$$;
