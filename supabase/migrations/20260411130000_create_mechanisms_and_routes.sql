-- create mechanisms_of_action and routes_of_administration reference tables

create table if not exists public.mechanisms_of_action (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null, -- nullable: seed rows have no creator; diverges from other tables intentionally
  name text not null,
  description text,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, name)
);

create index if not exists idx_mechanisms_of_action_space_order
  on public.mechanisms_of_action (space_id, display_order, name);

create table if not exists public.routes_of_administration (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null, -- nullable: seed rows have no creator; diverges from other tables intentionally
  name text not null,
  abbreviation text,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, name)
);

create index if not exists idx_routes_of_administration_space_order
  on public.routes_of_administration (space_id, display_order, name);

-- note: no updated_at trigger; handle_updated_at() is not defined in this codebase.
-- updated_at reflects insert time only until a trigger is added in a future migration.

-- RLS
alter table public.mechanisms_of_action enable row level security;
alter table public.routes_of_administration enable row level security;

create policy "space members can view mechanisms_of_action" on public.mechanisms_of_action for select to authenticated
using ( public.has_space_access(space_id) );
create policy "space editors can insert mechanisms_of_action" on public.mechanisms_of_action for insert to authenticated
with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can update mechanisms_of_action" on public.mechanisms_of_action for update to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) )
with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can delete mechanisms_of_action" on public.mechanisms_of_action for delete to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) );

create policy "space members can view routes_of_administration" on public.routes_of_administration for select to authenticated
using ( public.has_space_access(space_id) );
create policy "space editors can insert routes_of_administration" on public.routes_of_administration for insert to authenticated
with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can update routes_of_administration" on public.routes_of_administration for update to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) )
with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can delete routes_of_administration" on public.routes_of_administration for delete to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) );
