-- migration: 20260510120200_seed_demo_activity_variety
-- purpose: emit one event of every supported event_type on a fresh demo space
--          so the Activity page renders the full variety after seed_demo_data().
--          Today the only events surfaced by seed_demo_data are the three slip
--          updates from _seed_demo_recent_activity (all date_moved with the
--          same shape), which makes the feed look monotonous and hides the row
--          renderer's other branches.
--
-- approach: direct inserts into trial_change_events with payload shapes that
--          exactly match what _classify_change (ctgov-side) and
--          _emit_events_from_marker_change (analyst-side) would produce. We
--          bypass the live classifiers because:
--            1. ctgov path requires writing prior snapshots and invoking
--               ingest_ctgov_snapshot, which would couple the demo to network
--               assumptions and obscure timestamps.
--            2. analyst path via the marker trigger emits zero events on
--               INSERT before any marker_assignments row exists, so synthesizing
--               marker_added through the trigger is awkward.
--
--          Real markers are created for the analyst rows so the RPC joins
--          (marker_color, marker_type_name, marker_title) resolve naturally;
--          marker_removed uses the trigger path against a separately-created
--          "to-be-deleted" marker so the marker_changes audit-row fallback for
--          deleted markers is exercised end-to-end.
--
-- affected objects:
--   - public._seed_demo_activity_variety  (new helper, security definer)
--   - public.seed_demo_data                (orchestrator: appended call)
--
-- idempotency: relies on seed_demo_data short-circuiting when companies
--   already exist for the space (same pattern as the other _seed_demo_* helpers).

-- =============================================================================
-- 1. helper.
-- =============================================================================

create or replace function public._seed_demo_activity_variety(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Cardiometabolic seed trials used as the staging surface. NULL-tolerant:
  -- bail out below if the realistic seed isn't loaded (matches the
  -- _seed_demo_recent_activity pattern). One trial per event group keeps the
  -- feed readable.
  t_status      uuid; -- REDEFINE-2
  t_date        uuid; -- ATTAIN-1
  t_phase       uuid; -- ACHIEVE-1
  t_enroll      uuid; -- TRIUMPH-1
  t_arms        uuid; -- ACACIA-HCM
  t_intervene   uuid; -- SUMMIT
  t_outcome     uuid; -- SURMOUNT-MMO
  t_sponsor     uuid; -- SELECT
  t_elig        uuid; -- DAPA-HF
  t_withdrawn   uuid; -- ATTR-ACT

  -- A live marker for the marker_added / marker_updated / marker_reclassified /
  -- date_moved (analyst) / projection_finalized rows. Hung off REDEFINE-2.
  m_live        uuid := gen_random_uuid();
  -- A throwaway marker created then DELETEd so the marker trigger emits a
  -- real marker_removed event with marker_changes audit fallback.
  m_doomed      uuid := gen_random_uuid();

  -- Marker type ids seeded by seed.sql (system, space_id NULL).
  mt_topline_data   constant uuid := 'a0000000-0000-0000-0000-000000000013';
  mt_full_data      constant uuid := 'a0000000-0000-0000-0000-000000000031';
  mt_reg_filing     constant uuid := 'a0000000-0000-0000-0000-000000000032';
  mt_approval       constant uuid := 'a0000000-0000-0000-0000-000000000035';
  mt_launch         constant uuid := 'a0000000-0000-0000-0000-000000000036';

  -- Spaced observed_at slots so the feed sorts intelligibly. Newest first.
  -- 'now' anchors are deliberate so the rows always land inside the default
  -- "Last 30 days" filter.
  ts_01 timestamptz := now() - interval '5 minutes';
  ts_02 timestamptz := now() - interval '10 minutes';
  ts_03 timestamptz := now() - interval '15 minutes';
  ts_04 timestamptz := now() - interval '20 minutes';
  ts_05 timestamptz := now() - interval '25 minutes';
  ts_06 timestamptz := now() - interval '30 minutes';
  ts_07 timestamptz := now() - interval '35 minutes';
  ts_08 timestamptz := now() - interval '40 minutes';
  ts_09 timestamptz := now() - interval '45 minutes';
  ts_10 timestamptz := now() - interval '50 minutes';
  ts_11 timestamptz := now() - interval '55 minutes';
  ts_12 timestamptz := now() - interval '60 minutes';
  ts_13 timestamptz := now() - interval '65 minutes';
  ts_14 timestamptz := now() - interval '70 minutes';
  ts_15 timestamptz := now() - interval '75 minutes';
  ts_16 timestamptz := now() - interval '80 minutes';
begin
  select id into t_status      from public.trials where space_id = p_space_id and name = 'REDEFINE-2'    limit 1;
  select id into t_date        from public.trials where space_id = p_space_id and name = 'ATTAIN-1'      limit 1;
  select id into t_phase       from public.trials where space_id = p_space_id and name = 'ACHIEVE-1'     limit 1;
  select id into t_enroll      from public.trials where space_id = p_space_id and name = 'TRIUMPH-1'     limit 1;
  select id into t_arms        from public.trials where space_id = p_space_id and name = 'ACACIA-HCM'    limit 1;
  select id into t_intervene   from public.trials where space_id = p_space_id and name = 'SUMMIT'        limit 1;
  select id into t_outcome     from public.trials where space_id = p_space_id and name = 'SURMOUNT-MMO'  limit 1;
  select id into t_sponsor     from public.trials where space_id = p_space_id and name = 'SELECT'        limit 1;
  select id into t_elig        from public.trials where space_id = p_space_id and name = 'DAPA-HF'       limit 1;
  select id into t_withdrawn   from public.trials where space_id = p_space_id and name = 'ATTR-ACT'      limit 1;

  -- Bail out if the realistic cardiometabolic seed isn't loaded. We need a
  -- handful of named trials to hang demo events off; if those aren't here,
  -- skip silently rather than fabricating partial coverage.
  if t_status is null or t_date is null or t_phase is null
     or t_enroll is null or t_arms is null then
    return;
  end if;

  -- Fallbacks for trials that may not exist in older revs of the realistic
  -- seed. Use REDEFINE-2 as the staging trial so the row at least renders.
  t_intervene := coalesce(t_intervene, t_status);
  t_outcome   := coalesce(t_outcome,   t_status);
  t_sponsor   := coalesce(t_sponsor,   t_status);
  t_elig      := coalesce(t_elig,      t_status);
  t_withdrawn := coalesce(t_withdrawn, t_arms);

  -- ---------------------------------------------------------------------------
  -- 12 CT.gov-source events. payload shape per _classify_change.
  -- ---------------------------------------------------------------------------

  insert into public.trial_change_events (
    trial_id, space_id, event_type, source, payload, occurred_at, observed_at
  ) values

  -- 1. status_changed
  (t_status, p_space_id, 'status_changed', 'ctgov',
   jsonb_build_object('from', 'RECRUITING', 'to', 'ACTIVE_NOT_RECRUITING'),
   ts_01, ts_01),

  -- 2. date_moved (trial-level: primary completion)
  (t_date, p_space_id, 'date_moved', 'ctgov',
   jsonb_build_object(
     'which_date', 'primary_completion',
     'from',       '2026-08-15',
     'to',         '2026-11-23',
     'days_diff',  100,
     'direction',  'slip'
   ),
   ts_02, ts_02),

  -- 3. phase_transitioned
  (t_phase, p_space_id, 'phase_transitioned', 'ctgov',
   jsonb_build_object(
     'from', jsonb_build_array('PHASE2'),
     'to',   jsonb_build_array('PHASE3')
   ),
   ts_03, ts_03),

  -- 4. enrollment_target_changed (cut, the more interesting CI signal)
  (t_enroll, p_space_id, 'enrollment_target_changed', 'ctgov',
   jsonb_build_object('from', 200, 'to', 180, 'percent_change', -10.00),
   ts_04, ts_04),

  -- 5. arm_added
  (t_arms, p_space_id, 'arm_added', 'ctgov',
   jsonb_build_object(
     'arm_label',   'High-dose CagriSema 2.4mg',
     'arm_type',    'EXPERIMENTAL',
     'description', 'Open-label extension cohort.'
   ),
   ts_05, ts_05),

  -- 6. arm_removed
  (t_arms, p_space_id, 'arm_removed', 'ctgov',
   jsonb_build_object(
     'arm_label', 'Placebo comparator',
     'arm_type',  'PLACEBO_COMPARATOR'
   ),
   ts_06, ts_06),

  -- 7. intervention_changed (added + removed)
  (t_intervene, p_space_id, 'intervention_changed', 'ctgov',
   jsonb_build_object(
     'added',   jsonb_build_array(jsonb_build_object('name', 'Tirzepatide 15mg', 'type', 'DRUG')),
     'removed', jsonb_build_array(jsonb_build_object('name', 'Tirzepatide 10mg', 'type', 'DRUG'))
   ),
   ts_07, ts_07),

  -- 8. outcome_measure_changed (primary: one added, one removed)
  (t_outcome, p_space_id, 'outcome_measure_changed', 'ctgov',
   jsonb_build_object(
     'outcome_kind', 'primary',
     'added', jsonb_build_array(jsonb_build_object(
       'measure', 'KCCQ-CSS at week 24',
       'description', 'Kansas City Cardiomyopathy Questionnaire',
       'timeFrame', 'Week 24'
     )),
     'removed', jsonb_build_array(jsonb_build_object(
       'measure', 'Change in LV mass index',
       'description', 'cMRI-derived LV mass index',
       'timeFrame', 'Week 24'
     )),
     'modified', '[]'::jsonb
   ),
   ts_08, ts_08),

  -- 9. sponsor_changed (cross-company; one of the biggest CI signals)
  (t_sponsor, p_space_id, 'sponsor_changed', 'ctgov',
   jsonb_build_object('from', 'Novo Nordisk A/S', 'to', 'Sanofi'),
   ts_09, ts_09),

  -- 10. eligibility_criteria_changed (length delta only per _classify_change)
  (t_elig, p_space_id, 'eligibility_criteria_changed', 'ctgov',
   jsonb_build_object('old_length', 800, 'new_length', 1212),
   ts_10, ts_10),

  -- 11. eligibility_changed (minimum_age bumped)
  (t_elig, p_space_id, 'eligibility_changed', 'ctgov',
   jsonb_build_object(
     'which_field', 'minimum_age',
     'from',        '18 Years',
     'to',          '21 Years'
   ),
   ts_11, ts_11),

  -- 12. trial_withdrawn (last_seen_post_date is the canonical payload field)
  (t_withdrawn, p_space_id, 'trial_withdrawn', 'ctgov',
   jsonb_build_object('last_seen_post_date', (current_date - interval '28 days')::date),
   ts_12, ts_12);

  -- ---------------------------------------------------------------------------
  -- Live marker for the analyst-side direct-insert events. event_date sits
  -- well outside the upcoming-catalyst window so it doesn't interfere with
  -- the "Next 14 days" widget seeded by _seed_demo_recent_activity.
  -- ---------------------------------------------------------------------------

  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, description)
    values (m_live, p_space_id, p_uid, mt_approval, 'REDEFINE-2 PDUFA expected', 'company',
            (current_date + interval '180 days')::date,
            'Anticipated PDUFA decision following BLA filing.');
  insert into public.marker_assignments (marker_id, trial_id)
    values (m_live, t_status);

  -- 5 analyst-source events on the live marker. Each one references the
  -- real marker_id so RPC joins to markers + marker_types resolve cleanly.

  insert into public.trial_change_events (
    trial_id, space_id, event_type, source, payload, occurred_at, observed_at, marker_id
  ) values

  -- 13. marker_added
  (t_status, p_space_id, 'marker_added', 'analyst',
   jsonb_build_object(
     'event_date',     (current_date + interval '180 days')::date,
     'marker_type_id', mt_approval,
     'projection',     'company'
   ),
   ts_13, ts_13, m_live),

  -- 14. marker_updated (title edit only -> changed_fields=[title])
  (t_status, p_space_id, 'marker_updated', 'analyst',
   jsonb_build_object(
     'changed_fields', jsonb_build_array('title')
   ),
   ts_14, ts_14, m_live),

  -- 15. marker_reclassified (Topline Data -> Full Data)
  (t_status, p_space_id, 'marker_reclassified', 'analyst',
   jsonb_build_object(
     'from_type_id', mt_topline_data,
     'to_type_id',   mt_full_data
   ),
   ts_15, ts_15, m_live),

  -- 16. date_moved (analyst-source; which_date='event_date' marker anchor)
  (t_status, p_space_id, 'date_moved', 'analyst',
   jsonb_build_object(
     'which_date', 'event_date',
     'from',       (current_date + interval '180 days')::date,
     'to',         (current_date + interval '257 days')::date,
     'days_diff',  77,
     'direction',  'slip'
   ),
   ts_16, ts_16, m_live);

  -- 17. projection_finalized on a fresh marker (separate from m_live so the
  -- live marker stays 'company' for any UI that filters by projection).
  declare
    m_finalized uuid := gen_random_uuid();
  begin
    insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, description)
      values (m_finalized, p_space_id, p_uid, mt_full_data, 'REDEFINE-1 full readout', 'actual',
              (current_date - interval '14 days')::date,
              'Full Phase 3 readout published in NEJM.');
    insert into public.marker_assignments (marker_id, trial_id)
      values (m_finalized, t_status);

    insert into public.trial_change_events (
      trial_id, space_id, event_type, source, payload, occurred_at, observed_at, marker_id
    ) values
    (t_status, p_space_id, 'projection_finalized', 'analyst',
     jsonb_build_object(
       'from',       'company',
       'to',         'actual',
       'event_date', (current_date - interval '14 days')::date
     ),
     now() - interval '85 minutes',
     now() - interval '85 minutes',
     m_finalized);
  end;

  -- marker_removed: create a separate marker, assign it, then DELETE so the
  -- marker trigger fires naturally. The trigger writes marker_id=null on the
  -- emitted event (per _emit_events_from_marker_change) and the RPC falls
  -- back to marker_changes.old_values for title/marker_type_id resolution.
  insert into public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, description)
    values (m_doomed, p_space_id, p_uid, mt_launch, 'REDEFINE-2 launch (deprecated forecast)', 'company',
            (current_date + interval '365 days')::date,
            'Earlier launch forecast superseded by revised commercial plan.');
  insert into public.marker_assignments (marker_id, trial_id)
    values (m_doomed, t_status);

  delete from public.markers where id = m_doomed;
  -- The trigger-emitted marker_removed event observed_at defaults to now(),
  -- which is younger than every direct-insert above. That puts it at the top
  -- of the feed -- desirable, since "removed" is a fresh signal for analysts.
end;
$$;

comment on function public._seed_demo_activity_variety(uuid, uuid) is
  'Emits one demo event per supported event_type (12 CT.gov-source + 5 analyst-source via direct insert + marker_removed via trigger on a deleted marker), so the Activity page renders the full row-renderer matrix after seed_demo_data() against a fresh cardiometabolic space. SECURITY DEFINER. Bails out silently if the realistic cardiometabolic seed (REDEFINE-2 etc.) is not loaded.';

-- =============================================================================
-- 2. orchestrator: append the new helper to the seed_demo_data pipeline.
--    Body mirrors migration 20260505201000 plus one extra perform line at
--    the end so this is reentrant after the latest revision of the seeder.
-- =============================================================================

create or replace function public.seed_demo_data(p_space_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  existing_count int;
begin
  if uid is null then
    raise exception 'Must be authenticated to seed demo data'
      using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.space_members
     where space_id = p_space_id
       and user_id = uid
       and role = 'owner'
  ) and not public.is_platform_admin() then
    raise exception 'Insufficient permissions: must be space owner to seed demo data'
      using errcode = '42501';
  end if;

  select count(*) into existing_count
    from public.companies
    where space_id = p_space_id;

  if existing_count > 0 then
    return;
  end if;

  create temp table if not exists _seed_ids (
    entity_type text not null,
    key         text not null,
    id          uuid not null,
    primary key (entity_type, key)
  ) on commit drop;

  perform public._seed_demo_companies(p_space_id, uid);
  perform public._seed_demo_therapeutic_areas(p_space_id, uid);
  perform public._seed_demo_products(p_space_id, uid);
  perform public._seed_demo_moa_roa(p_space_id, uid);
  perform public._seed_demo_trials(p_space_id, uid);
  perform public._seed_demo_markers(p_space_id, uid);
  perform public._seed_demo_trial_notes(p_space_id, uid);
  perform public._seed_demo_events(p_space_id, uid);
  perform public._seed_demo_primary_intelligence(p_space_id, uid);
  perform public._seed_demo_materials(p_space_id, uid);
  perform public._seed_demo_recent_activity(p_space_id, uid);
  perform public._seed_demo_activity_variety(p_space_id, uid);
end;
$$;

comment on function public.seed_demo_data(uuid) is
  'Seeds a space with comprehensive demo data: 8 real pharma companies, 20 fictional products across 4 therapeutic areas, 26 trials covering all phases, 55+ markers, 12 trial notes, 20 events, plus 5 published primary intelligence reads (4 trial-anchored, 1 space-level thematic), 2 drafts, 3 materials, 5 upcoming-catalyst markers in the next 14 days, 3 >90d slips on projected markers so the engagement-landing widgets always have fresh content, and (added 2026-05-10) one demo event of every event_type so the Activity page renders the full row-renderer matrix. Permission gate: caller must be a space owner of p_space_id or a platform admin. Idempotent: returns early if the space already has companies.';
