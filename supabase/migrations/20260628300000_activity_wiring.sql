-- migration: 20260628300000_activity_wiring
-- purpose: Task CA -- restore the Activity-feed emission (CT.gov date-moves +
--   analyst event edits) into public.trial_change_events that was lost when C1
--   retired the marker-audit trigger.
--
-- Background. The Activity feed (get_activity_feed) reads trial_change_events
-- (joined to events via ce.event_id). event_changes is a SEPARATE per-event
-- change log, NOT the Activity source. In the marker era there were two
-- date_moved emitters: _classify_change (inside ingest_ctgov_snapshot) and the
-- marker UPSERT audit trigger. A de-dup deliberately SUPPRESSED _classify_change
-- for the three CT.gov date fields so the marker audit became the single
-- emitter (spec A3). Phase B / task C1 retired that marker audit trigger, but
-- _classify_change still defers those fields, so NO producer emits date_moved
-- for a CT.gov date change in the event model. This migration closes two gaps:
--
-- Gap (a): un-suppress _classify_change for startDateStruct.date /
--   primaryCompletionDateStruct.date / completionDateStruct.date so a CT.gov
--   date drift emits a date_moved row again. ingest_ctgov_snapshot already
--   inserts whatever _classify_change returns into trial_change_events
--   (source='ctgov', event_id null, derived_from_change_id set), so this is the
--   whole fix on the CT.gov side. The emit block is partial-date safe
--   (_safe_iso_date returns null for non-YYYY-MM-DD; days_diff/direction fall to
--   null while the raw from/to strings are still emitted) -- identical to the
--   pre-C1 emit shape (migration 20260625180000). All other branches are
--   reproduced byte-identical from the live body.
--
-- Gap (b): emit an analyst Activity row from update_event. update_event is the
--   analyst edit RPC; it has no frontend caller today, but the Stage 3 merged
--   Event form edits through it, so emitting HERE (not via a trigger on events)
--   is forward-correct and avoids the seed-interaction risk a trigger carries
--   (the seed producers do bulk inline inserts/updates, NOT update_event -- a
--   trigger would pollute the demo Activity feed). update_event now captures the
--   old event_date / anchor / space BEFORE the UPDATE and, when the event is
--   trial-anchored, inserts ONE trial_change_events row AFTER the UPDATE
--   (source='analyst', event_id=p_event_id), event_type 'date_moved' when the
--   date moved else 'event_edited'. All existing guards + the UPDATE are
--   byte-identical; the signature is unchanged.
--
-- date_moved payload shape: matches the frontend renderer
--   (src/client/src/app/shared/utils/change-event-summary.ts, the date_moved
--   branch) which reads which_date / from / to / days_diff / direction. For the
--   analyst event edit which_date='event_date' (the renderer's event-level
--   branch); for CT.gov which_date is start / primary_completion /
--   study_completion (the TRIAL_DATE_LABEL keys).
--
-- DOCUMENTED LIMITATION. The current manage marker inline-edit path
-- (marker.service.update -> inline .from('events').update) does NOT go through
-- update_event, so those edits will NOT emit an Activity row until Stage 3
-- routes all edits through update_event / the merged form. This is acceptable
-- for the cutover. Likewise, Activity is trial-scoped (trial_change_events.
-- trial_id is NOT NULL): update_event does NOT emit for company- or
-- asset-anchored event edits in v1.
--
-- security: _classify_change stays STABLE, search_path='' (calls schema-
--   qualified). update_event stays SECURITY DEFINER, search_path='public'.

-- =============================================================================
-- Gap (a): _classify_change -- un-suppress the three CT.gov date fields.
-- Reproduced from the live body; ONLY the startDateStruct/primaryCompletion/
-- completion date branch changed (suppression -> emit). Every other branch is
-- byte-identical.
-- =============================================================================
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
  -- Un-suppressed (task CA): the marker-audit date_moved emitter was retired in
  -- C1, so _classify_change is once again the single date_moved emitter for the
  -- three CT.gov registry dates. ingest_ctgov_snapshot inserts this row into
  -- trial_change_events (source='ctgov'). Partial-safe: _safe_iso_date returns
  -- null for non-YYYY-MM-DD values (e.g. "2026-04", "2026") instead of raising
  -- 22007, and the days_diff/direction fall to null while the raw from/to
  -- strings are still emitted.
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
-- Gap (b): update_event -- emit an analyst Activity row on a trial-anchored
-- event edit. Reproduced from the live body; the guards + the UPDATE are
-- byte-identical. Added: capture-before locals + the AFTER-UPDATE insert.
-- =============================================================================
create or replace function public.update_event(
  p_event_id uuid,
  p_title text,
  p_event_date date,
  p_projection text,
  p_date_precision text,
  p_end_date date,
  p_end_date_precision text,
  p_is_ongoing boolean,
  p_description text,
  p_source_url text,
  p_significance text,
  p_visibility text,
  p_no_longer_expected boolean
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_space          uuid;
  v_old_event_date date;
  v_anchor_type    text;
  v_anchor_id      uuid;
  v_old_title      text;
  v_old_description text;
  v_event_type     text;
begin
  -- capture-before: read the old row's space + the fields the Activity emit
  -- needs (event_date / anchor / title / description) in a single lookup.
  select space_id, event_date, anchor_type, anchor_id, title, description
    into v_space, v_old_event_date, v_anchor_type, v_anchor_id, v_old_title, v_old_description
    from public.events where id = p_event_id;
  if v_space is null then raise exception 'event not found' using errcode = 'P0002'; end if;
  if not public.has_space_access(v_space, array['owner','editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_is_ongoing and p_end_date is not null then
    raise exception 'an ongoing event cannot have an end date' using errcode = '22023';
  end if;
  update public.events set
    title = p_title, event_date = p_event_date, projection = p_projection, date_precision = p_date_precision,
    end_date = p_end_date, end_date_precision = p_end_date_precision, is_ongoing = p_is_ongoing,
    description = p_description, source_url = p_source_url, significance = p_significance,
    visibility = p_visibility, no_longer_expected = p_no_longer_expected
  where id = p_event_id;

  -- Activity emit (task CA gap b). trial_change_events is the Activity-feed
  -- source and trial_id is NOT NULL, so we emit ONLY for trial-anchored events.
  -- LIMITATION: company-/asset-anchored event edits do not reach Activity in
  -- v1, and the manage marker inline-edit path (which does NOT call this RPC)
  -- emits nothing until Stage 3 routes all edits through update_event.
  if v_anchor_type = 'trial' and v_anchor_id is not null
     and (v_old_event_date is distinct from p_event_date
          or v_old_title is distinct from p_title
          or v_old_description is distinct from p_description) then
    v_event_type := case when v_old_event_date is distinct from p_event_date
                         then 'date_moved' else 'event_edited' end;
    insert into public.trial_change_events
      (trial_id, space_id, event_type, source, payload, occurred_at, event_id)
    values (
      v_anchor_id,
      v_space,
      v_event_type,
      'analyst',
      case when v_event_type = 'date_moved'
           then jsonb_build_object(
             'which_date', 'event_date',
             'from',       v_old_event_date,
             'to',         p_event_date,
             'days_diff',  case when v_old_event_date is not null and p_event_date is not null
                                then p_event_date - v_old_event_date else null end,
             'direction',  case when v_old_event_date is null or p_event_date is null then null
                                when p_event_date > v_old_event_date then 'slip'
                                when p_event_date < v_old_event_date then 'accelerate'
                                else 'none' end
           )
           else jsonb_build_object('title', p_title)
      end,
      now(),
      p_event_id
    );
  end if;
end;
$function$;

-- =============================================================================
-- smoke: prod-safe, data-conditional, self-cleaning. A scratch trial-anchored
-- event edited via update_event must yield exactly one analyst date_moved
-- trial_change_events row; clean up after. Runs only when the demo space and a
-- usable owner are present (absent locally -> prod-safe skip, like every
-- A/S/C-phase smoke).
-- =============================================================================
do $$
declare
  v_space    uuid := '00000000-0000-0000-0000-0000000d0100';
  v_uid      uuid;
  v_asset    uuid;
  v_company  uuid;
  v_trial    uuid;
  v_event    uuid;
  v_type     uuid;
  v_rows     int;
  v_etype    text;
begin
  if not exists (select 1 from public.spaces where id = v_space) then
    raise notice 'CA smoke: demo space absent (prod-safe skip)';
    return;
  end if;
  select user_id into v_uid from public.space_members
    where space_id = v_space and role = 'owner' limit 1;
  if v_uid is null then
    raise notice 'CA smoke: no owner for demo space (prod-safe skip)';
    return;
  end if;
  select id into v_type from public.event_types where space_id is null limit 1;

  insert into public.companies (space_id, name, created_by)
    values (v_space, 'CA Smoke Co', v_uid) returning id into v_company;
  insert into public.assets (space_id, company_id, name, created_by)
    values (v_space, v_company, 'CA Smoke Asset', v_uid) returning id into v_asset;
  insert into public.trials (space_id, asset_id, name, created_by)
    values (v_space, v_asset, 'CA Smoke Trial', v_uid) returning id into v_trial;
  insert into public.events
    (space_id, event_type_id, title, event_date, anchor_type, anchor_id, created_by, metadata)
    values (v_space, v_type, 'CA Smoke Event', '2026-01-01', 'trial', v_trial, v_uid,
            jsonb_build_object('source','analyst'))
    returning id into v_event;

  -- edit the date through the RPC body (call directly; the RPC's has_space_access
  -- guard is exercised by the integration spec, not this superuser smoke).
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform public.update_event(
    v_event, 'CA Smoke Event', '2026-03-01', 'actual', 'exact',
    null, 'exact', false, null, null, null, null, false
  );

  select count(*), max(event_type) into v_rows, v_etype
    from public.trial_change_events
   where event_id = v_event and source = 'analyst';
  if v_rows <> 1 then
    raise exception 'CA smoke: expected 1 analyst change-event, got %', v_rows;
  end if;
  if v_etype <> 'date_moved' then
    raise exception 'CA smoke: expected date_moved, got %', v_etype;
  end if;

  -- cleanup (re-runnable): change-events cascade on trial delete, but delete
  -- explicitly first to avoid the events_audit BEFORE DELETE ordering hazard.
  delete from public.trial_change_events where event_id = v_event;
  delete from public.events where id = v_event;
  delete from public.trials where id = v_trial;
  delete from public.assets where id = v_asset;
  delete from public.companies where id = v_company;
  raise notice 'CA smoke: PASS';
end$$;

notify pgrst, 'reload schema';
