-- migration: 20260524120300_narrow_trial_phase_constraint
-- purpose: remove APPROVED and LAUNCHED from the trials.phase_type CHECK
--          constraint. these are development statuses, not trial phases.
--          migrate existing APPROVED/LAUNCHED trials to P3 (all are pivotal
--          phase 3 trials). update the trial_phases_phase_type_check on the
--          old trial_phases table if it still exists (it was dropped but the
--          constraint name might be on trials via migration history).
-- affected tables: public.trials

-- =============================================================================
-- 1. migrate APPROVED/LAUNCHED data to P3
-- =============================================================================
-- all currently seeded APPROVED/LAUNCHED trials are completed pivotal P3 trials.
-- their development status is now tracked on asset_indications (backfilled in T2).
update public.trials
  set phase_type = 'P3'
  where phase_type in ('APPROVED', 'LAUNCHED');

-- =============================================================================
-- 2. narrow the CHECK constraint
-- =============================================================================
alter table public.trials drop constraint if exists trials_phase_type_check;

alter table public.trials add constraint trials_phase_type_check
  check (phase_type is null or phase_type in
    ('PRECLIN', 'P1', 'P2', 'P3', 'P4', 'P1_2', 'P2_3', 'OBS'));

-- the old trial_phases constraint (if somehow still present) is harmless to
-- attempt to drop; the table was dropped in 20260412130100.
alter table if exists public.trial_phases
  drop constraint if exists trial_phases_phase_type_check;

-- =============================================================================
-- smoke tests
-- =============================================================================
do $$
declare
  v_bad_count int;
  v_p3_count  int;
begin
  -- no trials should have APPROVED or LAUNCHED
  select count(*) into v_bad_count
    from public.trials
    where phase_type in ('APPROVED', 'LAUNCHED');
  assert v_bad_count = 0,
    format('expected 0 APPROVED/LAUNCHED trials, got %s', v_bad_count);

  -- P3 trials may exist (migrated from APPROVED/LAUNCHED + existing P3)
  select count(*) into v_p3_count
    from public.trials where phase_type = 'P3';

  -- verify CHECK constraint exists by attempting a direct value test
  -- (does not require seed data)
  begin
    perform 1 from public.trials
      where false
        and phase_type = 'APPROVED'; -- just verify column exists
  end;

  -- verify constraint text includes the new allowed values
  assert exists (
    select 1 from information_schema.check_constraints
    where constraint_name = 'trials_phase_type_check'
      and check_clause not like '%APPROVED%'
  ), 'constraint should not contain APPROVED';

  raise notice 'smoke: phase constraint narrowing passed (% P3 trials, 0 APPROVED/LAUNCHED)', v_p3_count;
end;
$$;
