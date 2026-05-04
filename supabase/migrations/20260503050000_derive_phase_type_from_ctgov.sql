-- migration: 20260503050000_derive_phase_type_from_ctgov
-- purpose: auto-fill the four analyst-owned trial columns that the
--   visualizations depend on -- phase_type, phase_start_date,
--   phase_end_date, and the coarse lifecycle status -- from ct.gov
--   sync data when the analyst hasn't set them. before this migration,
--   ct.gov-synced trials had trials.phase populated (e.g. "Phase 3")
--   but the analyst-owned columns null, so:
--     - the landscape index counted their products as "missing phase
--       data" and the bullseye couldn't rank them (uses phase_type)
--     - the dashboard timeline phase bar didn't render for them
--       (needs phase_type AND phase_start_date)
--     - the trial-list Status column showed a muted dash for every
--       synced trial (uses status, distinct from recruitment_status)
--   the legacy trial-form (retired in commit 03c94c5 with the change-
--   feed branch) had pickers for all four columns; the new trial-create
--   / trial-edit dialogs deliberately omit them pending inline-per-
--   field editing that hasn't shipped. this leaves ct.gov-synced
--   trials with no path to populated visualizations.
--
-- behavior:
--   - new helper _derive_phase_type(p_phases jsonb, p_study_type text)
--     returns text. maps the ct.gov phases array (and observational
--     study type) to the analyst-owned phase_type enum used by the
--     bullseye / dashboard / phase filter.
--
--     mapping rules:
--       ['EARLY_PHASE1']                              -> 'P1'
--       ['PHASE1']                                    -> 'P1'
--       ['PHASE2']                                    -> 'P2'
--       ['PHASE3']                                    -> 'P3'
--       ['PHASE4']                                    -> 'P4'
--       multi-phase array (e.g. ['PHASE2','PHASE3'])  -> max of the set
--       ['NA'] + study_type='OBSERVATIONAL'           -> 'OBS'
--       anything else / null / empty                  -> NULL
--
--     why max-of-set instead of P1_2 / P2_3: those values are valid by
--     trials_phase_type_check but no consumer ranks them. the bullseye
--     case statement (PRECLIN..LAUNCHED only) returns null for them, so
--     setting them would NOT clear the "products missing phase data"
--     warning. taking max matches how pharma analysts read combined-
--     design trials competitively (P2/P3 reads as P3 registration).
--
--   - _materialize_trial_from_snapshot now also writes phase_type,
--     phase_start_date, phase_end_date, and status via reverse coalesce
--     (coalesce(existing, derived)). these are still analyst-owned --
--     a value the analyst set is NEVER overwritten. derived values
--     only fill nulls. this preserves analyst control while letting
--     ct.gov seed empty trials on first sync.
--
--     start_date source: protocolSection.statusModule.startDateStruct.date
--     end_date   source: coalesce(primaryCompletionDateStruct.date,
--                                 completionDateStruct.date)
--     primary completion is the readout date and is the catalyst event
--     analysts care about; final completion (post-followup) is the
--     fallback when CT.gov hasn't filled primary. ANTICIPATED dates
--     are accepted -- the timeline bar's job is to show forward
--     planning, and "no bar" is worse than "anticipated bar". after
--     first sync the change feed surfaces date moves; we don't
--     auto-update the trial row, so the analyst stays in control.
--
--     status source: collapses ct.gov overallStatus to the analyst
--     lifecycle bucket (matches the seed convention "Active" /
--     "Planned" / "Completed" / "Terminated" / "Withdrawn"):
--       NOT_YET_RECRUITING                              -> 'Planned'
--       RECRUITING / ACTIVE_NOT_RECRUITING /
--         ENROLLING_BY_INVITATION                       -> 'Active'
--       COMPLETED                                       -> 'Completed'
--       SUSPENDED / TERMINATED                          -> 'Terminated'
--       WITHDRAWN                                       -> 'Withdrawn'
--       UNKNOWN / null / anything else                  -> NULL
--     trials.recruitment_status keeps the verbatim ct.gov enum and
--     is unaffected; status is the coarser analyst lens.
--
--   - one-time backfill applies all four derivations to every trial
--     where the corresponding column is currently null and a snapshot
--     exists. uses the latest snapshot per trial (highest ctgov_version).
--
-- affected objects:
--   - new function: public._derive_phase_type(jsonb, text)
--   - new function: public._derive_status(text)
--   - replaced function: public._materialize_trial_from_snapshot(uuid, jsonb)
--   - data:           public.trials (backfill phase_type / phase_start_date /
--                                    phase_end_date / status where each is null)

-- =============================================================================
-- 0. _safe_iso_date
-- =============================================================================
-- ct.gov returns dates as strings under the *DateStruct.date paths. Most are
-- full ISO YYYY-MM-DD, but early-planning trials sometimes return partials
-- (e.g. 'YYYY-MM' or 'YYYY'). A direct ::date cast on a partial raises 22007
-- and breaks the entire UPDATE statement, which is what blocked this
-- migration's first remote push. This helper returns a date only when the
-- input is exactly YYYY-MM-DD; partials, malformed strings, and empties all
-- coalesce to NULL. Padding partials to first-of-month was rejected because
-- it would feed fabricated dates into the timeline phase bar.

create or replace function public._safe_iso_date(p_text text)
returns date
language sql
immutable
as $$
  select case when p_text ~ '^\d{4}-\d{2}-\d{2}$' then p_text::date else null end;
$$;

comment on function public._safe_iso_date(text) is
  'Returns p_text as a date only if it matches YYYY-MM-DD exactly; otherwise NULL. Used to safely cast ct.gov *DateStruct.date strings, which can be partials like ''2026-06''.';

-- =============================================================================
-- 1. _derive_phase_type
-- =============================================================================

create or replace function public._derive_phase_type(
  p_phases     jsonb,
  p_study_type text
) returns text
language plpgsql
immutable
as $$
declare
  v_arr      text[];
  v_distinct text[];
  v_max      text;
begin
  -- null / non-array / empty -> null
  if p_phases is null or jsonb_typeof(p_phases) <> 'array' then
    return null;
  end if;

  select array_agg(value::text) into v_arr from jsonb_array_elements_text(p_phases);
  if v_arr is null or array_length(v_arr, 1) is null then
    return null;
  end if;

  -- NA + observational -> OBS. NA + non-observational stays null because
  -- expanded-access programs also use NA and shouldn't auto-classify.
  if v_arr = array['NA'] then
    if p_study_type = 'OBSERVATIONAL' then
      return 'OBS';
    end if;
    return null;
  end if;

  -- normalize to the four phase buckets (treat EARLY_PHASE1 as PHASE1
  -- competitively). drop NA tokens that appear alongside real phases.
  -- unknown tokens propagate as null via the `else null` branch below.
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

  -- strip nulls from the agg
  v_distinct := array_remove(v_distinct, null);
  if v_distinct is null or array_length(v_distinct, 1) is null then
    return null;
  end if;

  -- take the max (lexical works because PHASE1 < PHASE2 < PHASE3 < PHASE4)
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

comment on function public._derive_phase_type(jsonb, text) is
  'Maps a ct.gov phases array + studyType to the analyst-owned phase_type enum (P1/P2/P3/P4/OBS). Multi-phase arrays collapse to max because P1_2/P2_3 are not handled by the bullseye rank function. EARLY_PHASE1 -> P1. NA + OBSERVATIONAL -> OBS. Returns NULL for ambiguous / unknown / empty input.';

-- =============================================================================
-- 1b. _derive_status
-- =============================================================================
-- Collapses ct.gov overallStatus into the coarser analyst lifecycle bucket
-- shown in the trial-list "Status" column. Distinct from recruitment_status,
-- which keeps the verbatim ct.gov enum.

create or replace function public._derive_status(p_overall_status text)
returns text
language sql
immutable
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

comment on function public._derive_status(text) is
  'Maps ct.gov overallStatus to the coarse analyst lifecycle bucket stored in trials.status (Planned / Active / Completed / Terminated / Withdrawn). Returns NULL for UNKNOWN, null, or unrecognized values. Distinct from trials.recruitment_status, which retains the verbatim ct.gov enum.';

-- =============================================================================
-- 2. _materialize_trial_from_snapshot (replace)
-- =============================================================================
-- new vs prior:
--   - also derives v_phase_type and writes it via coalesce(phase_type, derived).
--   - docstring no longer claims phase_type is untouched; it is, but only
--     when currently null. analyst-set values are still preserved.

create or replace function public._materialize_trial_from_snapshot(
  p_trial_id uuid,
  p_payload  jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase                 text;
  v_phase_type            text;
  v_phase_start_date      date;
  v_phase_end_date        date;
  v_recruitment           text;
  v_status                text;
  v_study_type            text;
  v_last_update_date      date;
begin
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

  update public.trials
     set phase                   = coalesce(v_phase, phase),
         phase_type              = coalesce(phase_type, v_phase_type),
         phase_start_date        = coalesce(phase_start_date, v_phase_start_date),
         phase_end_date          = coalesce(phase_end_date, v_phase_end_date),
         status                  = coalesce(status, v_status),
         recruitment_status      = coalesce(v_recruitment, recruitment_status),
         study_type              = coalesce(v_study_type, study_type),
         last_update_posted_date = coalesce(v_last_update_date, last_update_posted_date),
         ctgov_last_synced_at    = now()
   where id = p_trial_id;
end;
$$;

revoke execute on function public._materialize_trial_from_snapshot(uuid, jsonb) from public;

comment on function public._materialize_trial_from_snapshot(uuid, jsonb) is
  'Applies the ct.gov-owned subset of a snapshot payload onto trials via one partial UPDATE. ct.gov-owned fields (phase, recruitment_status, study_type, last_update_posted_date) use coalesce(derived, existing) so missing paths keep prior values. Analyst-owned phase_type / phase_start_date / phase_end_date / status use reverse coalesce(existing, derived) so analyst-set values are never overwritten while ct.gov can seed nulls on first sync. Other analyst-owned columns (name, notes, display_order, product_id, therapeutic_area_id) are untouched. Called by ingest_ctgov_snapshot.';

-- =============================================================================
-- 3. one-time backfill against existing snapshots
-- =============================================================================
-- For every trial with at least one snapshot, fill in any of phase_type /
-- phase_start_date / phase_end_date that's currently null using the latest
-- snapshot. coalesce(existing, derived) on each column independently so we
-- only fill the holes -- analyst-set values stay intact, and a column that
-- ct.gov has no value for stays null too. Idempotent on rerun: any column
-- still null after a run is one ct.gov can't help with.

with latest_snapshot as (
  select distinct on (trial_id)
    trial_id,
    payload
  from public.trial_ctgov_snapshots
  order by trial_id, ctgov_version desc
)
update public.trials t
   set phase_type       = coalesce(t.phase_type,       derived.phase_type),
       phase_start_date = coalesce(t.phase_start_date, derived.phase_start_date),
       phase_end_date   = coalesce(t.phase_end_date,   derived.phase_end_date),
       status           = coalesce(t.status,           derived.status)
  from (
    select
      ls.trial_id,
      public._derive_phase_type(
        ls.payload #> '{protocolSection,designModule,phases}',
        ls.payload #>> '{protocolSection,designModule,studyType}'
      ) as phase_type,
      public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,startDateStruct,date}')
        as phase_start_date,
      coalesce(
        public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,primaryCompletionDateStruct,date}'),
        public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,completionDateStruct,date}')
      ) as phase_end_date,
      public._derive_status(ls.payload #>> '{protocolSection,statusModule,overallStatus}')
        as status
    from latest_snapshot ls
  ) as derived
 where t.id = derived.trial_id
   and (
     (t.phase_type is null       and derived.phase_type       is not null) or
     (t.phase_start_date is null and derived.phase_start_date is not null) or
     (t.phase_end_date is null   and derived.phase_end_date   is not null) or
     (t.status is null           and derived.status           is not null)
   );

-- =============================================================================
-- 4. inline smoke for _derive_phase_type and _derive_status
-- =============================================================================
-- pure-function smoke; no fixtures required. asserts the documented
-- mapping tables line by line so a future edit to either helper that
-- breaks a case fails db-reset rather than landing silently.

do $$
declare
  v_cases  jsonb := jsonb_build_array(
    jsonb_build_object('label', 'PHASE1 single',        'phases', '["PHASE1"]'::jsonb,            'study_type', null,             'expected', 'P1'),
    jsonb_build_object('label', 'PHASE2 single',        'phases', '["PHASE2"]'::jsonb,            'study_type', null,             'expected', 'P2'),
    jsonb_build_object('label', 'PHASE3 single',        'phases', '["PHASE3"]'::jsonb,            'study_type', null,             'expected', 'P3'),
    jsonb_build_object('label', 'PHASE4 single',        'phases', '["PHASE4"]'::jsonb,            'study_type', null,             'expected', 'P4'),
    jsonb_build_object('label', 'EARLY_PHASE1 -> P1',   'phases', '["EARLY_PHASE1"]'::jsonb,      'study_type', null,             'expected', 'P1'),
    jsonb_build_object('label', 'PHASE1/PHASE2 -> P2',  'phases', '["PHASE1","PHASE2"]'::jsonb,   'study_type', null,             'expected', 'P2'),
    jsonb_build_object('label', 'PHASE2/PHASE3 -> P3',  'phases', '["PHASE2","PHASE3"]'::jsonb,   'study_type', null,             'expected', 'P3'),
    jsonb_build_object('label', 'PHASE3/PHASE4 -> P4',  'phases', '["PHASE3","PHASE4"]'::jsonb,   'study_type', null,             'expected', 'P4'),
    jsonb_build_object('label', 'NA + OBSERVATIONAL',   'phases', '["NA"]'::jsonb,                'study_type', 'OBSERVATIONAL',  'expected', 'OBS'),
    jsonb_build_object('label', 'NA + INTERVENTIONAL',  'phases', '["NA"]'::jsonb,                'study_type', 'INTERVENTIONAL', 'expected', null),
    jsonb_build_object('label', 'NA + null study type', 'phases', '["NA"]'::jsonb,                'study_type', null,             'expected', null),
    jsonb_build_object('label', 'NA stripped from set', 'phases', '["NA","PHASE2"]'::jsonb,       'study_type', null,             'expected', 'P2'),
    jsonb_build_object('label', 'null input',           'phases', null,                            'study_type', null,             'expected', null),
    jsonb_build_object('label', 'empty array',          'phases', '[]'::jsonb,                    'study_type', null,             'expected', null),
    jsonb_build_object('label', 'non-array jsonb',      'phases', '"PHASE2"'::jsonb,              'study_type', null,             'expected', null),
    jsonb_build_object('label', 'unknown token only',   'phases', '["BOGUS"]'::jsonb,             'study_type', null,             'expected', null)
  );
  v_case   jsonb;
  v_actual text;
  v_expect text;
begin
  for v_case in select * from jsonb_array_elements(v_cases) loop
    v_actual := public._derive_phase_type(
      case when v_case ->> 'phases' is null then null else (v_case -> 'phases') end,
      v_case ->> 'study_type'
    );
    v_expect := v_case ->> 'expected';
    if v_actual is distinct from v_expect then
      raise exception '_derive_phase_type smoke FAIL: % expected % got %',
        v_case ->> 'label',
        coalesce(v_expect, 'NULL'),
        coalesce(v_actual, 'NULL');
    end if;
  end loop;

  raise notice '_derive_phase_type smoke: PASS';
end $$;

do $$
declare
  v_cases jsonb := jsonb_build_array(
    jsonb_build_object('label', 'NOT_YET_RECRUITING -> Planned',     'overall', 'NOT_YET_RECRUITING',      'expected', 'Planned'),
    jsonb_build_object('label', 'RECRUITING -> Active',              'overall', 'RECRUITING',              'expected', 'Active'),
    jsonb_build_object('label', 'ACTIVE_NOT_RECRUITING -> Active',   'overall', 'ACTIVE_NOT_RECRUITING',   'expected', 'Active'),
    jsonb_build_object('label', 'ENROLLING_BY_INVITATION -> Active', 'overall', 'ENROLLING_BY_INVITATION', 'expected', 'Active'),
    jsonb_build_object('label', 'COMPLETED -> Completed',            'overall', 'COMPLETED',               'expected', 'Completed'),
    jsonb_build_object('label', 'SUSPENDED -> Terminated',           'overall', 'SUSPENDED',               'expected', 'Terminated'),
    jsonb_build_object('label', 'TERMINATED -> Terminated',          'overall', 'TERMINATED',              'expected', 'Terminated'),
    jsonb_build_object('label', 'WITHDRAWN -> Withdrawn',            'overall', 'WITHDRAWN',               'expected', 'Withdrawn'),
    jsonb_build_object('label', 'UNKNOWN -> NULL',                   'overall', 'UNKNOWN',                 'expected', null),
    jsonb_build_object('label', 'null input -> NULL',                'overall', null,                       'expected', null),
    jsonb_build_object('label', 'unrecognized -> NULL',              'overall', 'BOGUS',                   'expected', null)
  );
  v_case   jsonb;
  v_actual text;
  v_expect text;
begin
  for v_case in select * from jsonb_array_elements(v_cases) loop
    v_actual := public._derive_status(v_case ->> 'overall');
    v_expect := v_case ->> 'expected';
    if v_actual is distinct from v_expect then
      raise exception '_derive_status smoke FAIL: % expected % got %',
        v_case ->> 'label',
        coalesce(v_expect, 'NULL'),
        coalesce(v_actual, 'NULL');
    end if;
  end loop;

  raise notice '_derive_status smoke: PASS';
end $$;
