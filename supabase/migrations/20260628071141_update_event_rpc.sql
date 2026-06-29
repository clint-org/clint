create or replace function public.update_event(
  p_event_id uuid, p_title text, p_event_date date, p_projection text, p_date_precision text,
  p_end_date date, p_end_date_precision text, p_is_ongoing boolean, p_description text,
  p_source_url text, p_significance text, p_visibility text, p_no_longer_expected boolean
) returns void language plpgsql security definer set search_path = public as $$
declare v_space uuid;
begin
  select space_id into v_space from public.events where id = p_event_id;
  if v_space is null then raise exception 'event not found' using errcode = 'P0002'; end if;
  if not public.has_space_access(v_space, array['owner','editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_is_ongoing and p_end_date is not null then
    raise exception 'an ongoing event cannot have an end date' using errcode = '22023';
  end if;
  update public.events set
    title = p_title, event_date = p_event_date, projection = p_projection, date_precision = p_date_precision,
    end_date = p_end_date, end_date_precision = p_end_date_precision, is_ongoing = p_is_ongoing,
    description = p_description, source_url = p_source_url, significance = p_significance,
    visibility = p_visibility, no_longer_expected = p_no_longer_expected
  where id = p_event_id;
end; $$;

grant execute on function public.update_event(uuid,text,date,text,text,date,text,boolean,text,text,text,text,boolean) to authenticated;
notify pgrst, 'reload schema';
