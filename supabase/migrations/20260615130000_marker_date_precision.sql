-- Fuzzy / approximate marker dates (P2.1).
--
-- A catalyst is frequently known only to a quarter, month, half, or year.
-- The timeline axis is exact-date, so we keep storing a real date in
-- markers.event_date (the period MIDPOINT, e.g. Q4 2026 -> 2026-11-15) and add
-- a date_precision enum recording how precise that date actually is. The UI
-- renders the period label ("~Q4 '26") + an "(estimated)" affordance instead
-- of a false exact day, and the marker form re-derives its period pickers from
-- the stored midpoint. Midpoint + label math lives in the client's
-- marker-date-precision.ts (the single source of truth).
--
-- related:
--   - 20260605130000_content_create_authz_and_marker_trial_space.sql (create_marker origin)
--   - 20260502120700_marker_changes_trigger.sql                      (event_date change feed)

-- 1. Column ------------------------------------------------------------------

alter table public.markers
  add column if not exists date_precision text not null default 'exact';

alter table public.markers
  drop constraint if exists markers_date_precision_check;

alter table public.markers
  add constraint markers_date_precision_check
  check (date_precision in ('exact', 'month', 'quarter', 'half', 'year'));

comment on column public.markers.date_precision is
  'How precise event_date actually is. exact = the real day; month/quarter/half/year = event_date holds the period midpoint and the UI renders the period label ("~Q4 ''26") instead of a false exact day. See client marker-date-precision.ts.';

-- 2. create_marker -- add p_date_precision -----------------------------------
-- Drop the old 11-arg signature and recreate with the appended defaulted
-- parameter so there is exactly one create_marker (no ambiguous overload).
-- commit_source_import and the Angular UI both call by name / positional with
-- the precision defaulting to 'exact', so existing callers are unaffected.

drop function if exists public.create_marker(
  uuid, uuid, text, text, date, date, text, text, uuid[], uuid, text
);

create or replace function public.create_marker(
  p_space_id       uuid,
  p_marker_type_id uuid,
  p_title          text,
  p_projection     text,
  p_event_date     date,
  p_end_date       date      default null,
  p_description    text      default null,
  p_source_url     text      default null,
  p_trial_ids      uuid[]    default null,
  p_source_doc_id  uuid      default null,
  p_change_source  text      default 'analyst',
  p_date_precision text      default 'exact'
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

  if p_date_precision not in ('exact', 'month', 'quarter', 'half', 'year') then
    raise exception 'invalid date_precision %', p_date_precision
      using errcode = '22023';
  end if;

  -- Every trial this marker is pinned to must live in the marker's space.
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
    description, source_url, created_by, source_doc_id, date_precision
  ) values (
    p_space_id, p_marker_type_id, p_title, p_projection, p_event_date,
    p_end_date, p_description, p_source_url, v_uid, p_source_doc_id, p_date_precision
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

comment on function public.create_marker(uuid, uuid, text, text, date, date, text, text, uuid[], uuid, text, text) is
  'Shared entity-create RPC for markers. Inserts marker (with date_precision), then assignments, then re-emits audit fan-out. Used by both commit_source_import and the Angular UI. Caller must hold owner/editor on the space; every p_trial_ids trial must live in p_space_id.';

grant execute on function public.create_marker(
  uuid, uuid, text, text, date, date, text, text, uuid[], uuid, text, text
) to authenticated;

-- 3. Reload PostgREST so the new signature is callable immediately ------------

notify pgrst, 'reload schema';
