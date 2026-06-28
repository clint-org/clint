create or replace function public.create_event(
  p_space_id uuid, p_event_type_id uuid, p_title text, p_event_date date, p_anchor_type text,
  p_anchor_id uuid default null, p_projection text default 'actual',
  p_date_precision text default 'exact', p_end_date date default null,
  p_end_date_precision text default 'exact', p_is_ongoing boolean default false,
  p_description text default null, p_source_url text default null,
  p_significance text default null, p_visibility text default null, p_source_doc_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ok boolean;
begin
  if not public.has_space_access(p_space_id, array['owner','editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_is_ongoing and p_end_date is not null then
    raise exception 'an ongoing event cannot have an end date' using errcode = '22023';
  end if;
  if p_anchor_type not in ('space','company','asset','trial') then
    raise exception 'invalid anchor_type' using errcode = '22023';
  end if;
  if p_anchor_type <> 'space' and p_anchor_id is null then
    raise exception 'anchor_id required for anchor_type %', p_anchor_type using errcode = '22023';
  end if;
  -- anchor entity must live in the space
  if p_anchor_type = 'company' then
    select exists(select 1 from public.companies where id = p_anchor_id and space_id = p_space_id) into v_ok;
  elsif p_anchor_type = 'asset' then
    select exists(select 1 from public.assets where id = p_anchor_id and space_id = p_space_id) into v_ok;
  elsif p_anchor_type = 'trial' then
    select exists(select 1 from public.trials where id = p_anchor_id and space_id = p_space_id) into v_ok;
  else v_ok := true; end if;
  if not v_ok then raise exception 'anchor % not in space %', p_anchor_id, p_space_id using errcode = '42501'; end if;

  insert into public.events (space_id, event_type_id, title, event_date, anchor_type, anchor_id,
    projection, date_precision, end_date, end_date_precision, is_ongoing, description, source_url,
    significance, visibility, source_doc_id)
  values (p_space_id, p_event_type_id, p_title, p_event_date, p_anchor_type, p_anchor_id,
    p_projection, p_date_precision, p_end_date, p_end_date_precision, p_is_ongoing, p_description, p_source_url,
    p_significance, p_visibility, p_source_doc_id)
  returning id into v_id;
  return v_id;
end; $$;

grant execute on function public.create_event(uuid,uuid,text,date,text,uuid,text,text,date,text,boolean,text,text,text,text,uuid) to authenticated;
notify pgrst, 'reload schema';
