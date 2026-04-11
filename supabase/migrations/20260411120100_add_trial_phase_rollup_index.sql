-- migration: 20260411120100_add_trial_phase_rollup_index
-- purpose: add a compound index on public.trial_phases (trial_id, phase_type)
--          to keep the "highest phase per trial" rollup cheap when a space
--          grows. used by the landscape bullseye RPCs.
-- affected objects: public.trial_phases (index idx_trial_phases_trial_phase)

create index if not exists idx_trial_phases_trial_phase
  on public.trial_phases (trial_id, phase_type);
