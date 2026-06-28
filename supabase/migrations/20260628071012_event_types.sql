create table public.event_types (
  id                   uuid primary key default gen_random_uuid(),
  space_id             uuid references public.spaces (id) on delete cascade,
  category_id          uuid not null references public.event_type_categories (id),
  name                 text not null,
  shape                text not null check (shape in ('circle','diamond','flag','triangle','square','hexagon','dashed-line')),
  fill_style           text not null default 'filled' check (fill_style in ('filled','outline')),
  color                text not null,
  inner_mark           text not null default 'none' check (inner_mark in ('dot','dash','check','x','none')),
  default_significance text not null default 'high' check (default_significance in ('high','low')),
  is_system            boolean not null default false,
  display_order        int not null default 0,
  created_by           uuid references auth.users (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users (id)
);
create index idx_event_types_space_id on public.event_types (space_id);
create index idx_event_types_category_id on public.event_types (category_id);

alter table public.event_types enable row level security;
create policy "event_types: select" on public.event_types for select to authenticated
  using (space_id is null or public.has_space_access(space_id));
create policy "event_types: insert" on public.event_types for insert to authenticated
  with check (public.has_space_access(space_id, array['owner','editor']));
create policy "event_types: update" on public.event_types for update to authenticated
  using (public.has_space_access(space_id, array['owner','editor']))
  with check (public.has_space_access(space_id, array['owner','editor']));
create policy "event_types: delete" on public.event_types for delete to authenticated
  using (public.has_space_access(space_id, array['owner','editor']));

create trigger trg_event_types_set_created_by  before insert on public.event_types
  for each row execute function public._set_created_by();
create trigger trg_event_types_set_updated_audit before update on public.event_types
  for each row execute function public._set_updated_audit();

-- system types (high significance unless noted). Commercial uses the new hexagon glyph.
insert into public.event_types (id, space_id, created_by, name, shape, fill_style, color, inner_mark, default_significance, is_system, display_order, category_id) values
  ('a0000000-0000-0000-0000-000000000011', null, null, 'Trial Start',        'dashed-line','filled','#94a3b8','none','high', true, 1, 'd0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000012', null, null, 'Trial End',          'dashed-line','filled','#94a3b8','none','high', true, 2, 'd0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000008', null, null, 'Primary Completion', 'circle',     'filled','#475569','none','high', true, 3, 'd0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000013', null, null, 'Topline Data',       'circle',     'filled','#4ade80','dot', 'high', true, 1, 'd0000000-0000-0000-0000-000000000002'),
  ('a0000000-0000-0000-0000-000000000032', null, null, 'Regulatory Filing',  'diamond',    'filled','#f97316','dot', 'high', true, 1, 'd0000000-0000-0000-0000-000000000003'),
  ('a0000000-0000-0000-0000-000000000035', null, null, 'Approval',           'flag',       'filled','#3b82f6','none','high', true, 1, 'd0000000-0000-0000-0000-000000000004'),
  ('a0000000-0000-0000-0000-000000000036', null, null, 'Launch',             'triangle',   'filled','#7c3aed','none','high', true, 1, 'd0000000-0000-0000-0000-000000000005'),
  ('a0000000-0000-0000-0000-000000000020', null, null, 'LOE Date',           'square',     'filled','#78350f','x',   'high', true, 1, 'd0000000-0000-0000-0000-000000000006'),
  ('a0000000-0000-0000-0000-000000000040', null, null, 'Distribution',       'hexagon',    'filled','#0e7490','none','high', true, 1, 'd0000000-0000-0000-0000-000000000007'),
  ('a0000000-0000-0000-0000-000000000050', null, null, 'Leadership Change',  'circle',     'filled','#475569','none','low',  true, 1, 'd0000000-0000-0000-0000-000000000008'),
  ('a0000000-0000-0000-0000-000000000060', null, null, 'Financial',          'circle',     'filled','#475569','none','low',  true, 1, 'd0000000-0000-0000-0000-000000000009'),
  ('a0000000-0000-0000-0000-000000000070', null, null, 'Strategic',          'circle',     'filled','#475569','none','low',  true, 1, 'd0000000-0000-0000-0000-00000000000a')
on conflict (id) do update set name = excluded.name, shape = excluded.shape, color = excluded.color,
  inner_mark = excluded.inner_mark, default_significance = excluded.default_significance, category_id = excluded.category_id;

notify pgrst, 'reload schema';
