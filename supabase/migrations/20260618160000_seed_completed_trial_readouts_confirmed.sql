-- Demo data integrity: a completed / terminated / withdrawn trial cannot have a
-- data readout (topline / interim / full data) that is still "projected" -- the
-- readout landed by the time the trial finished. Mark such readouts confirmed
-- (projection = 'actual'), and where the date sits after the trial's completion,
-- clamp it back to the completion date, so a finished trial never shows a future
-- projected readout on the timeline or in the catalyst rail.
--
-- Scoped to the data-readout category only, so approval / launch / loss-of-
-- exclusivity markers -- which legitimately post-date a trial's completion --
-- are left untouched. This only repairs logically inconsistent rows.

update public.markers m
set projection = 'actual',
    event_date = case
      when t.phase_end_date is not null and m.event_date > t.phase_end_date
        then t.phase_end_date
      else m.event_date
    end
from public.marker_assignments ma
join public.trials t on t.id = ma.trial_id
where ma.marker_id = m.id
  and lower(t.status) in ('completed', 'terminated', 'withdrawn')
  and m.projection <> 'actual'
  -- Topline / Interim / generic data readouts land by completion; Full Data
  -- (the full publication) legitimately appears later, so exclude it.
  and m.marker_type_id in (
    select mt.id from public.marker_types mt
    where mt.category_id = 'c0000000-0000-0000-0000-000000000002'
      and mt.name <> 'Full Data'
  );
