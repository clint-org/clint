-- migration: 20260625120000_classify_change_safe_partial_dates
-- purpose: stop ct.gov partial dates (e.g. "2026-04", "2026") from crashing the
--   daily sync. _classify_change cast the old/new values of a date-struct diff
--   with a raw ::date inside the date_moved branch:
--       v_old_date := nullif(p_old #>> '{}', '')::date;
--       v_new_date := nullif(p_new #>> '{}', '')::date;
--   ct.gov routinely emits month-precision dates for startDateStruct /
--   primaryCompletionDateStruct / completionDateStruct. A partial like "2026-04"
--   raises 22007 (invalid input syntax for type date), which aborts the whole
--   ingest_ctgov_snapshot transaction. The worker logs it as a per-trial 400 and
--   the run lands at status=partial. This recurred every day for any trial whose
--   completion date is month-precision (observed: NCT05929066).
--
-- fix: use the existing public._safe_iso_date() helper, which returns null for
--   anything that is not a full YYYY-MM-DD. The date_moved branch already handles
--   null v_old_date / v_new_date (days_diff and direction fall to null while the
--   raw from/to strings are still emitted), so a partial now produces a valid
--   date_moved event instead of crashing.
--
-- scope: only the two casts in the date_moved branch change. The rest of the
--   function is reproduced verbatim from the live definition so CREATE OR REPLACE
--   keeps every other classification intact.
--
-- security: SECURITY INVOKER STABLE, set search_path = '' (unchanged). Calls are
--   schema-qualified (public._safe_iso_date) because of the empty search_path.

create or replace function public._classify_change(
  p_field_path text,
  p_old jsonb,
  p_new jsonb,
  p_occurred_at timestamptz default now()
)
returns table(event_type text, payload jsonb, occurred_at timestamptz)
language plpgsql
stable
set search_path = ''
as $function$
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
    -- partial-safe: _safe_iso_date returns null for non-YYYY-MM-DD values
    -- (e.g. "2026-04", "2026") instead of raising 22007.
    v_old_date  := public._safe_iso_date(p_old #>> '{}');
    v_new_date  := public._safe_iso_date(p_new #>> '{}');
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
$function$;

-- =============================================================================
-- smoke test: the date_moved branch must tolerate partial dates.
-- =============================================================================
do $$
declare
  v_rec   record;
  v_count int;
begin
  -- case 1: partial old ("2026-04") + full new must NOT raise, must emit
  -- date_moved with days_diff null (we cannot compute days from a partial).
  select event_type, payload into v_rec
    from public._classify_change(
      'protocolSection.statusModule.primaryCompletionDateStruct.date',
      '"2026-04"'::jsonb,
      '"2026-05-01"'::jsonb,
      '2026-06-01T00:00:00Z'::timestamptz
    );
  if v_rec.event_type <> 'date_moved' then
    raise exception 'classify partial-date smoke: expected date_moved, got %', v_rec.event_type;
  end if;
  if v_rec.payload ->> 'days_diff' is not null then
    raise exception 'classify partial-date smoke: expected null days_diff for partial old, got %', v_rec.payload ->> 'days_diff';
  end if;
  if v_rec.payload ->> 'from' <> '2026-04' or v_rec.payload ->> 'to' <> '2026-05-01' then
    raise exception 'classify partial-date smoke: raw from/to not preserved, got % -> %',
      v_rec.payload ->> 'from', v_rec.payload ->> 'to';
  end if;

  -- case 2: both partial ("2026" -> "2026-07") must not raise either.
  select count(*) into v_count
    from public._classify_change(
      'protocolSection.statusModule.completionDateStruct.date',
      '"2026"'::jsonb,
      '"2026-07"'::jsonb,
      now()
    );
  if v_count <> 1 then
    raise exception 'classify partial-date smoke: both-partial should still emit 1 date_moved, got %', v_count;
  end if;

  -- case 3: full -> full still computes days_diff + direction (regression guard).
  select event_type, payload into v_rec
    from public._classify_change(
      'protocolSection.statusModule.primaryCompletionDateStruct.date',
      '"2026-04-01"'::jsonb,
      '"2026-04-11"'::jsonb,
      now()
    );
  if (v_rec.payload ->> 'days_diff')::int <> 10 then
    raise exception 'classify partial-date smoke: expected days_diff=10 for full dates, got %', v_rec.payload ->> 'days_diff';
  end if;
  if v_rec.payload ->> 'direction' <> 'slip' then
    raise exception 'classify partial-date smoke: expected direction=slip, got %', v_rec.payload ->> 'direction';
  end if;

  raise notice '_classify_change partial-date smoke test: PASS';
end$$;
