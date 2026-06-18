-- Backfill phase_end_date for the demo dataset's active P3 trials.
--
-- These three trials (SURMOUNT-MMO, TRIUMPH-1, ACACIA-HCM) were seeded with a
-- null phase_end_date, so their phase bars feather to "today" on the timeline
-- instead of running to completion. seed.sql now sets these on fresh local
-- seeds; this migration backfills environments whose data was already seeded
-- (e.g. dev). Matched by NCT identifier and guarded on phase_end_date IS NULL,
-- so a genuinely synced trial (which already carries a completion date) is
-- never overwritten. Dates are the trials' projected primary-completion dates.

update public.trials set phase_end_date = '2025-10-31'
  where identifier = 'NCT05556512' and phase_end_date is null; -- SURMOUNT-MMO

update public.trials set phase_end_date = '2026-11-30'
  where identifier = 'NCT05929066' and phase_end_date is null; -- TRIUMPH-1

update public.trials set phase_end_date = '2026-06-30'
  where identifier = 'NCT06081894' and phase_end_date is null; -- ACACIA-HCM
