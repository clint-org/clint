-- Drop the vestigial, required p_source_url param from update_event.
--
-- 20260628320000 kept p_source_url as "vestigial, accepted-but-ignored" on both
-- writers, expecting the client to keep passing it positionally. The client's
-- UpdateEventArgs (event-write.model.ts) instead DROPPED it. create_event survived
-- because its p_source_url has a DEFAULT; update_event's did not, so every edit
-- 404'd at PostgREST (PGRST202 -> "Could not save the event"). The body never reads
-- p_source_url (source_url column was dropped in 20260628320000), so removing the
-- param is a pure signature change that aligns the RPC to the shipped client.
--
-- create_event is intentionally NOT touched: its p_source_url has a default and
-- producers call it positionally. This migration must be the highest-versioned
-- redefinition of update_event (migrations:check-redefs).

drop function if exists public.update_event(
  uuid, text, date, text, text, date, text, boolean, text, text, text, text, boolean, uuid, text, uuid, jsonb
);

create function public.update_event(
  p_event_id uuid, p_title text, p_event_date date, p_projection text, p_date_precision text,
  p_end_date date, p_end_date_precision text, p_is_ongoing boolean, p_description text,
  p_significance text, p_visibility text, p_no_longer_expected boolean,
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

grant execute on function public.update_event(
  uuid, text, date, text, text, date, text, boolean, text, text, text, boolean, uuid, text, uuid, jsonb
) to authenticated;

-- in-migration smoke: call update_event with the CLIENT shape (named args, no
-- p_source_url). Wrapped for populated remote DBs where the migration role cannot
-- satisfy has_space_access (42501) -- same rationale as 20260629040000's smoke.
do $$
declare v_space uuid; v_type uuid; v_trial uuid; v_id uuid; v_title text;
begin
  select id into v_space from public.spaces limit 1;
  select id into v_type from public.event_types where is_system limit 1;
  if v_space is not null and v_type is not null then
    select id into v_trial from public.trials where space_id = v_space limit 1;
    if v_trial is not null then
      v_id := public.create_event(
        p_space_id => v_space, p_event_type_id => v_type, p_title => '__edit_shape_smoke__',
        p_event_date => '2030-01-01', p_anchor_type => 'trial', p_anchor_id => v_trial);
      perform public.update_event(
        p_event_id => v_id, p_title => '__edit_shape_smoke_renamed__', p_event_date => '2030-01-01',
        p_projection => 'actual', p_date_precision => 'exact', p_end_date => null,
        p_end_date_precision => 'exact', p_is_ongoing => false, p_description => null,
        p_significance => null, p_visibility => null, p_no_longer_expected => false);
      select title into v_title from public.events where id = v_id;
      if v_title <> '__edit_shape_smoke_renamed__' then
        raise exception 'update_event client-shape smoke failed: %', v_title;
      end if;
      delete from public.events where id = v_id;
    end if;
  end if;
exception when insufficient_privilege then
  null;
end $$;

notify pgrst, 'reload schema';
