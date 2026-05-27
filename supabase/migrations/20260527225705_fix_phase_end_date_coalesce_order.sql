-- Fix phase_end_date to prefer completionDateStruct (Trial End) over
-- primaryCompletionDateStruct (PCD).  The original coalesce in
-- _materialize_trial_from_snapshot had them backwards, so phase_end_date
-- showed the PCD date instead of the actual trial end.

-- 1. Replace the function with corrected coalesce order
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
                          public._safe_iso_date(p_payload #>> '{protocolSection,statusModule,completionDateStruct,date}'),
                          public._safe_iso_date(p_payload #>> '{protocolSection,statusModule,primaryCompletionDateStruct,date}')
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

-- 2. Backfill: recompute phase_end_date for every trial whose latest
--    snapshot has a completionDateStruct that differs from the current
--    phase_end_date (i.e. trials that got the PCD instead of Trial End).
with latest_snapshot as (
  select distinct on (trial_id)
    trial_id,
    payload
  from public.trial_ctgov_snapshots
  order by trial_id, ctgov_version desc
),
corrected as (
  select
    ls.trial_id,
    coalesce(
      public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,completionDateStruct,date}'),
      public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,primaryCompletionDateStruct,date}')
    ) as phase_end_date
  from latest_snapshot ls
)
update public.trials t
   set phase_end_date = c.phase_end_date
  from corrected c
 where t.id = c.trial_id
   and c.phase_end_date is not null
   and (t.phase_end_date is distinct from c.phase_end_date);
