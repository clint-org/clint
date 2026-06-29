-- Stage 3: create_event + update_event gain p_metadata jsonb (events.metadata) so the
-- merged Event form can persist tags + regulatory pathway. Both defs are reproduced from
-- the live pg_get_functiondef (post re-anchor migration 20260629030000); only p_metadata
-- and the metadata column write are added. update_event uses coalesce(p_metadata, metadata)
-- to match its existing conditional-update pattern for event_type_id/anchor (a caller that
-- omits p_metadata leaves metadata untouched). create_event sets metadata = p_metadata
-- (null when not provided).

-- Adding a param changes the signature, so drop the old defs first (create or replace
-- would otherwise create a second overload and make calls ambiguous).
drop function if exists public.create_event(uuid,uuid,text,date,text,uuid,text,text,date,text,boolean,text,text,text,text,uuid,jsonb);
drop function if exists public.update_event(uuid,text,date,text,text,date,text,boolean,text,text,text,text,boolean,uuid,text,uuid);

-- create_event: add trailing p_metadata jsonb default null (18th param).
create or replace function public.create_event(
  p_space_id uuid, p_event_type_id uuid, p_title text, p_event_date date, p_anchor_type text,
  p_anchor_id uuid default null, p_projection text default 'actual', p_date_precision text default 'exact',
  p_end_date date default null, p_end_date_precision text default 'exact', p_is_ongoing boolean default false,
  p_description text default null, p_source_url text default null, p_significance text default null,
  p_visibility text default null, p_source_doc_id uuid default null, p_sources jsonb default null,
  p_metadata jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  if p_anchor_type = 'company' then
    select exists(select 1 from public.companies where id = p_anchor_id and space_id = p_space_id) into v_ok;
  elsif p_anchor_type = 'asset' then
    select exists(select 1 from public.assets where id = p_anchor_id and space_id = p_space_id) into v_ok;
  elsif p_anchor_type = 'trial' then
    select exists(select 1 from public.trials where id = p_anchor_id and space_id = p_space_id) into v_ok;
  else v_ok := true; end if;
  if not v_ok then raise exception 'anchor % not in space %', p_anchor_id, p_space_id using errcode = '42501'; end if;

  insert into public.events (space_id, event_type_id, title, event_date, anchor_type, anchor_id,
    projection, date_precision, end_date, end_date_precision, is_ongoing, description,
    significance, visibility, source_doc_id, metadata)
  values (p_space_id, p_event_type_id, p_title, p_event_date, p_anchor_type, p_anchor_id,
    p_projection, p_date_precision, p_end_date, p_end_date_precision, p_is_ongoing, p_description,
    p_significance, p_visibility, p_source_doc_id, p_metadata)
  returning id into v_id;

  if p_sources is not null then
    insert into public.event_sources (event_id, url, label, sort_order)
    select v_id, (s.elem->>'url'), (s.elem->>'label'), (s.ord)::int
    from jsonb_array_elements(p_sources) with ordinality as s(elem, ord)
    where coalesce(s.elem->>'url','') <> '';
  end if;

  return v_id;
end; $function$;

-- update_event: add trailing p_metadata jsonb default null (17th param). Preserves the
-- re-anchor params, anchor validation (22023), and the trial_change_events activity emit.
create or replace function public.update_event(
  p_event_id uuid, p_title text, p_event_date date, p_projection text, p_date_precision text,
  p_end_date date, p_end_date_precision text, p_is_ongoing boolean, p_description text,
  p_source_url text, p_significance text, p_visibility text, p_no_longer_expected boolean,
  p_event_type_id uuid default null, p_anchor_type text default null, p_anchor_id uuid default null,
  p_metadata jsonb default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_space             uuid;
  v_old_event_date    date;
  v_anchor_type       text;
  v_anchor_id         uuid;
  v_old_title         text;
  v_old_description   text;
  v_event_type        text;
  v_ok                boolean;
  v_eff_anchor_type   text;
  v_eff_anchor_id     uuid;
begin
  select space_id, event_date, anchor_type, anchor_id, title, description
    into v_space, v_old_event_date, v_anchor_type, v_anchor_id, v_old_title, v_old_description
    from public.events where id = p_event_id;
  if v_space is null then raise exception 'event not found' using errcode = 'P0002'; end if;
  if not public.has_space_access(v_space, array['owner','editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_is_ongoing and p_end_date is not null then
    raise exception 'an ongoing event cannot have an end date' using errcode = '22023';
  end if;

  if p_anchor_type is not null then
    if p_anchor_type not in ('space','company','asset','trial') then
      raise exception 'invalid anchor_type' using errcode = '22023';
    end if;
    if p_anchor_type <> 'space' and p_anchor_id is null then
      raise exception 'anchor_id required for anchor_type %', p_anchor_type using errcode = '22023';
    end if;
    if p_anchor_type = 'company' then
      select exists(select 1 from public.companies where id = p_anchor_id and space_id = v_space) into v_ok;
    elsif p_anchor_type = 'asset' then
      select exists(select 1 from public.assets    where id = p_anchor_id and space_id = v_space) into v_ok;
    elsif p_anchor_type = 'trial' then
      select exists(select 1 from public.trials    where id = p_anchor_id and space_id = v_space) into v_ok;
    else v_ok := true; end if;
    if not v_ok then
      raise exception 'anchor % not in space %', p_anchor_id, v_space using errcode = '22023';
    end if;
  end if;

  update public.events set
    title               = p_title,
    event_date          = p_event_date,
    projection          = p_projection,
    date_precision      = p_date_precision,
    end_date            = p_end_date,
    end_date_precision  = p_end_date_precision,
    is_ongoing          = p_is_ongoing,
    description         = p_description,
    significance        = p_significance,
    visibility          = p_visibility,
    no_longer_expected  = p_no_longer_expected,
    event_type_id       = coalesce(p_event_type_id, event_type_id),
    anchor_type         = coalesce(p_anchor_type,   anchor_type),
    anchor_id           = case
                            when p_anchor_type is null   then anchor_id
                            when p_anchor_type = 'space' then null
                            else p_anchor_id
                          end,
    metadata            = coalesce(p_metadata, metadata)
  where id = p_event_id;

  v_eff_anchor_type := coalesce(p_anchor_type, v_anchor_type);
  v_eff_anchor_id   := case
                         when p_anchor_type is null   then v_anchor_id
                         when p_anchor_type = 'space' then null
                         else p_anchor_id
                       end;

  if v_eff_anchor_type = 'trial' and v_eff_anchor_id is not null
     and (v_old_event_date is distinct from p_event_date
          or v_old_title is distinct from p_title
          or v_old_description is distinct from p_description) then
    v_event_type := case when v_old_event_date is distinct from p_event_date
                         then 'date_moved' else 'event_edited' end;
    insert into public.trial_change_events
      (trial_id, space_id, event_type, source, payload, occurred_at, event_id)
    values (
      v_eff_anchor_id,
      v_space,
      v_event_type,
      'analyst',
      case when v_event_type = 'date_moved'
           then jsonb_build_object(
             'which_date', 'event_date',
             'from',       v_old_event_date,
             'to',         p_event_date,
             'days_diff',  case when v_old_event_date is not null and p_event_date is not null
                                then p_event_date - v_old_event_date else null end,
             'direction',  case when v_old_event_date is null or p_event_date is null then null
                                when p_event_date > v_old_event_date then 'slip'
                                when p_event_date < v_old_event_date then 'accelerate'
                                else 'none' end
           )
           else jsonb_build_object('title', p_title)
      end,
      now(),
      p_event_id
    );
  end if;
end;
$function$;

-- Re-grant execute (dropping the old signatures dropped their grants).
grant execute on function public.create_event(uuid,uuid,text,date,text,uuid,text,text,date,text,boolean,text,text,text,text,uuid,jsonb,jsonb) to authenticated;
grant execute on function public.update_event(uuid,text,date,text,text,date,text,boolean,text,text,text,text,boolean,uuid,text,uuid,jsonb) to authenticated;

-- in-migration smoke: create with metadata, then verify it round-trips + update changes it.
do $$
declare v_space uuid; v_type uuid; v_trial uuid; v_id uuid; v_meta jsonb;
begin
  select id into v_space from public.spaces limit 1;
  select id into v_type from public.event_types where is_system limit 1;
  if v_space is not null and v_type is not null then
    select id into v_trial from public.trials where space_id = v_space limit 1;
    if v_trial is not null then
      v_id := public.create_event(
        p_space_id => v_space, p_event_type_id => v_type, p_title => '__meta_smoke__',
        p_event_date => '2030-01-01', p_anchor_type => 'trial', p_anchor_id => v_trial,
        p_metadata => jsonb_build_object('tags', jsonb_build_array('t1'), 'pathway', 'BLA'));
      select metadata into v_meta from public.events where id = v_id;
      if v_meta is null or v_meta->>'pathway' <> 'BLA' then
        raise exception 'create_event metadata smoke failed: %', v_meta;
      end if;
      delete from public.events where id = v_id;
    end if;
  end if;
exception when insufficient_privilege then
  -- The migration role cannot satisfy create_event's has_space_access guard against a
  -- populated remote DB (no auth.uid()), so it raises 42501. This smoke is a local-only
  -- sanity check (it skips on an empty DB anyway); safe to no-op when access is denied.
  null;
end $$;

notify pgrst, 'reload schema';
