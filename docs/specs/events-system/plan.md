# Events System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an events system that lets analysts capture competitive intelligence at any entity level, with a unified chronological feed page showing events and markers together.

**Architecture:** New `events` feature module with its own database tables, RPC functions, Angular services, and components. Events are fully independent from markers -- they share no tables. The events page queries both via a UNION ALL RPC. Entity attachment uses nullable FKs with a CHECK constraint.

**Tech Stack:** Angular 19 (standalone components, signals), Supabase (Postgres, RLS, RPC), PrimeNG 19, Tailwind CSS v4

---

## Task 1: Database Migration -- Tables, RLS, Indexes, Seed

**Files:**
- Create: `supabase/migrations/20260413120000_events_system.sql`

- [ ] **Step 1: Create the migration file with event_categories table**

```sql
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
```

- [ ] **Step 2: Add event_threads table**

Append to the same migration file:

```sql
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
```

- [ ] **Step 3: Add events table**

```sql
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
```

- [ ] **Step 4: Add event_sources table**

```sql
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
```

- [ ] **Step 5: Add event_links table**

```sql
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
```

- [ ] **Step 6: Seed system event categories**

```sql
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
```

- [ ] **Step 7: Verify migration syntax**

Run: `cd src/client && npx supabase migration list 2>&1 | tail -5` (or just check the file for SQL syntax errors by reading it).

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260413120000_events_system.sql
git commit -m "feat(db): add events system tables, RLS, and seed categories"
```

---

## Task 2: Database Migration -- RPC Functions

**Files:**
- Create: `supabase/migrations/20260413120100_events_rpc_functions.sql`

- [ ] **Step 1: Create get_events_page_data RPC**

```sql
-- migration: 20260413120100_events_rpc_functions
-- purpose: RPC functions for the events page (unified feed, detail, thread, tags)
-- affected functions (created): get_events_page_data, get_event_detail, get_event_thread, get_space_tags

-- ============================================================
-- 1. get_events_page_data - unified chronological feed
-- ============================================================

create or replace function public.get_events_page_data(
  p_space_id      uuid,
  p_date_from     date     default null,
  p_date_to       date     default null,
  p_entity_level  text     default null,
  p_entity_id     uuid     default null,
  p_category_ids  uuid[]   default null,
  p_tags          text[]   default null,
  p_priority      text     default null,
  p_source_type   text     default null,
  p_limit         int      default 50,
  p_offset        int      default 0
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  -- normalize empty arrays to null
  if p_category_ids = '{}' then p_category_ids := null; end if;
  if p_tags = '{}' then p_tags := null; end if;

  with unified_feed as (
    -- Events half
    select
      'event'::text as source_type,
      ev.id,
      ev.title,
      ev.event_date,
      ec.name as category_name,
      ec.id as category_id,
      ev.priority,
      case
        when ev.trial_id is not null then 'trial'
        when ev.product_id is not null then 'product'
        when ev.company_id is not null then 'company'
        else 'space'
      end as entity_level,
      coalesce(t.name, pr.name, co.name, 'Industry') as entity_name,
      coalesce(ev.trial_id, ev.product_id, ev.company_id) as entity_id,
      coalesce(
        co.name,
        co_via_product.name,
        co_via_trial.name
      ) as company_name,
      ev.tags,
      ev.thread_id is not null as has_thread,
      ev.thread_id,
      ev.description,
      null::text as source_url,
      ev.created_at
    from public.events ev
    join public.event_categories ec on ec.id = ev.category_id
    left join public.companies co on co.id = ev.company_id
    left join public.products pr on pr.id = ev.product_id
    left join public.companies co_via_product on pr.id is not null and co_via_product.id = pr.company_id
    left join public.trials t on t.id = ev.trial_id
    left join public.products pr_via_trial on t.id is not null and pr_via_trial.id = t.product_id
    left join public.companies co_via_trial on pr_via_trial.id is not null and co_via_trial.id = pr_via_trial.company_id
    where ev.space_id = p_space_id
      and (p_source_type is null or p_source_type = 'event')
      and (p_date_from is null or ev.event_date >= p_date_from)
      and (p_date_to is null or ev.event_date <= p_date_to)
      and (p_priority is null or ev.priority = p_priority)
      and (p_tags is null or ev.tags && p_tags)
      and (p_category_ids is null or ec.id = any(p_category_ids))
      and (
        p_entity_level is null
        or (p_entity_level = 'space' and ev.company_id is null and ev.product_id is null and ev.trial_id is null)
        or (p_entity_level = 'company' and ev.company_id is not null)
        or (p_entity_level = 'product' and ev.product_id is not null)
        or (p_entity_level = 'trial' and ev.trial_id is not null)
      )
      and (
        p_entity_id is null
        or ev.company_id = p_entity_id
        or ev.product_id = p_entity_id
        or ev.trial_id = p_entity_id
      )

    union all

    -- Markers half
    select
      'marker'::text as source_type,
      m.id,
      m.title,
      m.event_date,
      mc.name as category_name,
      mc.id as category_id,
      null::text as priority,
      'trial'::text as entity_level,
      t.name as entity_name,
      t.id as entity_id,
      co.name as company_name,
      '{}'::text[] as tags,
      false as has_thread,
      null::uuid as thread_id,
      m.description,
      m.source_url,
      m.created_at
    from public.markers m
    join public.marker_assignments ma on ma.marker_id = m.id
    join public.trials t on t.id = ma.trial_id
    join public.products pr on pr.id = t.product_id
    join public.companies co on co.id = pr.company_id
    join public.marker_types mt on mt.id = m.marker_type_id
    join public.marker_categories mc on mc.id = mt.category_id
    where m.space_id = p_space_id
      and (p_source_type is null or p_source_type = 'marker')
      and (p_date_from is null or m.event_date >= p_date_from)
      and (p_date_to is null or m.event_date <= p_date_to)
      and (p_tags is null)
      and (p_priority is null)
      and (p_category_ids is null or mc.id = any(p_category_ids))
      and (
        p_entity_level is null
        or p_entity_level = 'trial'
      )
      and (
        p_entity_id is null
        or t.id = p_entity_id
        or pr.id = p_entity_id
        or co.id = p_entity_id
      )
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'source_type', uf.source_type,
        'id', uf.id,
        'title', uf.title,
        'event_date', uf.event_date,
        'category_name', uf.category_name,
        'category_id', uf.category_id,
        'priority', uf.priority,
        'entity_level', uf.entity_level,
        'entity_name', uf.entity_name,
        'entity_id', uf.entity_id,
        'company_name', uf.company_name,
        'tags', to_jsonb(uf.tags),
        'has_thread', uf.has_thread,
        'thread_id', uf.thread_id,
        'description', uf.description,
        'source_url', uf.source_url
      )
      order by uf.event_date desc, uf.created_at desc
    ),
    '[]'::jsonb
  )
  into result
  from (
    select * from unified_feed
    order by event_date desc, created_at desc
    limit p_limit offset p_offset
  ) uf;

  return result;
end;
$$;
```

- [ ] **Step 2: Create get_event_detail RPC**

Append to the same file:

```sql
-- ============================================================
-- 2. get_event_detail
-- ============================================================

create or replace function public.get_event_detail(
  p_event_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'id', ev.id,
    'space_id', ev.space_id,
    'title', ev.title,
    'event_date', ev.event_date,
    'description', ev.description,
    'priority', ev.priority,
    'tags', to_jsonb(ev.tags),
    'thread_id', ev.thread_id,
    'thread_order', ev.thread_order,
    'created_by', ev.created_by,
    'created_at', ev.created_at,
    'updated_at', ev.updated_at,
    'category', jsonb_build_object(
      'id', ec.id,
      'name', ec.name
    ),
    'entity_level', case
      when ev.trial_id is not null then 'trial'
      when ev.product_id is not null then 'product'
      when ev.company_id is not null then 'company'
      else 'space'
    end,
    'entity_name', coalesce(t.name, pr.name, co.name, 'Industry'),
    'entity_id', coalesce(ev.trial_id, ev.product_id, ev.company_id),
    'company_name', coalesce(
      co.name,
      co_via_product.name,
      co_via_trial.name
    ),
    'sources', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', es.id, 'url', es.url, 'label', es.label)
        order by es.created_at
      )
      from public.event_sources es
      where es.event_id = ev.id
    ), '[]'::jsonb),
    'thread', case when ev.thread_id is not null then (
      select jsonb_build_object(
        'id', et.id,
        'title', et.title,
        'events', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', te.id,
              'title', te.title,
              'event_date', te.event_date,
              'thread_order', te.thread_order
            )
            order by te.thread_order
          )
          from public.events te
          where te.thread_id = et.id
        ), '[]'::jsonb)
      )
      from public.event_threads et
      where et.id = ev.thread_id
    ) else null end,
    'linked_events', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', le.id,
          'title', le.title,
          'event_date', le.event_date,
          'category_name', lec.name
        )
      )
      from (
        select e2.* from public.event_links el
        join public.events e2 on e2.id = el.target_event_id
        where el.source_event_id = ev.id
        union
        select e2.* from public.event_links el
        join public.events e2 on e2.id = el.source_event_id
        where el.target_event_id = ev.id
      ) le
      join public.event_categories lec on lec.id = le.category_id
    ), '[]'::jsonb)
  )
  into result
  from public.events ev
  join public.event_categories ec on ec.id = ev.category_id
  left join public.companies co on co.id = ev.company_id
  left join public.products pr on pr.id = ev.product_id
  left join public.companies co_via_product on pr.id is not null and co_via_product.id = pr.company_id
  left join public.trials t on t.id = ev.trial_id
  left join public.products pr_via_trial on t.id is not null and pr_via_trial.id = t.product_id
  left join public.companies co_via_trial on pr_via_trial.id is not null and co_via_trial.id = pr_via_trial.company_id
  where ev.id = p_event_id;

  return result;
end;
$$;
```

- [ ] **Step 3: Create get_event_thread RPC**

```sql
-- ============================================================
-- 3. get_event_thread
-- ============================================================

create or replace function public.get_event_thread(
  p_thread_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'id', et.id,
    'title', et.title,
    'created_by', et.created_by,
    'created_at', et.created_at,
    'events', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', ev.id,
          'title', ev.title,
          'event_date', ev.event_date,
          'thread_order', ev.thread_order,
          'priority', ev.priority,
          'category_name', ec.name
        )
        order by ev.thread_order
      )
      from public.events ev
      join public.event_categories ec on ec.id = ev.category_id
      where ev.thread_id = et.id
    ), '[]'::jsonb)
  )
  into result
  from public.event_threads et
  where et.id = p_thread_id;

  return result;
end;
$$;
```

- [ ] **Step 4: Create get_space_tags RPC**

```sql
-- ============================================================
-- 4. get_space_tags
-- ============================================================

create or replace function public.get_space_tags(
  p_space_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  select coalesce(
    jsonb_agg(distinct tag order by tag),
    '[]'::jsonb
  )
  into result
  from public.events ev,
  lateral unnest(ev.tags) as tag
  where ev.space_id = p_space_id;

  return result;
end;
$$;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260413120100_events_rpc_functions.sql
git commit -m "feat(db): add events RPC functions (feed, detail, thread, tags)"
```

---

## Task 3: TypeScript Models

**Files:**
- Create: `src/client/src/app/core/models/event.model.ts`

- [ ] **Step 1: Create the event model file**

```typescript
export interface EventCategory {
  id: string;
  space_id: string | null;
  name: string;
  display_order: number;
  is_system: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventThread {
  id: string;
  space_id: string;
  title: string;
  created_by: string | null;
  created_at: string;
}

export interface EventSource {
  id: string;
  event_id: string;
  url: string;
  label: string | null;
  created_at: string;
}

export interface EventLink {
  id: string;
  source_event_id: string;
  target_event_id: string;
  created_by: string | null;
  created_at: string;
}

export type EventPriority = 'high' | 'low';

export type EntityLevel = 'space' | 'company' | 'product' | 'trial';

export interface AppEvent {
  id: string;
  space_id: string;
  company_id: string | null;
  product_id: string | null;
  trial_id: string | null;
  category_id: string;
  thread_id: string | null;
  thread_order: number | null;
  title: string;
  event_date: string;
  description: string | null;
  priority: EventPriority;
  tags: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** A row returned by get_events_page_data RPC (event or marker). */
export interface FeedItem {
  source_type: 'event' | 'marker';
  id: string;
  title: string;
  event_date: string;
  category_name: string;
  category_id: string;
  priority: EventPriority | null;
  entity_level: EntityLevel;
  entity_name: string;
  entity_id: string | null;
  company_name: string | null;
  tags: string[];
  has_thread: boolean;
  thread_id: string | null;
  description: string | null;
  source_url: string | null;
}

/** Full event detail returned by get_event_detail RPC. */
export interface EventDetail {
  id: string;
  space_id: string;
  title: string;
  event_date: string;
  description: string | null;
  priority: EventPriority;
  tags: string[];
  thread_id: string | null;
  thread_order: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  category: { id: string; name: string };
  entity_level: EntityLevel;
  entity_name: string;
  entity_id: string | null;
  company_name: string | null;
  sources: { id: string; url: string; label: string | null }[];
  thread: {
    id: string;
    title: string;
    events: { id: string; title: string; event_date: string; thread_order: number }[];
  } | null;
  linked_events: {
    id: string;
    title: string;
    event_date: string;
    category_name: string;
  }[];
}

export interface EventsPageFilters {
  dateFrom: string | null;
  dateTo: string | null;
  entityLevel: EntityLevel | null;
  entityId: string | null;
  categoryIds: string[];
  tags: string[];
  priority: EventPriority | null;
  sourceType: 'event' | 'marker' | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/src/app/core/models/event.model.ts
git commit -m "feat(models): add event system TypeScript interfaces"
```

---

## Task 4: Angular Services

**Files:**
- Create: `src/client/src/app/core/services/event.service.ts`
- Create: `src/client/src/app/core/services/event-category.service.ts`
- Create: `src/client/src/app/core/services/event-thread.service.ts`

- [ ] **Step 1: Create EventCategoryService**

```typescript
import { inject, Injectable } from '@angular/core';

import { EventCategory } from '../models/event.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class EventCategoryService {
  private supabase = inject(SupabaseService);

  async list(spaceId?: string): Promise<EventCategory[]> {
    let query = this.supabase.client
      .from('event_categories')
      .select('*')
      .order('display_order');

    if (spaceId) {
      query = query.or(`is_system.eq.true,space_id.eq.${spaceId}`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data as EventCategory[];
  }
}
```

- [ ] **Step 2: Create EventThreadService**

```typescript
import { inject, Injectable } from '@angular/core';

import { EventThread } from '../models/event.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class EventThreadService {
  private supabase = inject(SupabaseService);

  async listBySpace(spaceId: string): Promise<EventThread[]> {
    const { data, error } = await this.supabase.client
      .from('event_threads')
      .select('*')
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data as EventThread[];
  }

  async create(spaceId: string, title: string): Promise<EventThread> {
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { data, error } = await this.supabase.client
      .from('event_threads')
      .insert({ space_id: spaceId, title, created_by: userId })
      .select()
      .single();
    if (error) throw error;
    return data as EventThread;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('event_threads')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }
}
```

- [ ] **Step 3: Create EventService**

```typescript
import { inject, Injectable } from '@angular/core';

import {
  AppEvent,
  EventDetail,
  EventsPageFilters,
  FeedItem,
} from '../models/event.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class EventService {
  private supabase = inject(SupabaseService);

  async getEventsPageData(
    spaceId: string,
    filters: EventsPageFilters,
    limit = 50,
    offset = 0,
  ): Promise<FeedItem[]> {
    const { data, error } = await this.supabase.client.rpc('get_events_page_data', {
      p_space_id: spaceId,
      p_date_from: filters.dateFrom,
      p_date_to: filters.dateTo,
      p_entity_level: filters.entityLevel,
      p_entity_id: filters.entityId,
      p_category_ids: filters.categoryIds.length > 0 ? filters.categoryIds : null,
      p_tags: filters.tags.length > 0 ? filters.tags : null,
      p_priority: filters.priority,
      p_source_type: filters.sourceType,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw error;
    return (data ?? []) as FeedItem[];
  }

  async getEventDetail(eventId: string): Promise<EventDetail> {
    const { data, error } = await this.supabase.client.rpc('get_event_detail', {
      p_event_id: eventId,
    });
    if (error) throw error;
    return data as EventDetail;
  }

  async getSpaceTags(spaceId: string): Promise<string[]> {
    const { data, error } = await this.supabase.client.rpc('get_space_tags', {
      p_space_id: spaceId,
    });
    if (error) throw error;
    return (data ?? []) as string[];
  }

  async create(
    spaceId: string,
    event: Partial<AppEvent>,
    sources: { url: string; label: string }[],
    linkedEventIds: string[],
  ): Promise<AppEvent> {
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { data, error } = await this.supabase.client
      .from('events')
      .insert({ ...event, space_id: spaceId, created_by: userId })
      .select()
      .single();
    if (error) throw error;

    if (sources.length > 0) {
      const sourceRows = sources.map((s) => ({
        event_id: data.id,
        url: s.url,
        label: s.label || null,
      }));
      const { error: srcErr } = await this.supabase.client
        .from('event_sources')
        .insert(sourceRows);
      if (srcErr) throw srcErr;
    }

    if (linkedEventIds.length > 0) {
      const linkRows = linkedEventIds.map((targetId) => ({
        source_event_id: data.id,
        target_event_id: targetId,
        created_by: userId,
      }));
      const { error: linkErr } = await this.supabase.client
        .from('event_links')
        .insert(linkRows);
      if (linkErr) throw linkErr;
    }

    return data as AppEvent;
  }

  async update(id: string, changes: Partial<AppEvent>): Promise<AppEvent> {
    const { data, error } = await this.supabase.client
      .from('events')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as AppEvent;
  }

  async updateSources(
    eventId: string,
    sources: { url: string; label: string }[],
  ): Promise<void> {
    const { error: delErr } = await this.supabase.client
      .from('event_sources')
      .delete()
      .eq('event_id', eventId);
    if (delErr) throw delErr;

    if (sources.length > 0) {
      const rows = sources.map((s) => ({
        event_id: eventId,
        url: s.url,
        label: s.label || null,
      }));
      const { error: insErr } = await this.supabase.client
        .from('event_sources')
        .insert(rows);
      if (insErr) throw insErr;
    }
  }

  async updateLinks(eventId: string, linkedEventIds: string[]): Promise<void> {
    // Delete existing links where this event is the source
    const { error: delErr } = await this.supabase.client
      .from('event_links')
      .delete()
      .eq('source_event_id', eventId);
    if (delErr) throw delErr;

    // Also delete links where this event is the target
    const { error: delErr2 } = await this.supabase.client
      .from('event_links')
      .delete()
      .eq('target_event_id', eventId);
    if (delErr2) throw delErr2;

    if (linkedEventIds.length > 0) {
      const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
      const rows = linkedEventIds.map((targetId) => ({
        source_event_id: eventId,
        target_event_id: targetId,
        created_by: userId,
      }));
      const { error: insErr } = await this.supabase.client
        .from('event_links')
        .insert(rows);
      if (insErr) throw insErr;
    }
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('events')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/core/services/event.service.ts src/client/src/app/core/services/event-category.service.ts src/client/src/app/core/services/event-thread.service.ts
git commit -m "feat(services): add EventService, EventCategoryService, EventThreadService"
```

---

## Task 5: Events Page Component + Routing + Navigation

**Files:**
- Create: `src/client/src/app/features/events/events-page.component.ts`
- Create: `src/client/src/app/features/events/events-page.component.html`
- Modify: `src/client/src/app/app.routes.ts` (add events route)
- Modify: `src/client/src/app/core/layout/header.component.ts` (add Events nav link)

- [ ] **Step 1: Create EventsPageComponent TypeScript**

```typescript
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';

import {
  EventCategory,
  EventDetail,
  EventsPageFilters,
  FeedItem,
} from '../../core/models/event.model';
import { EventService } from '../../core/services/event.service';
import { EventCategoryService } from '../../core/services/event-category.service';
import { MarkerCategoryService } from '../../core/services/marker-category.service';
import { MarkerCategory } from '../../core/models/marker.model';
import { EventFilterBarComponent } from './event-filter-bar.component';
import { EventFeedItemComponent } from './event-feed-item.component';
import { EventFormComponent } from './event-form.component';
import { confirmDelete } from '../../shared/utils/confirm-delete';

@Component({
  selector: 'app-events-page',
  standalone: true,
  imports: [
    ButtonModule,
    Dialog,
    MessageModule,
    ProgressSpinner,
    EventFilterBarComponent,
    EventFeedItemComponent,
    EventFormComponent,
  ],
  templateUrl: './events-page.component.html',
})
export class EventsPageComponent implements OnInit {
  private eventService = inject(EventService);
  private eventCategoryService = inject(EventCategoryService);
  private markerCategoryService = inject(MarkerCategoryService);
  private route = inject(ActivatedRoute);
  private confirmation = inject(ConfirmationService);

  spaceId = '';

  // Data
  feedItems = signal<FeedItem[]>([]);
  eventCategories = signal<EventCategory[]>([]);
  markerCategories = signal<MarkerCategory[]>([]);
  spaceTags = signal<string[]>([]);
  selectedDetail = signal<EventDetail | null>(null);

  // UI state
  loading = signal(false);
  error = signal<string | null>(null);
  modalOpen = signal(false);
  editingEventId = signal<string | null>(null);
  hasMore = signal(true);

  // Filters
  filters = signal<EventsPageFilters>({
    dateFrom: null,
    dateTo: null,
    entityLevel: null,
    entityId: null,
    categoryIds: [],
    tags: [],
    priority: null,
    sourceType: null,
  });

  readonly allCategories = computed(() => {
    const eCats = this.eventCategories().map((c) => ({
      id: c.id,
      name: c.name,
      group: 'Events',
    }));
    const mCats = this.markerCategories().map((c) => ({
      id: c.id,
      name: c.name,
      group: 'Markers',
    }));
    return [...eCats, ...mCats];
  });

  private readonly PAGE_SIZE = 50;

  async ngOnInit(): Promise<void> {
    this.spaceId = this.getSpaceId();
    await this.loadInitialData();
  }

  async onFiltersChanged(newFilters: EventsPageFilters): Promise<void> {
    this.filters.set(newFilters);
    await this.loadFeed();
  }

  async loadMore(): Promise<void> {
    const currentItems = this.feedItems();
    this.loading.set(true);
    try {
      const moreItems = await this.eventService.getEventsPageData(
        this.spaceId,
        this.filters(),
        this.PAGE_SIZE,
        currentItems.length,
      );
      if (moreItems.length < this.PAGE_SIZE) {
        this.hasMore.set(false);
      }
      this.feedItems.set([...currentItems, ...moreItems]);
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : 'Failed to load more events.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  openCreateModal(): void {
    this.editingEventId.set(null);
    this.modalOpen.set(true);
  }

  openEditModal(eventId: string): void {
    this.editingEventId.set(eventId);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.editingEventId.set(null);
  }

  async onSaved(): Promise<void> {
    this.closeModal();
    await this.loadFeed();
    // Refresh tags in case new ones were added
    this.spaceTags.set(await this.eventService.getSpaceTags(this.spaceId));
  }

  async onDeleteEvent(eventId: string): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete event',
      message: 'Delete this event? This cannot be undone.',
    });
    if (!ok) return;
    this.error.set(null);
    try {
      await this.eventService.delete(eventId);
      await this.loadFeed();
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : 'Could not delete event.',
      );
    }
  }

  async onSelectItem(item: FeedItem): Promise<void> {
    if (item.source_type !== 'event') {
      // Markers don't have expandable detail in events page
      return;
    }
    // Toggle: if already selected, deselect
    if (this.selectedDetail()?.id === item.id) {
      this.selectedDetail.set(null);
      return;
    }
    try {
      const detail = await this.eventService.getEventDetail(item.id);
      this.selectedDetail.set(detail);
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : 'Could not load event detail.',
      );
    }
  }

  private async loadInitialData(): Promise<void> {
    this.loading.set(true);
    try {
      const [feed, eCats, mCats, tags] = await Promise.all([
        this.eventService.getEventsPageData(this.spaceId, this.filters(), this.PAGE_SIZE, 0),
        this.eventCategoryService.list(this.spaceId),
        this.markerCategoryService.list(this.spaceId),
        this.eventService.getSpaceTags(this.spaceId),
      ]);
      this.feedItems.set(feed);
      this.eventCategories.set(eCats);
      this.markerCategories.set(mCats);
      this.spaceTags.set(tags);
      if (feed.length < this.PAGE_SIZE) {
        this.hasMore.set(false);
      }
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : 'Failed to load events.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  private async loadFeed(): Promise<void> {
    this.loading.set(true);
    this.hasMore.set(true);
    try {
      const feed = await this.eventService.getEventsPageData(
        this.spaceId,
        this.filters(),
        this.PAGE_SIZE,
        0,
      );
      this.feedItems.set(feed);
      if (feed.length < this.PAGE_SIZE) {
        this.hasMore.set(false);
      }
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : 'Failed to load events.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  private getSpaceId(): string {
    let route = this.route.snapshot;
    while (route) {
      const id = route.paramMap.get('spaceId');
      if (id) return id;
      if (!route.parent) break;
      route = route.parent;
    }
    return '';
  }
}
```

- [ ] **Step 2: Create EventsPageComponent HTML template**

```html
<div class="mx-auto max-w-5xl px-6 py-8">
  <div class="mb-6 flex items-center justify-between">
    <div>
      <p class="text-xs font-medium uppercase tracking-wider text-slate-400">Intelligence</p>
      <h1 class="text-xl font-semibold text-slate-900">Events</h1>
    </div>
    <p-button
      label="New Event"
      icon="fa-solid fa-plus"
      severity="secondary"
      [outlined]="true"
      size="small"
      (onClick)="openCreateModal()"
    />
  </div>

  @if (error()) {
    <p-message severity="error" [closable]="false" styleClass="mb-4">{{ error() }}</p-message>
  }

  <app-event-filter-bar
    [filters]="filters()"
    [categories]="allCategories()"
    [tags]="spaceTags()"
    (filtersChange)="onFiltersChanged($event)"
  />

  @if (loading() && feedItems().length === 0) {
    <div class="flex justify-center py-16">
      <p-progressSpinner strokeWidth="3" />
    </div>
  } @else if (feedItems().length === 0) {
    <div class="py-16 text-center text-sm text-slate-400">
      No events yet. Events capture competitive intelligence -- leadership changes, strategic moves, regulatory shifts -- at any level of your landscape.
    </div>
  } @else {
    <div class="mt-4 space-y-2">
      @for (item of feedItems(); track item.id) {
        <app-event-feed-item
          [item]="item"
          [detail]="selectedDetail()?.id === item.id ? selectedDetail() : null"
          (select)="onSelectItem(item)"
          (edit)="openEditModal(item.id)"
          (delete)="onDeleteEvent(item.id)"
        />
      }
    </div>

    @if (hasMore()) {
      <div class="mt-4 flex justify-center">
        <p-button
          label="Load more"
          severity="secondary"
          [outlined]="true"
          size="small"
          [loading]="loading()"
          (onClick)="loadMore()"
        />
      </div>
    }
  }
</div>

<p-dialog
  [header]="editingEventId() ? 'Edit event' : 'New event'"
  [(visible)]="modalOpen"
  [modal]="true"
  [style]="{ width: '42rem' }"
  (onHide)="closeModal()"
>
  <app-event-form
    [eventId]="editingEventId()"
    (saved)="onSaved()"
    (cancelled)="closeModal()"
  />
</p-dialog>
```

- [ ] **Step 3: Add route to app.routes.ts**

In `src/client/src/app/app.routes.ts`, add after the `manage/therapeutic-areas` route block (around line 226):

```typescript
          {
            path: 'events',
            loadComponent: () =>
              import('./features/events/events-page.component').then(
                (m) => m.EventsPageComponent,
              ),
          },
```

- [ ] **Step 4: Add Events nav link to header**

In `src/client/src/app/core/layout/header.component.ts`, add after the "Areas" nav link (after line 122):

```html
            <a
              [routerLink]="spaceBase().concat('events')"
              routerLinkActive="nav-active"
              class="nav-link"
            >
              Events
            </a>
```

- [ ] **Step 5: Verify build compiles (may have missing component references -- that's expected)**

Run: `cd src/client && ng build 2>&1 | tail -20`

This will likely fail because the child components don't exist yet. That's fine -- the page component skeleton is correct.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/events/events-page.component.ts src/client/src/app/features/events/events-page.component.html src/client/src/app/app.routes.ts src/client/src/app/core/layout/header.component.ts
git commit -m "feat(events): add events page component, route, and navigation link"
```

---

## Task 6: Event Filter Bar Component

**Files:**
- Create: `src/client/src/app/features/events/event-filter-bar.component.ts`

- [ ] **Step 1: Create EventFilterBarComponent**

```typescript
import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Select } from 'primeng/select';
import { MultiSelect } from 'primeng/multiselect';
import { DatePicker } from 'primeng/datepicker';

import { EventsPageFilters, EntityLevel, EventPriority } from '../../core/models/event.model';

@Component({
  selector: 'app-event-filter-bar',
  standalone: true,
  imports: [FormsModule, Select, MultiSelect, DatePicker],
  template: `
    <div class="flex flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div class="min-w-[140px]">
        <label class="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500" for="filter-date-from">From</label>
        <p-datepicker
          inputId="filter-date-from"
          [ngModel]="dateFromValue"
          (ngModelChange)="onDateFromChange($event)"
          dateFormat="yy-mm-dd"
          [showClear]="true"
          placeholder="Start date"
          [style]="{ width: '100%' }"
          appendTo="body"
        />
      </div>

      <div class="min-w-[140px]">
        <label class="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500" for="filter-date-to">To</label>
        <p-datepicker
          inputId="filter-date-to"
          [ngModel]="dateToValue"
          (ngModelChange)="onDateToChange($event)"
          dateFormat="yy-mm-dd"
          [showClear]="true"
          placeholder="End date"
          [style]="{ width: '100%' }"
          appendTo="body"
        />
      </div>

      <div class="min-w-[130px]">
        <label class="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500" for="filter-level">Level</label>
        <p-select
          inputId="filter-level"
          [options]="entityLevelOptions"
          [ngModel]="filters().entityLevel"
          (ngModelChange)="onEntityLevelChange($event)"
          optionLabel="label"
          optionValue="value"
          placeholder="All levels"
          [showClear]="true"
          [style]="{ width: '100%' }"
          appendTo="body"
        />
      </div>

      <div class="min-w-[160px]">
        <label class="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500" for="filter-category">Category</label>
        <p-multiselect
          inputId="filter-category"
          [options]="categories()"
          [ngModel]="filters().categoryIds"
          (ngModelChange)="onCategoryChange($event)"
          optionLabel="name"
          optionValue="id"
          optionGroupLabel="group"
          optionGroupChildren="items"
          placeholder="All categories"
          [style]="{ width: '100%' }"
          appendTo="body"
        />
      </div>

      <div class="min-w-[140px]">
        <label class="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500" for="filter-tags">Tags</label>
        <p-multiselect
          inputId="filter-tags"
          [options]="tagOptions()"
          [ngModel]="filters().tags"
          (ngModelChange)="onTagsChange($event)"
          placeholder="All tags"
          [style]="{ width: '100%' }"
          appendTo="body"
        />
      </div>

      <div class="min-w-[110px]">
        <label class="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500" for="filter-priority">Priority</label>
        <p-select
          inputId="filter-priority"
          [options]="priorityOptions"
          [ngModel]="filters().priority"
          (ngModelChange)="onPriorityChange($event)"
          optionLabel="label"
          optionValue="value"
          placeholder="All"
          [showClear]="true"
          [style]="{ width: '100%' }"
          appendTo="body"
        />
      </div>

      <div class="min-w-[110px]">
        <label class="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500" for="filter-source">Source</label>
        <p-select
          inputId="filter-source"
          [options]="sourceTypeOptions"
          [ngModel]="filters().sourceType"
          (ngModelChange)="onSourceTypeChange($event)"
          optionLabel="label"
          optionValue="value"
          placeholder="All"
          [showClear]="true"
          [style]="{ width: '100%' }"
          appendTo="body"
        />
      </div>
    </div>
  `,
})
export class EventFilterBarComponent {
  readonly filters = input.required<EventsPageFilters>();
  readonly categories = input.required<{ id: string; name: string; group: string }[]>();
  readonly tags = input.required<string[]>();

  readonly filtersChange = output<EventsPageFilters>();

  readonly entityLevelOptions: { label: string; value: EntityLevel }[] = [
    { label: 'Industry', value: 'space' },
    { label: 'Company', value: 'company' },
    { label: 'Product', value: 'product' },
    { label: 'Trial', value: 'trial' },
  ];

  readonly priorityOptions: { label: string; value: EventPriority }[] = [
    { label: 'High', value: 'high' },
    { label: 'Low', value: 'low' },
  ];

  readonly sourceTypeOptions = [
    { label: 'Events', value: 'event' },
    { label: 'Markers', value: 'marker' },
  ];

  get dateFromValue(): Date | null {
    const d = this.filters().dateFrom;
    return d ? new Date(d + 'T00:00:00') : null;
  }

  get dateToValue(): Date | null {
    const d = this.filters().dateTo;
    return d ? new Date(d + 'T00:00:00') : null;
  }

  tagOptions(): string[] {
    return this.tags();
  }

  onDateFromChange(date: Date | null): void {
    this.emit({ dateFrom: date ? this.formatDate(date) : null });
  }

  onDateToChange(date: Date | null): void {
    this.emit({ dateTo: date ? this.formatDate(date) : null });
  }

  onEntityLevelChange(level: EntityLevel | null): void {
    this.emit({ entityLevel: level, entityId: null });
  }

  onCategoryChange(ids: string[]): void {
    this.emit({ categoryIds: ids ?? [] });
  }

  onTagsChange(tags: string[]): void {
    this.emit({ tags: tags ?? [] });
  }

  onPriorityChange(priority: EventPriority | null): void {
    this.emit({ priority });
  }

  onSourceTypeChange(sourceType: 'event' | 'marker' | null): void {
    this.emit({ sourceType });
  }

  private emit(patch: Partial<EventsPageFilters>): void {
    this.filtersChange.emit({ ...this.filters(), ...patch });
  }

  private formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/src/app/features/events/event-filter-bar.component.ts
git commit -m "feat(events): add event filter bar component"
```

---

## Task 7: Event Feed Item Component

**Files:**
- Create: `src/client/src/app/features/events/event-feed-item.component.ts`

- [ ] **Step 1: Create EventFeedItemComponent**

```typescript
import { Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { Tag } from 'primeng/tag';

import { EventDetail, FeedItem } from '../../core/models/event.model';
import { EventDetailComponent } from './event-detail.component';

@Component({
  selector: 'app-event-feed-item',
  standalone: true,
  imports: [DatePipe, ButtonModule, Tag, EventDetailComponent],
  template: `
    <div
      class="cursor-pointer rounded-md border border-slate-200 bg-white transition-colors hover:border-slate-300"
      [class.border-teal-300]="detail() !== null"
      (click)="select.emit()"
      (keydown.enter)="select.emit()"
      tabindex="0"
      [attr.aria-label]="item().title"
      role="button"
    >
      <div class="flex items-start gap-3 px-4 py-3">
        <!-- Source badge -->
        <span
          class="mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          [class.bg-teal-50]="item().source_type === 'event'"
          [class.text-teal-700]="item().source_type === 'event'"
          [class.bg-slate-100]="item().source_type === 'marker'"
          [class.text-slate-500]="item().source_type === 'marker'"
        >
          {{ item().source_type }}
        </span>

        <!-- Main content -->
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="text-xs text-slate-400">{{ item().event_date | date:'mediumDate' }}</span>
            @if (item().priority === 'high') {
              <span class="inline-block h-1.5 w-1.5 rounded-full bg-red-500" title="High priority"></span>
            }
            <span class="text-xs text-slate-400">{{ item().category_name }}</span>
          </div>
          <p class="mt-0.5 text-sm font-medium text-slate-900">{{ item().title }}</p>
          <div class="mt-1 flex items-center gap-2 text-xs text-slate-400">
            @if (item().company_name && item().entity_level !== 'space') {
              <span>{{ item().company_name }}</span>
            }
            @if (item().entity_level !== 'space' && item().entity_level !== 'company' && item().entity_name) {
              <span class="text-slate-300">/</span>
              <span>{{ item().entity_name }}</span>
            }
            @if (item().entity_level === 'space') {
              <span>Industry</span>
            }
          </div>
          @if (item().tags.length > 0) {
            <div class="mt-1.5 flex flex-wrap gap-1">
              @for (tag of item().tags; track tag) {
                <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{{ tag }}</span>
              }
            </div>
          }
          @if (item().has_thread) {
            <span class="mt-1 inline-flex items-center gap-1 text-[10px] text-slate-400">
              <i class="fa-solid fa-link text-[8px]"></i> Part of a thread
            </span>
          }
        </div>

        <!-- Actions (events only) -->
        @if (item().source_type === 'event') {
          <div class="flex gap-1" (click)="$event.stopPropagation()">
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              (click)="edit.emit()"
              aria-label="Edit event"
            >
              <i class="fa-solid fa-pen text-xs"></i>
            </button>
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600"
              (click)="onDelete($event)"
              aria-label="Delete event"
            >
              <i class="fa-solid fa-trash text-xs"></i>
            </button>
          </div>
        }
      </div>

      <!-- Expanded detail -->
      @if (detail(); as d) {
        <div class="border-t border-slate-100 px-4 py-3" (click)="$event.stopPropagation()">
          <app-event-detail [detail]="d" />
        </div>
      }
    </div>
  `,
})
export class EventFeedItemComponent {
  readonly item = input.required<FeedItem>();
  readonly detail = input<EventDetail | null>(null);

  readonly select = output<void>();
  readonly edit = output<void>();
  readonly delete = output<void>();

  onDelete(event: MouseEvent): void {
    event.stopPropagation();
    this.delete.emit();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/src/app/features/events/event-feed-item.component.ts
git commit -m "feat(events): add event feed item component"
```

---

## Task 8: Event Detail Component

**Files:**
- Create: `src/client/src/app/features/events/event-detail.component.ts`

- [ ] **Step 1: Create EventDetailComponent**

```typescript
import { Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';

import { EventDetail } from '../../core/models/event.model';

@Component({
  selector: 'app-event-detail',
  standalone: true,
  imports: [DatePipe],
  template: `
    @if (detail(); as d) {
      <div class="space-y-3 text-sm">
        <!-- Description -->
        @if (d.description) {
          <p class="text-slate-600">{{ d.description }}</p>
        }

        <!-- Sources -->
        @if (d.sources.length > 0) {
          <div>
            <p class="mb-1 text-xs font-medium uppercase tracking-wider text-slate-400">Sources</p>
            <ul class="space-y-0.5">
              @for (src of d.sources; track src.id) {
                <li>
                  <a
                    [href]="src.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-teal-700 hover:text-teal-800 hover:underline"
                  >
                    {{ src.label || src.url }}
                    <i class="fa-solid fa-arrow-up-right-from-square ml-1 text-[10px]"></i>
                  </a>
                </li>
              }
            </ul>
          </div>
        }

        <!-- Thread -->
        @if (d.thread) {
          <div>
            <p class="mb-1 text-xs font-medium uppercase tracking-wider text-slate-400">
              Thread: {{ d.thread.title }}
            </p>
            <ol class="space-y-1 border-l-2 border-slate-200 pl-3">
              @for (te of d.thread.events; track te.id) {
                <li
                  class="text-xs"
                  [class.font-semibold]="te.id === d.id"
                  [class.text-teal-700]="te.id === d.id"
                  [class.text-slate-500]="te.id !== d.id"
                >
                  {{ te.event_date | date:'mediumDate' }} -- {{ te.title }}
                </li>
              }
            </ol>
          </div>
        }

        <!-- Linked events -->
        @if (d.linked_events.length > 0) {
          <div>
            <p class="mb-1 text-xs font-medium uppercase tracking-wider text-slate-400">Related events</p>
            <ul class="space-y-0.5">
              @for (le of d.linked_events; track le.id) {
                <li class="text-xs text-slate-500">
                  {{ le.event_date | date:'mediumDate' }} -- {{ le.title }}
                  <span class="text-slate-300">({{ le.category_name }})</span>
                </li>
              }
            </ul>
          </div>
        }

        <!-- Meta -->
        <p class="text-[10px] text-slate-300">
          Created {{ d.created_at | date:'medium' }}
        </p>
      </div>
    }
  `,
})
export class EventDetailComponent {
  readonly detail = input.required<EventDetail>();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/src/app/features/events/event-detail.component.ts
git commit -m "feat(events): add event detail component"
```

---

## Task 9: Event Form Component

**Files:**
- Create: `src/client/src/app/features/events/event-form.component.ts`

- [ ] **Step 1: Create EventFormComponent**

This is the largest component. It handles create and edit, with fields for entity level, title, date, category, priority, description, tags, sources, thread, and linked events.

```typescript
import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { InputText } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { Select } from 'primeng/select';
import { DatePicker } from 'primeng/datepicker';
import { AutoComplete, AutoCompleteCompleteEvent } from 'primeng/autocomplete';
import { Chips } from 'primeng/chips';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import {
  AppEvent,
  EventCategory,
  EventDetail,
  EventPriority,
  EntityLevel,
  EventThread,
  FeedItem,
} from '../../core/models/event.model';
import { Company } from '../../core/models/company.model';
import { Product } from '../../core/models/product.model';
import { Trial } from '../../core/models/trial.model';
import { EventService } from '../../core/services/event.service';
import { EventCategoryService } from '../../core/services/event-category.service';
import { EventThreadService } from '../../core/services/event-thread.service';
import { CompanyService } from '../../core/services/company.service';
import { ProductService } from '../../core/services/product.service';
import { TrialService } from '../../core/services/trial.service';

interface SourceRow {
  url: string;
  label: string;
}

@Component({
  selector: 'app-event-form',
  standalone: true,
  imports: [
    FormsModule,
    InputText,
    Textarea,
    Select,
    DatePicker,
    AutoComplete,
    Chips,
    ButtonModule,
    MessageModule,
  ],
  template: `
    <form (ngSubmit)="onSubmit()" class="space-y-4" aria-label="Event form">
      @if (error()) {
        <p-message severity="error" [closable]="false">{{ error() }}</p-message>
      }

      <!-- Entity level + entity picker -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="event-level" class="mb-1 block text-xs font-medium text-slate-600">Level</label>
          <p-select
            inputId="event-level"
            [options]="entityLevelOptions"
            [(ngModel)]="entityLevel"
            name="entityLevel"
            optionLabel="label"
            optionValue="value"
            placeholder="Select level"
            [style]="{ width: '100%' }"
            (ngModelChange)="onEntityLevelChange()"
          />
        </div>

        @if (entityLevel && entityLevel !== 'space') {
          <div>
            <label for="event-entity" class="mb-1 block text-xs font-medium text-slate-600">
              {{ entityLevel === 'company' ? 'Company' : entityLevel === 'product' ? 'Product' : 'Trial' }}
            </label>
            <p-select
              inputId="event-entity"
              [options]="entityOptions()"
              [(ngModel)]="entityId"
              name="entityId"
              optionLabel="name"
              optionValue="id"
              placeholder="Select..."
              [filter]="true"
              [style]="{ width: '100%' }"
            />
          </div>
        }
      </div>

      <!-- Title + Date -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="event-title" class="mb-1 block text-xs font-medium text-slate-600">Title</label>
          <input pInputText id="event-title" [(ngModel)]="title" name="title" class="w-full" required />
        </div>
        <div>
          <label for="event-date" class="mb-1 block text-xs font-medium text-slate-600">Date</label>
          <p-datepicker
            inputId="event-date"
            [(ngModel)]="eventDateValue"
            name="eventDate"
            dateFormat="yy-mm-dd"
            [style]="{ width: '100%' }"
            appendTo="body"
          />
        </div>
      </div>

      <!-- Category + Priority -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="event-category" class="mb-1 block text-xs font-medium text-slate-600">Category</label>
          <p-select
            inputId="event-category"
            [options]="categories()"
            [(ngModel)]="categoryId"
            name="categoryId"
            optionLabel="name"
            optionValue="id"
            placeholder="Select category"
            [style]="{ width: '100%' }"
          />
        </div>
        <div>
          <label for="event-priority" class="mb-1 block text-xs font-medium text-slate-600">Priority</label>
          <p-select
            inputId="event-priority"
            [options]="priorityOptions"
            [(ngModel)]="priority"
            name="priority"
            optionLabel="label"
            optionValue="value"
            [style]="{ width: '100%' }"
          />
        </div>
      </div>

      <!-- Description -->
      <div>
        <label for="event-description" class="mb-1 block text-xs font-medium text-slate-600">Description</label>
        <textarea pTextarea id="event-description" [(ngModel)]="description" name="description" rows="3" class="w-full"></textarea>
      </div>

      <!-- Tags -->
      <div>
        <label for="event-tags" class="mb-1 block text-xs font-medium text-slate-600">Tags</label>
        <p-chips inputId="event-tags" [(ngModel)]="tags" name="tags" placeholder="Add tags..." [style]="{ width: '100%' }" />
      </div>

      <!-- Sources -->
      <div>
        <label class="mb-1 block text-xs font-medium text-slate-600">Source URLs</label>
        @for (src of sources; track $index) {
          <div class="mb-2 flex items-center gap-2">
            <input pInputText [(ngModel)]="src.url" [name]="'srcUrl' + $index" placeholder="URL" class="flex-1" />
            <input pInputText [(ngModel)]="src.label" [name]="'srcLabel' + $index" placeholder="Label (optional)" class="w-40" />
            <button type="button" class="text-slate-400 hover:text-red-500" (click)="removeSource($index)" aria-label="Remove source">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        }
        <button type="button" class="text-xs text-teal-700 hover:text-teal-800" (click)="addSource()">
          + Add source
        </button>
      </div>

      <!-- Thread -->
      <div>
        <label for="event-thread" class="mb-1 block text-xs font-medium text-slate-600">Thread (optional)</label>
        <div class="flex items-center gap-2">
          <p-select
            inputId="event-thread"
            [options]="threads()"
            [(ngModel)]="threadId"
            name="threadId"
            optionLabel="title"
            optionValue="id"
            placeholder="None"
            [showClear]="true"
            [style]="{ width: '100%' }"
          />
        </div>
        @if (!threadId) {
          <div class="mt-2 flex items-center gap-2">
            <input pInputText [(ngModel)]="newThreadTitle" name="newThreadTitle" placeholder="Or start a new thread..." class="flex-1 text-sm" />
          </div>
        }
      </div>

      <!-- Actions -->
      <div class="flex justify-end gap-2 pt-2">
        <p-button label="Cancel" severity="secondary" [outlined]="true" (onClick)="cancelled.emit()" type="button" />
        <p-button [label]="eventId() ? 'Update' : 'Create'" type="submit" [loading]="saving()" />
      </div>
    </form>
  `,
})
export class EventFormComponent implements OnInit {
  readonly eventId = input<string | null>(null);

  readonly saved = output<void>();
  readonly cancelled = output<void>();

  private eventService = inject(EventService);
  private eventCategoryService = inject(EventCategoryService);
  private eventThreadService = inject(EventThreadService);
  private companyService = inject(CompanyService);
  private productService = inject(ProductService);
  private trialService = inject(TrialService);
  private route = inject(ActivatedRoute);

  readonly entityLevelOptions: { label: string; value: EntityLevel }[] = [
    { label: 'Industry (space-wide)', value: 'space' },
    { label: 'Company', value: 'company' },
    { label: 'Product', value: 'product' },
    { label: 'Trial', value: 'trial' },
  ];

  readonly priorityOptions: { label: string; value: EventPriority }[] = [
    { label: 'Low', value: 'low' },
    { label: 'High', value: 'high' },
  ];

  categories = signal<EventCategory[]>([]);
  threads = signal<EventThread[]>([]);
  companies = signal<Company[]>([]);
  products = signal<Product[]>([]);
  trials = signal<Trial[]>([]);
  entityOptions = signal<{ id: string; name: string }[]>([]);

  // Form fields
  entityLevel: EntityLevel = 'space';
  entityId = '';
  title = '';
  eventDateValue: Date | null = null;
  categoryId = '';
  priority: EventPriority = 'low';
  description = '';
  tags: string[] = [];
  sources: SourceRow[] = [];
  threadId: string | null = null;
  newThreadTitle = '';
  linkedEventIds: string[] = [];

  saving = signal(false);
  error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    const spaceId = this.getSpaceId();
    await this.loadData(spaceId);

    const id = this.eventId();
    if (id) {
      await this.loadExisting(id);
    }
  }

  onEntityLevelChange(): void {
    this.entityId = '';
    if (this.entityLevel === 'company') {
      this.entityOptions.set(this.companies().map((c) => ({ id: c.id, name: c.name })));
    } else if (this.entityLevel === 'product') {
      this.entityOptions.set(this.products().map((p) => ({ id: p.id, name: p.name })));
    } else if (this.entityLevel === 'trial') {
      this.entityOptions.set(this.trials().map((t) => ({ id: t.id, name: t.name })));
    } else {
      this.entityOptions.set([]);
    }
  }

  addSource(): void {
    this.sources = [...this.sources, { url: '', label: '' }];
  }

  removeSource(index: number): void {
    this.sources = this.sources.filter((_, i) => i !== index);
  }

  async onSubmit(): Promise<void> {
    if (!this.title || !this.eventDateValue || !this.categoryId) return;

    this.saving.set(true);
    this.error.set(null);

    const spaceId = this.getSpaceId();

    // Resolve thread
    let resolvedThreadId = this.threadId;
    if (!resolvedThreadId && this.newThreadTitle.trim()) {
      try {
        const thread = await this.eventThreadService.create(spaceId, this.newThreadTitle.trim());
        resolvedThreadId = thread.id;
      } catch (err) {
        this.error.set(err instanceof Error ? err.message : 'Could not create thread.');
        this.saving.set(false);
        return;
      }
    }

    // Compute thread_order if joining a thread
    let threadOrder: number | null = null;
    if (resolvedThreadId) {
      // Put at end -- count existing events in the thread
      const existingThread = this.threads().find((t) => t.id === resolvedThreadId);
      // Simple approach: query for max thread_order is cleaner but we don't have it readily.
      // For now, use timestamp-based ordering or just set a high number.
      // The RPC sorts by thread_order, so we need a unique value.
      threadOrder = Date.now(); // Monotonically increasing, good enough for ordering
    }

    const eventDate = this.formatDate(this.eventDateValue);

    const payload: Partial<AppEvent> = {
      category_id: this.categoryId,
      title: this.title,
      event_date: eventDate,
      description: this.description || null,
      priority: this.priority,
      tags: this.tags,
      thread_id: resolvedThreadId,
      thread_order: threadOrder,
      company_id: this.entityLevel === 'company' ? this.entityId : null,
      product_id: this.entityLevel === 'product' ? this.entityId : null,
      trial_id: this.entityLevel === 'trial' ? this.entityId : null,
    };

    const validSources = this.sources.filter((s) => s.url.trim());

    try {
      const id = this.eventId();
      if (id) {
        await this.eventService.update(id, payload);
        await this.eventService.updateSources(id, validSources);
      } else {
        await this.eventService.create(spaceId, payload, validSources, this.linkedEventIds);
      }
      this.saved.emit();
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : 'Could not save event.',
      );
    } finally {
      this.saving.set(false);
    }
  }

  private async loadData(spaceId: string): Promise<void> {
    try {
      const [cats, threads, companies, products, trials] = await Promise.all([
        this.eventCategoryService.list(spaceId),
        this.eventThreadService.listBySpace(spaceId),
        this.companyService.list(spaceId),
        this.productService.list(spaceId),
        this.trialService.listBySpace(spaceId),
      ]);
      this.categories.set(cats);
      this.threads.set(threads);
      this.companies.set(companies);
      this.products.set(products);
      this.trials.set(trials);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not load form data.');
    }
  }

  private async loadExisting(eventId: string): Promise<void> {
    try {
      const detail = await this.eventService.getEventDetail(eventId);
      this.title = detail.title;
      this.eventDateValue = new Date(detail.event_date + 'T00:00:00');
      this.categoryId = detail.category.id;
      this.priority = detail.priority;
      this.description = detail.description ?? '';
      this.tags = detail.tags;
      this.threadId = detail.thread_id;

      // Determine entity level
      if (detail.entity_level === 'company' && detail.entity_id) {
        this.entityLevel = 'company';
        this.entityId = detail.entity_id;
        this.entityOptions.set(this.companies().map((c) => ({ id: c.id, name: c.name })));
      } else if (detail.entity_level === 'product' && detail.entity_id) {
        this.entityLevel = 'product';
        this.entityId = detail.entity_id;
        this.entityOptions.set(this.products().map((p) => ({ id: p.id, name: p.name })));
      } else if (detail.entity_level === 'trial' && detail.entity_id) {
        this.entityLevel = 'trial';
        this.entityId = detail.entity_id;
        this.entityOptions.set(this.trials().map((t) => ({ id: t.id, name: t.name })));
      } else {
        this.entityLevel = 'space';
      }

      // Load sources
      this.sources = detail.sources.map((s) => ({ url: s.url, label: s.label ?? '' }));

      // Linked events
      this.linkedEventIds = detail.linked_events.map((le) => le.id);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not load event.');
    }
  }

  private getSpaceId(): string {
    let route = this.route.snapshot;
    while (route) {
      const id = route.paramMap.get('spaceId');
      if (id) return id;
      if (!route.parent) break;
      route = route.parent;
    }
    return '';
  }

  private formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/src/app/features/events/event-form.component.ts
git commit -m "feat(events): add event form component with full CRUD support"
```

---

## Task 10: Build Verification and Final Commit

**Files:**
- All files from previous tasks

- [ ] **Step 1: Run lint**

Run: `cd src/client && ng lint 2>&1 | tail -30`

Fix any lint errors that arise.

- [ ] **Step 2: Run build**

Run: `cd src/client && ng build 2>&1 | tail -30`

Fix any build errors. Common issues to watch for:
- Missing imports (Company, Product, Trial models/services)
- PrimeNG component import names (check exact export names)
- Template syntax errors

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(events): resolve lint and build errors"
```
