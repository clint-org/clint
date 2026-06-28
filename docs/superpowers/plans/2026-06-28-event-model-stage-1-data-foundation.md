# Event Model, Stage 1: Data Foundation, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the unified `events` + `event_types` schema (replacing the old `markers`/`events` tables), with the create/update RPCs, RLS, grants, append-only change log, and seed data, all verified by integration tests, so later stages can build the timeline and surfaces on it.

**Architecture:** Greenfield, no data backfill. This stage DROPS the old `markers*` and `events*` tables and their dependent objects, then CREATES one `events` table (the merged fact entity) keyed to an `event_types` taxonomy (which subsumes `marker_types` + `marker_categories` + `event_categories`). Membership on the timeline is derived (significance + visibility + anchor), so there is no `marker_assignments` join: an event carries a single polymorphic anchor (`space`/`company`/`asset`/`trial`). Audit fields and the change log mirror the existing trigger patterns. The frontend is NOT touched in this stage; it will not compile against the new schema until Stage 2, so the first dev deploy is at the end of Stage 2. Stage 1 is verified by integration tests, not the browser.

**Tech Stack:** PostgreSQL via Supabase (migrations in `supabase/migrations/`), `plpgsql` SECURITY DEFINER RPCs, RLS via `has_space_access()`, Vitest integration tests in `src/client/integration/`.

## Global Constraints

- All schema changes are timestamped migrations in `supabase/migrations/`; never edit an applied migration, add a new one. Naming: `YYYYMMDDHHmmss_short_description.sql`.
- Every migration that changes an RPC signature or adds an RPC ends with `notify pgrst, 'reload schema';`.
- Audit fields (`created_by`, `updated_by`, `created_at`, `updated_at`) are set server-side by BEFORE triggers (`_set_created_by`, `_set_updated_audit`); never trust client-supplied values.
- Entity writes go through shared `create_*`/`update_*` SECURITY DEFINER RPCs; no inline entity inserts from sibling RPCs.
- Tier-1 governance RPCs are out of scope here (no `record_audit_event` / `@audit:tier1` marker needed for these editorial RPCs).
- New tables start "dark": add a row to `supabase/data-api-grants.json` and an in-migration `grant` matching it, or `grants:check` fails CI.
- Every new public function must map to a capability in a `docs/runbook/features/*.md` manifest, or `features:check` fails CI.
- Vocabulary: the entity is an **Event**; the glyph is a **Marker** (rendering only, Stage 2); "catalyst" is retired. Significance is `high` (on timeline by default) / `low` (feed-only). Provenance enum stays `actual | company | primary | stout`.
- No emoji, no em dashes anywhere (code comments, docs, copy). Use commas/colons/periods.
- Run after migration changes: `supabase db reset` then `supabase db advisors --local --type all`. Run `npm run docs:arch` (from `src/client`) after migration changes and commit the regen.
- Test command (integration, from `src/client`): `npm run test -- integration/tests/<file>.spec.ts`. Unit: `npm run test:units`.

---

## File Structure

- `supabase/migrations/<ts>_drop_marker_event_tables.sql` : drop old `markers*`, `marker_*`, `events*`, `event_*` tables and dependent functions/policies/triggers (`cascade`). One responsibility: remove the old model.
- `supabase/migrations/<ts>_event_type_categories.sql` : `event_type_categories` table + RLS + seed 10 system categories.
- `supabase/migrations/<ts>_event_types.sql` : `event_types` table + RLS + audit triggers + seed system types.
- `supabase/migrations/<ts>_events_table.sql` : `events` table + RLS + audit triggers + indexes.
- `supabase/migrations/<ts>_event_changes.sql` : `event_changes` append-only log + `_log_event_change` trigger.
- `supabase/migrations/<ts>_create_event_rpc.sql` : `create_event` RPC + grant + smoke + reload.
- `supabase/migrations/<ts>_update_event_rpc.sql` : `update_event` RPC + grant + smoke + reload.
- `supabase/migrations/<ts>_event_grants.sql` : table grants for the new tables.
- `supabase/seed.sql` : replace marker/event seed blocks with `event_type_categories` + `event_types` system rows (modify).
- `supabase/data-api-grants.json` : add `events`, `event_types`, `event_type_categories`, `event_changes`; remove old `markers*`/`events*` entries (modify).
- `docs/runbook/features/events.md` : new feature manifest mapping `create_event`/`update_event` (create).
- `src/client/integration/tests/event-model-foundation.spec.ts` : integration tests for create/update/RLS/significance/audit (create).

> The exact `<ts>` values are assigned sequentially at write time (`supabase migration new <name>` prints the filename). Keep the file order above so drops run before creates.

---

### Task 1: Drop the old marker/event model

**Files:**
- Create: `supabase/migrations/<ts>_drop_marker_event_tables.sql`

**Interfaces:**
- Produces: removal of `public.markers`, `public.marker_types`, `public.marker_categories`, `public.marker_assignments`, `public.marker_changes`, `public.events`, `public.event_categories`, `public.event_threads`, `public.event_sources`, `public.event_links`, and their dependent functions (`create_marker`, `update_marker`, `get_marker_history`, `_log_marker_change`, `_emit_events_from_marker_change`, etc.) via `cascade`.

- [ ] **Step 1: Write the migration**

```sql
-- Greenfield cutover: no data to preserve. Remove the old two-table model and
-- everything that depends on it. The unified events schema replaces it.
drop table if exists public.marker_assignments cascade;
drop table if exists public.marker_changes     cascade;
drop table if exists public.markers            cascade;
drop table if exists public.marker_types       cascade;
drop table if exists public.marker_categories  cascade;
drop table if exists public.event_links        cascade;
drop table if exists public.event_sources      cascade;
drop table if exists public.events             cascade;
drop table if exists public.event_threads      cascade;
drop table if exists public.event_categories   cascade;

-- Drop functions that survived the cascade only by signature (no table dep).
drop function if exists public.create_marker(uuid, uuid, text, text, date, date, text, text, uuid[], uuid, text, text, text, boolean) cascade;
drop function if exists public.get_marker_history(uuid) cascade;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Verify the reset applies cleanly**

Run: `supabase db reset`
Expected: completes without error through this migration (later migrations that referenced these tables do not exist yet because this is the latest migration). If a *prior* migration's smoke block references a dropped object, that smoke ran before this drop, so it is unaffected.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/*_drop_marker_event_tables.sql
git commit -m "feat(events): drop old marker/event tables (greenfield cutover)"
```

---

### Task 2: event_type_categories table + system seed

**Files:**
- Create: `supabase/migrations/<ts>_event_type_categories.sql`

**Interfaces:**
- Produces: `public.event_type_categories(id uuid, space_id uuid, name text, display_order int, is_system boolean, created_by uuid, created_at timestamptz, updated_at timestamptz)`. System category fixed UUIDs use the `d0000000-0000-0000-0000-0000000000NN` range. Names + ids:
  - `...01` Clinical, `...02` Data, `...03` Regulatory, `...04` Approval, `...05` Launch, `...06` Loss of Exclusivity, `...07` Commercial, `...08` Leadership, `...09` Financial, `...0a` Strategic.

- [ ] **Step 1: Write the migration (table + RLS + audit triggers + seed)**

```sql
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
```

- [ ] **Step 2: Verify reset applies**

Run: `supabase db reset`
Expected: completes; `select count(*) from public.event_type_categories where is_system;` returns 10.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/*_event_type_categories.sql
git commit -m "feat(events): event_type_categories table + 10 system categories"
```

---

### Task 3: event_types table + system seed

**Files:**
- Create: `supabase/migrations/<ts>_event_types.sql`

**Interfaces:**
- Produces: `public.event_types(id uuid, space_id uuid, category_id uuid not null, name text, shape text, fill_style text, color text, inner_mark text, default_significance text, is_system boolean, display_order int, audit...)`. `default_significance in ('high','low')`. Shapes include the new `'hexagon'` for Commercial. System type ids use the `a0000000-...` range continuing the prior convention.

- [ ] **Step 1: Write the migration (table + RLS + audit triggers + seed)**

```sql
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
```

- [ ] **Step 2: Verify reset; 12 system types present**

Run: `supabase db reset` then `psql "$DB_URL" -c "select count(*) from public.event_types where is_system;"`
Expected: 12.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/*_event_types.sql
git commit -m "feat(events): event_types table + system types incl. commercial hexagon"
```

---

### Task 4: events table

**Files:**
- Create: `supabase/migrations/<ts>_events_table.sql`

**Interfaces:**
- Produces: `public.events` with the merged date model, provenance, `significance` (nullable, inherits from type), `visibility` (nullable: `pinned`/`hidden`), and a single polymorphic anchor (`anchor_type` in `space|company|asset|trial`, `anchor_id` nullable only when `space`). Generated `is_projected`. RLS = `has_space_access` read, owner/editor write. Audit triggers.

- [ ] **Step 1: Write the migration**

```sql
create table public.events (
  id                 uuid primary key default gen_random_uuid(),
  space_id           uuid not null references public.spaces (id) on delete cascade,
  event_type_id      uuid not null references public.event_types (id),
  title              text not null,
  description        text,
  source_url         text,
  event_date         date not null,
  date_precision     text not null default 'exact' check (date_precision in ('exact','month','quarter','half','year')),
  end_date           date,
  end_date_precision text not null default 'exact' check (end_date_precision in ('exact','month','quarter','half','year')),
  is_ongoing         boolean not null default false check (not (is_ongoing and end_date is not null)),
  projection         text not null default 'actual' check (projection in ('stout','company','primary','actual')),
  is_projected       boolean generated always as (projection <> 'actual') stored,
  significance        text check (significance in ('high','low')),
  visibility          text check (visibility in ('pinned','hidden')),
  anchor_type         text not null check (anchor_type in ('space','company','asset','trial')),
  anchor_id           uuid,
  no_longer_expected  boolean not null default false,
  metadata            jsonb,
  source_doc_id       uuid references public.source_documents (id) on delete set null,
  created_by          uuid not null references auth.users (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users (id),
  constraint events_anchor_id_required check (anchor_type = 'space' or anchor_id is not null)
);
create index idx_events_space_id on public.events (space_id);
create index idx_events_event_type_id on public.events (event_type_id);
create index idx_events_event_date on public.events (event_date);
create index idx_events_anchor on public.events (anchor_type, anchor_id);

alter table public.events enable row level security;
create policy "events: select" on public.events for select to authenticated
  using (public.has_space_access(space_id));
create policy "events: insert" on public.events for insert to authenticated
  with check (public.has_space_access(space_id, array['owner','editor']));
create policy "events: update" on public.events for update to authenticated
  using (public.has_space_access(space_id, array['owner','editor']))
  with check (public.has_space_access(space_id, array['owner','editor']));
create policy "events: delete" on public.events for delete to authenticated
  using (public.has_space_access(space_id, array['owner','editor']));

create trigger trg_events_set_created_by  before insert on public.events
  for each row execute function public._set_created_by();
create trigger trg_events_set_updated_audit before update on public.events
  for each row execute function public._set_updated_audit();
```

- [ ] **Step 2: Verify reset**

Run: `supabase db reset`
Expected: completes; `\d public.events` shows the columns and the `events_anchor_id_required` check.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/*_events_table.sql
git commit -m "feat(events): unified events table (date model + provenance + significance + anchor)"
```

---

### Task 5: event_changes append-only log + trigger

**Files:**
- Create: `supabase/migrations/<ts>_event_changes.sql`

**Interfaces:**
- Produces: `public.event_changes(id, event_id, space_id, change_type, old_values, new_values, changed_by, changed_at)` and `public._log_event_change()` BEFORE INSERT/UPDATE/DELETE trigger on `public.events`. Material fields tracked: `event_date, end_date, title, projection, event_type_id, significance, visibility, description`.

- [ ] **Step 1: Write the migration (mirror `_log_marker_change`)**

```sql
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
```

- [ ] **Step 2: Verify reset**

Run: `supabase db reset`
Expected: completes; trigger `events_audit` exists on `public.events`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/*_event_changes.sql
git commit -m "feat(events): event_changes append-only log + trigger"
```

---

### Task 6: create_event RPC

**Files:**
- Create: `supabase/migrations/<ts>_create_event_rpc.sql`

**Interfaces:**
- Produces: `public.create_event(p_space_id uuid, p_event_type_id uuid, p_title text, p_event_date date, p_anchor_type text, p_anchor_id uuid default null, p_projection text default 'actual', p_date_precision text default 'exact', p_end_date date default null, p_end_date_precision text default 'exact', p_is_ongoing boolean default false, p_description text default null, p_source_url text default null, p_significance text default null, p_visibility text default null, p_source_doc_id uuid default null) returns uuid`. Validates space access (owner/editor), anchor entity belongs to the space, precision enums. Inserts; `created_by` set by trigger. Returns new id.

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Verify reset**

Run: `supabase db reset`
Expected: completes; `\df public.create_event` shows the function.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/*_create_event_rpc.sql
git commit -m "feat(events): create_event RPC"
```

---

### Task 7: update_event RPC

**Files:**
- Create: `supabase/migrations/<ts>_update_event_rpc.sql`

**Interfaces:**
- Produces: `public.update_event(p_event_id uuid, p_title text, p_event_date date, p_projection text, p_date_precision text, p_end_date date, p_end_date_precision text, p_is_ongoing boolean, p_description text, p_source_url text, p_significance text, p_visibility text, p_no_longer_expected boolean) returns void`. Validates owner/editor on the event's space; updates fields; `updated_by`/`updated_at` set by trigger; change captured by `events_audit`.

- [ ] **Step 1: Write the migration**

```sql
create or replace function public.update_event(
  p_event_id uuid, p_title text, p_event_date date, p_projection text, p_date_precision text,
  p_end_date date, p_end_date_precision text, p_is_ongoing boolean, p_description text,
  p_source_url text, p_significance text, p_visibility text, p_no_longer_expected boolean
) returns void language plpgsql security definer set search_path = public as $$
declare v_space uuid;
begin
  select space_id into v_space from public.events where id = p_event_id;
  if v_space is null then raise exception 'event not found' using errcode = 'P0002'; end if;
  if not public.has_space_access(v_space, array['owner','editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_is_ongoing and p_end_date is not null then
    raise exception 'an ongoing event cannot have an end date' using errcode = '22023';
  end if;
  update public.events set
    title = p_title, event_date = p_event_date, projection = p_projection, date_precision = p_date_precision,
    end_date = p_end_date, end_date_precision = p_end_date_precision, is_ongoing = p_is_ongoing,
    description = p_description, source_url = p_source_url, significance = p_significance,
    visibility = p_visibility, no_longer_expected = p_no_longer_expected
  where id = p_event_id;
end; $$;

grant execute on function public.update_event(uuid,text,date,text,text,date,text,boolean,text,text,text,text,boolean) to authenticated;
notify pgrst, 'reload schema';
```

- [ ] **Step 2: Verify reset; commit**

Run: `supabase db reset`
Expected: completes.

```bash
git add supabase/migrations/*_update_event_rpc.sql
git commit -m "feat(events): update_event RPC"
```

---

### Task 8: Grants for the new tables

**Files:**
- Create: `supabase/migrations/<ts>_event_grants.sql`
- Modify: `supabase/data-api-grants.json`

**Interfaces:**
- Produces: table-level grants matching the matrix: `events` (select/insert/update/delete), `event_types` (select/insert/update/delete), `event_type_categories` (select/insert/update/delete), `event_changes` (select only). Removes the old `markers*`/`events*`/`event_categories` entries from the JSON.

- [ ] **Step 1: Write the grant migration**

```sql
grant select, insert, update, delete on public.events                 to authenticated;
grant select, insert, update, delete on public.event_types            to authenticated;
grant select, insert, update, delete on public.event_type_categories  to authenticated;
grant select                          on public.event_changes          to authenticated;
```

- [ ] **Step 2: Update the grants matrix JSON**

In `supabase/data-api-grants.json`, under `"tables"`, remove `markers`, `marker_assignments`, `marker_categories`, `marker_types`, `marker_changes`, `events`, `event_categories`, `event_threads`, `event_sources`, `event_links` (old entries), and add:

```json
"events": { "authenticated": ["select","insert","update","delete"], "justification": "client: event.service CRUD via PostgREST; writes also through create_event/update_event RPCs; RLS restricts writes to space owners/editors." },
"event_types": { "authenticated": ["select","insert","update","delete"], "justification": "client: event-type.service manage surface (Stage 3) full CRUD; selects embed event_types into events. RLS restricts writes to owners/editors." },
"event_type_categories": { "authenticated": ["select","insert","update","delete"], "justification": "client: taxonomy admin manage surface (Stage 3); selects embed categories. RLS restricts writes to owners/editors." },
"event_changes": { "authenticated": ["select"], "justification": "client: Activity surface reads the change log; writes only via the events trigger." }
```

- [ ] **Step 3: Run grants check**

Run: `cd src/client && npm run grants:check`
Expected: PASS (no missing or excess grants).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_event_grants.sql supabase/data-api-grants.json
git commit -m "feat(events): grants matrix for unified event tables"
```

---

### Task 9: Feature manifest for create_event/update_event

**Files:**
- Create: `docs/runbook/features/events.md`
- Delete: `docs/runbook/features/catalysts.md` (its RPCs were dropped)

**Interfaces:**
- Produces: a manifest capability that maps `create_event`, `update_event` to a surface so `features:check` (which requires every public fn map to a capability) passes. Tables referenced: `events`, `event_types`, `event_type_categories`, `event_changes`.

- [ ] **Step 1: Write the manifest**

```markdown
---
surface: Events
spec: docs/superpowers/specs/2026-06-28-unified-events-timeline-design.md
---

# Events

The unified dated-fact entity that powers the timeline, the Intelligence feed,
Future Events, and Activity.

## Capabilities

​```yaml
- id: event-authoring
  summary: Create and edit events (the merged marker/event entity) with date model, provenance, significance, anchor, and pin/hide.
  routes: []
  rpcs:
    - create_event
    - update_event
  tables:
    - events
    - event_types
    - event_type_categories
    - event_changes
  related: []
  user_facing: false
  role: editor
  status: active
​```
```

(Remove the backslash-zero-width characters; the fenced yaml block uses three backticks.)

- [ ] **Step 2: Delete the stale catalysts manifest and run features:check**

```bash
git rm docs/runbook/features/catalysts.md
cd src/client && npm run features:check
```
Expected: PASS (every public fn maps; no `rpc-unmapped` error).

- [ ] **Step 3: Commit**

```bash
git add docs/runbook/features/events.md
git commit -m "docs(events): feature manifest for create_event/update_event"
```

---

### Task 10: Integration tests (create/update, RLS, significance default, audit, change log)

**Files:**
- Create: `src/client/integration/tests/event-model-foundation.spec.ts`

**Interfaces:**
- Consumes: `buildPersonas`, `adminClient` from `../fixtures/personas`; `as`, `expectOk` from `../harness/as`; the `create_event`/`update_event` RPCs.

- [ ] **Step 1: Write the failing tests**

```typescript
import { beforeAll, describe, expect, it } from 'vitest';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectOk } from '../harness/as';

let p: Personas;
beforeAll(async () => { p = await buildPersonas(); }, 90_000);

const TOPLINE = 'a0000000-0000-0000-0000-000000000013'; // Topline Data (high)
const LEADER  = 'a0000000-0000-0000-0000-000000000050'; // Leadership Change (low)

describe('event model foundation', () => {
  const admin = adminClient();

  it('create_event inserts an asset-anchored event and sets created_by from JWT', async () => {
    const client = as(p, 'contributor');
    const { data: asset } = await admin.from('assets')
      .insert({ space_id: p.org.spaceId, name: 'Zepbound' }).select('id').single();

    const { data: id, error } = await client.rpc('create_event', {
      p_space_id: p.org.spaceId, p_event_type_id: TOPLINE, p_title: 'Topline readout',
      p_event_date: '2025-09-15', p_anchor_type: 'asset', p_anchor_id: asset!.id,
    });
    expectOk({ data: id, error });

    const { data: row } = await admin.from('events').select('*').eq('id', id).single();
    expect(row!.created_by).toBe(p.ids.contributor);
    expect(row!.anchor_type).toBe('asset');
    expect(row!.significance).toBeNull(); // inherits from type
  });

  it('create_event rejects a viewer (42501)', async () => {
    const client = as(p, 'reader');
    const { error } = await client.rpc('create_event', {
      p_space_id: p.org.spaceId, p_event_type_id: TOPLINE, p_title: 'x',
      p_event_date: '2025-01-01', p_anchor_type: 'space',
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });

  it('create_event rejects an anchor from another space (42501)', async () => {
    const client = as(p, 'contributor');
    const { data: otherAsset } = await admin.from('assets')
      .insert({ space_id: p.other.spaceId, name: 'Foreign' }).select('id').single();
    const { error } = await client.rpc('create_event', {
      p_space_id: p.org.spaceId, p_event_type_id: TOPLINE, p_title: 'x',
      p_event_date: '2025-01-01', p_anchor_type: 'asset', p_anchor_id: otherAsset!.id,
    });
    expect(error!.code).toBe('42501');
  });

  it('update_event sets updated_by and writes an event_changes row', async () => {
    const client = as(p, 'contributor');
    const { data: id } = await client.rpc('create_event', {
      p_space_id: p.org.spaceId, p_event_type_id: LEADER, p_title: 'CEO comment',
      p_event_date: '2024-01-10', p_anchor_type: 'space',
    });
    const { error } = await client.rpc('update_event', {
      p_event_id: id, p_title: 'CEO comment (updated)', p_event_date: '2024-01-10',
      p_projection: 'actual', p_date_precision: 'exact', p_end_date: null,
      p_end_date_precision: 'exact', p_is_ongoing: false, p_description: null,
      p_source_url: null, p_significance: null, p_visibility: 'pinned', p_no_longer_expected: false,
    });
    expectOk({ data: null, error });

    const { data: row } = await admin.from('events').select('updated_by, visibility').eq('id', id).single();
    expect(row!.updated_by).toBe(p.ids.contributor);
    expect(row!.visibility).toBe('pinned');

    const { data: changes } = await admin.from('event_changes')
      .select('change_type').eq('event_id', id).order('changed_at', { ascending: true });
    expect(changes!.map((c) => c.change_type)).toEqual(['created', 'updated']);
  });
});
```

- [ ] **Step 2: Run, expect FAIL (RPCs/tables exist after db reset, so run reset first)**

Run: `supabase db reset` then `cd src/client && npm run test -- integration/tests/event-model-foundation.spec.ts`
Expected: PASS if Tasks 1-8 applied. If a persona fixture lacks `p.other.spaceId`, check `fixtures/personas.ts` for the second-space accessor name and adjust (it exists for cross-space tests).

- [ ] **Step 3: Commit**

```bash
git add src/client/integration/tests/event-model-foundation.spec.ts
git commit -m "test(events): foundation integration tests (create/update/RLS/audit/change-log)"
```

---

### Task 11: Reseed system data + regen architecture docs

**Files:**
- Modify: `supabase/seed.sql` (replace marker/event seed blocks with a pointer; system types now ship via migrations)
- Regen: `docs/runbook/02-*, 06-*, 07-*` via `npm run docs:arch`

**Interfaces:**
- Produces: a clean `db reset` with no references to dropped tables in `seed.sql`. Demo events are added in Stage 4 (producers); Stage 1 seed only needs the system taxonomy, which the migrations already insert.

- [ ] **Step 1: Remove dropped-table seed blocks**

In `supabase/seed.sql`, delete the `insert into public.marker_categories ...`, `insert into public.marker_types ...`, and `insert into public.event_categories ...` blocks (system taxonomy now lives in the Task 2/3 migrations). Leave the demo-space bootstrap; the `seed_demo_data` RPC is repointed in Stage 4, so if it references markers/events, temporarily guard its call: wrap the `perform public.seed_demo_data(...)` line so a missing function does not break reset, or stub `seed_demo_data` to a no-op in this stage. Confirm `supabase db reset` is green.

- [ ] **Step 2: Run reset + advisors + docs regen**

```bash
supabase db reset
supabase db advisors --local --type all
cd src/client && npm run docs:arch
```
Expected: reset green; advisors report no new ERROR/WARN on the new tables (RLS enabled on all four; add a policy if `rls_disabled_in_public` fires); docs regen updates the ER + RPC matrix.

- [ ] **Step 3: Commit**

```bash
git add supabase/seed.sql docs/runbook
git commit -m "chore(events): reseed system taxonomy via migrations; regen architecture docs"
```

---

## Self-Review

**Spec coverage (Stage 1 scope):** unified Event schema (Tasks 3-4), event_types subsuming marker/event taxonomies (Tasks 2-3), provenance + significance + visibility + single anchor (Task 4), no `marker_assignments` (Task 1 drop, Task 4 anchor), change log (Task 5), create/update RPCs with server-side audit + shared-RPC rule (Tasks 6-7), RLS owner/editor (Tasks 2-4), grants dark-by-default (Task 8), features mapping (Task 9), greenfield drop + no backfill (Task 1), drift gates + advisors (Tasks 8-11), integration tests paired per behavior (Task 10). Deferred to later stages: timeline rendering/toggles, terminology/IA, producers (seed-demo/ctgov/AI import), the Activity/feed/Future-Events surfaces, docs/glossary/deck.

**Placeholder scan:** the `<ts>` migration prefixes are assigned at `supabase migration new` time (noted in File Structure), not placeholders. The feature-manifest fenced block uses literal triple backticks (the zero-width note flags it). No TODO/TBD.

**Type consistency:** `create_event` returns `uuid`; `update_event` returns `void`. `significance`/`visibility` are nullable on `events` and pass through both RPCs. System type ids referenced in tests (`TOPLINE`, `LEADER`) match the Task 3 seed. `has_space_access(space_id, array['owner','editor'])` matches the gathered RLS signature. `_set_created_by`/`_set_updated_audit` are the existing functions (Task 4 reuses them).

---

## Next stages (separate plans, written just-in-time)

- **Stage 2:** timeline reads `events`; three row levels + visibility toggles + Compare preset; commercial hexagon glyph; phase-bar derivation from clinical-type events. First dev deploy + Chrome verification.
- **Stage 3:** terminology/IA (Intelligence, Activity, Future Events), merged Event form, taxonomy admin.
- **Stage 4:** producers (seed-demo, CT.gov sync, AI import) emit events; final cutover.
- **Stage 5:** existing-suite migration sweep, docs/glossary, deck rework (last).
