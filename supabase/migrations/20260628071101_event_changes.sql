create table public.event_changes (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null,
  space_id    uuid not null references public.spaces (id) on delete cascade,
  change_type varchar(20) not null,
  old_values  jsonb,
  new_values  jsonb,
  changed_by  uuid references auth.users (id),
  changed_at  timestamptz not null default now()
);
create index idx_event_changes_event_changed on public.event_changes (event_id, changed_at desc);
create index idx_event_changes_space_changed on public.event_changes (space_id, changed_at desc);

alter table public.event_changes enable row level security;
create policy event_changes_select on public.event_changes for select to authenticated
  using (public.has_space_access(space_id));

create or replace function public._log_event_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_payload jsonb; v_old jsonb; v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    v_payload := jsonb_build_object('event_date',new.event_date,'end_date',new.end_date,'title',new.title,
      'projection',new.projection,'event_type_id',new.event_type_id,'significance',new.significance,
      'visibility',new.visibility,'description',new.description);
    insert into public.event_changes (event_id, space_id, change_type, old_values, new_values, changed_by)
      values (new.id, new.space_id, 'created', null, v_payload, v_uid);
    return new;
  elsif tg_op = 'UPDATE' then
    if new.event_date is not distinct from old.event_date and new.end_date is not distinct from old.end_date
       and new.title is not distinct from old.title and new.projection is not distinct from old.projection
       and new.event_type_id is not distinct from old.event_type_id and new.significance is not distinct from old.significance
       and new.visibility is not distinct from old.visibility and new.description is not distinct from old.description then
      return new;
    end if;
    v_old := jsonb_build_object('event_date',old.event_date,'end_date',old.end_date,'title',old.title,
      'projection',old.projection,'event_type_id',old.event_type_id,'significance',old.significance,
      'visibility',old.visibility,'description',old.description);
    v_payload := jsonb_build_object('event_date',new.event_date,'end_date',new.end_date,'title',new.title,
      'projection',new.projection,'event_type_id',new.event_type_id,'significance',new.significance,
      'visibility',new.visibility,'description',new.description);
    insert into public.event_changes (event_id, space_id, change_type, old_values, new_values, changed_by)
      values (new.id, new.space_id, 'updated', v_old, v_payload, v_uid);
    return new;
  elsif tg_op = 'DELETE' then
    v_old := jsonb_build_object('event_date',old.event_date,'end_date',old.end_date,'title',old.title,
      'projection',old.projection,'event_type_id',old.event_type_id,'significance',old.significance,
      'visibility',old.visibility,'description',old.description);
    insert into public.event_changes (event_id, space_id, change_type, old_values, new_values, changed_by)
      values (old.id, old.space_id, 'deleted', v_old, null, v_uid);
    return old;
  end if;
  return null;
end; $$;

revoke execute on function public._log_event_change() from public;
create trigger events_audit before insert or update or delete on public.events
  for each row execute function public._log_event_change();
