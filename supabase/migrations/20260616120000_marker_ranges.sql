-- Marker ranges: bounded fuzzy ranges and open-ended ("onwards") markers (P2.1 ext).
--
-- Markers already carry event_date + date_precision (the start). This adds:
--   - end_date_precision: precision of the optional end_date (mirrors date_precision)
--   - is_ongoing: an open-ended "... onwards" marker (start known, no end), e.g.
--     "Approval Q3 2024 onwards", "Launched H2 2026 onwards".
-- A bounded fuzzy range is "readout Q4 2026 to Q1 2027" (start + end, both fuzzy).
-- The two are mutually exclusive: an ongoing marker has no end_date.
--
-- related:
--   - 20260615130000_marker_date_precision.sql  (date_precision + create_marker)
--   - 20260615131000_dashboard_data_marker_precision.sql (get_dashboard_data)

-- 1. Columns -----------------------------------------------------------------

alter table public.markers
  add column if not exists end_date_precision text not null default 'exact';

alter table public.markers
  drop constraint if exists markers_end_date_precision_check;
alter table public.markers
  add constraint markers_end_date_precision_check
  check (end_date_precision in ('exact', 'month', 'quarter', 'half', 'year'));

alter table public.markers
  add column if not exists is_ongoing boolean not null default false;

alter table public.markers
  drop constraint if exists markers_ongoing_has_no_end_check;
alter table public.markers
  add constraint markers_ongoing_has_no_end_check
  check (not (is_ongoing and end_date is not null));

comment on column public.markers.end_date_precision is
  'Precision of end_date when set (exact|month|quarter|half|year); the UI renders the period label for a fuzzy range end. See client marker-date-precision.ts.';
comment on column public.markers.is_ongoing is
  'Open-ended ("... onwards") marker: a known start with no end. Mutually exclusive with end_date. The timeline renders a tail that fades to the present frontier.';

-- 2. create_marker -- add p_end_date_precision + p_is_ongoing ----------------

drop function if exists public.create_marker(
  uuid, uuid, text, text, date, date, text, text, uuid[], uuid, text, text
);

create or replace function public.create_marker(
  p_space_id           uuid,
  p_marker_type_id     uuid,
  p_title              text,
  p_projection         text,
  p_event_date         date,
  p_end_date           date      default null,
  p_description        text      default null,
  p_source_url         text      default null,
  p_trial_ids          uuid[]    default null,
  p_source_doc_id      uuid      default null,
  p_change_source      text      default 'analyst',
  p_date_precision     text      default 'exact',
  p_end_date_precision text      default 'exact',
  p_is_ongoing         boolean   default false
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_id        uuid;
  v_audit_id  uuid;
  v_trial_id  uuid;
begin
  if not public.has_space_access(p_space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_date_precision not in ('exact', 'month', 'quarter', 'half', 'year')
     or p_end_date_precision not in ('exact', 'month', 'quarter', 'half', 'year') then
    raise exception 'invalid date_precision' using errcode = '22023';
  end if;

  if p_is_ongoing and p_end_date is not null then
    raise exception 'an ongoing marker cannot have an end date' using errcode = '22023';
  end if;

  if p_trial_ids is not null and array_length(p_trial_ids, 1) > 0 then
    foreach v_trial_id in array p_trial_ids
    loop
      if not exists (
        select 1 from public.trials t
         where t.id = v_trial_id and t.space_id = p_space_id
      ) then
        raise exception 'trial % is not in space %', v_trial_id, p_space_id
          using errcode = '42501';
      end if;
    end loop;
  end if;

  insert into public.markers (
    space_id, marker_type_id, title, projection, event_date, end_date,
    description, source_url, created_by, source_doc_id,
    date_precision, end_date_precision, is_ongoing
  ) values (
    p_space_id, p_marker_type_id, p_title, p_projection, p_event_date,
    p_end_date, p_description, p_source_url, v_uid, p_source_doc_id,
    p_date_precision, p_end_date_precision, p_is_ongoing
  )
  returning id into v_id;

  if p_trial_ids is not null and array_length(p_trial_ids, 1) > 0 then
    foreach v_trial_id in array p_trial_ids
    loop
      insert into public.marker_assignments (marker_id, trial_id)
        values (v_id, v_trial_id)
        on conflict do nothing;
    end loop;

    select id into v_audit_id
      from public.marker_changes
     where marker_id = v_id and change_type = 'created'
     order by changed_at desc
     limit 1;

    if v_audit_id is not null then
      perform public._emit_events_from_marker_change(v_audit_id, p_change_source);
    end if;
  end if;

  return v_id;
end;
$$;

comment on function public.create_marker(uuid, uuid, text, text, date, date, text, text, uuid[], uuid, text, text, text, boolean) is
  'Shared entity-create RPC for markers. Inserts marker (with date/end-date precision + is_ongoing), assignments, then audit fan-out. Caller must hold owner/editor on the space; every p_trial_ids trial must live in p_space_id; an ongoing marker cannot also have an end date.';

grant execute on function public.create_marker(
  uuid, uuid, text, text, date, date, text, text, uuid[], uuid, text, text, text, boolean
) to authenticated;

notify pgrst, 'reload schema';
