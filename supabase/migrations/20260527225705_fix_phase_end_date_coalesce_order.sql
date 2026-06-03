-- Fix phase_end_date to prefer completionDateStruct (Trial End) over
-- primaryCompletionDateStruct (PCD).  The coalesce in
-- _materialize_trial_from_snapshot had them backwards, so phase_end_date
-- showed the PCD date instead of the actual trial end.

-- 1. Replace the function with corrected coalesce order.
--    This is the full body from 20260521200200 with one change: lines that
--    derive v_phase_end_date now read completionDateStruct first, then
--    primaryCompletionDateStruct as fallback.
create or replace function public._materialize_trial_from_snapshot(
  p_trial_id uuid,
  p_payload  jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase                text;
  v_phase_type           text;
  v_phase_start_date     date;
  v_phase_end_date       date;
  v_recruitment          text;
  v_status               text;
  v_study_type           text;
  v_last_update_date     date;
  v_prev_phase_type      text;
  v_prev_phase_start     date;
  v_prev_phase_end       date;
  v_prev_phase_type_src  text;
  v_prev_phase_start_src text;
  v_prev_phase_end_src   text;
  v_space_id             uuid;
  v_now                  timestamptz := now();
  v_occurred             timestamptz;
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
  v_occurred         := coalesce(v_last_update_date::timestamptz, v_now);

  select phase_type, phase_start_date, phase_end_date,
         phase_type_source, phase_start_date_source, phase_end_date_source,
         space_id
    into v_prev_phase_type, v_prev_phase_start, v_prev_phase_end,
         v_prev_phase_type_src, v_prev_phase_start_src, v_prev_phase_end_src,
         v_space_id
    from public.trials where id = p_trial_id;

  perform set_config('clint.materialize_in_progress', 'on', true);

  update public.trials
     set phase                   = coalesce(v_phase, phase),
         phase_type              = coalesce(v_phase_type,       phase_type),
         phase_start_date        = coalesce(v_phase_start_date, phase_start_date),
         phase_end_date          = coalesce(v_phase_end_date,   phase_end_date),
         phase_type_source       = case when v_phase_type       is not null then 'ctgov' else phase_type_source       end,
         phase_start_date_source = case when v_phase_start_date is not null then 'ctgov' else phase_start_date_source end,
         phase_end_date_source   = case when v_phase_end_date   is not null then 'ctgov' else phase_end_date_source   end,
         status                  = coalesce(status, v_status),
         recruitment_status      = coalesce(v_recruitment, recruitment_status),
         study_type              = coalesce(v_study_type, study_type),
         last_update_posted_date = coalesce(v_last_update_date, last_update_posted_date),
         ctgov_last_synced_at    = v_now
   where id = p_trial_id;

  perform set_config('clint.materialize_in_progress', 'off', true);

  if v_prev_phase_type is not null and v_phase_type is not null and v_phase_type <> v_prev_phase_type then
    insert into public.trial_change_events (trial_id, space_id, event_type, source, payload, occurred_at)
    values (p_trial_id, v_space_id, 'phase_changed', 'ctgov',
      jsonb_build_object(
        'field',      'phase_type',
        'old_value',  to_jsonb(v_prev_phase_type),
        'new_value',  to_jsonb(v_phase_type),
        'old_source', to_jsonb(v_prev_phase_type_src)
      ),
      v_occurred);
  end if;

  if v_prev_phase_start is not null and v_phase_start_date is not null and v_phase_start_date <> v_prev_phase_start then
    insert into public.trial_change_events (trial_id, space_id, event_type, source, payload, occurred_at)
    values (p_trial_id, v_space_id, 'phase_start_changed', 'ctgov',
      jsonb_build_object(
        'field',      'phase_start_date',
        'old_value',  to_jsonb(v_prev_phase_start),
        'new_value',  to_jsonb(v_phase_start_date),
        'old_source', to_jsonb(v_prev_phase_start_src)
      ),
      v_occurred);
  end if;

  if v_prev_phase_end is not null and v_phase_end_date is not null and v_phase_end_date <> v_prev_phase_end then
    insert into public.trial_change_events (trial_id, space_id, event_type, source, payload, occurred_at)
    values (p_trial_id, v_space_id, 'phase_end_changed', 'ctgov',
      jsonb_build_object(
        'field',      'phase_end_date',
        'old_value',  to_jsonb(v_prev_phase_end),
        'new_value',  to_jsonb(v_phase_end_date),
        'old_source', to_jsonb(v_prev_phase_end_src)
      ),
      v_occurred);
  end if;
end;
$$;

revoke execute on function public._materialize_trial_from_snapshot(uuid, jsonb) from public;

-- 2. Backfill: recompute phase_end_date for every trial whose latest
--    snapshot has a completionDateStruct that differs from the current
--    phase_end_date (i.e. trials that got the PCD instead of Trial End).
--    Wrapped in a DO block to set the GUC that bypasses the guard trigger.
do $$
begin
  perform set_config('clint.materialize_in_progress', 'on', true);

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

  perform set_config('clint.materialize_in_progress', 'off', true);
end;
$$;
