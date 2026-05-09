-- migration: 20260509120100_advisor_sweep_function_search_path
-- purpose: clear all 9 `function_search_path_mutable` warnings reported by
--   the Supabase advisor (Splinter rule 0011). every flagged function lacks
--   an explicit `set search_path` clause, which means the search path is
--   inherited from the caller and the function can be tricked into resolving
--   to an attacker-controlled schema if one is ever prepended.
--
-- approach: each function's body uses only pg_catalog built-ins or already-
--   qualified `public.*` references; none reference an unqualified user
--   table. so the fix is purely a `set search_path = ''` clause on each
--   function. body bytes are reproduced verbatim from the originating
--   migrations to keep `pg_get_functiondef` diffs auditable.
--
-- originating migrations:
--   20260428220000_member_self_protection_guards.sql
--     - public.member_guard_mark_cascade_start
--     - public.member_guard_mark_cascade_end
--   20260502120400_ctgov_helper_functions.sql
--     - public._map_phase_array
--     - public._path_in_hinted_modules
--     - public._compute_field_diffs
--     - public._classify_change
--   20260503050000_derive_phase_type_from_ctgov.sql
--     - public._safe_iso_date
--     - public._derive_phase_type
--     - public._derive_status

-- =============================================================================
-- member_guard_mark_cascade_start / end
-- =============================================================================
create or replace function public.member_guard_mark_cascade_start()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('clint.member_guard_cascade', 'on', true);
  return null;
end;
$$;

create or replace function public.member_guard_mark_cascade_end()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('clint.member_guard_cascade', 'off', true);
  return null;
end;
$$;

-- =============================================================================
-- _map_phase_array
-- =============================================================================
create or replace function public._map_phase_array(p_phases jsonb)
returns text
language plpgsql
immutable
set search_path = ''
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

-- =============================================================================
-- _path_in_hinted_modules
-- =============================================================================
create or replace function public._path_in_hinted_modules(
  p_field_path   text,
  p_module_hints text[]
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1
      from unnest(string_to_array(p_field_path, '.')) as seg
     where seg = any(p_module_hints)
  );
$$;

-- =============================================================================
-- _compute_field_diffs
-- =============================================================================
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
set search_path = ''
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

-- =============================================================================
-- _classify_change
-- =============================================================================
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
set search_path = ''
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
  if p_field_path = 'protocolSection.armsInterventionsModule.armGroups' then
    select coalesce(array_agg(elem ->> 'label'), array[]::text[])
      into v_old_labels
      from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) elem;
    select coalesce(array_agg(elem ->> 'label'), array[]::text[])
      into v_new_labels
      from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) elem;

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

    select coalesce(jsonb_agg(elem), '[]'::jsonb)
      into v_added
      from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) elem
     where not ((elem ->> 'measure') = any(v_old_keys));

    select coalesce(jsonb_agg(elem), '[]'::jsonb)
      into v_removed
      from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) elem
     where not ((elem ->> 'measure') = any(v_new_keys));

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
end;
$$;

-- =============================================================================
-- _safe_iso_date
-- =============================================================================
create or replace function public._safe_iso_date(p_text text)
returns date
language sql
immutable
set search_path = ''
as $$
  select case when p_text ~ '^\d{4}-\d{2}-\d{2}$' then p_text::date else null end;
$$;

-- =============================================================================
-- _derive_phase_type
-- =============================================================================
create or replace function public._derive_phase_type(
  p_phases     jsonb,
  p_study_type text
) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_arr      text[];
  v_distinct text[];
  v_max      text;
begin
  if p_phases is null or jsonb_typeof(p_phases) <> 'array' then
    return null;
  end if;

  select array_agg(value::text) into v_arr from jsonb_array_elements_text(p_phases);
  if v_arr is null or array_length(v_arr, 1) is null then
    return null;
  end if;

  if v_arr = array['NA'] then
    if p_study_type = 'OBSERVATIONAL' then
      return 'OBS';
    end if;
    return null;
  end if;

  select array_agg(distinct
    case raw
      when 'EARLY_PHASE1' then 'PHASE1'
      when 'PHASE1'       then 'PHASE1'
      when 'PHASE2'       then 'PHASE2'
      when 'PHASE3'       then 'PHASE3'
      when 'PHASE4'       then 'PHASE4'
      when 'NA'           then null
      else null
    end
  ) into v_distinct
  from unnest(v_arr) as raw;

  v_distinct := array_remove(v_distinct, null);
  if v_distinct is null or array_length(v_distinct, 1) is null then
    return null;
  end if;

  select max(p) into v_max from unnest(v_distinct) as p;

  return case v_max
    when 'PHASE1' then 'P1'
    when 'PHASE2' then 'P2'
    when 'PHASE3' then 'P3'
    when 'PHASE4' then 'P4'
    else null
  end;
end;
$$;

-- =============================================================================
-- _derive_status
-- =============================================================================
create or replace function public._derive_status(p_overall_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_overall_status
    when 'NOT_YET_RECRUITING'        then 'Planned'
    when 'RECRUITING'                then 'Active'
    when 'ACTIVE_NOT_RECRUITING'     then 'Active'
    when 'ENROLLING_BY_INVITATION'   then 'Active'
    when 'COMPLETED'                 then 'Completed'
    when 'SUSPENDED'                 then 'Terminated'
    when 'TERMINATED'                then 'Terminated'
    when 'WITHDRAWN'                 then 'Withdrawn'
    else null
  end;
$$;
