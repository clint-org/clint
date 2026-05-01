-- migration: 20260501120000_palette_tables_and_indexes
-- purpose: pg_trgm extension, GIN trigram indexes for command palette search,
--          palette_pinned and palette_recents tables with RLS

create extension if not exists pg_trgm;

-- Trigram indexes for fuzzy/prefix search across searchable text columns.
create index if not exists companies_name_trgm
  on public.companies using gin (name gin_trgm_ops);

create index if not exists products_name_trgm
  on public.products using gin (name gin_trgm_ops);

create index if not exists products_generic_name_trgm
  on public.products using gin (generic_name gin_trgm_ops);

-- trials.name is the display name; trials.identifier is the NCT / registry ID.
create index if not exists trials_name_trgm
  on public.trials using gin (name gin_trgm_ops);

create index if not exists trials_identifier_trgm
  on public.trials using gin (identifier gin_trgm_ops);

-- markers is the physical table backing the 'catalyst' palette kind.
create index if not exists markers_title_trgm
  on public.markers using gin (title gin_trgm_ops);

create index if not exists events_title_trgm
  on public.events using gin (title gin_trgm_ops);

-- Pinned items per user per space.
create table public.palette_pinned (
  user_id    uuid not null references auth.users on delete cascade,
  space_id   uuid not null references public.spaces on delete cascade,
  kind       text not null check (kind in ('company','product','trial','catalyst','event')),
  entity_id  uuid not null,
  position   int  not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, space_id, kind, entity_id)
);

create index palette_pinned_user_space
  on public.palette_pinned (user_id, space_id, position);

-- Recently opened entities per user per space.
create table public.palette_recents (
  user_id        uuid not null references auth.users on delete cascade,
  space_id       uuid not null references public.spaces on delete cascade,
  kind           text not null check (kind in ('company','product','trial','catalyst','event')),
  entity_id      uuid not null,
  last_opened_at timestamptz not null default now(),
  primary key (user_id, space_id, kind, entity_id)
);

create index palette_recents_user_space_time
  on public.palette_recents (user_id, space_id, last_opened_at desc);

-- RLS: each row is owned by user_id; only that user may read or write.
alter table public.palette_pinned  enable row level security;
alter table public.palette_recents enable row level security;

create policy palette_pinned_owner
  on public.palette_pinned
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy palette_recents_owner
  on public.palette_recents
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.palette_pinned  is 'User-pinned entities shown in the command palette empty state';
comment on table public.palette_recents is 'User-recently-opened entities shown in the command palette empty state';
