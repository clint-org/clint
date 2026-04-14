-- migration: 20260413120000_events_system
-- purpose: create events system tables (event_categories, event_threads, events, event_sources, event_links)
-- affected tables (created): event_categories, event_threads, events, event_sources, event_links
-- notes: events are separate from markers; they share no tables

-- ============================================================
-- 1. event_categories
-- ============================================================

create table public.event_categories (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid references public.spaces (id) on delete cascade,
  name        text not null,
  display_order int not null,
  is_system   boolean not null default false,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.event_categories is 'Event categories: system defaults (space_id null) plus space-custom ones.';

create index idx_event_categories_space_id on public.event_categories (space_id);

alter table public.event_categories enable row level security;

-- SELECT: authenticated users see system categories; space members see custom categories
create policy "event_categories: select"
  on public.event_categories for select to authenticated
  using (
    is_system = true
    or public.has_space_access(space_id)
  );

-- INSERT: editors/owners can create custom categories
create policy "event_categories: insert"
  on public.event_categories for insert to authenticated
  with check (
    is_system = false
    and public.has_space_access(space_id, array['owner', 'editor'])
  );

-- UPDATE: editors/owners can update custom categories
create policy "event_categories: update"
  on public.event_categories for update to authenticated
  using (
    is_system = false
    and public.has_space_access(space_id, array['owner', 'editor'])
  )
  with check (
    is_system = false
    and public.has_space_access(space_id, array['owner', 'editor'])
  );

-- DELETE: editors/owners can delete custom categories
create policy "event_categories: delete"
  on public.event_categories for delete to authenticated
  using (
    is_system = false
    and public.has_space_access(space_id, array['owner', 'editor'])
  );

-- ============================================================
-- 2. event_threads
-- ============================================================

create table public.event_threads (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces (id) on delete cascade,
  title       text not null,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now()
);

comment on table public.event_threads is 'Sequential narrative chains grouping related events into a story.';

create index idx_event_threads_space_id on public.event_threads (space_id);

alter table public.event_threads enable row level security;

create policy "event_threads: select"
  on public.event_threads for select to authenticated
  using (public.has_space_access(space_id));

create policy "event_threads: insert"
  on public.event_threads for insert to authenticated
  with check (public.has_space_access(space_id, array['owner', 'editor']));

create policy "event_threads: update"
  on public.event_threads for update to authenticated
  using (public.has_space_access(space_id, array['owner', 'editor']))
  with check (public.has_space_access(space_id, array['owner', 'editor']));

create policy "event_threads: delete"
  on public.event_threads for delete to authenticated
  using (public.has_space_access(space_id, array['owner', 'editor']));

-- ============================================================
-- 3. events
-- ============================================================

create table public.events (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references public.spaces (id) on delete cascade,
  company_id    uuid references public.companies (id) on delete cascade,
  product_id    uuid references public.products (id) on delete cascade,
  trial_id      uuid references public.trials (id) on delete cascade,
  category_id   uuid not null references public.event_categories (id),
  thread_id     uuid references public.event_threads (id) on delete set null,
  thread_order  int,
  title         text not null,
  event_date    date not null,
  description   text,
  priority      text not null default 'low',
  tags          text[] not null default '{}',
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint events_priority_check check (priority in ('high', 'low')),
  constraint events_entity_level_check check (
    (case when company_id is not null then 1 else 0 end)
    + (case when product_id is not null then 1 else 0 end)
    + (case when trial_id is not null then 1 else 0 end)
    <= 1
  )
);

comment on table public.events is 'Analyst-created competitive intelligence events at space/company/product/trial level.';

create index idx_events_space_id on public.events (space_id);
create index idx_events_event_date on public.events (event_date);
create index idx_events_category_id on public.events (category_id);
create index idx_events_company_id on public.events (company_id);
create index idx_events_product_id on public.events (product_id);
create index idx_events_trial_id on public.events (trial_id);
create index idx_events_priority on public.events (priority);
create index idx_events_thread_id on public.events (thread_id) where thread_id is not null;

alter table public.events enable row level security;

create policy "events: select"
  on public.events for select to authenticated
  using (public.has_space_access(space_id));

create policy "events: insert"
  on public.events for insert to authenticated
  with check (public.has_space_access(space_id, array['owner', 'editor']));

create policy "events: update"
  on public.events for update to authenticated
  using (public.has_space_access(space_id, array['owner', 'editor']))
  with check (public.has_space_access(space_id, array['owner', 'editor']));

create policy "events: delete"
  on public.events for delete to authenticated
  using (public.has_space_access(space_id, array['owner', 'editor']));

-- ============================================================
-- 4. event_sources
-- ============================================================

create table public.event_sources (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  url         text not null,
  label       text,
  created_at  timestamptz not null default now()
);

comment on table public.event_sources is 'Multiple source URLs per event (press releases, SEC filings, etc.).';

create index idx_event_sources_event_id on public.event_sources (event_id);

alter table public.event_sources enable row level security;

create policy "event_sources: select"
  on public.event_sources for select to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_id
      and public.has_space_access(e.space_id)
    )
  );

create policy "event_sources: insert"
  on public.event_sources for insert to authenticated
  with check (
    exists (
      select 1 from public.events e
      where e.id = event_id
      and public.has_space_access(e.space_id, array['owner', 'editor'])
    )
  );

create policy "event_sources: update"
  on public.event_sources for update to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_id
      and public.has_space_access(e.space_id, array['owner', 'editor'])
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = event_id
      and public.has_space_access(e.space_id, array['owner', 'editor'])
    )
  );

create policy "event_sources: delete"
  on public.event_sources for delete to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_id
      and public.has_space_access(e.space_id, array['owner', 'editor'])
    )
  );

-- ============================================================
-- 5. event_links
-- ============================================================

create table public.event_links (
  id                uuid primary key default gen_random_uuid(),
  source_event_id   uuid not null references public.events (id) on delete cascade,
  target_event_id   uuid not null references public.events (id) on delete cascade,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),

  constraint event_links_unique unique (source_event_id, target_event_id),
  constraint event_links_no_self check (source_event_id <> target_event_id)
);

comment on table public.event_links is 'Bidirectional ad-hoc links between related events.';

create index idx_event_links_source on public.event_links (source_event_id);
create index idx_event_links_target on public.event_links (target_event_id);

alter table public.event_links enable row level security;

create policy "event_links: select"
  on public.event_links for select to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = source_event_id
      and public.has_space_access(e.space_id)
    )
  );

create policy "event_links: insert"
  on public.event_links for insert to authenticated
  with check (
    exists (
      select 1 from public.events e
      where e.id = source_event_id
      and public.has_space_access(e.space_id, array['owner', 'editor'])
    )
  );

create policy "event_links: delete"
  on public.event_links for delete to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = source_event_id
      and public.has_space_access(e.space_id, array['owner', 'editor'])
    )
  );

-- ============================================================
-- 6. Seed system event categories
-- ============================================================

insert into public.event_categories (id, space_id, name, display_order, is_system, created_by)
values
  ('e0000000-0000-0000-0000-000000000001', null, 'Leadership',  1, true, null),
  ('e0000000-0000-0000-0000-000000000002', null, 'Regulatory',  2, true, null),
  ('e0000000-0000-0000-0000-000000000003', null, 'Financial',   3, true, null),
  ('e0000000-0000-0000-0000-000000000004', null, 'Strategic',   4, true, null),
  ('e0000000-0000-0000-0000-000000000005', null, 'Clinical',    5, true, null),
  ('e0000000-0000-0000-0000-000000000006', null, 'Commercial',  6, true, null)
on conflict (id) do nothing;
