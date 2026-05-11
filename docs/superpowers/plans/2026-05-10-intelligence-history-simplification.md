# Intelligence History Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the snapshot-revisions audit log that backs primary intelligence history with a single linear event timeline derived from version-row columns; show word-level inline diffs at read time between each published version and the most recent prior non-withdrawn published version.

**Architecture:** Each version is a `primary_intelligence` row that owns four new columns capturing its own lifecycle events: `publish_note`, `published_by`, `archived_at`, `withdraw_note`. The `primary_intelligence_revisions` table, its trigger, and both session GUCs (`app.change_note`, `app.changed_fields_json`) are dropped. `get_primary_intelligence_history` returns `{ current, draft, versions[], events[] }` with `versions[]` carrying a server-computed `diff_base_id` (skips withdrawn rows). The history panel renders a flat sorted event list; each `published` event expands to show its version's content with `diffWords` marks against its diff-base row.

**Tech Stack:** Angular 19 (standalone, signals, OnPush), PrimeNG 19, Tailwind v4, Supabase Postgres, Playwright (e2e + integration), `diff` npm package (kept).

**Spec:** `docs/specs/intelligence-history-simplification/spec.md` (id `spec-2026-008`, status `approved`)

---

## File Map

**Database (created):**
- `supabase/migrations/20260510130000_intelligence_history_simplify.sql` — adds 4 columns, backfills, drops revisions table + trigger + GUCs, replaces 4 RPCs.

**Frontend (modified):**
- `src/client/src/app/core/models/primary-intelligence.model.ts` — type rewrites.
- `src/client/src/app/core/services/primary-intelligence.service.ts` — drop `loadVersionRevisions`.
- `src/client/src/app/shared/components/intelligence-history-panel/history-panel-host.ts` — drop `loadVersionRevisions`.
- `src/client/src/app/shared/components/intelligence-history-panel/intelligence-history-panel.component.ts` — rewrite as timeline.
- `src/client/src/app/shared/components/intelligence-history-panel/intelligence-history-panel.component.html` — rewrite as timeline.
- `src/client/src/app/shared/components/intelligence-block/intelligence-block.component.ts` — drop chips, source change note from `publish_note`.
- `src/client/src/app/shared/components/intelligence-block/intelligence-block.component.html` — drop chip block, render single note line.
- `src/client/src/app/features/manage/trials/trial-detail.component.ts` and `.html` — drop revision binding, drop activity feed.
- `src/client/src/app/features/manage/markers/marker-detail.component.ts` and `.html` — drop revision binding.
- `src/client/src/app/features/manage/companies/company-detail.component.ts` and `.html` — drop revision binding.
- `src/client/src/app/features/manage/products/product-detail.component.ts` and `.html` — drop revision binding.
- `src/client/src/app/features/manage/engagement/engagement-detail.component.ts` and `.html` — drop revision binding.
- `src/client/e2e/tests/intelligence-history.spec.ts` — rewrite assertions for the new timeline; add withdrawn-skip diff test.
- `src/client/integration/tests/rpc-content-write.spec.ts` — drop `recent_revisions`/`changed_fields` asserts, target `record.publish_note` instead.

**Frontend (deleted):**
- `src/client/src/app/shared/components/recent-activity-feed/recent-activity-feed.component.ts` — redundant with new history panel.

**Docs (modified):**
- `docs/runbook/03-features.md`
- `docs/runbook/07-database-schema.md`
- `docs/runbook/08-authentication-security.md`

---

## Conventions

- All migrations follow `YYYYMMDDHHMMSS_description.sql` naming and are append-only.
- Postgres functions use `language plpgsql` or `sql`, `security definer` for write paths and `security invoker` for read paths, `set search_path = ''`, fully-qualified `public.x` names.
- Frontend uses `inject()`, signals, native control flow `@if`/`@for`/`@switch`, standalone components with `ChangeDetectionStrategy.OnPush`, `input()`/`output()` functions (never decorators), `readonly` on I/O.
- Service methods stay Promise-based to mirror the rest of `PrimaryIntelligenceService`.
- e2e specs use `@playwright/test` and run via `npm run test:e2e -- <filter>`.
- Integration specs use `vitest` and run via `npm run test:integration -- <filter>`.
- After every task that changes code, run `cd src/client && ng lint && ng build` before committing.
- Commit messages: lowercase scope prefix, no Claude attribution, no em dashes.

---

## Phase 1: Database migration + integration test

**Goal:** Migration adds new columns, backfills, drops the old log and GUC plumbing, and rewrites 4 RPCs. Integration test is rewritten to verify the new RPC contract.

### Task 1.1: Rewrite integration test for the new RPC contract

**Files:**
- Modify: `src/client/integration/tests/rpc-content-write.spec.ts`

- [ ] **Step 1: Read current test to understand scaffolding**

Run: `wc -l src/client/integration/tests/rpc-content-write.spec.ts`
Expected: about 400 lines.

- [ ] **Step 2: Rewrite the test file**

The test currently asserts `payload.recent_revisions[0].changed_fields` in five places. Replace those assertions with assertions on `record.publish_note` and other columns directly.

Open the file. For every `recent_revisions` reference:
1. In the local TS type declaration near line 168 (`recent_revisions: { ... }[]`), remove the `recent_revisions` property from the type entirely.
2. In each `expect(...)` referencing `recent_revisions`, rewrite as follows:
   - `expect(payload!.recent_revisions).toHaveLength(1)` → remove the assertion (we no longer have a revisions array).
   - `expect(payload!.recent_revisions[0].changed_fields).toEqual({})` → remove (changed_fields concept gone).
   - `expect(next!.recent_revisions[0].changed_fields).toEqual({ headline: true })` → replace with `expect(next!.record.publish_note).toBe('Tightened headline')` if the test passed `'Tightened headline'` as the change_note; otherwise drop.
   - `expect(next!.recent_revisions[0].change_note).toBe('...')` → replace with `expect(next!.record.publish_note).toBe('...')`.
   - `expect(next!.recent_revisions[0].changed_fields).toEqual({ links: true })` → drop (we don't surface link-change tracking anymore; we still assert the links survive via the existing `links` assertions in the same test).
   - `expect(published!.recent_revisions[0].changed_fields).toEqual({ state: true })` → replace with `expect(published!.record.state).toBe('published')` and `expect(published!.record.publish_note).toBe('initial release')` (or whichever change_note was passed at publish time; check the test's `upsert` call to see the exact value).

Add at top of the describe block:

```ts
// After spec-2026-008, the payload contains only { record, links, contributors }.
// publish_note and published_by live on the record; there is no revisions array.
```

Update the test titles where the test name mentions `changed_fields` or `revision`:
- `"create: persists links with entity_name resolved; creation revision has empty changed_fields"` → `"create: persists links with entity_name resolved"`
- `"update headline only: changed_fields = {headline: true}; links untouched"` → `"update headline only: publish_note recorded; links untouched"`
- Apply the same shortening to the other titles that mention `changed_fields`.

- [ ] **Step 3: Run integration test to verify it fails against the unchanged backend**

Run: `cd src/client && npm run test:integration -- rpc-content-write 2>&1 | tail -40`
Expected: FAIL with errors like "publish_note is undefined" or "column does not exist" — meaning the test now needs the migration before it can pass.

- [ ] **Step 4: Commit the failing test**

```bash
git add src/client/integration/tests/rpc-content-write.spec.ts
git commit -m "test(intel-history): rewrite rpc-content-write for new RPC contract"
```

### Task 1.2: Write the migration

**Files:**
- Create: `supabase/migrations/20260510130000_intelligence_history_simplify.sql`

- [ ] **Step 1: Verify the timestamp slot is free**

Run: `ls supabase/migrations/20260510*.sql`
Expected: a few migrations from earlier today (none at `20260510130000`).

- [ ] **Step 2: Write the migration**

Create the file with the full contents below. This is one transaction; Supabase wraps each migration file in a transaction by default.

```sql
-- migration: 20260510130000_intelligence_history_simplify
-- purpose: replace the snapshot-revisions audit log with a column-based
--   event model on primary_intelligence. Adds publish_note,
--   published_by, archived_at, withdraw_note; backfills from the
--   revisions table; drops the revisions table, its trigger, and the
--   get_intelligence_version_revisions RPC; rewrites
--   upsert_primary_intelligence, withdraw_primary_intelligence,
--   get_primary_intelligence_history, build_intelligence_payload to
--   the new contract.

-- =============================================================================
-- 1. add columns
-- =============================================================================

alter table public.primary_intelligence
  add column if not exists publish_note  text,
  add column if not exists published_by  uuid references auth.users (id),
  add column if not exists archived_at   timestamptz,
  add column if not exists withdraw_note text;

comment on column public.primary_intelligence.publish_note is
  'Change note typed at publish time. Stored on the row that transitioned into state=published. Never written by archive or withdraw flows. Null for drafts and for the first publish on a brand-new anchor.';

comment on column public.primary_intelligence.published_by is
  'auth.users id of the agency member who published this version. Null for drafts. Persists through archive/withdraw transitions.';

comment on column public.primary_intelligence.archived_at is
  'Timestamp of the published -> archived transition. Set when a newer version publishes over this one. Null otherwise.';

comment on column public.primary_intelligence.withdraw_note is
  'Change note typed at withdraw time. Stored on the row that transitioned from published to withdrawn. Distinct from publish_note so a withdrawn version retains both.';

-- =============================================================================
-- 2. backfill from primary_intelligence_revisions
-- =============================================================================

update public.primary_intelligence p
   set publish_note  = r.change_note,
       published_by  = r.edited_by
  from (
    select distinct on (primary_intelligence_id)
           primary_intelligence_id,
           change_note,
           edited_by
      from public.primary_intelligence_revisions
     where state = 'published'
     order by primary_intelligence_id, edited_at asc
  ) r
 where r.primary_intelligence_id = p.id;

update public.primary_intelligence p
   set withdraw_note = r.change_note
  from (
    select distinct on (primary_intelligence_id)
           primary_intelligence_id,
           change_note
      from public.primary_intelligence_revisions
     where state = 'withdrawn'
     order by primary_intelligence_id, edited_at desc
  ) r
 where r.primary_intelligence_id = p.id
   and p.state = 'withdrawn';

update public.primary_intelligence p
   set archived_at = coalesce(
     (select min(edited_at)
        from public.primary_intelligence_revisions r
       where r.primary_intelligence_id = p.id
         and r.state = 'archived'),
     p.updated_at
   )
 where p.state = 'archived';

-- =============================================================================
-- 3. drop the snapshot log + its plumbing
-- =============================================================================

drop function if exists public.get_intelligence_version_revisions(uuid);

drop trigger if exists primary_intelligence_revision_trigger
  on public.primary_intelligence;

drop function if exists public.write_primary_intelligence_revision();

-- table drops cascade its RLS policies and indexes
drop table if exists public.primary_intelligence_revisions;

-- =============================================================================
-- 4. replace upsert_primary_intelligence (drop GUCs + changed_fields)
-- =============================================================================

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

    -- archive any prior published row for this anchor
    update public.primary_intelligence
       set state       = 'archived',
           archived_at = now(),
           updated_at  = now()
     where space_id    = p_space_id
       and entity_type = p_entity_type
       and entity_id   = p_entity_id
       and state       = 'published'
       and id is distinct from p_id;
  end if;

  if p_id is null then
    insert into public.primary_intelligence (
      space_id, entity_type, entity_id, state, headline,
      thesis_md, watch_md, implications_md,
      publish_note, published_by, last_edited_by
    ) values (
      p_space_id, p_entity_type, p_entity_id, p_state, p_headline,
      coalesce(p_thesis_md, ''), coalesce(p_watch_md, ''),
      coalesce(p_implications_md, ''),
      case when p_state = 'published' then nullif(trim(coalesce(p_change_note, '')), '') else null end,
      case when p_state = 'published' then auth.uid() else null end,
      auth.uid()
    )
    returning id into v_id;
  else
    update public.primary_intelligence
       set state = p_state,
           headline = p_headline,
           thesis_md = coalesce(p_thesis_md, ''),
           watch_md = coalesce(p_watch_md, ''),
           implications_md = coalesce(p_implications_md, ''),
           publish_note = case
             when p_state = 'published' then nullif(trim(coalesce(p_change_note, '')), '')
             else publish_note
           end,
           published_by = case
             when p_state = 'published' and published_by is null then auth.uid()
             else published_by
           end,
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

revoke execute on function public.upsert_primary_intelligence(
  uuid, uuid, text, uuid, text, text, text, text, text, text, jsonb
) from public;
revoke execute on function public.upsert_primary_intelligence(
  uuid, uuid, text, uuid, text, text, text, text, text, text, jsonb
) from anon;
grant execute on function public.upsert_primary_intelligence(
  uuid, uuid, text, uuid, text, text, text, text, text, text, jsonb
) to authenticated;

-- =============================================================================
-- 5. replace withdraw_primary_intelligence (drop GUC, write withdraw_note)
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

  update public.primary_intelligence
     set state          = 'withdrawn',
         withdrawn_at   = now(),
         withdrawn_by   = auth.uid(),
         withdraw_note  = p_change_note,
         last_edited_by = auth.uid(),
         updated_at     = now()
   where id = p_id;
end;
$$;

revoke execute on function public.withdraw_primary_intelligence(uuid, text) from public;
revoke execute on function public.withdraw_primary_intelligence(uuid, text) from anon;
grant  execute on function public.withdraw_primary_intelligence(uuid, text) to authenticated;

-- =============================================================================
-- 6. replace get_primary_intelligence_history (returns events[] + diff_base_id)
-- =============================================================================

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
  versions_with_base as (
    select v.*,
           (
             select v2.id
               from versions v2
              where v2.version_number < v.version_number
                and v2.published_at is not null
                and v2.withdrawn_at is null
              order by v2.version_number desc
              limit 1
           ) as diff_base_id
      from versions v
  ),
  events as (
    select created_at as at, 'draft_started'::text as kind, id as row_id,
           null::int as version_number, last_edited_by as by, null::text as note
      from rows
    union all
    select published_at, 'published', id, version_number, published_by, publish_note
      from rows where published_at is not null
    union all
    select archived_at, 'archived', id, version_number, null, null
      from rows where archived_at is not null
    union all
    select withdrawn_at, 'withdrawn', id, version_number, withdrawn_by, withdraw_note
      from rows where withdrawn_at is not null
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
          'publish_note',    v.publish_note,
          'published_at',    v.published_at,
          'published_by',    v.published_by,
          'archived_at',     v.archived_at,
          'withdrawn_at',    v.withdrawn_at,
          'withdrawn_by',    v.withdrawn_by,
          'withdraw_note',   v.withdraw_note,
          'diff_base_id',    v.diff_base_id
        )
        order by v.version_number desc
      ) from versions_with_base v),
      '[]'::jsonb
    ),
    'events', coalesce(
      (select jsonb_agg(
        jsonb_build_object(
          'at',             e.at,
          'kind',           e.kind,
          'row_id',         e.row_id,
          'version_number', e.version_number,
          'by',             e.by,
          'note',           e.note
        )
        order by e.at asc, e.kind asc
      ) from events e),
      '[]'::jsonb
    )
  );
$$;

revoke execute on function public.get_primary_intelligence_history(uuid, text, uuid) from public;
revoke execute on function public.get_primary_intelligence_history(uuid, text, uuid) from anon;
grant  execute on function public.get_primary_intelligence_history(uuid, text, uuid) to authenticated;

-- =============================================================================
-- 7. replace build_intelligence_payload (drop recent_revisions)
-- =============================================================================
-- Preserves the existing contract for { record, links, contributors }.
-- Links carry entity_name resolved server-side per the prior migration.

create or replace function public.build_intelligence_payload(
  p_space_id    uuid,
  p_entity_type text,
  p_entity_id   uuid,
  p_state       text,
  p_revision_limit int default 5
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with row as (
    select * from public.primary_intelligence p
     where p.space_id    = p_space_id
       and p.entity_type = p_entity_type
       and p.entity_id   = p_entity_id
       and p.state       = p_state
     limit 1
  ),
  links_resolved as (
    select l.*,
           case l.entity_type
             when 'trial'   then (select t.name from public.trials t where t.id = l.entity_id)
             when 'marker'  then (select m.title from public.markers m where m.id = l.entity_id)
             when 'company' then (select c.name from public.companies c where c.id = l.entity_id)
             when 'product' then (select pr.name from public.products pr where pr.id = l.entity_id)
           end as entity_name
      from public.primary_intelligence_links l
     where l.primary_intelligence_id = (select id from row)
  ),
  contributors as (
    select array_agg(distinct last_edited_by) as ids
      from public.primary_intelligence
     where space_id    = p_space_id
       and entity_type = p_entity_type
       and entity_id   = p_entity_id
  )
  select case
    when not exists (select 1 from row) then null
    else jsonb_build_object(
      'record', (select to_jsonb(r) from row r),
      'links', coalesce(
        (select jsonb_agg(
          jsonb_build_object(
            'id',               l.id,
            'entity_type',      l.entity_type,
            'entity_id',        l.entity_id,
            'entity_name',      l.entity_name,
            'relationship_type', l.relationship_type,
            'gloss',            l.gloss,
            'display_order',    l.display_order
          )
          order by l.display_order asc, l.relationship_type asc
        ) from links_resolved l),
        '[]'::jsonb
      ),
      'contributors', coalesce(
        (select to_jsonb(ids) from contributors),
        '[]'::jsonb
      )
    )
  end;
$$;

comment on function public.build_intelligence_payload(uuid, text, uuid, text, int) is
  'After spec-2026-008: returns { record, links, contributors }. The record carries publish_note; the revisions log was dropped.';

revoke execute on function public.build_intelligence_payload(uuid, text, uuid, text, int) from public;
revoke execute on function public.build_intelligence_payload(uuid, text, uuid, text, int) from anon;
grant  execute on function public.build_intelligence_payload(uuid, text, uuid, text, int) to authenticated;
```

- [ ] **Step 3: Apply the migration**

Run: `supabase db reset 2>&1 | tail -10`
Expected: "Finished supabase db reset on branch main." with no errors. If the reset fails, read the output, fix the migration file, and rerun.

- [ ] **Step 4: Run advisors**

Run: `supabase db advisors --local --type all 2>&1 | tail -30`
Expected: "No issues found" or only existing pre-migration warnings (no new ones referencing primary_intelligence columns or RPCs).

- [ ] **Step 5: Run the integration test (should pass now)**

Run: `cd src/client && npm run test:integration -- rpc-content-write 2>&1 | tail -30`
Expected: all tests in `rpc-content-write.spec.ts` pass.

- [ ] **Step 6: Commit the migration**

```bash
git add supabase/migrations/20260510130000_intelligence_history_simplify.sql
git commit -m "feat(db): simplify intelligence history schema and RPCs"
```

---

## Phase 2: Frontend type definitions (additive)

**Goal:** Update `primary-intelligence.model.ts` so it matches the new RPC payload shape. Keep old types alongside for now so downstream code still compiles; remove them in Phase 8 once all consumers are migrated.

### Task 2.1: Add new types to the model file

**Files:**
- Modify: `src/client/src/app/core/models/primary-intelligence.model.ts`

- [ ] **Step 1: Add `publish_note` to `PrimaryIntelligence`**

Find the `PrimaryIntelligence` interface (around line 20) and add `publish_note: string | null;` immediately after `implications_md`. The interface should look like:

```ts
export interface PrimaryIntelligence {
  id: string;
  space_id: string;
  entity_type: IntelligenceEntityType;
  entity_id: string;
  state: IntelligenceState;
  headline: string;
  thesis_md: string;
  watch_md: string;
  implications_md: string;
  publish_note: string | null;
  last_edited_by: string;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Rewrite `IntelligenceVersionRow`**

Replace the existing `IntelligenceVersionRow` interface block (around line 162) with:

```ts
/**
 * One row in the version history list returned by
 * `get_primary_intelligence_history`. Each version is a published,
 * archived, or withdrawn snapshot of the anchor. `diff_base_id` points
 * at the most recent prior published version that is not withdrawn,
 * or null when no such predecessor exists (v1).
 */
export interface IntelligenceVersionRow {
  id: string;
  version_number: number;
  state: VersionState;
  headline: string;
  thesis_md: string;
  watch_md: string;
  implications_md: string;
  publish_note: string | null;
  published_at: string;
  published_by: string;
  archived_at: string | null;
  withdrawn_at: string | null;
  withdrawn_by: string | null;
  withdraw_note: string | null;
  diff_base_id: string | null;
}
```

- [ ] **Step 3: Add `IntelligenceHistoryEvent` interface**

Immediately after the rewritten `IntelligenceVersionRow`, add:

```ts
export type IntelligenceHistoryEventKind =
  | 'draft_started'
  | 'published'
  | 'archived'
  | 'withdrawn';

export interface IntelligenceHistoryEvent {
  at: string;
  kind: IntelligenceHistoryEventKind;
  row_id: string;
  version_number: number | null;
  by: string | null;
  note: string | null;
}
```

- [ ] **Step 4: Add `events` to `IntelligenceHistoryPayload`**

Find `IntelligenceHistoryPayload` (around line 184) and add `events: IntelligenceHistoryEvent[];` at the bottom of the interface:

```ts
export interface IntelligenceHistoryPayload {
  current: PrimaryIntelligence | null;
  draft: PrimaryIntelligence | null;
  versions: IntelligenceVersionRow[];
  events: IntelligenceHistoryEvent[];
}
```

- [ ] **Step 5: Verify build**

Run: `cd src/client && ng build 2>&1 | tail -20`
Expected: build succeeds. If there are errors, they will be in places that read removed fields off `IntelligenceVersionRow` (specifically `change_note` and `edited_by`, which we just renamed). Fix downstream callers to use `publish_note` and `published_by` until the build is clean. The downstream consumers are:
- `intelligence-history-panel.component.ts` and `.html` — use `publish_note` instead of `change_note`, `published_by` instead of `edited_by`.
- (no other consumers — `IntelligenceVersionRow` is panel-internal)

If you need to touch the panel just enough to keep the build green, make the minimal rename only; the full rewrite happens in Phase 3.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/core/models/primary-intelligence.model.ts \
  src/client/src/app/shared/components/intelligence-history-panel/intelligence-history-panel.component.ts \
  src/client/src/app/shared/components/intelligence-history-panel/intelligence-history-panel.component.html
git commit -m "feat(intel-history): add publish_note + diff_base_id + events to model"
```

---

## Phase 3: History panel rewrite

**Goal:** Replace the per-version expand-diff panel with a linear timeline of events. Each `published` event row is expandable to show content with word-level inline diff against `diff_base_id`.

### Task 3.1: Rewrite the panel TS

**Files:**
- Modify: `src/client/src/app/shared/components/intelligence-history-panel/intelligence-history-panel.component.ts`

- [ ] **Step 1: Replace the entire TS file**

Replace the file contents with:

```ts
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { diffWords } from 'diff';

import {
  IntelligenceHistoryEvent,
  IntelligenceHistoryPayload,
  IntelligenceVersionRow,
  PrimaryIntelligence,
} from '../../../core/models/primary-intelligence.model';
import { renderMarkdownInline } from '../../utils/markdown-render';

type VersionSection = 'headline' | 'thesis' | 'watch' | 'implications';

interface DiffSection {
  section: VersionSection;
  label: string;
  html: string;
}

@Component({
  selector: 'app-intelligence-history-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
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
  readonly draftClicked = output<void>();

  protected readonly expanded = signal(false);
  protected readonly expandedEventIds = signal<ReadonlySet<string>>(new Set());

  protected readonly events = computed<IntelligenceHistoryEvent[]>(
    () => this.payload().events ?? [],
  );
  protected readonly versions = computed<IntelligenceVersionRow[]>(
    () => this.payload().versions ?? [],
  );
  protected readonly draft = computed<PrimaryIntelligence | null>(
    () => this.payload().draft,
  );
  protected readonly current = computed<PrimaryIntelligence | null>(
    () => this.payload().current,
  );

  protected readonly eventCount = computed(() => this.events().length);
  protected readonly versionCount = computed(() => this.versions().length);
  protected readonly canExpand = computed(() => this.eventCount() > 0);

  protected readonly latestPublished = computed<IntelligenceHistoryEvent | null>(() => {
    for (const e of [...this.events()].reverse()) {
      if (e.kind === 'published') return e;
    }
    return null;
  });

  protected readonly versionsById = computed<Record<string, IntelligenceVersionRow>>(() => {
    const out: Record<string, IntelligenceVersionRow> = {};
    for (const v of this.versions()) out[v.id] = v;
    return out;
  });

  /**
   * The events list with archive sub-events folded under their causing
   * publish: an `archived` event at the same timestamp as a `published`
   * event renders as a child of that publish row, not a peer.
   */
  protected readonly timeline = computed<
    { event: IntelligenceHistoryEvent; archivedChildren: IntelligenceHistoryEvent[] }[]
  >(() => {
    const all = this.events();
    const rows: {
      event: IntelligenceHistoryEvent;
      archivedChildren: IntelligenceHistoryEvent[];
    }[] = [];
    const archivedAt = new Map<string, IntelligenceHistoryEvent[]>();

    for (const e of all) {
      if (e.kind === 'archived') {
        const list = archivedAt.get(e.at) ?? [];
        list.push(e);
        archivedAt.set(e.at, list);
      }
    }

    for (const e of all) {
      if (e.kind === 'archived') continue;
      const children = e.kind === 'published' ? (archivedAt.get(e.at) ?? []) : [];
      rows.push({ event: e, archivedChildren: children });
    }
    return rows;
  });

  protected isEventExpanded(rowId: string): boolean {
    return this.expandedEventIds().has(rowId);
  }

  protected toggleEvent(rowId: string): void {
    this.expandedEventIds.update((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  protected toggle(): void {
    if (!this.canExpand()) return;
    this.expanded.update((v) => !v);
  }

  protected versionForEvent(event: IntelligenceHistoryEvent): IntelligenceVersionRow | null {
    return this.versionsById()[event.row_id] ?? null;
  }

  protected diffBaseFor(version: IntelligenceVersionRow): IntelligenceVersionRow | null {
    if (!version.diff_base_id) return null;
    return this.versionsById()[version.diff_base_id] ?? null;
  }

  /**
   * Renders the four content sections of `version` with word-level
   * inline diff marks against `base` (or plain content if base is null).
   */
  protected renderDiff(
    version: IntelligenceVersionRow,
    base: IntelligenceVersionRow | null,
  ): DiffSection[] {
    const sections: { key: VersionSection; label: string; field: keyof IntelligenceVersionRow }[] = [
      { key: 'headline', label: 'Headline', field: 'headline' },
      { key: 'thesis', label: 'Thesis', field: 'thesis_md' },
      { key: 'watch', label: 'What to watch', field: 'watch_md' },
      { key: 'implications', label: 'Implications', field: 'implications_md' },
    ];
    const out: DiffSection[] = [];
    for (const s of sections) {
      const after = (version[s.field] as string) ?? '';
      if (!after.trim()) continue;
      const before = base ? ((base[s.field] as string) ?? '') : '';
      const html = base ? renderWordDiff(before, after) : renderMarkdownInline(after);
      out.push({ section: s.key, label: s.label, html });
    }
    return out;
  }

  protected eventVersionChip(event: IntelligenceHistoryEvent): string | null {
    if (event.version_number == null) return null;
    return `v${event.version_number}`;
  }

  protected authorInitials(id: string | null | undefined): string {
    if (!id) return '';
    return this.authorMap()[id] ?? id.slice(0, 2).toUpperCase();
  }

  protected formatDate(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  protected formatTime(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  protected eventKindLabel(kind: IntelligenceHistoryEvent['kind']): string {
    switch (kind) {
      case 'draft_started':
        return 'Draft';
      case 'published':
        return 'Published';
      case 'archived':
        return 'Archived';
      case 'withdrawn':
        return 'Withdrawn';
    }
  }

  protected isExpandable(kind: IntelligenceHistoryEvent['kind']): boolean {
    return kind === 'published' || kind === 'withdrawn';
  }

  protected hasDraft(): boolean {
    return this.draft() !== null && this.currentUserCanEdit();
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderWordDiff(before: string, after: string): string {
  const parts = diffWords(before, after);
  return parts
    .map((p) => {
      const text = escapeHtml(p.value);
      if (p.added) return `<ins class="bg-brand-100 text-slate-900 no-underline">${text}</ins>`;
      if (p.removed) return `<del class="text-slate-500 line-through">${text}</del>`;
      return `<span>${text}</span>`;
    })
    .join('');
}
```

- [ ] **Step 2: Verify build**

Run: `cd src/client && ng build 2>&1 | tail -20`
Expected: build fails because the template still uses the old API. Move to next task.

### Task 3.2: Rewrite the panel HTML

**Files:**
- Modify: `src/client/src/app/shared/components/intelligence-history-panel/intelligence-history-panel.component.html`

- [ ] **Step 1: Replace the entire HTML file**

Replace contents with:

```html
<section class="mb-4 border border-slate-200 bg-white" aria-labelledby="history-heading">
  <button
    type="button"
    class="flex w-full items-center justify-between border-b border-slate-200 bg-slate-50/60 px-4 py-2 text-left"
    [class.border-b-0]="!expanded()"
    [attr.aria-expanded]="expanded()"
    [disabled]="!canExpand()"
    (click)="toggle()"
  >
    <span id="history-heading" class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
      History
    </span>
    <span class="flex items-center gap-3 text-xs text-slate-500">
      @if (eventCount() === 0) {
        <span>No prior versions</span>
      } @else {
        <span>{{ versionCount() }} {{ versionCount() === 1 ? 'version' : 'versions' }}</span>
        @if (latestPublished(); as e) {
          <span class="font-mono">v{{ e.version_number }}</span>
          <span>{{ formatDate(e.at) }}</span>
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
    <div class="space-y-3 px-4 py-3">
      @if (hasDraft() && draft(); as d) {
        <button
          type="button"
          class="block w-full rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-left hover:border-slate-400"
          (click)="draftClicked.emit()"
        >
          <div class="flex items-baseline gap-2">
            <span class="text-xs font-medium uppercase tracking-[0.16em] text-slate-600">Working draft</span>
            <span class="text-xs text-slate-500">
              Edited {{ formatDate(d.updated_at) }} by {{ authorInitials(d.last_edited_by) }}
            </span>
          </div>
        </button>
      }

      @for (row of timeline(); track row.event.row_id + ':' + row.event.kind + ':' + row.event.at) {
        @let event = row.event;
        @let kind = event.kind;
        @let expandable = isExpandable(kind);
        @let expandedNow = isEventExpanded(event.row_id);
        @let version = versionForEvent(event);

        <article
          class="rounded-md border bg-white"
          [class.border-slate-200]="kind !== 'withdrawn'"
          [class.border-amber-300]="kind === 'withdrawn'"
        >
          <button
            type="button"
            class="flex w-full items-start justify-between gap-4 p-3 text-left"
            [attr.aria-expanded]="expandable ? expandedNow : null"
            [disabled]="!expandable"
            (click)="expandable ? toggleEvent(event.row_id) : null"
          >
            <div class="flex-1">
              <div class="flex flex-wrap items-baseline gap-2">
                <span class="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  {{ formatDate(event.at) }} {{ formatTime(event.at) }}
                </span>
                <span
                  class="rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                  [class.bg-brand-50]="kind === 'published'"
                  [class.text-brand-700]="kind === 'published'"
                  [class.border]="true"
                  [class.border-brand-200]="kind === 'published'"
                  [class.bg-slate-100]="kind === 'draft_started' || kind === 'archived'"
                  [class.text-slate-700]="kind === 'draft_started' || kind === 'archived'"
                  [class.border-slate-200]="kind === 'draft_started' || kind === 'archived'"
                  [class.bg-amber-50]="kind === 'withdrawn'"
                  [class.text-amber-700]="kind === 'withdrawn'"
                  [class.border-amber-200]="kind === 'withdrawn'"
                >
                  {{ eventKindLabel(kind) }}
                </span>
                @if (eventVersionChip(event); as chip) {
                  <span class="font-mono text-sm font-medium text-slate-700">{{ chip }}</span>
                }
                @if (event.by) {
                  <span class="text-xs text-slate-500">by {{ authorInitials(event.by) }}</span>
                }
              </div>
              @if (event.note) {
                <p class="mt-1 text-sm italic text-slate-700">"{{ event.note }}"</p>
              }
              @if (row.archivedChildren.length > 0) {
                @for (child of row.archivedChildren; track child.row_id) {
                  <p class="mt-1 pl-3 text-xs text-slate-500 border-l border-slate-200">
                    v{{ child.version_number }} archived
                  </p>
                }
              }
            </div>
            @if (expandable) {
              <span
                class="mt-1 inline-block h-2 w-2 border-r border-b border-slate-400 shrink-0"
                [class.rotate-45]="!expandedNow"
                [class.-rotate-135]="expandedNow"
                aria-hidden="true"
              ></span>
            }
          </button>

          @if (expandable && expandedNow && version) {
            <div class="border-t border-slate-100 p-4 space-y-3">
              @if (kind === 'published') {
                @let base = diffBaseFor(version);
                @if (!base) {
                  <p class="text-[10px] uppercase tracking-[0.18em] text-slate-400">Initial publication</p>
                } @else {
                  <p class="text-[10px] uppercase tracking-[0.18em] text-slate-400">
                    Changes vs v{{ base.version_number }}
                  </p>
                }
                @for (s of renderDiff(version, base); track s.section) {
                  <section>
                    <h4 class="text-[10px] uppercase tracking-[0.2em] text-slate-500">{{ s.label }}</h4>
                    <div class="prose prose-sm max-w-none text-slate-800" [innerHTML]="s.html"></div>
                  </section>
                }
              } @else if (kind === 'withdrawn') {
                <p class="text-[10px] uppercase tracking-[0.18em] text-amber-700">Withdrawn snapshot</p>
                @for (s of renderDiff(version, null); track s.section) {
                  <section>
                    <h4 class="text-[10px] uppercase tracking-[0.2em] text-slate-500">{{ s.label }}</h4>
                    <div class="prose prose-sm max-w-none text-slate-800" [innerHTML]="s.html"></div>
                  </section>
                }
              }
            </div>
          }
        </article>
      }
    </div>
  }
</section>
```

- [ ] **Step 2: Verify build + lint**

Run: `cd src/client && ng lint 2>&1 | tail -10 && ng build 2>&1 | tail -10`
Expected: both succeed cleanly. If lint flags the template, address those errors before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/shared/components/intelligence-history-panel/intelligence-history-panel.component.ts \
        src/client/src/app/shared/components/intelligence-history-panel/intelligence-history-panel.component.html
git commit -m "feat(intel-history): rewrite history panel as linear event timeline"
```

---

## Phase 4: IntelligenceBlock simplification

**Goal:** Drop the "Updated [Thesis | Implications]" chip row. Source the inline change-note line from the row's `publish_note` column instead of `recent_revisions[0].change_note`.

### Task 4.1: Simplify the block TS

**Files:**
- Modify: `src/client/src/app/shared/components/intelligence-block/intelligence-block.component.ts`

- [ ] **Step 1: Remove chip computed properties and import**

Open the file. Make these edits:

1. Remove the import line `IntelligenceRevisionField,` from the model imports.
2. Delete the `latestRevisionNote` computed property (around lines 113-118).
3. Delete the `FIELD_LABELS` static array (around lines 125-132) and the JSDoc above it.
4. Delete the `latestChangedFields` computed property (around lines 134-142).
5. Add a new computed property in the same place:

```ts
protected readonly publishNote = computed<string | null>(() => {
  const note = this.current()?.record.publish_note ?? null;
  return note && note.trim() ? note : null;
});
```

- [ ] **Step 2: Verify build**

Run: `cd src/client && ng build 2>&1 | tail -10`
Expected: build fails because the template references `latestRevisionNote()` and `latestChangedFields()`. Move to next task.

### Task 4.2: Simplify the block HTML

**Files:**
- Modify: `src/client/src/app/shared/components/intelligence-block/intelligence-block.component.html`

- [ ] **Step 1: Replace the chip block with a note-only line**

Find the block (around lines 90-113):

```html
@if (latestRevisionNote() || latestChangedFields().length) {
  <div
    class="mb-4 flex flex-wrap items-center gap-2 border-l-2 border-slate-200 bg-slate-50/40 px-3 py-1.5"
  >
    @if (latestChangedFields().length) {
      <span ...>Updated</span>
      @for (label of latestChangedFields(); track label) {
        <span ...>{{ label }}</span>
      }
    }
    @if (latestRevisionNote()) {
      <span class="text-xs italic text-slate-500">{{ latestRevisionNote() }}</span>
    }
  </div>
}
```

Replace it entirely with:

```html
@if (publishNote(); as note) {
  <div class="mb-4 border-l-2 border-slate-200 bg-slate-50/40 px-3 py-1.5">
    <span class="text-xs italic text-slate-500">{{ note }}</span>
  </div>
}
```

- [ ] **Step 2: Verify lint + build**

Run: `cd src/client && ng lint 2>&1 | tail -10 && ng build 2>&1 | tail -10`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/shared/components/intelligence-block/intelligence-block.component.ts \
        src/client/src/app/shared/components/intelligence-block/intelligence-block.component.html
git commit -m "feat(intel-block): drop changed-fields chips, source note from publish_note"
```

---

## Phase 5: Delete RecentActivityFeedComponent

**Goal:** Remove the now-redundant per-detail-page activity feed (only mounted on trial-detail).

### Task 5.1: Delete the component and its trial-detail mount

**Files:**
- Delete: `src/client/src/app/shared/components/recent-activity-feed/recent-activity-feed.component.ts`
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.html`
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.ts`

- [ ] **Step 1: Delete the component file and its containing directory**

Run: `rm -rf src/client/src/app/shared/components/recent-activity-feed/`
Verify: `ls src/client/src/app/shared/components/recent-activity-feed/ 2>&1`
Expected: "No such file or directory".

- [ ] **Step 2: Remove the usage in trial-detail.component.html**

Open `src/client/src/app/features/manage/trials/trial-detail.component.html`. Find the `<app-recent-activity-feed` element (around line 263) and delete the entire element including its inputs and the wrapping section if it has no other content. Use this find-and-remove approach:

Run: `grep -n "app-recent-activity-feed\|recent-activity-feed" src/client/src/app/features/manage/trials/trial-detail.component.html`
Locate the element. Remove it together with its outer container section if that section exists only to wrap the feed.

- [ ] **Step 3: Remove the import and Component entry in trial-detail.component.ts**

Open `src/client/src/app/features/manage/trials/trial-detail.component.ts`. Find:
- The `import { RecentActivityFeedComponent } from '../../../shared/components/recent-activity-feed/recent-activity-feed.component';` line (around line 50).
- The `RecentActivityFeedComponent,` entry in the `@Component`'s `imports` array (around line 84).

Delete both lines.

- [ ] **Step 4: Verify lint + build**

Run: `cd src/client && ng lint 2>&1 | tail -10 && ng build 2>&1 | tail -10`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add -A src/client/src/app/shared/components/recent-activity-feed \
        src/client/src/app/features/manage/trials/trial-detail.component.html \
        src/client/src/app/features/manage/trials/trial-detail.component.ts
git commit -m "feat(intel-history): delete RecentActivityFeedComponent (superseded by history panel)"
```

---

## Phase 6: Detail-page binding cleanup

**Goal:** Remove the `versionRevisionsRequested` bindings and the `loadHistoryVersionRevisions` methods from all five detail pages.

### Task 6.1: Strip revision bindings from 5 detail pages

**Files (all modify):**
- `src/client/src/app/features/manage/trials/trial-detail.component.ts` and `.html`
- `src/client/src/app/features/manage/markers/marker-detail.component.ts` and `.html`
- `src/client/src/app/features/manage/companies/company-detail.component.ts` and `.html`
- `src/client/src/app/features/manage/products/product-detail.component.ts` and `.html`
- `src/client/src/app/features/manage/engagement/engagement-detail.component.ts` and `.html`

- [ ] **Step 1: Confirm the panel TS no longer exposes `versionRevisionsRequested`**

Run: `grep -n "versionRevisionsRequested" src/client/src/app/shared/components/intelligence-history-panel/intelligence-history-panel.component.ts`
Expected: no matches (we dropped it in Phase 3).

- [ ] **Step 2: For each of the 5 HTML files, drop the binding**

In each HTML file, find the `<app-intelligence-history-panel` element and remove the `(versionRevisionsRequested)="loadHistoryVersionRevisions($event)"` line. The element keeps its other bindings (`[payload]`, `[currentUserCanEdit]`, `(withdraw)`, `(purgeVersion)`, `(purgeAnchor)`).

Verify across all five files:

```bash
grep -n "versionRevisionsRequested\|loadHistoryVersionRevisions" \
  src/client/src/app/features/manage/trials/trial-detail.component.html \
  src/client/src/app/features/manage/markers/marker-detail.component.html \
  src/client/src/app/features/manage/companies/company-detail.component.html \
  src/client/src/app/features/manage/products/product-detail.component.html \
  src/client/src/app/features/manage/engagement/engagement-detail.component.html
```
Expected: no matches.

- [ ] **Step 3: For each of the 5 TS files, delete the `loadHistoryVersionRevisions` method**

In each TS file, find the method that looks like:

```ts
async loadHistoryVersionRevisions(versionId: string): Promise<void> {
  try {
    const revs = await this.historyHost.loadVersionRevisions(versionId);
    this.historyPanelRef()?.setVersionRevisions(versionId, revs);
  } catch (...) { ... }
}
```

Delete the entire method. Also delete any `historyPanelRef` viewChild signal and its import if it is only used by this method (search for other usages first):

```bash
for f in \
  src/client/src/app/features/manage/trials/trial-detail.component.ts \
  src/client/src/app/features/manage/markers/marker-detail.component.ts \
  src/client/src/app/features/manage/companies/company-detail.component.ts \
  src/client/src/app/features/manage/products/product-detail.component.ts \
  src/client/src/app/features/manage/engagement/engagement-detail.component.ts; do
  echo "=== $f ===";
  grep -n "historyPanelRef\|loadHistoryVersionRevisions" $f;
done
```

For each file: if `historyPanelRef` only appears inside `loadHistoryVersionRevisions`, delete its declaration, its `viewChild` import (if unused elsewhere), and the `IntelligenceHistoryPanelComponent` import if it is no longer referenced.

Search the codebase to confirm `setVersionRevisions` is gone:

```bash
grep -rn "setVersionRevisions" src/client/src
```
Expected: no matches.

- [ ] **Step 4: Verify lint + build**

Run: `cd src/client && ng lint 2>&1 | tail -10 && ng build 2>&1 | tail -10`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/manage
git commit -m "feat(intel-history): remove revision-load bindings from detail pages"
```

---

## Phase 7: Service + host cleanup

**Goal:** Drop `loadVersionRevisions` from both the service and the panel host.

### Task 7.1: Trim the service and host

**Files:**
- Modify: `src/client/src/app/core/services/primary-intelligence.service.ts`
- Modify: `src/client/src/app/shared/components/intelligence-history-panel/history-panel-host.ts`

- [ ] **Step 1: Drop `loadVersionRevisions` from the service**

Open `src/client/src/app/core/services/primary-intelligence.service.ts`. Delete the entire `loadVersionRevisions` method (around lines 146-153) and remove `IntelligenceVersionRevision` from the model imports at the top of the file.

- [ ] **Step 2: Drop `loadVersionRevisions` from the host**

Open `src/client/src/app/shared/components/intelligence-history-panel/history-panel-host.ts`. Delete the entire `loadVersionRevisions` method (around lines 35-37) and remove `IntelligenceVersionRevision` from the model imports.

- [ ] **Step 3: Verify**

Run: `grep -rn "loadVersionRevisions\|IntelligenceVersionRevision" src/client/src`
Expected: no matches.

Run: `cd src/client && ng lint 2>&1 | tail -10 && ng build 2>&1 | tail -10`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/core/services/primary-intelligence.service.ts \
        src/client/src/app/shared/components/intelligence-history-panel/history-panel-host.ts
git commit -m "feat(intel-history): drop loadVersionRevisions from service and host"
```

---

## Phase 8: Final model cleanup

**Goal:** Now that no consumer references the legacy types, remove them from the model file.

### Task 8.1: Delete dead model types

**Files:**
- Modify: `src/client/src/app/core/models/primary-intelligence.model.ts`

- [ ] **Step 1: Verify no consumers remain**

Run:

```bash
grep -rn "PrimaryIntelligenceRevision\|IntelligenceVersionRevision\|IntelligenceRevisionField\|recent_revisions\b" src/client/src src/client/integration src/client/e2e
```
Expected: no matches.

- [ ] **Step 2: Remove the dead types**

Open the model file. Delete:
- The `IntelligenceRevisionField` type alias.
- The `PrimaryIntelligenceRevision` interface.
- The `IntelligenceVersionRevision` interface.
- The `recent_revisions: PrimaryIntelligenceRevision[];` line inside `IntelligencePayload`.

The remaining interfaces should be: `PrimaryIntelligence`, `PrimaryIntelligenceLink`, `IntelligencePayload` (no `recent_revisions`), `ReferencedInRow`, `IntelligenceDetailBundle`, `IntelligenceFeedRow`, `IntelligenceFeedResult`, `UpsertIntelligenceInput`, `IntelligenceVersionRow`, `IntelligenceHistoryEvent`, `IntelligenceHistoryPayload`.

- [ ] **Step 3: Verify build + lint**

Run: `cd src/client && ng lint 2>&1 | tail -10 && ng build 2>&1 | tail -10`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/core/models/primary-intelligence.model.ts
git commit -m "feat(intel-history): drop legacy revision model types"
```

---

## Phase 9: e2e rewrite

**Goal:** Update the e2e spec for the new timeline shape. Add a new test confirming withdrawn versions are skipped as diff bases.

### Task 9.1: Rewrite intelligence-history.spec.ts

**Files:**
- Modify: `src/client/e2e/tests/intelligence-history.spec.ts`

- [ ] **Step 1: Update seed helpers**

Open the file. Update both `seedArchivedVersion` and `seedPublishedVersion` to write the new columns:

```ts
async function seedArchivedVersion(opts: {
  spaceId: string;
  entityType: 'company';
  entityId: string;
  headline: string;
  versionNumber: number;
  publishedAt: string;
  archivedAt: string;
  publishNote: string | null;
  userId: string;
}): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('primary_intelligence')
    .insert({
      space_id: opts.spaceId,
      entity_type: opts.entityType,
      entity_id: opts.entityId,
      state: 'archived',
      headline: opts.headline,
      thesis_md: '',
      watch_md: '',
      implications_md: '',
      last_edited_by: opts.userId,
      version_number: opts.versionNumber,
      published_at: opts.publishedAt,
      published_by: opts.userId,
      publish_note: opts.publishNote,
      archived_at: opts.archivedAt,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to seed archived version: ${error.message}`);
  return data.id;
}

async function seedPublishedVersion(opts: {
  spaceId: string;
  entityType: 'company';
  entityId: string;
  headline: string;
  versionNumber?: number;
  publishedAt?: string;
  publishNote?: string | null;
  thesis?: string;
  userId: string;
}): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('primary_intelligence')
    .insert({
      space_id: opts.spaceId,
      entity_type: opts.entityType,
      entity_id: opts.entityId,
      state: 'published',
      headline: opts.headline,
      thesis_md: opts.thesis ?? '',
      watch_md: '',
      implications_md: '',
      last_edited_by: opts.userId,
      version_number: opts.versionNumber ?? null,
      published_at: opts.publishedAt ?? new Date().toISOString(),
      published_by: opts.userId,
      publish_note: opts.publishNote ?? null,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to seed published version: ${error.message}`);
  return data.id;
}

async function seedWithdrawnVersion(opts: {
  spaceId: string;
  entityType: 'company';
  entityId: string;
  headline: string;
  versionNumber: number;
  publishedAt: string;
  withdrawnAt: string;
  publishNote: string | null;
  withdrawNote: string | null;
  thesis?: string;
  userId: string;
}): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('primary_intelligence')
    .insert({
      space_id: opts.spaceId,
      entity_type: opts.entityType,
      entity_id: opts.entityId,
      state: 'withdrawn',
      headline: opts.headline,
      thesis_md: opts.thesis ?? '',
      watch_md: '',
      implications_md: '',
      last_edited_by: opts.userId,
      version_number: opts.versionNumber,
      published_at: opts.publishedAt,
      published_by: opts.userId,
      publish_note: opts.publishNote,
      withdrawn_at: opts.withdrawnAt,
      withdrawn_by: opts.userId,
      withdraw_note: opts.withdrawNote,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to seed withdrawn version: ${error.message}`);
  return data.id;
}
```

- [ ] **Step 2: Rewrite the seeded-versions test**

Replace the body of the test `'history panel shows seeded versions; Withdraw flow soft-deletes the current row'` with assertions appropriate for the new timeline:

```ts
test('history panel shows seeded versions; Withdraw flow soft-deletes the current row', async () => {
  await ensureClean(spaceId, 'company', companyId);

  await seedArchivedVersion({
    spaceId,
    entityType: 'company',
    entityId: companyId,
    headline: 'Acme thesis v1',
    versionNumber: 1,
    publishedAt: '2026-04-01T00:00:00Z',
    archivedAt: '2026-04-05T00:00:00Z',
    publishNote: 'initial release',
    userId,
  });
  await seedPublishedVersion({
    spaceId,
    entityType: 'company',
    entityId: companyId,
    headline: 'Acme thesis v2',
    versionNumber: 2,
    publishedAt: '2026-04-05T00:00:00Z',
    publishNote: 'expanded thesis',
    userId,
  });

  await page.goto(companyUrl, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Acme thesis v2', level: 3 })).toBeVisible({
    timeout: 10000,
  });

  const historyRegion = page.getByRole('region', { name: 'History' });
  await expect(historyRegion.getByText('2 versions')).toBeVisible();
  await historyRegion.locator('button[aria-expanded]').first().click();

  // Both publish events render with their version chips and notes.
  await expect(historyRegion.getByText('v1')).toBeVisible();
  await expect(historyRegion.getByText('v2')).toBeVisible();
  await expect(historyRegion.getByText('"initial release"')).toBeVisible();
  await expect(historyRegion.getByText('"expanded thesis"')).toBeVisible();
  // The archived sub-line for v1 is nested under v2's publish row.
  await expect(historyRegion.getByText('v1 archived')).toBeVisible();

  // Withdraw v2 via the IntelligenceBlock control.
  await page.getByRole('button', { name: 'Withdraw' }).first().click();
  const withdrawDialog = page.getByRole('dialog', { name: 'Withdraw this read' });
  await expect(withdrawDialog).toBeVisible({ timeout: 5000 });
  await withdrawDialog.getByLabel(/reason/i).fill('superseded by external press release');
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/rest/v1/rpc/withdraw_primary_intelligence') && r.ok(),
    ),
    withdrawDialog.getByRole('button', { name: 'Withdraw' }).click(),
  ]);

  await expect(page.getByRole('heading', { name: 'Acme thesis v2', level: 3 })).toBeHidden({
    timeout: 5000,
  });
  await expect(page.getByRole('button', { name: 'Add primary intelligence' })).toBeVisible();

  await page.reload({ waitUntil: 'networkidle' });
  const historyAfter = page.getByRole('region', { name: 'History' });
  await expect(historyAfter.getByText('2 versions')).toBeVisible();
  await historyAfter.locator('button[aria-expanded]').first().click();
  await expect(historyAfter.getByText('Withdrawn').first()).toBeVisible();
  await expect(historyAfter.getByText('"superseded by external press release"')).toBeVisible();
});
```

- [ ] **Step 3: Add the withdrawn-skip diff test**

Add a new test after the rewritten seeded-versions test (still inside the `test.describe`):

```ts
test('diff base skips withdrawn versions', async () => {
  await ensureClean(spaceId, 'company', companyId);

  await seedArchivedVersion({
    spaceId,
    entityType: 'company',
    entityId: companyId,
    headline: 'Acme v1 headline',
    versionNumber: 1,
    publishedAt: '2026-04-01T00:00:00Z',
    archivedAt: '2026-04-05T00:00:00Z',
    publishNote: 'initial',
    userId,
  });
  await seedWithdrawnVersion({
    spaceId,
    entityType: 'company',
    entityId: companyId,
    headline: 'Acme v2 headline withdrawn branch',
    versionNumber: 2,
    publishedAt: '2026-04-05T00:00:00Z',
    withdrawnAt: '2026-04-06T00:00:00Z',
    publishNote: 'branch we abandoned',
    withdrawNote: 'wrong data',
    userId,
  });
  await seedPublishedVersion({
    spaceId,
    entityType: 'company',
    entityId: companyId,
    headline: 'Acme v3 headline',
    versionNumber: 3,
    publishedAt: '2026-04-07T00:00:00Z',
    publishNote: 'rewritten',
    userId,
  });

  await page.goto(companyUrl, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Acme v3 headline', level: 3 })).toBeVisible({
    timeout: 10000,
  });

  const historyRegion = page.getByRole('region', { name: 'History' });
  await historyRegion.locator('button[aria-expanded]').first().click();

  // Expand v3's Published row.
  const v3Row = historyRegion.locator('article', { hasText: 'v3' }).first();
  await v3Row.locator('button[aria-expanded]').first().click();

  // The diff base label should reference v1, not v2.
  await expect(historyRegion.getByText('Changes vs v1')).toBeVisible();

  // The diff body should include ins/del marks against v1's content.
  await expect(historyRegion.locator('ins').first()).toBeVisible();
});
```

- [ ] **Step 4: Update the "No prior versions" test if needed**

Check that the existing `'history panel renders "No prior versions" for a brand-new company'` still passes against the new copy. The panel still uses the string `'No prior versions'` when `eventCount() === 0`, so no change should be needed. Verify by reading the test and confirming the assertion.

- [ ] **Step 5: Run the e2e suite for this spec**

Run: `cd src/client && npm run test:e2e -- intelligence-history 2>&1 | tail -30`
Expected: all three tests pass (No prior versions; seeded versions + Withdraw; diff base skips withdrawn).

If the suite fails because the previous test's seeded state leaks into the next test, ensure each test calls `ensureClean` at the top (the existing test does).

- [ ] **Step 6: Commit**

```bash
git add src/client/e2e/tests/intelligence-history.spec.ts
git commit -m "test(intel-history): rewrite e2e for timeline shape, add withdrawn-skip diff test"
```

---

## Phase 10: Documentation update

**Goal:** Reflect the simplified schema in the runbook prose; regenerate auto-gen blocks.

### Task 10.1: Update runbook prose

**Files:**
- Modify: `docs/runbook/03-features.md`
- Modify: `docs/runbook/07-database-schema.md`
- Modify: `docs/runbook/08-authentication-security.md`

- [ ] **Step 1: Update `03-features.md` Primary intelligence section**

Open the file. Find the "Data model" paragraph in the Primary intelligence section (around line 329). Rewrite it as:

```
**Data model.** Single polymorphic table `primary_intelligence` keyed on `(space_id, entity_type, entity_id)` where `entity_type in ('trial', 'marker', 'company', 'product', 'space')`. Each row carries `state in ('draft','published','archived','withdrawn')`, a per-anchor `version_number` stamped on entry into `published`, and four lifecycle columns: `publish_note` + `published_by` set at publish, `archived_at` set when a newer version publishes over this one, `withdraw_note` set when the row is withdrawn. A unique partial index on `state = 'published'` enforces one published row per anchor; drafts can co-exist. One child table: `primary_intelligence_links` (cross-entity relations with `relationship_type` and optional gloss).
```

Find the RPC list paragraph (around line 334). Edit:

- The `upsert_primary_intelligence(...)` line: remove "stashes both app.change_note and app.changed_fields_json session vars so the revision trigger can record what moved." Replace with "On publish, writes `publish_note` + `published_by` directly to the new row and stamps `archived_at` on the prior published row in the same call."
- The `delete_primary_intelligence(id)` line: change "cascades to links and revisions" to "cascades to links".
- Drop `get_intelligence_version_revisions` from the list.

Update the `app-intelligence-block` paragraph (around line 340): remove the sentence "The block also surfaces structural diff chips above the body when the latest revision recorded changed sections." (The chips are gone.)

Update the `app-recent-activity-feed` paragraph (around line 344): delete the entire bullet. The activity feed is gone.

Insert or update the `app-intelligence-history-panel` description (find it nearby or add it):

```
- `app-intelligence-history-panel` mounts below `app-intelligence-block` on every detail page. Renders a single linear event timeline for the anchor (`draft_started | published | archived | withdrawn`). Published and withdrawn events expand to show their version's content; published events also render word-level inline ins/del marks (via `diffWords` from the `diff` npm package) against the most recent prior non-withdrawn published version. Archive events render as nested sub-lines under their causing publish.
```

- [ ] **Step 2: Update `07-database-schema.md` prose**

Find the prose around the auto-gen ER block referencing `PRIMARY_INTELLIGENCE_REVISIONS` (line 57 referenced earlier). The ER diagram is auto-generated and will refresh when `npm run docs:arch` runs (Step 4); we just need to update surrounding prose. Look for the "primary_intelligence version columns" section (around line 93) and rewrite it to describe the new columns: `publish_note`, `published_by`, `archived_at`, `withdraw_note`. Remove any sentences referring to `primary_intelligence_revisions` as a table.

- [ ] **Step 3: Update `08-authentication-security.md` prose**

Find any narrative paragraphs (not the auto-gen RLS coverage table) that mention `primary_intelligence_revisions` and remove or rewrite them. The auto-gen table will refresh in Step 4.

- [ ] **Step 4: Regenerate auto-gen blocks**

Run: `cd src/client && npm run docs:arch 2>&1 | tail -20`
Expected: "Architecture docs regenerated." or similar success message. The ER block, RLS table, and any drift sections under `<!-- AUTO-GEN: -->` markers will reflect the new schema (no revisions table).

- [ ] **Step 5: Verify regen**

Run: `git diff docs/runbook/07-database-schema.md docs/runbook/08-authentication-security.md`
Confirm:
- The ER block no longer contains `PRIMARY_INTELLIGENCE_REVISIONS`.
- The RLS coverage table in 08 no longer contains a row for `primary_intelligence_revisions`.

- [ ] **Step 6: Commit**

```bash
git add docs/runbook/03-features.md docs/runbook/07-database-schema.md docs/runbook/08-authentication-security.md
git commit -m "docs(runbook): update primary intelligence schema and history-panel description"
```

---

## Phase 11: Final verification

**Goal:** Run the full local validation suite to catch anything the per-phase verifications missed.

### Task 11.1: Full lint + build + advisor + e2e suite

- [ ] **Step 1: Run lint**

Run: `cd src/client && ng lint 2>&1 | tail -10`
Expected: "All files pass linting."

- [ ] **Step 2: Run build**

Run: `cd src/client && ng build 2>&1 | tail -10`
Expected: "Application bundle generation complete." with no errors (CSS budget warnings on pre-existing components are acceptable).

- [ ] **Step 3: Run Supabase advisors**

Run: `supabase db advisors --local --type all 2>&1 | tail -20`
Expected: "No issues found" or only pre-existing warnings (none related to the new columns or dropped table).

- [ ] **Step 4: Run integration tests touched by this work**

Run: `cd src/client && npm run test:integration -- rpc-content-write 2>&1 | tail -20`
Expected: all tests pass.

- [ ] **Step 5: Run e2e tests touched by this work**

Run: `cd src/client && npm run test:e2e -- intelligence-history 2>&1 | tail -30`
Expected: three tests pass.

- [ ] **Step 6: Confirm no orphan references remain**

Run:
```bash
grep -rn "primary_intelligence_revisions\|app.change_note\|app.changed_fields_json\|write_primary_intelligence_revision\|get_intelligence_version_revisions\|recent_revisions\|RecentActivityFeedComponent\|loadVersionRevisions" \
  src/client/src src/client/integration src/client/e2e supabase/migrations 2>/dev/null \
  | grep -v "20260510130000_intelligence_history_simplify.sql"
```

Expected: no matches (except inside the new migration file itself, which references the dropped names as part of `drop` statements — those are excluded by the grep above).

- [ ] **Step 7: Update spec status**

Update `docs/specs/intelligence-history-simplification/status.json`:
- Set `status` to `completed`.
- Set every task entry's `status` to `completed`.
- Set `updatedAt` to current ISO timestamp.

Update `docs/specs/intelligence-history-simplification/spec.md`:
- Set `status: approved` to `status: completed` in the frontmatter.
- Set `updated:` to today's date.

- [ ] **Step 8: Commit**

```bash
git add docs/specs/intelligence-history-simplification/
git commit -m "chore(spec): mark intelligence-history-simplification complete"
```

---

## Notes for the implementing engineer

- **The migration is the riskiest step.** If `supabase db reset` fails partway through Phase 1, read the error, fix the SQL in the same migration file (don't add a follow-up migration), and rerun. Migrations are append-only across PRs but you can edit the file freely while it hasn't been merged.
- **You can re-run individual phases.** Each phase ends with a green build and a commit. If you discover an issue during a later phase, you can `git revert` only the affected commit and re-do that phase without disturbing the others.
- **Do not skip lint.** The repo's lint config ratchets multiple rules to `error` for Angular 21 readiness. The pre-push hook will catch issues, but per-phase lint runs catch them sooner.
- **Cloudflare auto-deploys on push to main.** Don't push to main mid-implementation; wait until Phase 11 completes locally.
- **Commit messages.** Lowercase scope prefix, present tense imperative, no Claude attribution, no em dashes.
