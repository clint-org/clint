-- migration: 20260411120000_extend_phase_types
-- purpose: extend the set of accepted phase_type values on public.trial_phases
--          to support the landscape bullseye feature. adds PRECLIN, APPROVED,
--          and LAUNCHED alongside the existing P1-P4 and OBS values by
--          introducing a check constraint that enumerates the valid set.
-- affected objects: public.trial_phases (adds check constraint trial_phases_phase_type_check)
-- notes: no existing check constraint on phase_type; this migration introduces
--        one for the first time. existing rows in the seed data use only
--        P1-P3 and are compatible with the new constraint.

alter table public.trial_phases
  add constraint trial_phases_phase_type_check
  check (
    phase_type in ('PRECLIN', 'P1', 'P2', 'P3', 'P4', 'APPROVED', 'LAUNCHED', 'OBS')
  );

comment on constraint trial_phases_phase_type_check on public.trial_phases is
  'Enumerates the valid development-lifecycle phase values used by the timeline dashboard and the landscape bullseye. PRECLIN, APPROVED, and LAUNCHED were added for the landscape feature; OBS (observational) is retained but excluded from the bullseye ring calculation.';
