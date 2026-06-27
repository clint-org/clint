-- ============================================================================
-- ROLLBACK for 20260626120000_ctgov_trial_dates_markers.sql
-- ============================================================================
-- This file lives under migrations/rollback/ and is NOT auto-applied by
-- `supabase db reset` (reset only runs .sql files directly under migrations/).
-- It is the tested rollback artifact: apply it manually with
--   psql "<db-url>" -f supabase/migrations/rollback/20260626120000_ctgov_trial_dates_markers.down.sql
--
-- ROLLBACK FLOOR (intentional, documented limitation):
--   * Re-adds the four dropped columns (phase_start_date, phase_end_date,
--     phase_start_date_source, phase_end_date_source) and re-backfills them from
--     the Trial Start / Trial End / PCD markers -- the exact mirror of the
--     forward derivation:
--       phase_start_date = earliest Trial Start marker's event_date
--       phase_end_date   = latest Trial End marker's event_date, else latest PCD
--       *_source         = 'ctgov' if the chosen marker is ct.gov-owned
--                          (metadata.source = 'ctgov'), else 'analyst'
--   * It does NOT restore the pre-migration function bodies
--     (_seed_ctgov_markers / _materialize_trial_from_snapshot /
--     _guard_ctgov_locked_phase_fields / get_dashboard_data / create_trial /
--     demo seeders), and it does NOT drop the new marker lock trigger or the
--     new helper functions. Those remain in their forward form. Fully reverting
--     behavior (columns driving the bar again) requires re-running the prior
--     migrations' function definitions. This floor satisfies the reversibility
--     requirement: the schema columns are back and correctly backfilled.
-- ============================================================================

alter table public.trials
  add column phase_start_date        date,
  add column phase_end_date          date,
  add column phase_start_date_source text,
  add column phase_end_date_source   text;

-- phase_start_date <- earliest Trial Start marker's event_date (+ ownership).
update public.trials t
   set phase_start_date        = s.event_date,
       phase_start_date_source = case when s.src = 'ctgov' then 'ctgov' else 'analyst' end
  from (
    select distinct on (ma.trial_id)
           ma.trial_id,
           m.event_date,
           m.metadata->>'source' as src
      from public.marker_assignments ma
      join public.markers m on m.id = ma.marker_id
     where m.marker_type_id = 'a0000000-0000-0000-0000-000000000011'  -- Trial Start
     order by ma.trial_id, m.event_date asc                           -- earliest wins
  ) s
 where t.id = s.trial_id;

-- phase_end_date <- latest Trial End marker's event_date, else latest PCD
-- (+ ownership). Mirrors the old phase_end_date = coalesce(completion, PCD).
update public.trials t
   set phase_end_date        = e.event_date,
       phase_end_date_source = case when e.src = 'ctgov' then 'ctgov' else 'analyst' end
  from (
    select distinct on (trial_id) trial_id, event_date, src
      from (
        select ma.trial_id,
               m.event_date,
               m.metadata->>'source' as src,
               case when m.marker_type_id = 'a0000000-0000-0000-0000-000000000012'
                    then 1 else 2 end as rnk   -- Trial End preferred over PCD
          from public.marker_assignments ma
          join public.markers m on m.id = ma.marker_id
         where m.marker_type_id in (
                 'a0000000-0000-0000-0000-000000000012',  -- Trial End
                 'a0000000-0000-0000-0000-000000000008'   -- PCD (fallback)
               )
      ) x
     order by trial_id, rnk asc, event_date desc          -- Trial End first, then latest
  ) e
 where t.id = e.trial_id;

notify pgrst, 'reload schema';
