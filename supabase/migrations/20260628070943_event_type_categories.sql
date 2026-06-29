create table public.event_type_categories (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid references public.spaces (id) on delete cascade,
  name          text not null,
  display_order int  not null default 0,
  is_system     boolean not null default false,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_event_type_categories_space_id on public.event_type_categories (space_id);

alter table public.event_type_categories enable row level security;
create policy "etc: select" on public.event_type_categories for select to authenticated
  using (space_id is null or public.has_space_access(space_id));
create policy "etc: insert" on public.event_type_categories for insert to authenticated
  with check (public.has_space_access(space_id, array['owner','editor']));
create policy "etc: update" on public.event_type_categories for update to authenticated
  using (public.has_space_access(space_id, array['owner','editor']))
  with check (public.has_space_access(space_id, array['owner','editor']));
create policy "etc: delete" on public.event_type_categories for delete to authenticated
  using (public.has_space_access(space_id, array['owner','editor']));

create trigger trg_etc_set_created_by  before insert on public.event_type_categories
  for each row execute function public._set_created_by();
create trigger trg_etc_set_updated_audit before update on public.event_type_categories
  for each row execute function public._set_updated_audit();

insert into public.event_type_categories (id, space_id, name, display_order, is_system, created_by) values
  ('d0000000-0000-0000-0000-000000000001', null, 'Clinical',             1, true, null),
  ('d0000000-0000-0000-0000-000000000002', null, 'Data',                 2, true, null),
  ('d0000000-0000-0000-0000-000000000003', null, 'Regulatory',           3, true, null),
  ('d0000000-0000-0000-0000-000000000004', null, 'Approval',             4, true, null),
  ('d0000000-0000-0000-0000-000000000005', null, 'Launch',               5, true, null),
  ('d0000000-0000-0000-0000-000000000006', null, 'Loss of Exclusivity',  6, true, null),
  ('d0000000-0000-0000-0000-000000000007', null, 'Commercial',           7, true, null),
  ('d0000000-0000-0000-0000-000000000008', null, 'Leadership',           8, true, null),
  ('d0000000-0000-0000-0000-000000000009', null, 'Financial',            9, true, null),
  ('d0000000-0000-0000-0000-00000000000a', null, 'Strategic',           10, true, null)
on conflict (id) do update set name = excluded.name, display_order = excluded.display_order, is_system = excluded.is_system;

notify pgrst, 'reload schema';
