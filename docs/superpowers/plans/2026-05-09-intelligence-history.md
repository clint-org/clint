# Intelligence Version History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make published primary intelligence versioned and surface the version history on each entity detail page, with a layered audience (clients see versions, agency sees per-version edit diffs), Withdraw (soft) and Purge (hard, typed-confirmation) controls, and history that survives republish.

**Architecture:** Versions are first-class rows in `primary_intelligence` (state expanded to `draft | published | archived | withdrawn`). Republish archives the prior published row instead of deleting it. A BEFORE trigger stamps `version_number` and `published_at` on entry into `published`. A second BEFORE trigger guards the state machine. The existing `primary_intelligence_revisions` table stays as the agency-only per-version audit log. One new presenter component (`IntelligenceHistoryPanel`) mounts below `IntelligenceBlock` on every detail page. `jsdiff` powers word-level diffs in the agency view.

**Tech Stack:** Angular 19 (standalone, signals), PrimeNG 19, Tailwind v4, Supabase (Postgres + RLS), Playwright (unit + e2e).

**Spec:** `docs/superpowers/specs/2026-05-09-intelligence-history-design.md`

---

## File Map

**Database (created):**
- `supabase/migrations/20260509130000_intelligence_history_schema.sql` -- column + index + check + triggers + backfill
- `supabase/migrations/20260509130100_intelligence_history_rpcs.sql` -- modify upsert, add withdraw / purge / get_primary_intelligence_history / get_intelligence_version_revisions, narrow delete
- `supabase/tests/intelligence-history/01_state_machine_guard.sql`
- `supabase/tests/intelligence-history/02_version_stamping.sql`
- `supabase/tests/intelligence-history/03_archive_on_republish.sql`
- `supabase/tests/intelligence-history/04_change_note_required.sql`
- `supabase/tests/intelligence-history/05_withdraw.sql`
- `supabase/tests/intelligence-history/06_purge.sql`
- `supabase/tests/intelligence-history/07_history_payload.sql`
- `supabase/tests/intelligence-history/run.sh`

**Frontend (modified):**
- `src/client/src/app/core/models/primary-intelligence.model.ts` -- widen `IntelligenceState`, add new types
- `src/client/src/app/core/services/primary-intelligence.service.ts` -- four new methods
- `src/client/src/app/shared/components/intelligence-block/intelligence-block.component.ts` -- state-aware controls, withdraw / purge outputs
- `src/client/src/app/shared/components/intelligence-block/intelligence-block.component.html` -- Withdraw button replaces Delete, overflow menu adds Purge
- `src/client/package.json` -- add `diff` dependency
- `src/client/src/app/features/manage/trials/trial-detail.component.ts` and `.html` -- mount history panel + handle withdraw / purge
- `src/client/src/app/features/manage/companies/company-detail.component.ts` and `.html` -- same
- `src/client/src/app/features/manage/products/product-detail.component.ts` and `.html` -- same
- `src/client/src/app/features/manage/markers/marker-detail.component.ts` and `.html` -- same
- `src/client/src/app/features/manage/engagement/engagement-detail.component.ts` and `.html` -- same

**Frontend (created):**
- `src/client/src/app/shared/utils/version-summary.ts` -- pure helper
- `src/client/src/app/shared/utils/version-summary.spec.ts`
- `src/client/src/app/shared/components/intelligence-history-panel/intelligence-history-panel.component.ts`
- `src/client/src/app/shared/components/intelligence-history-panel/intelligence-history-panel.component.html`
- `src/client/src/app/shared/components/intelligence-history-panel/withdraw-dialog.component.ts`
- `src/client/src/app/shared/components/intelligence-history-panel/purge-dialog.component.ts`
- `src/client/e2e/intelligence-history.e2e.ts`

---

## Conventions

- All migrations follow the `YYYYMMDDHHMMSS_description.sql` naming and are append-only (never edit a merged migration).
- Postgres functions use `language plpgsql` (or `sql`), `security definer` for write paths, `set search_path = ''`, fully-qualified table names (`public.x`).
- Frontend uses `inject()`, signals, control flow `@if/@for`, standalone components with explicit `imports`.
- Service methods stay Promise-based to mirror the rest of `PrimaryIntelligenceService`.
- Tests in this repo use `@playwright/test` for unit specs (`*.spec.ts` colocated with source) and `*.e2e.ts` files under `src/client/e2e/`.
- SQL tests run via `docker exec` against the local Supabase Postgres container; see `supabase/tests/palette/run.sh`.
- After every task that changes code, run `cd src/client && ng lint && ng build` before committing.
- Commit messages: lowercase scope prefix, no Claude attribution, no em dashes.

---

## Task 1: Database schema migration

**Files:**
- Create: `supabase/migrations/20260509130000_intelligence_history_schema.sql`

- [ ] **Step 1: Create the migration file with full content**

```sql
-- migration: 20260509130000_intelligence_history_schema
-- purpose: extend primary_intelligence to support versioned history.
--   adds archived/withdrawn states, version_number, published_at,
--   withdrawn_at/withdrawn_by, two BEFORE triggers (assign version
--   on entry to published; reject illegal state transitions), and
--   backfills currently-published rows as v1.

-- =============================================================================
-- expand state CHECK
-- =============================================================================

alter table public.primary_intelligence
  drop constraint if exists primary_intelligence_state_check;

alter table public.primary_intelligence
  add constraint primary_intelligence_state_check
      check (state in ('draft','published','archived','withdrawn'));

-- =============================================================================
-- new columns
-- =============================================================================

alter table public.primary_intelligence
  add column if not exists version_number int,
  add column if not exists published_at  timestamptz,
  add column if not exists withdrawn_at  timestamptz,
  add column if not exists withdrawn_by  uuid references auth.users (id);

comment on column public.primary_intelligence.version_number is
  'Per-anchor sequence assigned on entry into state=published. Null for drafts. Preserved through archive/withdraw transitions.';
comment on column public.primary_intelligence.published_at is
  'Timestamp of the most recent transition into state=published. Preserved through archive/withdraw.';
comment on column public.primary_intelligence.withdrawn_at is
  'Timestamp of the published -> withdrawn transition. Null otherwise.';

-- =============================================================================
-- index for the history panel (versions list, newest first)
-- =============================================================================

create index if not exists idx_primary_intelligence_anchor_versions
  on public.primary_intelligence (space_id, entity_type, entity_id, version_number desc)
  where state in ('published','archived','withdrawn');

-- =============================================================================
-- trigger: assign_primary_intelligence_version
-- =============================================================================
-- BEFORE INSERT/UPDATE. When state is published and version_number is null,
-- stamp the next per-anchor version number and set published_at = now().

create or replace function public.assign_primary_intelligence_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.state = 'published' and new.version_number is null then
    new.version_number := coalesce((
      select max(version_number) + 1
        from public.primary_intelligence
       where space_id    = new.space_id
         and entity_type = new.entity_type
         and entity_id   = new.entity_id
         and (TG_OP = 'INSERT' or id <> new.id)
         and version_number is not null
    ), 1);
    new.published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists primary_intelligence_assign_version_trigger
  on public.primary_intelligence;

create trigger primary_intelligence_assign_version_trigger
  before insert or update on public.primary_intelligence
  for each row execute function public.assign_primary_intelligence_version();

-- =============================================================================
-- trigger: guard_primary_intelligence_state
-- =============================================================================
-- BEFORE UPDATE. Rejects illegal state transitions:
--   - any change out of archived or withdrawn (terminal except for purge=DELETE)
--   - published -> draft (use withdraw or republish a new draft)

create or replace function public.guard_primary_intelligence_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.state is distinct from new.state then
    if old.state = 'archived' or old.state = 'withdrawn' then
      raise exception 'cannot transition % from terminal state %', new.id, old.state
        using errcode = '22023';
    end if;
    if old.state = 'published' and new.state = 'draft' then
      raise exception 'cannot move published row back to draft (use withdraw or republish a new draft)'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists primary_intelligence_guard_state_trigger
  on public.primary_intelligence;

create trigger primary_intelligence_guard_state_trigger
  before update on public.primary_intelligence
  for each row execute function public.guard_primary_intelligence_state();

-- =============================================================================
-- backfill: every currently-published row becomes v1
-- =============================================================================

update public.primary_intelligence
   set version_number = 1,
       published_at  = coalesce(published_at, updated_at)
 where state = 'published'
   and version_number is null;
```

- [ ] **Step 2: Reset and verify the schema applies cleanly**

Run from `src/client/`:
```bash
cd /Users/aadityamadala/Documents/code/clint-v2
supabase db reset
```
Expected: completes without errors, prints "Finished `supabase db reset` ..."

- [ ] **Step 3: Quick manual verification of the schema delta**

Run:
```bash
docker exec -i supabase_db_clint-v2 psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
\d public.primary_intelligence
select count(*) from public.primary_intelligence where state='published' and version_number=1;
SQL
```
Expected: the four new columns are listed, and at least the seeded published rows are stamped as v1.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260509130000_intelligence_history_schema.sql
git commit -m "feat(supabase): add primary_intelligence history schema and triggers"
```

---

## Task 2: SQL test -- state machine guard

**Files:**
- Create: `supabase/tests/intelligence-history/01_state_machine_guard.sql`

- [ ] **Step 1: Write the SQL test (will fail before Task 1's migration is applied; passes after)**

```sql
-- 01_state_machine_guard
-- Asserts the guard trigger rejects illegal state transitions.

do $$
declare
  v_space uuid;
  v_entity uuid;
  v_user uuid;
  v_id uuid;
  v_caught boolean;
begin
  select id, space_id into v_entity, v_space
  from public.companies order by id limit 1;
  select id into v_user from auth.users order by id limit 1;
  if v_space is null or v_entity is null or v_user is null then
    raise notice 'no seed data; skipping';
    return;
  end if;

  -- create a published row directly (skip RLS by inserting as superuser via psql)
  insert into public.primary_intelligence (
    space_id, entity_type, entity_id, state, headline,
    thesis_md, watch_md, implications_md, last_edited_by
  ) values (
    v_space, 'company', v_entity, 'published', 'Guard test',
    '', '', '', v_user
  )
  returning id into v_id;

  -- attempt published -> draft (must fail)
  v_caught := false;
  begin
    update public.primary_intelligence set state='draft' where id = v_id;
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'expected published -> draft to be rejected';
  end if;

  -- archive it
  update public.primary_intelligence set state='archived' where id = v_id;

  -- attempt archived -> anything (must fail)
  v_caught := false;
  begin
    update public.primary_intelligence set state='published' where id = v_id;
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'expected archived -> published to be rejected';
  end if;

  -- cleanup
  delete from public.primary_intelligence where id = v_id;
end $$;
```

- [ ] **Step 2: Run the test**

```bash
docker exec -i supabase_db_clint-v2 psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/intelligence-history/01_state_machine_guard.sql
```
Expected: completes without "expected ... to be rejected" exceptions.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/intelligence-history/01_state_machine_guard.sql
git commit -m "test(supabase): assert state machine guard rejects illegal transitions"
```

---

## Task 3: SQL test -- version_number stamping

**Files:**
- Create: `supabase/tests/intelligence-history/02_version_stamping.sql`

- [ ] **Step 1: Write the test**

```sql
-- 02_version_stamping
-- Asserts BEFORE trigger stamps version_number and published_at on entry into published.

do $$
declare
  v_space uuid;
  v_entity uuid;
  v_user uuid;
  v_id1 uuid;
  v_id2 uuid;
  v_n1 int;
  v_n2 int;
  v_pa1 timestamptz;
begin
  select id, space_id into v_entity, v_space
  from public.products order by id limit 1;
  select id into v_user from auth.users order by id limit 1;
  if v_space is null or v_entity is null or v_user is null then
    raise notice 'no seed data; skipping';
    return;
  end if;

  -- first publish gets v1
  insert into public.primary_intelligence (
    space_id, entity_type, entity_id, state, headline, thesis_md, watch_md, implications_md, last_edited_by
  ) values (v_space, 'product', v_entity, 'published', 'V1', '', '', '', v_user)
  returning id, version_number, published_at into v_id1, v_n1, v_pa1;

  if v_n1 <> 1 then raise exception 'expected v1, got %', v_n1; end if;
  if v_pa1 is null then raise exception 'expected published_at to be stamped'; end if;

  -- archive the first
  update public.primary_intelligence set state='archived' where id = v_id1;

  -- new publish gets v2
  insert into public.primary_intelligence (
    space_id, entity_type, entity_id, state, headline, thesis_md, watch_md, implications_md, last_edited_by
  ) values (v_space, 'product', v_entity, 'published', 'V2', '', '', '', v_user)
  returning id, version_number into v_id2, v_n2;

  if v_n2 <> 2 then raise exception 'expected v2, got %', v_n2; end if;

  -- editing the published row in place must not re-stamp version_number
  update public.primary_intelligence set headline='V2 edited' where id = v_id2;
  select version_number into v_n2 from public.primary_intelligence where id = v_id2;
  if v_n2 <> 2 then raise exception 'expected version_number to remain 2 after in-place edit, got %', v_n2; end if;

  -- cleanup
  delete from public.primary_intelligence where id in (v_id1, v_id2);
end $$;
```

- [ ] **Step 2: Run the test**

```bash
docker exec -i supabase_db_clint-v2 psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/intelligence-history/02_version_stamping.sql
```
Expected: completes without exceptions.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/intelligence-history/02_version_stamping.sql
git commit -m "test(supabase): assert version_number and published_at stamp on entry to published"
```

---

## Task 4: RPC migration -- modify upsert, add withdraw/purge/history RPCs, narrow delete

**Files:**
- Create: `supabase/migrations/20260509130100_intelligence_history_rpcs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260509130100_intelligence_history_rpcs
-- purpose: replace destructive republish behavior, add withdraw/purge,
--   and add history-fetcher RPCs. Narrows delete_primary_intelligence
--   to drafts only.

-- =============================================================================
-- upsert_primary_intelligence (replace)
-- =============================================================================
-- Differences from prior version:
--   - on publish, archive any prior published row instead of deleting it.
--   - on publish, require change_note when a prior version (any non-draft) exists.

create or replace function public.upsert_primary_intelligence(
  p_id              uuid,
  p_space_id        uuid,
  p_entity_type     text,
  p_entity_id       uuid,
  p_headline        text,
  p_thesis_md       text,
  p_watch_md        text,
  p_implications_md text,
  p_state           text,
  p_change_note     text,
  p_links           jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_agency_member_of_space(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_state not in ('draft', 'published') then
    raise exception 'invalid state %', p_state using errcode = '22023';
  end if;

  if p_entity_type not in ('trial', 'marker', 'company', 'product', 'space') then
    raise exception 'invalid entity_type %', p_entity_type using errcode = '22023';
  end if;

  perform set_config('app.change_note', coalesce(p_change_note, ''), true);

  if p_state = 'published' then
    -- enforce change_note when any prior non-draft version exists for this anchor
    if exists (
      select 1 from public.primary_intelligence
       where space_id    = p_space_id
         and entity_type = p_entity_type
         and entity_id   = p_entity_id
         and state in ('published','archived','withdrawn')
         and id is distinct from p_id
    ) and (p_change_note is null or length(trim(p_change_note)) = 0) then
      raise exception 'change_note required when republishing'
        using errcode = '22023';
    end if;

    -- archive any prior published row for this anchor (was: delete)
    update public.primary_intelligence
       set state = 'archived', updated_at = now()
     where space_id    = p_space_id
       and entity_type = p_entity_type
       and entity_id   = p_entity_id
       and state       = 'published'
       and id is distinct from p_id;
  end if;

  if p_id is null then
    insert into public.primary_intelligence (
      space_id, entity_type, entity_id, state, headline,
      thesis_md, watch_md, implications_md, last_edited_by
    ) values (
      p_space_id, p_entity_type, p_entity_id, p_state, p_headline,
      coalesce(p_thesis_md, ''), coalesce(p_watch_md, ''),
      coalesce(p_implications_md, ''), auth.uid()
    )
    returning id into v_id;
  else
    update public.primary_intelligence
       set state = p_state,
           headline = p_headline,
           thesis_md = coalesce(p_thesis_md, ''),
           watch_md = coalesce(p_watch_md, ''),
           implications_md = coalesce(p_implications_md, ''),
           last_edited_by = auth.uid(),
           updated_at = now()
     where id = p_id
       and space_id = p_space_id
    returning id into v_id;

    if v_id is null then
      raise exception 'primary_intelligence % not found in space %', p_id, p_space_id
        using errcode = 'P0002';
    end if;
  end if;

  delete from public.primary_intelligence_links
   where primary_intelligence_id = v_id;

  if p_links is not null and jsonb_array_length(p_links) > 0 then
    insert into public.primary_intelligence_links (
      primary_intelligence_id, entity_type, entity_id,
      relationship_type, gloss, display_order
    )
    select v_id,
           (l->>'entity_type')::text,
           (l->>'entity_id')::uuid,
           (l->>'relationship_type')::text,
           nullif(l->>'gloss', ''),
           coalesce((l->>'display_order')::int, 0)
      from jsonb_array_elements(p_links) l;
  end if;

  return v_id;
end;
$$;

-- =============================================================================
-- delete_primary_intelligence (narrow to drafts only)
-- =============================================================================

create or replace function public.delete_primary_intelligence(
  p_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.primary_intelligence%rowtype;
begin
  select * into v_row from public.primary_intelligence where id = p_id;
  if v_row.id is null then return; end if;

  if not public.is_agency_member_of_space(v_row.space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_row.state <> 'draft' then
    raise exception 'delete_primary_intelligence is restricted to drafts; use withdraw_primary_intelligence or purge_primary_intelligence (state=%)', v_row.state
      using errcode = '22023';
  end if;

  delete from public.primary_intelligence where id = p_id;
end;
$$;

-- =============================================================================
-- withdraw_primary_intelligence (new)
-- =============================================================================

create or replace function public.withdraw_primary_intelligence(
  p_id uuid,
  p_change_note text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.primary_intelligence%rowtype;
begin
  select * into v_row from public.primary_intelligence where id = p_id;
  if v_row.id is null then
    raise exception 'primary_intelligence % not found', p_id using errcode = 'P0002';
  end if;
  if not public.is_agency_member_of_space(v_row.space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_row.state <> 'published' then
    raise exception 'only published versions can be withdrawn (state=%)', v_row.state
      using errcode = '22023';
  end if;
  if p_change_note is null or length(trim(p_change_note)) = 0 then
    raise exception 'change_note required for withdraw' using errcode = '22023';
  end if;

  perform set_config('app.change_note', p_change_note, true);

  update public.primary_intelligence
     set state          = 'withdrawn',
         withdrawn_at   = now(),
         withdrawn_by   = auth.uid(),
         last_edited_by = auth.uid(),
         updated_at     = now()
   where id = p_id;
end;
$$;

revoke execute on function public.withdraw_primary_intelligence(uuid, text) from public;
revoke execute on function public.withdraw_primary_intelligence(uuid, text) from anon;
grant  execute on function public.withdraw_primary_intelligence(uuid, text) to authenticated;

-- =============================================================================
-- purge_primary_intelligence (new)
-- =============================================================================

create or replace function public.purge_primary_intelligence(
  p_id uuid,
  p_confirmation text,
  p_purge_anchor boolean default false
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.primary_intelligence%rowtype;
begin
  select * into v_row from public.primary_intelligence where id = p_id;
  if v_row.id is null then
    raise exception 'primary_intelligence % not found', p_id using errcode = 'P0002';
  end if;
  if not public.is_agency_member_of_space(v_row.space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_confirmation is null or p_confirmation <> v_row.headline then
    raise exception 'confirmation does not match headline' using errcode = '22023';
  end if;

  if p_purge_anchor then
    delete from public.primary_intelligence
     where space_id    = v_row.space_id
       and entity_type = v_row.entity_type
       and entity_id   = v_row.entity_id;
  else
    delete from public.primary_intelligence where id = p_id;
  end if;
end;
$$;

revoke execute on function public.purge_primary_intelligence(uuid, text, boolean) from public;
revoke execute on function public.purge_primary_intelligence(uuid, text, boolean) from anon;
grant  execute on function public.purge_primary_intelligence(uuid, text, boolean) to authenticated;

-- =============================================================================
-- get_primary_intelligence_history (new)
-- =============================================================================
-- Returns { current, draft, versions[] } for an anchor. RLS on the
-- underlying tables gates draft visibility automatically.

create or replace function public.get_primary_intelligence_history(
  p_space_id    uuid,
  p_entity_type text,
  p_entity_id   uuid
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with rows as (
    select * from public.primary_intelligence p
     where p.space_id    = p_space_id
       and p.entity_type = p_entity_type
       and p.entity_id   = p_entity_id
  ),
  current_row as (
    select * from rows where state = 'published' limit 1
  ),
  draft_row as (
    select * from rows where state = 'draft' order by updated_at desc limit 1
  ),
  versions as (
    select * from rows where state in ('published','archived','withdrawn')
  ),
  version_revisions as (
    select v.id as version_id,
           (
             select jsonb_build_object(
                      'change_note', rev.change_note,
                      'edited_by',   rev.edited_by,
                      'edited_at',   rev.edited_at
                    )
               from public.primary_intelligence_revisions rev
              where rev.primary_intelligence_id = v.id
                and rev.state = 'published'
              order by rev.edited_at asc
              limit 1
           ) as first_publish
      from versions v
  )
  select jsonb_build_object(
    'current', (select to_jsonb(c) from current_row c),
    'draft',   (select to_jsonb(d) from draft_row d),
    'versions', coalesce(
      (select jsonb_agg(
        jsonb_build_object(
          'id',              v.id,
          'version_number',  v.version_number,
          'state',           v.state,
          'headline',        v.headline,
          'thesis_md',       v.thesis_md,
          'watch_md',        v.watch_md,
          'implications_md', v.implications_md,
          'change_note',     vr.first_publish->>'change_note',
          'edited_by',       v.last_edited_by,
          'published_at',    v.published_at,
          'withdrawn_at',    v.withdrawn_at,
          'withdrawn_by',    v.withdrawn_by
        )
        order by v.version_number desc
      )
      from versions v
      left join version_revisions vr on vr.version_id = v.id),
      '[]'::jsonb
    )
  );
$$;

revoke execute on function public.get_primary_intelligence_history(uuid, text, uuid) from public;
revoke execute on function public.get_primary_intelligence_history(uuid, text, uuid) from anon;
grant  execute on function public.get_primary_intelligence_history(uuid, text, uuid) to authenticated;

-- =============================================================================
-- get_intelligence_version_revisions (new, agency-only via RLS)
-- =============================================================================
-- Returns the per-version edit history for a single version row,
-- ordered oldest-first, used to render adjacent-save word diffs.

create or replace function public.get_intelligence_version_revisions(
  p_version_id uuid
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',              rev.id,
        'state',           rev.state,
        'headline',        rev.headline,
        'thesis_md',       rev.thesis_md,
        'watch_md',        rev.watch_md,
        'implications_md', rev.implications_md,
        'change_note',     rev.change_note,
        'edited_by',       rev.edited_by,
        'edited_at',       rev.edited_at
      )
      order by rev.edited_at asc
    ),
    '[]'::jsonb
  )
  from public.primary_intelligence_revisions rev
  where rev.primary_intelligence_id = p_version_id;
$$;

revoke execute on function public.get_intelligence_version_revisions(uuid) from public;
revoke execute on function public.get_intelligence_version_revisions(uuid) from anon;
grant  execute on function public.get_intelligence_version_revisions(uuid) to authenticated;
```

- [ ] **Step 2: Apply the migration**

```bash
supabase db reset
```
Expected: completes without errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260509130100_intelligence_history_rpcs.sql
git commit -m "feat(supabase): archive on republish, add withdraw/purge/history RPCs"
```

---

## Task 5: SQL test -- archive on republish

**Files:**
- Create: `supabase/tests/intelligence-history/03_archive_on_republish.sql`

- [ ] **Step 1: Write the test**

```sql
-- 03_archive_on_republish
-- Asserts upsert_primary_intelligence archives prior published row instead of deleting.

do $$
declare
  v_space uuid;
  v_entity uuid;
  v_user uuid;
  v_id1 uuid;
  v_id2 uuid;
  v_state text;
  v_archived_count int;
begin
  select id, space_id into v_entity, v_space
  from public.companies order by id limit 1;
  select id into v_user from auth.users
   where id in (select user_id from public.space_members where space_id = v_space)
   order by id limit 1;
  if v_space is null or v_entity is null or v_user is null then
    raise notice 'no seed user; skipping';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  perform set_config('role', 'authenticated', true);

  -- v1 publish (no change note required since no prior version)
  v_id1 := public.upsert_primary_intelligence(
    null, v_space, 'company', v_entity,
    'V1 headline', '', '', '', 'published', null, '[]'::jsonb
  );

  -- v2 publish via a fresh draft id; must archive v1
  v_id2 := public.upsert_primary_intelligence(
    null, v_space, 'company', v_entity,
    'V2 headline', '', '', '', 'published', 'updated thesis', '[]'::jsonb
  );

  -- v1 should still exist, now archived
  select state into v_state from public.primary_intelligence where id = v_id1;
  if v_state <> 'archived' then
    raise exception 'expected v1 to be archived after republish, got state=%', v_state;
  end if;
  select state into v_state from public.primary_intelligence where id = v_id2;
  if v_state <> 'published' then
    raise exception 'expected v2 to be published, got state=%', v_state;
  end if;

  -- exactly one archived row for this anchor
  select count(*) into v_archived_count
    from public.primary_intelligence
   where space_id = v_space and entity_type='company' and entity_id=v_entity
     and state='archived';
  if v_archived_count <> 1 then
    raise exception 'expected 1 archived row, got %', v_archived_count;
  end if;

  -- cleanup
  delete from public.primary_intelligence where id in (v_id1, v_id2);
  perform set_config('role', 'postgres', true);
end $$;
```

- [ ] **Step 2: Run it**

```bash
docker exec -i supabase_db_clint-v2 psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/intelligence-history/03_archive_on_republish.sql
```
Expected: completes without exceptions.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/intelligence-history/03_archive_on_republish.sql
git commit -m "test(supabase): assert republish archives the prior published row"
```

---

## Task 6: SQL test -- change_note required on republish

**Files:**
- Create: `supabase/tests/intelligence-history/04_change_note_required.sql`

- [ ] **Step 1: Write the test**

```sql
-- 04_change_note_required
-- Asserts publishing without a change_note raises when a prior version exists,
-- but is accepted on first publish.

do $$
declare
  v_space uuid; v_entity uuid; v_user uuid; v_id1 uuid; v_id2 uuid;
  v_caught boolean;
begin
  select id, space_id into v_entity, v_space from public.products order by id limit 1;
  select id into v_user from auth.users
   where id in (select user_id from public.space_members where space_id=v_space)
   order by id limit 1;
  if v_space is null or v_user is null then return; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  perform set_config('role', 'authenticated', true);

  -- first publish: change_note may be null
  v_id1 := public.upsert_primary_intelligence(
    null, v_space, 'product', v_entity, 'first', '', '', '', 'published', null, '[]'::jsonb
  );

  -- republish without change_note: must raise
  v_caught := false;
  begin
    v_id2 := public.upsert_primary_intelligence(
      null, v_space, 'product', v_entity, 'second', '', '', '', 'published', null, '[]'::jsonb
    );
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'expected republish-without-change_note to raise';
  end if;

  -- republish with change_note succeeds
  v_id2 := public.upsert_primary_intelligence(
    null, v_space, 'product', v_entity, 'second', '', '', '', 'published', 'fixed wording', '[]'::jsonb
  );

  delete from public.primary_intelligence where id in (v_id1, v_id2);
  perform set_config('role', 'postgres', true);
end $$;
```

- [ ] **Step 2: Run it**

```bash
docker exec -i supabase_db_clint-v2 psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/intelligence-history/04_change_note_required.sql
```
Expected: completes without exceptions.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/intelligence-history/04_change_note_required.sql
git commit -m "test(supabase): assert change_note required when republishing"
```

---

## Task 7: SQL test -- withdraw

**Files:**
- Create: `supabase/tests/intelligence-history/05_withdraw.sql`

- [ ] **Step 1: Write the test**

```sql
-- 05_withdraw
-- Asserts withdraw transitions published -> withdrawn, requires change_note,
-- and rejects non-published rows.

do $$
declare
  v_space uuid; v_entity uuid; v_user uuid; v_id uuid;
  v_state text; v_withdrawn_at timestamptz; v_caught boolean;
begin
  select id, space_id into v_entity, v_space from public.markers order by id limit 1;
  select id into v_user from auth.users
   where id in (select user_id from public.space_members where space_id=v_space)
   order by id limit 1;
  if v_space is null or v_user is null then return; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  perform set_config('role', 'authenticated', true);

  v_id := public.upsert_primary_intelligence(
    null, v_space, 'marker', v_entity, 'to withdraw', '', '', '', 'published', null, '[]'::jsonb
  );

  -- withdraw without change_note: must raise
  v_caught := false;
  begin
    perform public.withdraw_primary_intelligence(v_id, '');
  exception when others then v_caught := true; end;
  if not v_caught then raise exception 'expected withdraw-without-note to raise'; end if;

  -- withdraw with change_note: succeeds
  perform public.withdraw_primary_intelligence(v_id, 'no longer accurate');
  select state, withdrawn_at into v_state, v_withdrawn_at
    from public.primary_intelligence where id = v_id;
  if v_state <> 'withdrawn' then raise exception 'expected withdrawn, got %', v_state; end if;
  if v_withdrawn_at is null then raise exception 'expected withdrawn_at to be stamped'; end if;

  -- second withdraw: must raise (already withdrawn, not published)
  v_caught := false;
  begin
    perform public.withdraw_primary_intelligence(v_id, 'again');
  exception when others then v_caught := true; end;
  if not v_caught then raise exception 'expected double-withdraw to raise'; end if;

  delete from public.primary_intelligence where id = v_id;
  perform set_config('role', 'postgres', true);
end $$;
```

- [ ] **Step 2: Run it**

```bash
docker exec -i supabase_db_clint-v2 psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/intelligence-history/05_withdraw.sql
```
Expected: completes without exceptions.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/intelligence-history/05_withdraw.sql
git commit -m "test(supabase): assert withdraw transitions and validation"
```

---

## Task 8: SQL test -- purge

**Files:**
- Create: `supabase/tests/intelligence-history/06_purge.sql`

- [ ] **Step 1: Write the test**

```sql
-- 06_purge
-- Asserts purge requires exact headline match, deletes one version by default,
-- and cascades the entire anchor when p_purge_anchor=true.

do $$
declare
  v_space uuid; v_entity uuid; v_user uuid; v_id1 uuid; v_id2 uuid;
  v_count int; v_caught boolean;
begin
  select id, space_id into v_entity, v_space from public.companies order by id desc limit 1;
  select id into v_user from auth.users
   where id in (select user_id from public.space_members where space_id=v_space)
   order by id limit 1;
  if v_space is null or v_user is null then return; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  perform set_config('role', 'authenticated', true);

  v_id1 := public.upsert_primary_intelligence(
    null, v_space, 'company', v_entity, 'V1 head', '', '', '', 'published', null, '[]'::jsonb
  );
  v_id2 := public.upsert_primary_intelligence(
    null, v_space, 'company', v_entity, 'V2 head', '', '', '', 'published', 'shifted', '[]'::jsonb
  );

  -- bad confirmation: must raise
  v_caught := false;
  begin
    perform public.purge_primary_intelligence(v_id2, 'wrong', false);
  exception when others then v_caught := true; end;
  if not v_caught then raise exception 'expected wrong-confirmation to raise'; end if;

  -- good confirmation: deletes only v2
  perform public.purge_primary_intelligence(v_id2, 'V2 head', false);
  if exists (select 1 from public.primary_intelligence where id = v_id2) then
    raise exception 'expected v2 deleted';
  end if;
  if not exists (select 1 from public.primary_intelligence where id = v_id1) then
    raise exception 'expected v1 to remain';
  end if;

  -- purge anchor: deletes v1 too
  perform public.purge_primary_intelligence(v_id1, 'V1 head', true);
  select count(*) into v_count from public.primary_intelligence
    where space_id=v_space and entity_type='company' and entity_id=v_entity;
  if v_count <> 0 then raise exception 'expected anchor purge to clear all rows, got %', v_count; end if;

  perform set_config('role', 'postgres', true);
end $$;
```

- [ ] **Step 2: Run it**

```bash
docker exec -i supabase_db_clint-v2 psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/intelligence-history/06_purge.sql
```
Expected: completes without exceptions.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/intelligence-history/06_purge.sql
git commit -m "test(supabase): assert purge confirmation and anchor flag behavior"
```

---

## Task 9: SQL test -- history payload shape

**Files:**
- Create: `supabase/tests/intelligence-history/07_history_payload.sql`

- [ ] **Step 1: Write the test**

```sql
-- 07_history_payload
-- Asserts get_primary_intelligence_history returns current/draft/versions
-- with versions ordered by version_number desc.

do $$
declare
  v_space uuid; v_entity uuid; v_user uuid;
  v_id1 uuid; v_id2 uuid;
  v_payload jsonb;
  v_versions_count int;
  v_top_version int;
begin
  select id, space_id into v_entity, v_space from public.products order by id desc limit 1;
  select id into v_user from auth.users
   where id in (select user_id from public.space_members where space_id=v_space)
   order by id limit 1;
  if v_space is null or v_user is null then return; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  perform set_config('role', 'authenticated', true);

  v_id1 := public.upsert_primary_intelligence(
    null, v_space, 'product', v_entity, 'A', '', '', '', 'published', null, '[]'::jsonb
  );
  v_id2 := public.upsert_primary_intelligence(
    null, v_space, 'product', v_entity, 'B', '', '', '', 'published', 'rev', '[]'::jsonb
  );

  v_payload := public.get_primary_intelligence_history(v_space, 'product', v_entity);

  if v_payload->'current' is null or (v_payload->'current'->>'state') <> 'published' then
    raise exception 'expected current to be the published row';
  end if;
  v_versions_count := jsonb_array_length(v_payload->'versions');
  if v_versions_count <> 2 then
    raise exception 'expected 2 versions, got %', v_versions_count;
  end if;
  v_top_version := (v_payload->'versions'->0->>'version_number')::int;
  if v_top_version <> 2 then
    raise exception 'expected versions ordered desc with v2 first, got %', v_top_version;
  end if;

  -- cleanup via purge anchor
  perform public.purge_primary_intelligence(v_id2, 'B', true);
  perform set_config('role', 'postgres', true);
end $$;
```

- [ ] **Step 2: Run it**

```bash
docker exec -i supabase_db_clint-v2 psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/intelligence-history/07_history_payload.sql
```
Expected: completes without exceptions.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/intelligence-history/07_history_payload.sql
git commit -m "test(supabase): assert get_primary_intelligence_history payload shape"
```

---

## Task 10: SQL test runner

**Files:**
- Create: `supabase/tests/intelligence-history/run.sh`

- [ ] **Step 1: Write the runner**

```bash
#!/usr/bin/env bash
# Run every .sql file in this directory against local Supabase Postgres via docker exec.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER="${INTEL_DB_CONTAINER:-supabase_db_clint-v2}"
for f in "$HERE"/*.sql; do
  echo "--- $f"
  docker exec -i -e PSQLRC=/dev/null "$CONTAINER" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f"
done
echo "All intelligence-history tests passed."
```

- [ ] **Step 2: Mark executable and run**

```bash
chmod +x supabase/tests/intelligence-history/run.sh
./supabase/tests/intelligence-history/run.sh
```
Expected: prints each `--- <file>` and ends with "All intelligence-history tests passed."

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/intelligence-history/run.sh
git commit -m "test(supabase): runner for intelligence-history sql tests"
```

---

## Task 11: Frontend types -- widen `IntelligenceState`, add history types

**Files:**
- Modify: `src/client/src/app/core/models/primary-intelligence.model.ts`

- [ ] **Step 1: Replace the existing `IntelligenceState` line and add history types at end**

Find:
```ts
export type IntelligenceState = 'draft' | 'published';
```
Replace with:
```ts
export type IntelligenceState = 'draft' | 'published' | 'archived' | 'withdrawn';

/** States that count as "a version" in the history panel (excludes draft). */
export type VersionState = Exclude<IntelligenceState, 'draft'>;
```

Append to the bottom of the file:
```ts
/**
 * One row in the version history list returned by
 * `get_primary_intelligence_history`. Each version is a snapshot of a
 * primary_intelligence row that was once published, with the original
 * publish change_note attached.
 */
export interface IntelligenceVersionRow {
  id: string;
  version_number: number;
  state: VersionState;
  headline: string;
  thesis_md: string;
  watch_md: string;
  implications_md: string;
  change_note: string | null;
  edited_by: string;
  published_at: string;
  withdrawn_at: string | null;
  withdrawn_by: string | null;
}

/**
 * Payload returned by `get_primary_intelligence_history`. `current` is
 * the live published row (or null if withdrawn or never published).
 * `draft` is the agency-only working draft. `versions` includes the
 * live published row alongside archived and withdrawn versions, ordered
 * version_number desc.
 */
export interface IntelligenceHistoryPayload {
  current: PrimaryIntelligence | null;
  draft: PrimaryIntelligence | null;
  versions: IntelligenceVersionRow[];
}

/**
 * One revision snapshot returned by
 * `get_intelligence_version_revisions`. Used to render adjacent-save
 * word diffs in the agency view.
 */
export interface IntelligenceVersionRevision {
  id: string;
  state: IntelligenceState;
  headline: string;
  thesis_md: string;
  watch_md: string;
  implications_md: string;
  change_note: string | null;
  edited_by: string;
  edited_at: string;
}
```

- [ ] **Step 2: Lint and build**

```bash
cd src/client && ng lint && ng build
```
Expected: passes. (May produce TypeScript errors elsewhere if any consumer assumed the narrow `IntelligenceState`; if so, those are addressed in their own tasks below.)

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/models/primary-intelligence.model.ts
git commit -m "feat(intelligence): widen IntelligenceState and add history payload types"
```

---

## Task 12: Frontend service -- add four new methods

**Files:**
- Modify: `src/client/src/app/core/services/primary-intelligence.service.ts`

- [ ] **Step 1: Update imports and add methods**

Update the import block at the top of the file to include the new types:
```ts
import {
  IntelligenceDetailBundle,
  IntelligenceEntityType,
  IntelligenceFeedResult,
  IntelligenceFeedRow,
  IntelligenceHistoryPayload,
  IntelligenceVersionRevision,
  UpsertIntelligenceInput,
} from '../models/primary-intelligence.model';
```

Append four new methods inside the `PrimaryIntelligenceService` class, after the existing `delete()` method:

```ts
async loadHistory(
  spaceId: string,
  entityType: IntelligenceEntityType,
  entityId: string
): Promise<IntelligenceHistoryPayload> {
  const { data, error } = await this.supabase.client.rpc(
    'get_primary_intelligence_history',
    { p_space_id: spaceId, p_entity_type: entityType, p_entity_id: entityId }
  );
  if (error) throw error;
  return (
    (data as IntelligenceHistoryPayload) ?? { current: null, draft: null, versions: [] }
  );
}

async loadVersionRevisions(versionId: string): Promise<IntelligenceVersionRevision[]> {
  const { data, error } = await this.supabase.client.rpc(
    'get_intelligence_version_revisions',
    { p_version_id: versionId }
  );
  if (error) throw error;
  return (data as IntelligenceVersionRevision[]) ?? [];
}

async withdraw(id: string, changeNote: string): Promise<void> {
  const { error } = await this.supabase.client.rpc('withdraw_primary_intelligence', {
    p_id: id,
    p_change_note: changeNote,
  });
  if (error) throw error;
}

async purge(id: string, confirmation: string, purgeAnchor = false): Promise<void> {
  const { error } = await this.supabase.client.rpc('purge_primary_intelligence', {
    p_id: id,
    p_confirmation: confirmation,
    p_purge_anchor: purgeAnchor,
  });
  if (error) throw error;
}
```

- [ ] **Step 2: Lint and build**

```bash
cd src/client && ng lint && ng build
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/services/primary-intelligence.service.ts
git commit -m "feat(intelligence): add loadHistory, loadVersionRevisions, withdraw, purge"
```

---

## Task 13: Sectional summary helper + tests

**Files:**
- Create: `src/client/src/app/shared/utils/version-summary.ts`
- Create: `src/client/src/app/shared/utils/version-summary.spec.ts`

- [ ] **Step 1: Write the failing test**

`src/client/src/app/shared/utils/version-summary.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import {
  summarizeVersionChange,
  type VersionShape,
} from './version-summary';

const base: VersionShape = {
  headline: 'Same',
  thesis_md: 'thesis',
  watch_md: 'watch',
  implications_md: 'implications',
};

test.describe('summarizeVersionChange', () => {
  test('marks first publish when there is no prior', () => {
    expect(summarizeVersionChange(base, null)).toEqual({
      changedSections: [],
      isFirst: true,
    });
  });

  test('reports zero changes when fields match', () => {
    expect(summarizeVersionChange(base, { ...base })).toEqual({
      changedSections: [],
      isFirst: false,
    });
  });

  test('reports headline-only change', () => {
    expect(
      summarizeVersionChange({ ...base, headline: 'New' }, base)
    ).toEqual({ changedSections: ['headline'], isFirst: false });
  });

  test('reports multiple changed sections in canonical order', () => {
    expect(
      summarizeVersionChange(
        { ...base, watch_md: 'changed', thesis_md: 'changed' },
        base
      )
    ).toEqual({
      changedSections: ['thesis', 'watch'],
      isFirst: false,
    });
  });

  test('reports implications change', () => {
    expect(
      summarizeVersionChange(
        { ...base, implications_md: 'new' },
        base
      )
    ).toEqual({ changedSections: ['implications'], isFirst: false });
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
cd src/client && npm run test:unit -- src/app/shared/utils/version-summary.spec.ts
```
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the helper**

`src/client/src/app/shared/utils/version-summary.ts`:
```ts
export type VersionSection = 'headline' | 'thesis' | 'watch' | 'implications';

export interface VersionShape {
  headline: string;
  thesis_md: string;
  watch_md: string;
  implications_md: string;
}

export interface VersionChangeSummary {
  changedSections: VersionSection[];
  isFirst: boolean;
}

const ORDER: { section: VersionSection; field: keyof VersionShape }[] = [
  { section: 'headline', field: 'headline' },
  { section: 'thesis', field: 'thesis_md' },
  { section: 'watch', field: 'watch_md' },
  { section: 'implications', field: 'implications_md' },
];

export function summarizeVersionChange(
  thisVersion: VersionShape,
  priorVersion: VersionShape | null
): VersionChangeSummary {
  if (priorVersion === null) {
    return { changedSections: [], isFirst: true };
  }
  const changedSections: VersionSection[] = [];
  for (const { section, field } of ORDER) {
    if (thisVersion[field] !== priorVersion[field]) {
      changedSections.push(section);
    }
  }
  return { changedSections, isFirst: false };
}
```

- [ ] **Step 4: Verify it passes**

```bash
cd src/client && npm run test:unit -- src/app/shared/utils/version-summary.spec.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/shared/utils/version-summary.ts src/client/src/app/shared/utils/version-summary.spec.ts
git commit -m "feat(intelligence): add summarizeVersionChange helper with tests"
```

---

## Task 14: Add `diff` (jsdiff) dependency

**Files:**
- Modify: `src/client/package.json`

- [ ] **Step 1: Install**

```bash
cd src/client && npm install diff @types/diff
```
Expected: adds `diff` and `@types/diff` to `package.json` dependencies (and updates `package-lock.json`).

- [ ] **Step 2: Verify lint and build still pass**

```bash
cd src/client && ng lint && ng build
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/client/package.json src/client/package-lock.json
git commit -m "build(client): add diff (jsdiff) for word-level intelligence diffs"
```

---

## Task 15: IntelligenceHistoryPanel -- collapsed shell

**Files:**
- Create: `src/client/src/app/shared/components/intelligence-history-panel/intelligence-history-panel.component.ts`
- Create: `src/client/src/app/shared/components/intelligence-history-panel/intelligence-history-panel.component.html`

- [ ] **Step 1: Create the component (collapsed-only first)**

`intelligence-history-panel.component.ts`:
```ts
import { Component, computed, input, output, signal } from '@angular/core';

import {
  IntelligenceHistoryPayload,
  IntelligenceVersionRow,
} from '../../../core/models/primary-intelligence.model';

/**
 * Inline panel mounted below IntelligenceBlock on every entity detail
 * page. Shows version history for the anchor. Collapsed by default;
 * lazy expands on click. Agency-only affordances (drafts subsection,
 * per-version edit diffs, withdraw / purge) are gated by
 * `currentUserCanEdit`.
 */
@Component({
  selector: 'app-intelligence-history-panel',
  standalone: true,
  imports: [],
  templateUrl: './intelligence-history-panel.component.html',
})
export class IntelligenceHistoryPanelComponent {
  readonly payload = input.required<IntelligenceHistoryPayload>();
  readonly currentUserCanEdit = input<boolean>(false);
  readonly authorMap = input<Record<string, string>>({});

  readonly withdraw = output<{ id: string; changeNote: string }>();
  readonly purgeVersion = output<{ id: string; confirmation: string }>();
  readonly purgeAnchor = output<{ id: string; confirmation: string }>();
  readonly versionRevisionsRequested = output<string>();

  protected readonly expanded = signal(false);

  protected readonly versions = computed<IntelligenceVersionRow[]>(
    () => this.payload().versions ?? []
  );
  protected readonly versionCount = computed(() => this.versions().length);
  protected readonly latest = computed<IntelligenceVersionRow | null>(
    () => this.versions()[0] ?? null
  );
  protected readonly canExpand = computed(() => this.versionCount() > 1);

  protected toggle(): void {
    if (!this.canExpand()) return;
    this.expanded.update((v) => !v);
  }

  protected formatDate(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
```

`intelligence-history-panel.component.html`:
```html
<section class="mt-6 border-t border-slate-200 pt-4" aria-labelledby="history-heading">
  <button
    type="button"
    class="flex w-full items-center justify-between text-left"
    [attr.aria-expanded]="expanded()"
    [disabled]="!canExpand()"
    (click)="toggle()"
  >
    <span id="history-heading" class="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
      History
    </span>
    <span class="flex items-center gap-3 text-xs text-slate-500">
      @if (versionCount() <= 1) {
        <span>No prior versions</span>
      } @else {
        <span>{{ versionCount() }} versions</span>
        @if (latest(); as v) {
          <span class="font-mono">v{{ v.version_number }}</span>
          <span>{{ formatDate(v.published_at) }}</span>
        }
      }
      <span
        class="inline-block h-2 w-2 border-r border-b border-slate-400"
        [class.rotate-45]="!expanded()"
        [class.-rotate-135]="expanded()"
        aria-hidden="true"
      ></span>
    </span>
  </button>

  @if (expanded()) {
    <div class="mt-4 space-y-3">
      <!-- Version cards added in Task 16 -->
    </div>
  }
</section>
```

- [ ] **Step 2: Verify lint and build**

```bash
cd src/client && ng lint && ng build
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/shared/components/intelligence-history-panel/
git commit -m "feat(intelligence): scaffold IntelligenceHistoryPanel with collapsed shell"
```

---

## Task 16: IntelligenceHistoryPanel -- version cards (client view)

**Files:**
- Modify: `src/client/src/app/shared/components/intelligence-history-panel/intelligence-history-panel.component.ts`
- Modify: `src/client/src/app/shared/components/intelligence-history-panel/intelligence-history-panel.component.html`

- [ ] **Step 1: Add version card state, summary computation, and markdown rendering helper**

Update `intelligence-history-panel.component.ts` -- add imports and class members.

Add to the imports at the top:
```ts
import { renderMarkdownInline } from '../../utils/markdown-render';
import { summarizeVersionChange, VersionSection } from '../../utils/version-summary';
```

Add inside the class (after `protected readonly canExpand`):
```ts
protected readonly expandedVersionIds = signal<ReadonlySet<string>>(new Set());

protected isVersionExpanded(id: string): boolean {
  return this.expandedVersionIds().has(id);
}

protected toggleVersion(id: string): void {
  this.expandedVersionIds.update((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
}

protected priorOf(version: IntelligenceVersionRow): IntelligenceVersionRow | null {
  const all = this.versions();
  const idx = all.findIndex((v) => v.id === version.id);
  if (idx === -1 || idx === all.length - 1) return null;
  return all[idx + 1];
}

protected summaryFor(version: IntelligenceVersionRow): {
  changedSections: VersionSection[];
  isFirst: boolean;
} {
  return summarizeVersionChange(version, this.priorOf(version));
}

private static readonly SECTION_LABEL: Record<VersionSection, string> = {
  headline: 'Headline',
  thesis: 'Thesis',
  watch: 'What to watch',
  implications: 'Implications',
};

protected sectionLabel(section: VersionSection): string {
  return IntelligenceHistoryPanelComponent.SECTION_LABEL[section];
}

protected renderInline(md: string): string {
  return renderMarkdownInline(md ?? '');
}

protected authorInitials(id: string): string {
  return this.authorMap()[id] ?? id.slice(0, 2).toUpperCase();
}
```

- [ ] **Step 2: Replace the placeholder block in the template with version cards**

In `intelligence-history-panel.component.html`, replace the comment block:
```html
      <!-- Version cards added in Task 16 -->
```
with:
```html
      @for (v of versions(); track v.id) {
        <article
          class="rounded-md border border-slate-200 bg-white"
          [class.border-amber-300]="v.state === 'withdrawn'"
        >
          <button
            type="button"
            class="flex w-full items-start justify-between gap-4 p-3 text-left"
            [attr.aria-expanded]="isVersionExpanded(v.id)"
            (click)="toggleVersion(v.id)"
          >
            <div class="flex-1">
              <div class="flex items-baseline gap-2">
                <span class="font-mono text-sm font-medium text-slate-700">v{{ v.version_number }}</span>
                @if (v.state === 'archived') {
                  <span class="rounded-sm bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">Archived</span>
                }
                @if (v.state === 'withdrawn') {
                  <span class="rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-700">Withdrawn</span>
                }
                <span class="text-xs text-slate-500">
                  Published {{ formatDate(v.published_at) }} by {{ authorInitials(v.edited_by) }}
                </span>
              </div>
              @if (v.change_note) {
                <p class="mt-1 text-sm italic text-slate-700">"{{ v.change_note }}"</p>
              } @else if (summaryFor(v).isFirst) {
                <p class="mt-1 text-sm text-slate-500">Initial publication</p>
              }
              @if (!summaryFor(v).isFirst && summaryFor(v).changedSections.length > 0) {
                <p class="mt-1 text-xs text-slate-500">
                  Sections changed:
                  <span class="text-slate-700">
                    @for (s of summaryFor(v).changedSections; track s; let last = $last) {
                      {{ sectionLabel(s) }}@if (!last) {, }
                    }
                  </span>
                </p>
              }
            </div>
            <span
              class="mt-1 inline-block h-2 w-2 border-r border-b border-slate-400 shrink-0"
              [class.rotate-45]="!isVersionExpanded(v.id)"
              [class.-rotate-135]="isVersionExpanded(v.id)"
              aria-hidden="true"
            ></span>
          </button>

          @if (isVersionExpanded(v.id)) {
            <div class="border-t border-slate-100 p-4 space-y-3">
              <h3 class="text-base font-semibold text-slate-900">{{ v.headline }}</h3>
              @if (v.thesis_md) {
                <section>
                  <h4 class="text-[10px] uppercase tracking-[0.2em] text-slate-500">Thesis</h4>
                  <div class="prose prose-sm max-w-none text-slate-800" [innerHTML]="renderInline(v.thesis_md)"></div>
                </section>
              }
              @if (v.watch_md) {
                <section>
                  <h4 class="text-[10px] uppercase tracking-[0.2em] text-slate-500">What to watch</h4>
                  <div class="prose prose-sm max-w-none text-slate-800" [innerHTML]="renderInline(v.watch_md)"></div>
                </section>
              }
              @if (v.implications_md) {
                <section>
                  <h4 class="text-[10px] uppercase tracking-[0.2em] text-slate-500">Implications</h4>
                  <div class="prose prose-sm max-w-none text-slate-800" [innerHTML]="renderInline(v.implications_md)"></div>
                </section>
              }
            </div>
          }
        </article>
      }
```

- [ ] **Step 3: Lint and build**

```bash
cd src/client && ng lint && ng build
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/shared/components/intelligence-history-panel/
git commit -m "feat(intelligence): render version cards with snapshot expansion in history panel"
```

---

## Task 17: IntelligenceHistoryPanel -- agency edit-diff disclosure

**Files:**
- Modify: `src/client/src/app/shared/components/intelligence-history-panel/intelligence-history-panel.component.ts`
- Modify: `src/client/src/app/shared/components/intelligence-history-panel/intelligence-history-panel.component.html`

- [ ] **Step 1: Add diff state, lazy-load wiring, and word-diff helper**

Add to the top imports of `intelligence-history-panel.component.ts`:
```ts
import { diffWords } from 'diff';
import { IntelligenceVersionRevision } from '../../../core/models/primary-intelligence.model';
```

Add inside the class (after `authorInitials`):
```ts
protected readonly versionRevisions = signal<Record<string, IntelligenceVersionRevision[]>>({});
protected readonly diffShownIds = signal<ReadonlySet<string>>(new Set());

protected isDiffShown(id: string): boolean {
  return this.diffShownIds().has(id);
}

protected toggleDiff(id: string): void {
  const has = this.diffShownIds().has(id);
  if (!has && !(id in this.versionRevisions())) {
    this.versionRevisionsRequested.emit(id);
  }
  this.diffShownIds.update((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
}

setVersionRevisions(versionId: string, revs: IntelligenceVersionRevision[]): void {
  this.versionRevisions.update((prev) => ({ ...prev, [versionId]: revs }));
}

protected diffPairsFor(versionId: string): Array<{
  fromAt: string;
  toAt: string;
  changeNote: string | null;
  fields: Array<{ section: VersionSection; html: string }>;
}> {
  const revs = this.versionRevisions()[versionId] ?? [];
  const pairs: Array<{
    fromAt: string;
    toAt: string;
    changeNote: string | null;
    fields: Array<{ section: VersionSection; html: string }>;
  }> = [];
  for (let i = 1; i < revs.length; i++) {
    const prev = revs[i - 1];
    const curr = revs[i];
    const fields: Array<{ section: VersionSection; html: string }> = [];
    for (const [section, key] of [
      ['headline', 'headline'],
      ['thesis', 'thesis_md'],
      ['watch', 'watch_md'],
      ['implications', 'implications_md'],
    ] as Array<[VersionSection, keyof IntelligenceVersionRevision]>) {
      const before = (prev[key] as string) ?? '';
      const after = (curr[key] as string) ?? '';
      if (before !== after) {
        fields.push({ section, html: this.renderWordDiff(before, after) });
      }
    }
    pairs.push({
      fromAt: prev.edited_at,
      toAt: curr.edited_at,
      changeNote: curr.change_note,
      fields,
    });
  }
  return pairs;
}

private renderWordDiff(before: string, after: string): string {
  const parts = diffWords(before, after);
  return parts
    .map((p) => {
      const text = escapeHtml(p.value);
      if (p.added) return `<ins class="bg-teal-100 text-slate-900 no-underline">${text}</ins>`;
      if (p.removed) return `<del class="text-slate-500 line-through">${text}</del>`;
      return `<span>${text}</span>`;
    })
    .join('');
}
```

Append at the bottom of the file (outside the class):
```ts
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

- [ ] **Step 2: Add the diff disclosure inside the expanded version block**

In `intelligence-history-panel.component.html`, inside the `@if (isVersionExpanded(v.id)) { <div class="border-t border-slate-100 p-4 space-y-3">` block, **after** the implications section, append:

```html
              @if (currentUserCanEdit()) {
                <div class="border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    class="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 hover:text-slate-700"
                    [attr.aria-expanded]="isDiffShown(v.id)"
                    (click)="toggleDiff(v.id); $event.stopPropagation()"
                  >
                    {{ isDiffShown(v.id) ? 'Hide edits within this version' : 'Show edits within this version' }}
                  </button>
                  @if (isDiffShown(v.id)) {
                    <div class="mt-2 space-y-3">
                      @for (pair of diffPairsFor(v.id); track pair.toAt) {
                        <div class="rounded border border-slate-100 bg-slate-50 p-2 text-xs">
                          <div class="text-slate-500">
                            {{ formatDate(pair.fromAt) }} -> {{ formatDate(pair.toAt) }}
                            @if (pair.changeNote) {
                              <span class="text-slate-700">-- "{{ pair.changeNote }}"</span>
                            }
                          </div>
                          @for (f of pair.fields; track f.section) {
                            <div class="mt-1">
                              <span class="text-[10px] uppercase tracking-[0.2em] text-slate-500">{{ sectionLabel(f.section) }}</span>
                              <div class="text-slate-800" [innerHTML]="f.html"></div>
                            </div>
                          }
                        </div>
                      } @empty {
                        <p class="text-xs text-slate-500">Loading edits...</p>
                      }
                    </div>
                  }
                </div>
              }
```

- [ ] **Step 3: Lint and build**

```bash
cd src/client && ng lint && ng build
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/shared/components/intelligence-history-panel/
git commit -m "feat(intelligence): agency edit diffs in history panel via jsdiff"
```

---

## Task 18: IntelligenceHistoryPanel -- working-draft pinned card

**Files:**
- Modify: `src/client/src/app/shared/components/intelligence-history-panel/intelligence-history-panel.component.ts`
- Modify: `src/client/src/app/shared/components/intelligence-history-panel/intelligence-history-panel.component.html`

- [ ] **Step 1: Expose draft summary**

Add to `intelligence-history-panel.component.ts` (inside the class, after `latest`):
```ts
protected readonly draft = computed(() => this.payload().draft);
protected readonly current = computed(() => this.payload().current);

protected readonly draftSummary = computed(() => {
  const d = this.draft();
  const c = this.current();
  if (!d) return null;
  if (!c) {
    return { isFirst: true, changedSections: [] as VersionSection[] };
  }
  return summarizeVersionChange(
    {
      headline: d.headline,
      thesis_md: d.thesis_md,
      watch_md: d.watch_md,
      implications_md: d.implications_md,
    },
    {
      headline: c.headline,
      thesis_md: c.thesis_md,
      watch_md: c.watch_md,
      implications_md: c.implications_md,
    }
  );
});
```

Also add an output:
```ts
readonly draftClicked = output<void>();
```

- [ ] **Step 2: Add the pinned card to the template (inside the expanded section, before the @for over versions)**

In `intelligence-history-panel.component.html`, immediately after `<div class="mt-4 space-y-3">`, before the `@for (v of versions()...)`, add:

```html
      @if (currentUserCanEdit() && draft()) {
        <button
          type="button"
          class="block w-full rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-left hover:border-slate-400"
          (click)="draftClicked.emit()"
        >
          <div class="flex items-baseline gap-2">
            <span class="text-xs font-medium uppercase tracking-[0.16em] text-slate-600">Working draft</span>
            <span class="text-xs text-slate-500">
              Edited {{ formatDate(draft()?.updated_at) }} by {{ authorInitials(draft()?.last_edited_by ?? '') }}
            </span>
          </div>
          @if (draftSummary(); as s) {
            @if (s.isFirst) {
              <p class="mt-1 text-xs text-slate-500">No published version yet.</p>
            } @else if (s.changedSections.length > 0) {
              <p class="mt-1 text-xs text-slate-500">
                Diverges from current:
                <span class="text-slate-700">
                  @for (sec of s.changedSections; track sec; let last = $last) {
                    {{ sectionLabel(sec) }}@if (!last) {, }
                  }
                </span>
              </p>
            } @else {
              <p class="mt-1 text-xs text-slate-500">Identical to the current version (no edits yet).</p>
            }
          }
        </button>
      }
```

- [ ] **Step 3: Lint and build**

```bash
cd src/client && ng lint && ng build
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/shared/components/intelligence-history-panel/
git commit -m "feat(intelligence): pinned working-draft card in history panel"
```

---

## Task 19: Withdraw dialog component

**Files:**
- Create: `src/client/src/app/shared/components/intelligence-history-panel/withdraw-dialog.component.ts`

- [ ] **Step 1: Create the component**

```ts
import { Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';

/**
 * Withdraw confirmation. Required textarea becomes the public-facing
 * change_note attached to the withdrawal revision.
 */
@Component({
  selector: 'app-withdraw-intelligence-dialog',
  standalone: true,
  imports: [Dialog, ButtonModule, FormsModule],
  template: `
    <p-dialog
      [visible]="visible()"
      (visibleChange)="onVisibleChange($event)"
      header="Withdraw this read"
      [modal]="true"
      [style]="{ width: '32rem' }"
      [closable]="true"
    >
      <div class="space-y-3">
        <p class="text-sm text-slate-700">
          The version stays in history with a "Withdrawn" badge. Use Purge to remove permanently.
        </p>
        <label class="block text-xs font-medium uppercase tracking-[0.16em] text-slate-600">
          Reason (visible to clients)
        </label>
        <textarea
          class="w-full rounded border border-slate-300 p-2 text-sm"
          rows="3"
          [(ngModel)]="reason"
          aria-required="true"
        ></textarea>
      </div>
      <ng-template pTemplate="footer">
        <p-button label="Cancel" severity="secondary" (onClick)="cancel.emit()"></p-button>
        <p-button
          label="Withdraw"
          severity="danger"
          [disabled]="reason().trim().length === 0"
          (onClick)="confirmed.emit(reason().trim())"
        ></p-button>
      </ng-template>
    </p-dialog>
  `,
})
export class WithdrawIntelligenceDialogComponent {
  readonly visible = input.required<boolean>();
  readonly cancel = output<void>();
  readonly confirmed = output<string>();

  protected readonly reason = signal('');

  onVisibleChange(open: boolean): void {
    if (!open) this.cancel.emit();
  }
}
```

- [ ] **Step 2: Lint and build**

```bash
cd src/client && ng lint && ng build
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/shared/components/intelligence-history-panel/withdraw-dialog.component.ts
git commit -m "feat(intelligence): WithdrawIntelligenceDialog with required reason"
```

---

## Task 20: Purge dialog component

**Files:**
- Create: `src/client/src/app/shared/components/intelligence-history-panel/purge-dialog.component.ts`

- [ ] **Step 1: Create the component**

```ts
import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';

/**
 * Type-to-confirm purge. The "Purge" button is disabled until the user
 * types the exact target headline.
 */
@Component({
  selector: 'app-purge-intelligence-dialog',
  standalone: true,
  imports: [Dialog, ButtonModule, FormsModule],
  template: `
    <p-dialog
      [visible]="visible()"
      (visibleChange)="onVisibleChange($event)"
      header="Purge this read"
      [modal]="true"
      [style]="{ width: '32rem' }"
      [closable]="true"
    >
      <div class="space-y-3">
        <p class="text-sm text-slate-700">
          This permanently deletes the read{{ purgeAnchor() ? ' and every prior version' : '' }}.
          It cannot be undone.
        </p>
        <p class="text-xs uppercase tracking-[0.16em] text-slate-500">
          Type the version headline to confirm:
        </p>
        <p class="rounded bg-slate-50 p-2 text-sm font-mono text-slate-800">"{{ headline() }}"</p>
        <input
          type="text"
          class="w-full rounded border border-slate-300 p-2 text-sm"
          [(ngModel)]="entered"
          [attr.aria-label]="'Type ' + headline() + ' to confirm purge'"
        />
      </div>
      <ng-template pTemplate="footer">
        <p-button label="Cancel" severity="secondary" (onClick)="cancel.emit()"></p-button>
        <p-button
          label="Purge"
          severity="danger"
          [disabled]="!matches()"
          (onClick)="confirmed.emit(entered())"
        ></p-button>
      </ng-template>
    </p-dialog>
  `,
})
export class PurgeIntelligenceDialogComponent {
  readonly visible = input.required<boolean>();
  readonly headline = input.required<string>();
  readonly purgeAnchor = input<boolean>(false);

  readonly cancel = output<void>();
  readonly confirmed = output<string>();

  protected readonly entered = signal('');
  protected readonly matches = computed(() => this.entered() === this.headline());

  onVisibleChange(open: boolean): void {
    if (!open) this.cancel.emit();
  }
}
```

- [ ] **Step 2: Lint and build**

```bash
cd src/client && ng lint && ng build
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/shared/components/intelligence-history-panel/purge-dialog.component.ts
git commit -m "feat(intelligence): PurgeIntelligenceDialog with typed-confirmation gate"
```

---

## Task 21: IntelligenceBlock -- state-aware controls

**Files:**
- Modify: `src/client/src/app/shared/components/intelligence-block/intelligence-block.component.ts`
- Modify: `src/client/src/app/shared/components/intelligence-block/intelligence-block.component.html`

- [ ] **Step 1: Add new outputs and a computed primary action label**

Inside the class, replace:
```ts
readonly edit = output<void>();
readonly deleted = output<void>();
```
with:
```ts
readonly edit = output<void>();
readonly discardDraft = output<void>();
readonly withdraw = output<void>();
readonly purge = output<void>();
readonly purgeAnchor = output<void>();
```

Add a computed describing the primary destructive action:
```ts
protected readonly primaryDestructiveAction = computed<'discard' | 'withdraw' | null>(() => {
  const c = this.current()?.record;
  if (!c) return null;
  if (c.state === 'draft') return 'discard';
  if (c.state === 'published') return 'withdraw';
  return null;
});
```

- [ ] **Step 2: Update the template**

In `intelligence-block.component.html`, find the existing Delete button (search for the existing `deleted` emit) and replace its container with state-aware buttons. Locate the action row (typically next to the Edit button) and replace the destructive button with:

```html
@if (primaryDestructiveAction() === 'discard') {
  <p-button
    label="Discard draft"
    severity="secondary"
    size="small"
    (onClick)="discardDraft.emit()"
  ></p-button>
} @else if (primaryDestructiveAction() === 'withdraw') {
  <p-button
    label="Withdraw"
    severity="secondary"
    size="small"
    (onClick)="withdraw.emit()"
  ></p-button>
}

@if (primaryDestructiveAction() === 'withdraw') {
  <p-button
    severity="secondary"
    size="small"
    text="true"
    icon="pi pi-ellipsis-h"
    pTooltip="More"
    tooltipPosition="bottom"
    (onClick)="purge.emit()"
    aria-label="Purge this version"
  ></p-button>
}
```

(If the existing template uses a different button library shape, mirror it. The contract is: the old `deleted` output is replaced by `discardDraft` / `withdraw` / `purge` triggered from these buttons.)

- [ ] **Step 3: Update consumers temporarily so the build passes**

The old `(deleted)` output had consumers in detail pages. Search and replace one by one:
```bash
grep -rln "(deleted)=" src/client/src/app/features/manage/
```
For each match, change `(deleted)="..."` -> the appropriate one of `(discardDraft)` or `(withdraw)`. (Detail-page wiring is finalized in Tasks 23-27; for now substitute `(discardDraft)` to keep types compiling.)

- [ ] **Step 4: Lint and build**

```bash
cd src/client && ng lint && ng build
```
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/shared/components/intelligence-block/ src/client/src/app/features/manage/
git commit -m "feat(intelligence-block): state-aware Discard/Withdraw/Purge controls"
```

---

## Task 22: Detail page -- common wiring helper

**Files:**
- Create: `src/client/src/app/shared/components/intelligence-history-panel/history-panel-host.ts`

- [ ] **Step 1: Add a thin host helper that detail pages can compose**

```ts
import { signal } from '@angular/core';

import { PrimaryIntelligenceService } from '../../../core/services/primary-intelligence.service';
import {
  IntelligenceEntityType,
  IntelligenceHistoryPayload,
  IntelligenceVersionRevision,
} from '../../../core/models/primary-intelligence.model';

/**
 * Reusable state holder for the history panel on detail pages. Each
 * detail page constructs one of these and binds the panel to its
 * signals. Centralizes the lazy-load + revisions cache pattern so
 * every page does not re-implement it.
 */
export class IntelligenceHistoryHost {
  readonly payload = signal<IntelligenceHistoryPayload>({
    current: null,
    draft: null,
    versions: [],
  });

  constructor(private readonly service: PrimaryIntelligenceService) {}

  async load(
    spaceId: string,
    entityType: IntelligenceEntityType,
    entityId: string
  ): Promise<void> {
    this.payload.set(
      await this.service.loadHistory(spaceId, entityType, entityId)
    );
  }

  async loadVersionRevisions(versionId: string): Promise<IntelligenceVersionRevision[]> {
    return this.service.loadVersionRevisions(versionId);
  }

  async withdraw(id: string, changeNote: string): Promise<void> {
    await this.service.withdraw(id, changeNote);
  }

  async purge(id: string, confirmation: string, purgeAnchor = false): Promise<void> {
    await this.service.purge(id, confirmation, purgeAnchor);
  }
}
```

- [ ] **Step 2: Lint and build**

```bash
cd src/client && ng lint && ng build
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/shared/components/intelligence-history-panel/history-panel-host.ts
git commit -m "feat(intelligence): IntelligenceHistoryHost helper for detail pages"
```

---

## Task 23: Mount panel on trial detail

**Files:**
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.ts`
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.html`

- [ ] **Step 1: Add imports, host instance, and loaders**

Open `trial-detail.component.ts`. Add to imports:
```ts
import { IntelligenceHistoryPanelComponent } from '../../../shared/components/intelligence-history-panel/intelligence-history-panel.component';
import { WithdrawIntelligenceDialogComponent } from '../../../shared/components/intelligence-history-panel/withdraw-dialog.component';
import { PurgeIntelligenceDialogComponent } from '../../../shared/components/intelligence-history-panel/purge-dialog.component';
import { IntelligenceHistoryHost } from '../../../shared/components/intelligence-history-panel/history-panel-host';
```

Add to the component's `imports: [...]` array:
```ts
IntelligenceHistoryPanelComponent,
WithdrawIntelligenceDialogComponent,
PurgeIntelligenceDialogComponent,
```

Inside the class:
```ts
protected readonly historyHost = new IntelligenceHistoryHost(this.primaryIntelligenceService);
protected readonly withdrawDialogOpen = signal(false);
protected readonly purgeDialogOpen = signal(false);
protected readonly purgeAnchorMode = signal(false);
protected readonly purgeTargetHeadline = signal('');
protected readonly purgeTargetId = signal<string | null>(null);

private async refreshHistory(): Promise<void> {
  const t = this.trial();
  if (!t) return;
  await this.historyHost.load(t.space_id, 'trial', t.id);
}

protected async onWithdrawConfirmed(reason: string): Promise<void> {
  const id = this.historyHost.payload().current?.id;
  if (!id) return;
  await this.historyHost.withdraw(id, reason);
  this.withdrawDialogOpen.set(false);
  await this.refreshHistory();
  await this.reload();
}

protected onPurgeRequested(target: { id: string; headline: string }, anchor: boolean): void {
  this.purgeTargetId.set(target.id);
  this.purgeTargetHeadline.set(target.headline);
  this.purgeAnchorMode.set(anchor);
  this.purgeDialogOpen.set(true);
}

protected async onPurgeConfirmed(confirmation: string): Promise<void> {
  const id = this.purgeTargetId();
  if (!id) return;
  await this.historyHost.purge(id, confirmation, this.purgeAnchorMode());
  this.purgeDialogOpen.set(false);
  await this.refreshHistory();
  await this.reload();
}

protected async loadHistoryVersionRevisions(versionId: string): Promise<void> {
  const revs = await this.historyHost.loadVersionRevisions(versionId);
  // panel reads through @ViewChild call below
  this.historyPanelRef?.setVersionRevisions(versionId, revs);
}
```

Add a ViewChild for the panel:
```ts
@ViewChild(IntelligenceHistoryPanelComponent)
private historyPanelRef?: IntelligenceHistoryPanelComponent;
```

(Add `ViewChild` to the `@angular/core` import if not present.)

In whatever method already loads trial data (commonly `reload()` or an `effect()` reacting to the trial id), after the trial is loaded, call `await this.refreshHistory();`.

- [ ] **Step 2: Add panel + dialogs to the template**

In `trial-detail.component.html`, immediately after the `<app-intelligence-block>` element, insert:

```html
<app-intelligence-history-panel
  [payload]="historyHost.payload()"
  [currentUserCanEdit]="canEdit()"
  [authorMap]="authorMap()"
  (withdraw)="withdrawDialogOpen.set(true)"
  (purgeVersion)="onPurgeRequested({ id: $event.id, headline: $event.confirmation }, false)"
  (purgeAnchor)="onPurgeRequested({ id: $event.id, headline: $event.confirmation }, true)"
  (versionRevisionsRequested)="loadHistoryVersionRevisions($event)"
></app-intelligence-history-panel>

<app-withdraw-intelligence-dialog
  [visible]="withdrawDialogOpen()"
  (cancel)="withdrawDialogOpen.set(false)"
  (confirmed)="onWithdrawConfirmed($event)"
></app-withdraw-intelligence-dialog>

<app-purge-intelligence-dialog
  [visible]="purgeDialogOpen()"
  [headline]="purgeTargetHeadline()"
  [purgeAnchor]="purgeAnchorMode()"
  (cancel)="purgeDialogOpen.set(false)"
  (confirmed)="onPurgeConfirmed($event)"
></app-purge-intelligence-dialog>
```

Also wire the `(withdraw)` output of `IntelligenceBlock` to open the dialog:
```html
<app-intelligence-block
  ...
  (withdraw)="withdrawDialogOpen.set(true)"
  (purge)="onPurgeRequested({ id: historyHost.payload().current?.id ?? '', headline: historyHost.payload().current?.headline ?? '' }, false)"
></app-intelligence-block>
```

(Adapt to how the page already binds inputs/outputs on `app-intelligence-block`.)

- [ ] **Step 3: Lint and build**

```bash
cd src/client && ng lint && ng build
```
Expected: passes.

- [ ] **Step 4: Smoke test in browser**

```bash
cd src/client && npm start
```
Open a trial detail page, verify:
- Panel renders below the intelligence block.
- "No prior versions" shows on a trial with only one published row.
- Edit -> save as draft -> publish twice -> the panel now shows a v1 archived row.

Stop the dev server (Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/manage/trials/
git commit -m "feat(trial-detail): mount IntelligenceHistoryPanel and withdraw/purge dialogs"
```

---

## Task 24: Mount panel on company detail

**Files:**
- Modify: `src/client/src/app/features/manage/companies/company-detail.component.ts`
- Modify: `src/client/src/app/features/manage/companies/company-detail.component.html`

- [ ] **Step 1: Apply the same wiring as Task 23, replacing every reference to `'trial'` with `'company'` and using the company's id and `space_id`**

Open the file and copy the same import block, class members (`historyHost`, dialog signals, `refreshHistory`, `onWithdrawConfirmed`, `onPurgeRequested`, `onPurgeConfirmed`, `loadHistoryVersionRevisions`, `historyPanelRef`), and template additions from Task 23. The only change is:
- The `historyHost.load(space_id, 'company', companyId)` call uses `'company'` and the company id.
- Detail page uses `company()` signal name in place of `trial()`.

- [ ] **Step 2: Lint and build**

```bash
cd src/client && ng lint && ng build
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/manage/companies/
git commit -m "feat(company-detail): mount IntelligenceHistoryPanel and withdraw/purge dialogs"
```

---

## Task 25: Mount panel on product detail

**Files:**
- Modify: `src/client/src/app/features/manage/products/product-detail.component.ts`
- Modify: `src/client/src/app/features/manage/products/product-detail.component.html`

- [ ] **Step 1: Apply Task 23 wiring with `'product'` as entity type**

Same as Task 24, substituting product.

- [ ] **Step 2: Lint and build**

```bash
cd src/client && ng lint && ng build
```

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/manage/products/
git commit -m "feat(product-detail): mount IntelligenceHistoryPanel and withdraw/purge dialogs"
```

---

## Task 26: Mount panel on marker detail

**Files:**
- Modify: `src/client/src/app/features/manage/markers/marker-detail.component.ts`
- Modify: `src/client/src/app/features/manage/markers/marker-detail.component.html`

- [ ] **Step 1: Apply Task 23 wiring with `'marker'` as entity type**

- [ ] **Step 2: Lint and build**

```bash
cd src/client && ng lint && ng build
```

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/manage/markers/
git commit -m "feat(marker-detail): mount IntelligenceHistoryPanel and withdraw/purge dialogs"
```

---

## Task 27: Mount panel on engagement detail

**Files:**
- Modify: `src/client/src/app/features/manage/engagement/engagement-detail.component.ts`
- Modify: `src/client/src/app/features/manage/engagement/engagement-detail.component.html`

- [ ] **Step 1: Apply Task 23 wiring with `'space'` as entity type, using `space.id` for both `space_id` and `entity_id`**

Engagement detail has no separate entity id; `entity_id = space_id` per `get_space_intelligence`.

- [ ] **Step 2: Lint and build**

```bash
cd src/client && ng lint && ng build
```

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/manage/engagement/
git commit -m "feat(engagement-detail): mount IntelligenceHistoryPanel and withdraw/purge dialogs"
```

---

## Task 28: E2E -- intelligence-history loop

**Files:**
- Create: `src/client/e2e/intelligence-history.e2e.ts`

- [ ] **Step 1: Inspect existing e2e test for shape**

```bash
ls src/client/e2e/ 2>/dev/null
cat src/client/e2e/intelligence-crud.e2e.ts 2>/dev/null | head -80
```
This shows the auth/setup pattern used in this repo. Mirror it.

- [ ] **Step 2: Write the new e2e (skeleton; adapt selectors to what the existing e2e uses)**

```ts
import { test, expect } from '@playwright/test';
import { signInAsAgencyUser, openCompanyDetail } from './helpers/auth';

test.describe('intelligence version history', () => {
  test('publish v1, republish v2, withdraw v2, purge with wrong then right phrase', async ({ page }) => {
    await signInAsAgencyUser(page);
    await openCompanyDetail(page, { seedCompany: 'Acme Bio' });

    // Publish v1
    await page.getByRole('button', { name: /add intelligence|edit/i }).click();
    await page.getByLabel(/headline/i).fill('Acme thesis v1');
    await page.getByLabel(/thesis/i).fill('Initial read on Acme.');
    await page.getByRole('button', { name: /publish/i }).click();

    // Open history -- still 1 version
    await page.getByRole('button', { name: /history/i }).click();
    await expect(page.getByText('No prior versions')).toBeVisible();

    // Republish v2 (with change_note)
    await page.getByRole('button', { name: /edit/i }).click();
    await page.getByLabel(/thesis/i).fill('Updated read after PFS readout.');
    await page.getByLabel(/change note/i).fill('updated thesis after PFS readout');
    await page.getByRole('button', { name: /publish/i }).click();

    // History now has 2 versions; v1 is archived
    await page.getByRole('button', { name: /2 versions/i }).click();
    await expect(page.getByText(/v1/)).toBeVisible();
    await expect(page.getByText(/Archived/i)).toBeVisible();

    // Withdraw v2
    await page.getByRole('button', { name: /withdraw/i }).click();
    await page.getByLabel(/reason/i).fill('superseded by external press release');
    await page.getByRole('button', { name: /^withdraw$/i }).click();
    await expect(page.getByText(/withdrawn/i)).toBeVisible();

    // Purge with wrong phrase (button stays disabled)
    await page.getByRole('button', { name: /purge/i }).click();
    await page.getByLabel(/type .* to confirm/i).fill('wrong text');
    await expect(page.getByRole('button', { name: /^purge$/i })).toBeDisabled();

    // Right phrase -- enables purge, deletes
    await page.getByLabel(/type .* to confirm/i).fill('Acme thesis v1');
    await page.getByRole('button', { name: /^purge$/i }).click();
    // After purge, panel collapses to 1 version (v2 still archived) or empties depending on flow
    await expect(page.getByText(/Acme thesis v1/)).not.toBeVisible();
  });
});
```

(Selector text in this skeleton is approximate; tighten to whatever the existing `intelligence-crud.e2e.ts` uses for headline/thesis/publish controls.)

- [ ] **Step 3: Run the e2e**

```bash
cd src/client && npm run test:e2e:fast -- intelligence-history
```
Expected: passes (after selector tightening as needed).

- [ ] **Step 4: Commit**

```bash
git add src/client/e2e/intelligence-history.e2e.ts
git commit -m "test(e2e): intelligence history publish/withdraw/purge loop"
```

---

## Task 29: Regenerate runbook architecture docs

**Files:**
- Modify: any auto-gen blocks under `docs/runbook/` touched by `npm run docs:arch`

- [ ] **Step 1: Run the regen**

```bash
cd src/client && npm run docs:arch
```
Expected: updates `docs/runbook/02-tech-stack.md`, `06-backend-architecture.md`, `07-database-schema.md`, etc., where the new RPC and column appear.

- [ ] **Step 2: Edit hand-written prose around the auto-gen blocks**

In `docs/runbook/06-backend-architecture.md`, near the primary intelligence section, add a short paragraph (outside any AUTO-GEN block) documenting that `upsert_primary_intelligence` now archives instead of deletes, and that `withdraw_primary_intelligence` and `purge_primary_intelligence` provide the soft and hard delete forms respectively.

In `docs/runbook/07-database-schema.md`, near the `primary_intelligence` table, mention the new `version_number`, `published_at`, `withdrawn_at`, `withdrawn_by` columns and the expanded state machine (outside the auto-gen Mermaid block, which will reflect them automatically after regen).

- [ ] **Step 3: Commit**

```bash
git add docs/runbook/
git commit -m "docs(runbook): document intelligence version history schema and RPCs"
```

---

## Self-Review

Run before handoff. Look at the spec at `docs/superpowers/specs/2026-05-09-intelligence-history-design.md` with fresh eyes and check this plan against each section.

**Spec coverage:**

| Spec section | Implementing tasks |
|---|---|
| State machine (draft/published/archived/withdrawn) | Task 1 (CHECK + columns), Task 4 (RPC) |
| Schema delta (version_number, published_at, withdrawn_at/by, index, backfill) | Task 1 |
| Triggers (assign_version, guard_state) | Task 1 |
| `upsert_primary_intelligence` archive-on-publish + change_note enforcement | Task 4 |
| `withdraw_primary_intelligence` | Task 4 |
| `purge_primary_intelligence` (with anchor flag) | Task 4 |
| `delete_primary_intelligence` narrowed to drafts | Task 4 |
| `get_primary_intelligence_history` | Task 4 |
| `get_intelligence_version_revisions` | Task 4 |
| Frontend types (`IntelligenceState` widen, history payload, version row, version revision) | Task 11 |
| Service methods (loadHistory, loadVersionRevisions, withdraw, purge) | Task 12 |
| `summarizeVersionChange` helper | Task 13 |
| jsdiff dep | Task 14 |
| `IntelligenceHistoryPanel` (collapsed shell, version cards, agency diff disclosure, draft card) | Tasks 15, 16, 17, 18 |
| `WithdrawIntelligenceDialog` | Task 19 |
| `PurgeIntelligenceDialog` | Task 20 |
| `IntelligenceBlock` state-aware controls | Task 21 |
| `IntelligenceHistoryHost` helper | Task 22 |
| Mount panel on five detail pages | Tasks 23, 24, 25, 26, 27 |
| SQL integration tests (palette convention) | Tasks 2, 3, 5, 6, 7, 8, 9, 10 |
| E2E test | Task 28 |
| Runbook regen | Task 29 |

**Deliberately out of plan (matches spec non-goals):**
- Restore-as-draft from archive.
- Engagement-wide change feed entries.
- Notifications.
- Versioned URL deeplinks (`?v=2`) -- soft yes/no in spec; deferred here.
- Bulk version operations.

**Type and signature consistency check:**
- `IntelligenceVersionRow` (Task 11) is consumed in `IntelligenceHistoryPayload.versions` (Task 11), bound to the panel input (Task 15), iterated in the template (Task 16), and used in `summaryFor` / `priorOf` / diff helpers (Tasks 16, 17). Field names match the SQL JSON keys in `get_primary_intelligence_history` (Task 4).
- `IntelligenceVersionRevision` (Task 11) is returned by `loadVersionRevisions` (Task 12), passed via `setVersionRevisions` (Task 17), and indexed by `diffPairsFor` (Task 17). Field names match `get_intelligence_version_revisions` (Task 4).
- `withdraw_primary_intelligence(p_id, p_change_note)` (Task 4) -- service `withdraw(id, changeNote)` (Task 12) -- panel `withdraw` output -- dialog `confirmed: string` (Task 19) -- detail page `onWithdrawConfirmed(reason)` (Task 23). Aligned.
- `purge_primary_intelligence(p_id, p_confirmation, p_purge_anchor)` (Task 4) -- service `purge(id, confirmation, purgeAnchor)` (Task 12) -- panel `purgeVersion` / `purgeAnchor` outputs -- dialog `confirmed: string` (Task 20) -- detail page `onPurgeConfirmed(confirmation)` (Task 23). Aligned.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-09-intelligence-history.md`. Two execution options:**

**1. Subagent-Driven (recommended)** -- fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** -- execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
