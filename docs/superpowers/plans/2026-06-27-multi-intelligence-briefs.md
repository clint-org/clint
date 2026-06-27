# Multi-Intelligence-Briefs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each entity (engagement/space, company, asset, trial) own many primary-intelligence briefs ("a drawer of entries"), each an independent versioned deliverable, instead of exactly one.

**Architecture:** Introduce a `primary_intelligence_anchors` table that *is* the brief (entity binding + lead + order). The existing `primary_intelligence` rows become pure version rows hanging off an anchor via `anchor_id`. Every per-anchor rule (version numbering, one-published index, archive-on-republish, history, lead) re-keys from the entity triple `(space_id, entity_type, entity_id)` to `anchor_id`. The lifecycle/versioning state machine (`draft -> published -> archived/withdrawn`) is unchanged.

**Tech Stack:** Supabase/Postgres (SECURITY DEFINER RPCs, RLS, plpgsql triggers), Angular 19/21 (standalone signals components, PrimeNG 21, Tailwind v4), Vitest (unit), integration suite under `src/client/integration`, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-06-27-multi-intelligence-briefs-design.md`

## Global Constraints

- **Greenfield data:** no production intelligence to preserve. Migrations still must not crash on the existing dev/prod demo rows, so each restructuring migration includes a trivial in-migration backfill (one anchor per existing `(space_id, entity_type, entity_id)` group) before tightening constraints. Seed helpers are rewritten, not preserved.
- **Migrations are append-only.** Never edit an applied migration; add new timestamped files `YYYYMMDDHHmmss_*.sql`. Apply locally via `supabase db reset` (re-runs all migrations + seed), never by hand-applying SQL — a parallel session's reset wipes hand-applied funcs (PGRST202 storm).
- **Base every modified RPC on its live definition.** Run `supabase db reset` then `psql "$DB" -c "\sf public.<fn>"` (or `select pg_get_functiondef('public.<fn>'::regproc)`) and edit *that* body. Redefining from an older migration copy silently reverts newer logic (e.g. author/editor/owner gating added in `20260624140200`).
- **Signature changes need a schema reload.** Any migration that changes an RPC's parameter list ends with `notify pgrst, 'reload schema';` or the app 404s the new args.
- **jsonb<->interface shape is not runtime-checked.** When you change an RPC's jsonb output or a TS interface, diff both sides field-by-field; a key mismatch renders blank, not an error.
- **Audit:** pin/reorder/upsert are content ops on editorial tables, NOT Tier-1 governance — do NOT add `-- @audit:tier1` markers.
- **Copy rules:** no emojis, no em dashes. UI noun for one brief is an **"entry"**; drawer header reads **"Intelligence (N)"**. "Primary intelligence" in full headings, "Intelligence" in compact surfaces.
- **Static gates that must stay green:** `grants:check` (fails on missing AND excess grants), `features:check` (`rpc-unmapped` is an ERROR — every public RPC maps to a capability), `supabase db advisors --local --type all`, and `cd src/client && ng lint && ng build`.
- **Angular:** standalone + `OnPush` + `inject()` + signals; `input()`/`output()`/`model()`; native control flow `@if`/`@for`; `bg-brand-*` not `bg-teal-*`; PrimeNG for overlays/forms; WCAG AA.
- **Integration test env:** `export SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o json | jq -r .SERVICE_ROLE_KEY)` (the status name differs from the env name). Verify a single spec in isolation; the shared local Docker DB is contended by other worktrees.
- **Tests are per-task, never deferred.** Each task below that ships behavior ships its test in the same task and commit.

---

## File-structure map

**New files**
- `supabase/migrations/20260627120000_intelligence_anchors_schema.sql` — anchors table, PI restructure, indexes, RLS, trigger rescope, cleanup rewire (Task 1)
- `supabase/migrations/20260627120100_intelligence_upsert_anchor_aware.sql` — upsert rewrite (Task 2)
- `supabase/migrations/20260627120200_intelligence_lead_and_order_rpcs.sql` — set_intelligence_lead, reorder_intelligence (Task 3)
- `supabase/migrations/20260627120300_list_intelligence_for_entity.sql` — per-entity brief list (Task 4)
- `supabase/migrations/20260627120400_intelligence_detail_bundles_multi.sql` — detail RPC refactor (Task 5)
- `supabase/migrations/20260627120500_intelligence_history_and_lifecycle_multi.sql` — history rescope + lifecycle (Task 6)
- `supabase/migrations/20260627120600_intelligence_feed_and_landscape_multi.sql` — feed + landscape presence (Task 7)
- `supabase/migrations/20260627120700_intelligence_seed_multi.sql` — seed rewrite (Task 8)
- `src/client/src/app/shared/components/intelligence-brief-list/intelligence-brief-list.component.{ts,html,spec.ts}` — collapsed-briefs presenter (Task 11)
- `src/client/integration/tests/intelligence-multi-briefs.spec.ts` — integration coverage (Tasks 2-8 append here)
- `src/client/e2e/intelligence-multi-briefs.spec.ts` — e2e (Task 15)

**Modified files**
- `src/client/src/app/core/models/primary-intelligence.model.ts` (Task 9)
- `src/client/src/app/core/services/primary-intelligence.service.ts` (Task 10)
- trial/company/asset/engagement detail components (Task 12)
- `.../intelligence-compose-dialog/intelligence-compose-dialog.component.ts` (Task 13)
- `.../intelligence-history-panel/*` (Task 14)
- `supabase/data-api-grants.json`, `docs/runbook/features/primary-intelligence.md` (Task 8)
- runbook + help page + `npm run docs:arch` regen (Task 16)

---

## Task 1: Schema foundation — anchors table + PI restructure

**Files:**
- Create: `supabase/migrations/20260627120000_intelligence_anchors_schema.sql`

**Interfaces:**
- Produces: table `public.primary_intelligence_anchors(id, space_id, entity_type, entity_id, is_lead, display_order, created_by, created_at, updated_at)`; column `public.primary_intelligence.anchor_id uuid NOT NULL`; columns `primary_intelligence.entity_type`/`entity_id` REMOVED; unique index `primary_intelligence_one_published_per_anchor (anchor_id) WHERE state='published'`; unique index `primary_intelligence_one_lead_per_entity` on anchors `(space_id, entity_type, entity_id) WHERE is_lead`.

- [ ] **Step 1: Write the migration**

```sql
-- migration: 20260627120000_intelligence_anchors_schema
-- purpose: make an entity able to own MANY primary-intelligence briefs.
--   introduce primary_intelligence_anchors (the "brief": entity binding +
--   is_lead + display_order). primary_intelligence rows become version rows
--   hanging off an anchor via anchor_id. entity_type/entity_id move off
--   primary_intelligence onto the anchor. re-key the one-published index and
--   the version_number trigger from the entity triple to anchor_id. rewire the
--   polymorphic cleanup trigger and the space-delete PI cleanup to delete
--   anchors (versions/links/revisions cascade via real FKs).

-- 1. anchors table -----------------------------------------------------------
create table public.primary_intelligence_anchors (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  entity_type text not null check (entity_type in ('trial','company','product','space')),
  entity_id uuid not null,
  is_lead boolean not null default false,
  display_order int not null default 0,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.primary_intelligence_anchors is
  'One row per intelligence brief. Owns the entity binding (entity_type, '
  'entity_id, polymorphic, no FK), the pinned-lead flag, and manual order. '
  'primary_intelligence rows are versions of an anchor.';

create index idx_pi_anchors_entity
  on public.primary_intelligence_anchors (space_id, entity_type, entity_id, display_order);

-- one pinned lead per entity
create unique index primary_intelligence_one_lead_per_entity
  on public.primary_intelligence_anchors (space_id, entity_type, entity_id)
  where is_lead;

alter table public.primary_intelligence_anchors enable row level security;

-- 2. add anchor_id to primary_intelligence (nullable first for backfill) -----
alter table public.primary_intelligence
  add column anchor_id uuid references public.primary_intelligence_anchors (id) on delete cascade;

-- 3. backfill: one anchor per existing (space, entity_type, entity_id) group.
--    today each entity has at most one brief (archived rows are its versions),
--    so every existing group becomes exactly one anchor, marked lead.
--    skip rows whose entity_type='marker' (vestigial; never surfaced) by
--    deleting them — markers are not owners in the new model.
delete from public.primary_intelligence where entity_type = 'marker';

with grp as (
  select distinct space_id, entity_type, entity_id
    from public.primary_intelligence
), ins as (
  insert into public.primary_intelligence_anchors
    (space_id, entity_type, entity_id, is_lead, display_order)
  select space_id, entity_type, entity_id, true, 0 from grp
  returning id, space_id, entity_type, entity_id
)
update public.primary_intelligence p
   set anchor_id = ins.id
  from ins
 where p.space_id = ins.space_id
   and p.entity_type = ins.entity_type
   and p.entity_id = ins.entity_id;

-- 4. tighten: anchor_id required, drop the entity columns + old index --------
alter table public.primary_intelligence alter column anchor_id set not null;

drop index if exists primary_intelligence_one_published;
drop index if exists idx_primary_intelligence_entity;
drop index if exists idx_primary_intelligence_anchor_versions;

alter table public.primary_intelligence drop column entity_type;
alter table public.primary_intelligence drop column entity_id;

create unique index primary_intelligence_one_published_per_anchor
  on public.primary_intelligence (anchor_id)
  where state = 'published';

create index idx_primary_intelligence_anchor_versions
  on public.primary_intelligence (anchor_id, version_number desc)
  where state in ('published','archived','withdrawn');

create index idx_primary_intelligence_anchor
  on public.primary_intelligence (anchor_id);

-- 5. rescope version_number trigger to anchor_id -----------------------------
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
       where anchor_id = new.anchor_id
         and id is distinct from new.id
         and version_number is not null
    ), 1);
    new.published_at := now();
  end if;
  return new;
end;
$$;

-- 6. RLS on anchors: published-anchor readable in space; agency full access ---
create policy "pi_anchors published readable in space"
on public.primary_intelligence_anchors for select to authenticated
using (
  public.has_space_access(space_id)
  and exists (
    select 1 from public.primary_intelligence p
    where p.anchor_id = primary_intelligence_anchors.id
      and p.state = 'published'
  )
);

create policy "pi_anchors agency can read all"
on public.primary_intelligence_anchors for select to authenticated
using ( public.is_agency_member_of_space(space_id) );

create policy "pi_anchors agency can insert"
on public.primary_intelligence_anchors for insert to authenticated
with check ( public.is_agency_member_of_space(space_id) );

create policy "pi_anchors agency can update"
on public.primary_intelligence_anchors for update to authenticated
using ( public.is_agency_member_of_space(space_id) )
with check ( public.is_agency_member_of_space(space_id) );

create policy "pi_anchors agency can delete"
on public.primary_intelligence_anchors for delete to authenticated
using ( public.is_agency_member_of_space(space_id) );

-- 7. rewire polymorphic cleanup: delete anchors by (entity_type, entity_id)
--    (versions/links/revisions cascade), AND still delete link-target rows.
create or replace function public._cleanup_polymorphic_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text := tg_argv[0];
begin
  -- links that POINT TO the deleted entity as a target
  delete from public.primary_intelligence_links
    where entity_type = v_type and entity_id = old.id;
  -- briefs OWNED by the deleted entity (only the four owner types match)
  delete from public.primary_intelligence_anchors
    where entity_type = v_type and entity_id = old.id;
  delete from public.material_links
    where entity_type = v_type and entity_id = old.id;
  return old;
end;
$$;
```

- [ ] **Step 2: Update the space-delete PI cleanup site**

The space-delete path currently runs `delete from public.primary_intelligence where space_id = v_space_id;`. With versions cascading from anchors, change it to delete anchors. Find the live definition first:

Run: `psql "$DB" -c "\sf public.permanently_delete_space"` (and grep migrations for any other `delete from public.primary_intelligence where space_id`).
In the new migration, `create or replace` that function based on its live body, replacing the PI delete line with:

```sql
  delete from public.primary_intelligence_anchors where space_id = v_space_id;
```

(Keep `-- @audit:tier1` and `record_audit_event()` intact — `permanently_delete_space` IS Tier-1.)

- [ ] **Step 3: Append an inline smoke test to the migration**

```sql
do $$
declare
  v_count int;
begin
  -- anchors table exists and has the lead uniqueness guard
  perform 1 from pg_indexes
   where indexname = 'primary_intelligence_one_lead_per_entity';
  if not found then
    raise exception 'smoke FAIL: one-lead-per-entity index missing';
  end if;
  -- primary_intelligence no longer has entity_type
  select count(*) into v_count from information_schema.columns
   where table_schema='public' and table_name='primary_intelligence'
     and column_name in ('entity_type','entity_id');
  if v_count <> 0 then
    raise exception 'smoke FAIL: entity columns still on primary_intelligence';
  end if;
  raise notice 'anchors schema smoke ok';
end $$;
```

- [ ] **Step 4: Apply and verify**

Run: `supabase db reset` then `supabase db advisors --local --type all`
Expected: reset completes (all migrations + seed run — note seed will fail until Task 8 rewrites the seed helper; if so, temporarily comment the `_seed_demo_primary_intelligence(...)` call site in `supabase/seed.sql` to verify this migration, and restore it in Task 8). Advisors: no new ERROR/WARN for the anchors table.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260627120000_intelligence_anchors_schema.sql
git commit -m "feat(db): primary_intelligence_anchors + re-key versioning to anchor_id"
```

---

## Task 2: upsert_primary_intelligence becomes anchor-aware

**Files:**
- Create: `supabase/migrations/20260627120100_intelligence_upsert_anchor_aware.sql`
- Test: `src/client/integration/tests/intelligence-multi-briefs.spec.ts`

**Interfaces:**
- Consumes: anchors table (Task 1).
- Produces: `upsert_primary_intelligence(p_id uuid, p_anchor_id uuid, p_space_id uuid, p_entity_type text, p_entity_id uuid, p_headline text, p_summary_md text, p_implications_md text, p_state text, p_change_note text, p_links jsonb) returns uuid` (returns the version-row id; the anchor id is reachable via that row).

- [ ] **Step 1: Write the integration test first** (append to the spec; create the file with standard harness imports modeled on `src/client/integration/tests/rpc-content-write.spec.ts`)

```ts
// tests 1-7 from the spec test matrix
it('first brief creates a lead anchor; second brief is a non-lead sibling', async () => {
  const trialId = await fx.createTrial(space.id);
  const a1 = await rpcUpsert({ anchorId: null, id: null, entityType: 'trial', entityId: trialId, state: 'published', headline: 'First', changeNote: null });
  const a2 = await rpcUpsert({ anchorId: null, id: null, entityType: 'trial', entityId: trialId, state: 'published', headline: 'Second', changeNote: null });
  const anchors = await svc.from('primary_intelligence_anchors').select('*').eq('entity_id', trialId).order('display_order');
  expect(anchors.data).toHaveLength(2);
  expect(anchors.data!.filter(a => a.is_lead)).toHaveLength(1);
  expect(anchors.data![0].is_lead).toBe(true);   // first stays lead
  expect(anchors.data![1].is_lead).toBe(false);
  expect(anchors.data![1].display_order).toBe(1);
});

it('two published briefs on the same entity are allowed (different anchors)', async () => {
  // both published from the test above succeeded -> assert two published versions exist
  const pub = await svc.from('primary_intelligence').select('id, anchor_id, state, version_number').eq('state','published');
  // each anchor's first publish is version 1 (independent numbering)
  expect(pub.data!.every(r => r.version_number === 1)).toBe(true);
});

it('republishing one brief archives only that anchor\'s prior published, needs change_note', async () => {
  const trialId = await fx.createTrial(space.id);
  const v1 = await rpcUpsert({ anchorId: null, id: null, entityType: 'trial', entityId: trialId, state: 'published', headline: 'A v1', changeNote: null });
  const anchorId = (await svc.from('primary_intelligence').select('anchor_id').eq('id', v1).single()).data!.anchor_id;
  await expect(rpcUpsert({ anchorId, id: null, entityType: 'trial', entityId: trialId, state: 'published', headline: 'A v2', changeNote: null }))
    .rejects.toThrow(/change_note required/);
  await rpcUpsert({ anchorId, id: null, entityType: 'trial', entityId: trialId, state: 'published', headline: 'A v2', changeNote: 'revised' });
  const rows = await svc.from('primary_intelligence').select('state, version_number').eq('anchor_id', anchorId).order('version_number');
  expect(rows.data!.map(r => r.state)).toEqual(['archived','published']);
  expect(rows.data!.map(r => r.version_number)).toEqual([1,2]);
});
```

`rpcUpsert` is a local helper that calls `svc.rpc('upsert_primary_intelligence', { p_id, p_anchor_id, p_space_id: space.id, p_entity_type, p_entity_id, p_headline, p_summary_md: '', p_implications_md: '', p_state, p_change_note, p_links: [] })`.

- [ ] **Step 2: Run the test, expect failure**

Run: `cd src/client && SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o json | jq -r .SERVICE_ROLE_KEY) npx vitest run integration/tests/intelligence-multi-briefs.spec.ts`
Expected: FAIL (RPC signature has no `p_anchor_id`).

- [ ] **Step 3: Write the migration** — base on the live `upsert_primary_intelligence` (`\sf`), then change:
  1. Drop the old 10-arg signature: `drop function if exists public.upsert_primary_intelligence(uuid,uuid,text,uuid,text,text,text,text,text,jsonb);`
  2. Add `p_anchor_id uuid` as the 2nd parameter.
  3. Resolve the anchor:

```sql
  declare
    v_anchor_id uuid := p_anchor_id;
    v_id uuid;
    v_has_any boolean;
  begin
    if not public.is_agency_member_of_space(p_space_id) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if p_state not in ('draft','published') then
      raise exception 'invalid state %', p_state using errcode = '22023';
    end if;
    if p_entity_type not in ('trial','company','product','space') then
      raise exception 'invalid entity_type %', p_entity_type using errcode = '22023';
    end if;

    -- resolve / create the anchor
    if v_anchor_id is null and p_id is not null then
      select anchor_id into v_anchor_id from public.primary_intelligence where id = p_id;
    end if;
    if v_anchor_id is null then
      select exists(
        select 1 from public.primary_intelligence_anchors
         where space_id = p_space_id and entity_type = p_entity_type and entity_id = p_entity_id
      ) into v_has_any;
      insert into public.primary_intelligence_anchors
        (space_id, entity_type, entity_id, is_lead, display_order, created_by)
      values (
        p_space_id, p_entity_type, p_entity_id,
        not v_has_any,                                   -- first brief is lead
        coalesce((select max(display_order)+1 from public.primary_intelligence_anchors
                   where space_id=p_space_id and entity_type=p_entity_type and entity_id=p_entity_id), 0),
        auth.uid()
      )
      returning id into v_anchor_id;
    end if;
```

  4. Replace the change-note/archive blocks to scope by `anchor_id`:

```sql
    if p_state = 'published' then
      if exists (
        select 1 from public.primary_intelligence
         where anchor_id = v_anchor_id
           and state in ('published','archived','withdrawn')
           and id is distinct from p_id
      ) and (p_change_note is null or length(trim(p_change_note)) = 0) then
        raise exception 'change_note required when republishing' using errcode = '22023';
      end if;
      update public.primary_intelligence
         set state = 'archived', archived_at = now()
       where anchor_id = v_anchor_id and state = 'published' and id is distinct from p_id;
    end if;
```

  5. Insert/update the version row with `anchor_id` instead of entity columns (insert column list: `anchor_id, state, headline, summary_md, implications_md, publish_note, published_by, last_edited_by`). Keep the links delete+reinsert and the trailing `return v_id;` unchanged.
  6. Re-issue revoke/grant for the new 11-arg signature and end with `notify pgrst, 'reload schema';`.

- [ ] **Step 4: Apply and run the test**

Run: `supabase db reset && cd src/client && SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o json | jq -r .SERVICE_ROLE_KEY) npx vitest run integration/tests/intelligence-multi-briefs.spec.ts`
Expected: PASS for the three cases.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260627120100_intelligence_upsert_anchor_aware.sql src/client/integration/tests/intelligence-multi-briefs.spec.ts
git commit -m "feat(db): anchor-aware upsert_primary_intelligence (many briefs per entity)"
```

---

## Task 3: Lead + order RPCs

**Files:**
- Create: `supabase/migrations/20260627120200_intelligence_lead_and_order_rpcs.sql`
- Test: append to `intelligence-multi-briefs.spec.ts`

**Interfaces:**
- Produces:
  - `set_intelligence_lead(p_anchor_id uuid) returns void` — agency-only; clears `is_lead` on sibling anchors, sets it here; rejects if the anchor has no published version.
  - `reorder_intelligence(p_space_id uuid, p_entity_type text, p_entity_id uuid, p_anchor_ids uuid[]) returns void` — agency-only; sets `display_order` by array position; rejects if the set != the entity's anchors.

- [ ] **Step 1: Write the tests first**

```ts
it('set_intelligence_lead flips the lead and keeps exactly one', async () => {
  const trialId = await fx.createTrial(space.id);
  const v1 = await rpcUpsert({ anchorId:null,id:null,entityType:'trial',entityId:trialId,state:'published',headline:'A',changeNote:null });
  const v2 = await rpcUpsert({ anchorId:null,id:null,entityType:'trial',entityId:trialId,state:'published',headline:'B',changeNote:null });
  const a2 = (await svc.from('primary_intelligence').select('anchor_id').eq('id', v2).single()).data!.anchor_id;
  await svc.rpc('set_intelligence_lead', { p_anchor_id: a2 }).throwOnError();
  const anchors = await svc.from('primary_intelligence_anchors').select('id,is_lead').eq('entity_id', trialId);
  expect(anchors.data!.filter(a => a.is_lead).map(a=>a.id)).toEqual([a2]);
});

it('set_intelligence_lead rejects a draft-only anchor', async () => {
  const trialId = await fx.createTrial(space.id);
  const d = await rpcUpsert({ anchorId:null,id:null,entityType:'trial',entityId:trialId,state:'draft',headline:'draft',changeNote:null });
  const aId = (await svc.from('primary_intelligence').select('anchor_id').eq('id', d).single()).data!.anchor_id;
  await expect(svc.rpc('set_intelligence_lead', { p_anchor_id: aId }).throwOnError())
    .rejects.toThrow(/no published version|not published/);
});

it('reorder_intelligence writes display_order and rejects a mismatched set', async () => {
  const trialId = await fx.createTrial(space.id);
  const v1 = await rpcUpsert({ anchorId:null,id:null,entityType:'trial',entityId:trialId,state:'published',headline:'A',changeNote:null });
  const v2 = await rpcUpsert({ anchorId:null,id:null,entityType:'trial',entityId:trialId,state:'published',headline:'B',changeNote:null });
  const ids = (await svc.from('primary_intelligence_anchors').select('id').eq('entity_id', trialId)).data!.map(a=>a.id);
  await svc.rpc('reorder_intelligence', { p_space_id: space.id, p_entity_type:'trial', p_entity_id: trialId, p_anchor_ids: [ids[1], ids[0]] }).throwOnError();
  const after = await svc.from('primary_intelligence_anchors').select('id,display_order').eq('entity_id', trialId).order('display_order');
  expect(after.data!.map(a=>a.id)).toEqual([ids[1], ids[0]]);
  await expect(svc.rpc('reorder_intelligence', { p_space_id: space.id, p_entity_type:'trial', p_entity_id: trialId, p_anchor_ids: [ids[0]] }).throwOnError())
    .rejects.toThrow(/anchor set/);
});
```

- [ ] **Step 2: Run, expect failure** (functions not defined).

- [ ] **Step 3: Write the migration**

```sql
-- migration: 20260627120200_intelligence_lead_and_order_rpcs

create or replace function public.set_intelligence_lead(p_anchor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anchor public.primary_intelligence_anchors%rowtype;
begin
  select * into v_anchor from public.primary_intelligence_anchors where id = p_anchor_id;
  if v_anchor.id is null then
    raise exception 'anchor % not found', p_anchor_id using errcode = 'P0002';
  end if;
  if not public.is_agency_member_of_space(v_anchor.space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.primary_intelligence
     where anchor_id = p_anchor_id and state = 'published'
  ) then
    raise exception 'cannot pin an anchor with no published version' using errcode = '22023';
  end if;

  update public.primary_intelligence_anchors
     set is_lead = false, updated_at = now()
   where space_id = v_anchor.space_id
     and entity_type = v_anchor.entity_type
     and entity_id = v_anchor.entity_id
     and is_lead
     and id <> p_anchor_id;

  update public.primary_intelligence_anchors
     set is_lead = true, updated_at = now()
   where id = p_anchor_id;
end;
$$;

create or replace function public.reorder_intelligence(
  p_space_id uuid, p_entity_type text, p_entity_id uuid, p_anchor_ids uuid[]
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected int;
  v_matched int;
begin
  if not public.is_agency_member_of_space(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select count(*) into v_expected from public.primary_intelligence_anchors
   where space_id = p_space_id and entity_type = p_entity_type and entity_id = p_entity_id;
  select count(*) into v_matched from public.primary_intelligence_anchors
   where space_id = p_space_id and entity_type = p_entity_type and entity_id = p_entity_id
     and id = any(p_anchor_ids);
  if v_expected <> array_length(p_anchor_ids, 1) or v_matched <> v_expected then
    raise exception 'anchor set does not match the entity''s anchors' using errcode = '22023';
  end if;

  update public.primary_intelligence_anchors a
     set display_order = ord.idx - 1, updated_at = now()
    from (select unnest(p_anchor_ids) as id, generate_subscripts(p_anchor_ids, 1) as idx) ord
   where a.id = ord.id;
end;
$$;

revoke execute on function public.set_intelligence_lead(uuid) from public, anon;
grant  execute on function public.set_intelligence_lead(uuid) to authenticated;
revoke execute on function public.reorder_intelligence(uuid, text, uuid, uuid[]) from public, anon;
grant  execute on function public.reorder_intelligence(uuid, text, uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Apply and run tests** — `supabase db reset && ...vitest run...` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260627120200_intelligence_lead_and_order_rpcs.sql src/client/integration/tests/intelligence-multi-briefs.spec.ts
git commit -m "feat(db): set_intelligence_lead + reorder_intelligence"
```

---

## Task 4: list_intelligence_for_entity

**Files:**
- Create: `supabase/migrations/20260627120300_list_intelligence_for_entity.sql`
- Test: append to `intelligence-multi-briefs.spec.ts`

**Interfaces:**
- Produces: `list_intelligence_for_entity(p_space_id uuid, p_entity_type text, p_entity_id uuid) returns jsonb` — ordered array (lead first, then `display_order`) of `{ anchor_id, is_lead, display_order, published, draft, author, updated_at, version_count }` where `published`/`draft` are `build_intelligence_payload`-shaped objects or null. SECURITY INVOKER so RLS hides draft-only anchors from viewers.

- [ ] **Step 1: Write the test first**

```ts
it('list_intelligence_for_entity returns briefs lead-first; viewer sees only published anchors', async () => {
  const trialId = await fx.createTrial(space.id);
  await rpcUpsert({ anchorId:null,id:null,entityType:'trial',entityId:trialId,state:'published',headline:'Lead',changeNote:null });
  await rpcUpsert({ anchorId:null,id:null,entityType:'trial',entityId:trialId,state:'draft',headline:'Draft only',changeNote:null });
  // agency sees both
  const agency = await asAgency.rpc('list_intelligence_for_entity', { p_space_id: space.id, p_entity_type:'trial', p_entity_id: trialId }).throwOnError();
  expect((agency.data as any[]).length).toBe(2);
  expect((agency.data as any[])[0].is_lead).toBe(true);
  // viewer sees only the published-bearing anchor
  const viewer = await asViewer.rpc('list_intelligence_for_entity', { p_space_id: space.id, p_entity_type:'trial', p_entity_id: trialId }).throwOnError();
  expect((viewer.data as any[]).length).toBe(1);
  expect((viewer.data as any[])[0].published).toBeTruthy();
});
```

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Write the migration** (reuse `build_intelligence_payload` per anchor; it already returns `to_jsonb(record)`-shaped data)

```sql
-- migration: 20260627120300_list_intelligence_for_entity
create or replace function public.list_intelligence_for_entity(
  p_space_id uuid, p_entity_type text, p_entity_id uuid
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(brief order by a.is_lead desc, a.display_order, a.created_at), '[]'::jsonb)
  from public.primary_intelligence_anchors a
  cross join lateral (
    select jsonb_build_object(
      'anchor_id', a.id,
      'is_lead', a.is_lead,
      'display_order', a.display_order,
      'published', (
        select to_jsonb(p) from public.primary_intelligence p
         where p.anchor_id = a.id and p.state = 'published' limit 1
      ),
      'draft', (
        select to_jsonb(p) from public.primary_intelligence p
         where p.anchor_id = a.id and p.state = 'draft'
         order by p.updated_at desc limit 1
      ),
      'updated_at', (
        select max(p.updated_at) from public.primary_intelligence p where p.anchor_id = a.id
      ),
      'version_count', (
        select count(*) from public.primary_intelligence p
         where p.anchor_id = a.id and p.state in ('published','archived','withdrawn')
      )
    ) as brief
  ) brief
  where a.space_id = p_space_id
    and a.entity_type = p_entity_type
    and a.entity_id = p_entity_id
    -- RLS on primary_intelligence_anchors already hides draft-only anchors
    -- from non-agency callers; this predicate keeps agency view complete.
    and (
      public.is_agency_member_of_space(p_space_id)
      or exists (select 1 from public.primary_intelligence p
                  where p.anchor_id = a.id and p.state = 'published')
    );
$$;

revoke execute on function public.list_intelligence_for_entity(uuid, text, uuid) from public, anon;
grant  execute on function public.list_intelligence_for_entity(uuid, text, uuid) to authenticated;
notify pgrst, 'reload schema';
```

(Note: `build_intelligence_payload`'s richer link/contributor resolution is used by the detail bundle in Task 5; this list RPC returns the lean per-brief shape the drawer needs. If the drawer needs resolved links inline, call into `build_intelligence_payload(...)` per published row instead of `to_jsonb(p)` — decide in Task 5 once the detail bundle shape is final and keep the two consistent.)

- [ ] **Step 4: Apply and run test.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260627120300_list_intelligence_for_entity.sql src/client/integration/tests/intelligence-multi-briefs.spec.ts
git commit -m "feat(db): list_intelligence_for_entity (brief drawer source)"
```

---

## Task 5: Detail bundle RPCs return briefs[]

**Files:**
- Create: `supabase/migrations/20260627120400_intelligence_detail_bundles_multi.sql`
- Test: append to `intelligence-multi-briefs.spec.ts`

**Interfaces:**
- Consumes: `list_intelligence_for_entity` (Task 4), `referenced_in_entity`, `build_intelligence_payload`.
- Produces: `get_trial_detail_with_intelligence(p_trial_id)`, `get_company_detail_with_intelligence(p_company_id)`, `get_asset_detail_with_intelligence(p_asset_id)`, `get_space_intelligence(p_space_id)` each return `{ space_id, entity_type, entity_id, briefs: <list_intelligence_for_entity output>, referenced_in: [...], authors: {...} }`. The `published`/`draft` top-level keys are removed.

- [ ] **Step 1: Write the test first**

```ts
it('get_trial_detail_with_intelligence returns briefs[] + referenced_in', async () => {
  const trialId = await fx.createTrial(space.id);
  await rpcUpsert({ anchorId:null,id:null,entityType:'trial',entityId:trialId,state:'published',headline:'X',changeNote:null });
  await rpcUpsert({ anchorId:null,id:null,entityType:'trial',entityId:trialId,state:'published',headline:'Y',changeNote:null });
  const res = await asAgency.rpc('get_trial_detail_with_intelligence', { p_trial_id: trialId }).throwOnError();
  const bundle = res.data as any;
  expect(bundle.entity_type).toBe('trial');
  expect(bundle.briefs).toHaveLength(2);
  expect(Array.isArray(bundle.referenced_in)).toBe(true);
  expect(bundle).not.toHaveProperty('published'); // old shape removed
});
```

- [ ] **Step 2: Run, expect failure** (bundle still has `published`/`draft`).

- [ ] **Step 3: Write the migration** — base each on its live `\sf` body. They currently build `{ space_id, entity_type, entity_id, published, draft, referenced_in }`. Replace the `published`/`draft` keys with:

```sql
  -- inside each get_*_detail_with_intelligence, replacing the published/draft build:
  'briefs', public.list_intelligence_for_entity(v_space_id, '<type>', p_<x>_id),
```

Keep `referenced_in` (via `referenced_in_entity`) and any `authors` map. For `get_space_intelligence`, entity is the space itself (`entity_type='space'`, `entity_id=p_space_id`). Preserve the access guard each RPC already has. End with `notify pgrst, 'reload schema';`.

Drop the vestigial `get_marker_detail_with_intelligence` (markers are not owners): `drop function if exists public.get_marker_detail_with_intelligence(uuid);` and remove it from the feature manifest in Task 8.

- [ ] **Step 4: Apply and run test.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260627120400_intelligence_detail_bundles_multi.sql src/client/integration/tests/intelligence-multi-briefs.spec.ts
git commit -m "feat(db): detail bundles return briefs[] instead of single published/draft"
```

---

## Task 6: History rescope + lifecycle (auto-promote, anchor cleanup)

**Files:**
- Create: `supabase/migrations/20260627120500_intelligence_history_and_lifecycle_multi.sql`
- Test: append to `intelligence-multi-briefs.spec.ts`

**Interfaces:**
- Produces:
  - `get_primary_intelligence_history(p_anchor_id uuid) returns jsonb` (signature changed from the entity triple to a single anchor id; same `{ current, draft, versions, events }` shape).
  - `withdraw_primary_intelligence` / `purge_primary_intelligence` / `delete_primary_intelligence` re-scoped to anchors, with lead auto-promotion and anchor cleanup. `purge`'s `p_purge_anchor` deletes the whole anchor.
  - Internal helper `_promote_next_intelligence_lead(p_space_id, p_entity_type, p_entity_id)` — if the entity has no lead anchor, set the most-recently-published anchor as lead.

- [ ] **Step 1: Write the tests first**

```ts
it('withdrawing the lead\'s only published version auto-promotes the next published anchor', async () => {
  const trialId = await fx.createTrial(space.id);
  const v1 = await rpcUpsert({ anchorId:null,id:null,entityType:'trial',entityId:trialId,state:'published',headline:'Lead',changeNote:null });
  const v2 = await rpcUpsert({ anchorId:null,id:null,entityType:'trial',entityId:trialId,state:'published',headline:'Other',changeNote:null });
  const leadAnchor = (await svc.from('primary_intelligence').select('anchor_id').eq('id', v1).single()).data!.anchor_id;
  const otherAnchor = (await svc.from('primary_intelligence').select('anchor_id').eq('id', v2).single()).data!.anchor_id;
  await svc.rpc('withdraw_primary_intelligence', { p_id: v1, p_change_note: 'pulled' }).throwOnError();
  const anchors = await svc.from('primary_intelligence_anchors').select('id,is_lead').eq('entity_id', trialId);
  expect(anchors.data!.filter(a=>a.is_lead).map(a=>a.id)).toEqual([otherAnchor]);
});

it('purge whole anchor removes anchor + versions; deleting a fresh draft removes its anchor', async () => {
  const trialId = await fx.createTrial(space.id);
  const d = await rpcUpsert({ anchorId:null,id:null,entityType:'trial',entityId:trialId,state:'draft',headline:'Solo draft',changeNote:null });
  const aId = (await svc.from('primary_intelligence').select('anchor_id').eq('id', d).single()).data!.anchor_id;
  await svc.rpc('delete_primary_intelligence', { p_id: d }).throwOnError();
  const left = await svc.from('primary_intelligence_anchors').select('id').eq('id', aId);
  expect(left.data).toHaveLength(0);
});

it('get_primary_intelligence_history is scoped to one anchor', async () => {
  const trialId = await fx.createTrial(space.id);
  const v1 = await rpcUpsert({ anchorId:null,id:null,entityType:'trial',entityId:trialId,state:'published',headline:'A',changeNote:null });
  await rpcUpsert({ anchorId:null,id:null,entityType:'trial',entityId:trialId,state:'published',headline:'B',changeNote:null });
  const aId = (await svc.from('primary_intelligence').select('anchor_id').eq('id', v1).single()).data!.anchor_id;
  const hist = await asAgency.rpc('get_primary_intelligence_history', { p_anchor_id: aId }).throwOnError();
  expect((hist.data as any).versions).toHaveLength(1); // only anchor A's versions
});
```

- [ ] **Step 2: Run, expect failure** (history signature still triple; no auto-promote).

- [ ] **Step 3: Write the migration**
  1. `drop function if exists public.get_primary_intelligence_history(uuid, text, uuid);` then recreate based on the live body, replacing the three-column WHERE in the `rows` CTE with `where p.anchor_id = p_anchor_id` and the access guard with one that resolves the space from the anchor (`select space_id from primary_intelligence_anchors where id = p_anchor_id`).
  2. Add `_promote_next_intelligence_lead(...)`:

```sql
create or replace function public._promote_next_intelligence_lead(
  p_space_id uuid, p_entity_type text, p_entity_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.primary_intelligence_anchors
     where space_id=p_space_id and entity_type=p_entity_type and entity_id=p_entity_id and is_lead
  ) then
    return;  -- a lead already stands
  end if;
  update public.primary_intelligence_anchors
     set is_lead = true, updated_at = now()
   where id = (
     select a.id from public.primary_intelligence_anchors a
      join public.primary_intelligence p on p.anchor_id = a.id and p.state = 'published'
     where a.space_id=p_space_id and a.entity_type=p_entity_type and a.entity_id=p_entity_id
     order by p.published_at desc nulls last
     limit 1
   );
end;
$$;
```

  3. Recreate `withdraw_primary_intelligence(p_id, p_change_note)` based on live body; after the withdraw UPDATE, resolve the anchor + entity from the row and, if the lead anchor now has no published version, clear `is_lead` and call `_promote_next_intelligence_lead(...)`. Concretely append:

```sql
  -- after withdraw: if this anchor was lead and now has no published version, demote + promote
  update public.primary_intelligence_anchors ana
     set is_lead = false, updated_at = now()
   where ana.id = v_row.anchor_id
     and ana.is_lead
     and not exists (select 1 from public.primary_intelligence p
                      where p.anchor_id = ana.id and p.state = 'published');
  perform public._promote_next_intelligence_lead(a.space_id, a.entity_type, a.entity_id)
    from public.primary_intelligence_anchors a where a.id = v_row.anchor_id;
```

  (Note `v_row` must capture `anchor_id`; select it explicitly since the row no longer has entity columns.)

  4. Recreate `delete_primary_intelligence(p_id)` based on live body (drafts-only + author/editor/owner gate). After deleting the draft row, drop the anchor if it now has zero version rows:

```sql
  delete from public.primary_intelligence_anchors a
   where a.id = v_anchor_id
     and not exists (select 1 from public.primary_intelligence p where p.anchor_id = a.id);
  perform public._promote_next_intelligence_lead(a.space_id, a.entity_type, a.entity_id)
    from public.primary_intelligence_anchors a where a.id = v_anchor_id;
```

  5. Recreate `purge_primary_intelligence(p_id, p_confirmation, p_purge_anchor)` based on live body. Scope the anchor-purge branch by `anchor_id`:

```sql
  if p_purge_anchor then
    delete from public.primary_intelligence_anchors where id = v_anchor_id;  -- versions cascade
  else
    delete from public.primary_intelligence where id = p_id;
    delete from public.primary_intelligence_anchors a
     where a.id = v_anchor_id
       and not exists (select 1 from public.primary_intelligence p where p.anchor_id = a.id);
  end if;
  perform public._promote_next_intelligence_lead(a.space_id, a.entity_type, a.entity_id)
    from public.primary_intelligence_anchors a where a.id = v_anchor_id;
```

  6. Check `user_redaction_rpc` (migration `20260521120100`): it does `delete from public.primary_intelligence where id = v_pi;`. After it, the anchor may be empty — leave the polymorphic/anchor cleanup to the cascade, but if redaction can remove a lead's published version, add a `_promote_next_intelligence_lead` call. Base on its live body; if PI deletion is incidental, a comment noting the lead may need promotion is sufficient (covered by the cleanup triggers on full-entity delete).
  7. End with `notify pgrst, 'reload schema';`.

- [ ] **Step 4: Apply and run tests.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260627120500_intelligence_history_and_lifecycle_multi.sql src/client/integration/tests/intelligence-multi-briefs.spec.ts
git commit -m "feat(db): per-anchor history + lead auto-promotion + anchor cleanup"
```

---

## Task 7: Feed `is_lead` + landscape presence (multi-brief)

**Files:**
- Create: `supabase/migrations/20260627120600_intelligence_feed_and_landscape_multi.sql`
- Test: append to `intelligence-multi-briefs.spec.ts`

**Interfaces:**
- Produces: `list_primary_intelligence(...)` feed rows gain `is_lead` and `anchor_id`; `get_dashboard_data` / `get_positioning_data` presence flags computed across anchors: `has_intelligence` (any published anchor), `intelligence_headline` (lead anchor's published headline, fallback most-recent published), `intelligence_count` (number of published anchors per entity).

- [ ] **Step 1: Write the test first**

```ts
it('landscape presence reflects the lead headline and counts published anchors', async () => {
  const trialId = await fx.createTrial(space.id);   // ensure it's on the dashboard
  await rpcUpsert({ anchorId:null,id:null,entityType:'trial',entityId:trialId,state:'published',headline:'Lead headline',changeNote:null });
  await rpcUpsert({ anchorId:null,id:null,entityType:'trial',entityId:trialId,state:'published',headline:'Second',changeNote:null });
  const dash = await asAgency.rpc('get_dashboard_data', { p_space_id: space.id }).throwOnError();
  const trialNode = findTrial(dash.data, trialId);   // helper that locates the trial row in the payload
  expect(trialNode.has_intelligence).toBe(true);
  expect(trialNode.intelligence_headline).toBe('Lead headline');
  expect(trialNode.intelligence_count).toBe(2);
});
```

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Write the migration** — base `list_primary_intelligence`, `get_dashboard_data`, `get_positioning_data` on their live `\sf` bodies (see `20260626170000_landscape_primary_intelligence_presence.sql` for the current presence subqueries). The current presence subquery joins `primary_intelligence` on the entity triple; rewrite to join through `primary_intelligence_anchors`:

```sql
-- has_intelligence (per trial t):
exists (
  select 1 from public.primary_intelligence_anchors a
  join public.primary_intelligence p on p.anchor_id = a.id and p.state='published'
  where a.space_id = <space> and a.entity_type='trial' and a.entity_id = t.id
) as has_intelligence,
-- intelligence_headline (lead, fallback most recent published):
(
  select p.headline
    from public.primary_intelligence_anchors a
    join public.primary_intelligence p on p.anchor_id = a.id and p.state='published'
   where a.space_id=<space> and a.entity_type='trial' and a.entity_id=t.id
   order by a.is_lead desc, p.published_at desc nulls last
   limit 1
) as intelligence_headline,
-- intelligence_count (published anchors):
(
  select count(distinct a.id)
    from public.primary_intelligence_anchors a
    join public.primary_intelligence p on p.anchor_id = a.id and p.state='published'
   where a.space_id=<space> and a.entity_type='trial' and a.entity_id=t.id
) as intelligence_count
```

For `list_primary_intelligence`, the `base` CTE currently selects `p.*` from `primary_intelligence` filtered by `space_id` + `state='published'`. Join the anchor for entity binding and `is_lead`:

```sql
  from public.primary_intelligence p
  join public.primary_intelligence_anchors a on a.id = p.anchor_id
  where a.space_id = p_space_id and p.state = 'published'
    and (p_entity_types is null or a.entity_type = any(p_entity_types))
    ...
```

and add `'entity_type', a.entity_type, 'entity_id', a.entity_id, 'anchor_id', a.id, 'is_lead', a.is_lead` to each row's jsonb (the row no longer has entity columns). Update `referenced_in_entity` and `get_intelligence_notes_for_asset` similarly — both currently read `primary_intelligence.entity_type/entity_id`; rebase them to join anchors. End with `notify pgrst, 'reload schema';`.

- [ ] **Step 4: Apply and run test + advisors.** Expected: PASS, advisors clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260627120600_intelligence_feed_and_landscape_multi.sql src/client/integration/tests/intelligence-multi-briefs.spec.ts
git commit -m "feat(db): feed is_lead + multi-anchor landscape presence flags"
```

---

## Task 8: Seed rewrite + grants + feature manifest + RLS test

**Files:**
- Create: `supabase/migrations/20260627120700_intelligence_seed_multi.sql`
- Modify: `supabase/data-api-grants.json`, `docs/runbook/features/primary-intelligence.md`
- Test: append RLS cases to `intelligence-multi-briefs.spec.ts`

- [ ] **Step 1: Write the RLS tests first**

```ts
it('viewer cannot see draft-only anchors or archived versions; non-member sees nothing', async () => {
  const trialId = await fx.createTrial(space.id);
  await rpcUpsert({ anchorId:null,id:null,entityType:'trial',entityId:trialId,state:'draft',headline:'Hidden draft',changeNote:null });
  // viewer: anchors table returns nothing for a draft-only entity
  const viewerAnchors = await asViewer.from('primary_intelligence_anchors').select('id').eq('entity_id', trialId);
  expect(viewerAnchors.data ?? []).toHaveLength(0);
  // non-member sees nothing
  const strangerAnchors = await asStranger.from('primary_intelligence_anchors').select('id').eq('entity_id', trialId);
  expect(strangerAnchors.data ?? []).toHaveLength(0);
});
```

- [ ] **Step 2: Run, expect failure** (only if Task 1 RLS is wrong; otherwise this passes — that is acceptable since RLS shipped in Task 1, this test pins it).

- [ ] **Step 3: Rewrite `_seed_demo_primary_intelligence`** — base on the live body (the 10-read seed from `20260512000000`). For each `insert into public.primary_intelligence (...)`, first insert a `primary_intelligence_anchors` row for that `(space, entity_type, entity_id)` and reference its id as `anchor_id` in the version insert; drop the `entity_type, entity_id` columns from the version insert. Mark each anchor `is_lead = true`. Delete the marker-anchored draft (Read 9) — markers are not owners now. **Add one second brief** on the SUMMIT trial (a second anchor, `is_lead=false`, `display_order=1`, published) so the demo shows the drawer with multiple entries. End with `notify pgrst, 'reload schema';` if any signature changed (the seed helper signature is unchanged, so not required). Restore the `_seed_demo_primary_intelligence` call in `supabase/seed.sql` if it was commented in Task 1.

- [ ] **Step 4: Add the anchors grant row** to `supabase/data-api-grants.json` (alphabetical position near `primary_intelligence`):

```json
    "primary_intelligence_anchors": {
      "authenticated": ["select"],
      "justification": "client: primary-intelligence.service reads anchors for cache invalidation and brief lists. Writes go through upsert_primary_intelligence / set_intelligence_lead / reorder_intelligence (SECURITY DEFINER); e2e fixtures use the service-role key."
    },
```

- [ ] **Step 5: Update the feature manifest** `docs/runbook/features/primary-intelligence.md`:
  - Add `primary_intelligence_anchors` to the `tables:` of the data-model, upsert, entity-bundle, and history capabilities.
  - Add the three new RPCs to capabilities: `set_intelligence_lead` + `reorder_intelligence` under a new `primary-intelligence-ordering` capability (role: agency), `list_intelligence_for_entity` under `primary-intelligence-entity-bundle`.
  - Remove `get_marker_detail_with_intelligence` from the entity-bundle capability (dropped in Task 5).
  - Update the prose "Data model" paragraph to describe anchors + many-briefs-per-entity.

- [ ] **Step 6: Run gates**

Run: `supabase db reset && cd src/client && npm run grants:check && npm run features:check && SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o json | jq -r .SERVICE_ROLE_KEY) npx vitest run integration/tests/intelligence-multi-briefs.spec.ts`
Expected: grants:check PASS (no missing/excess), features:check PASS (no rpc-unmapped), integration PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260627120700_intelligence_seed_multi.sql supabase/seed.sql supabase/data-api-grants.json docs/runbook/features/primary-intelligence.md src/client/integration/tests/intelligence-multi-briefs.spec.ts
git commit -m "feat(db): multi-brief seed + anchors grants + feature manifest + RLS test"
```

---

## Task 9: Frontend model

**Files:**
- Modify: `src/client/src/app/core/models/primary-intelligence.model.ts`

**Interfaces:**
- Produces: `PrimaryIntelligenceBrief`, updated `IntelligenceDetailBundle` (`briefs: PrimaryIntelligenceBrief[]`, no `published`/`draft`), `UpsertIntelligenceInput.anchor_id`.

- [ ] **Step 1: Add the Brief type and update the bundle**

```ts
/** One brief (anchor) with its current published/draft payloads. Matches
 *  one element of list_intelligence_for_entity / detail bundle `briefs[]`. */
export interface PrimaryIntelligenceBrief {
  anchor_id: string;
  is_lead: boolean;
  display_order: number;
  published: IntelligencePayload | null;
  draft: IntelligencePayload | null;
  updated_at: string | null;
  version_count: number;
}

export interface IntelligenceDetailBundle {
  space_id: string;
  entity_type: IntelligenceEntityType;
  entity_id: string;
  briefs: PrimaryIntelligenceBrief[];
  referenced_in: ReferencedInRow[];
  authors?: Record<string, string>;
}

export interface UpsertIntelligenceInput {
  id: string | null;
  anchor_id: string | null;   // null => create a new brief
  space_id: string;
  entity_type: IntelligenceEntityType;
  entity_id: string;
  headline: string;
  summary_md: string;
  implications_md: string;
  state: IntelligenceState;
  change_note: string | null;
  links: PrimaryIntelligenceLink[];
}
```

Add `anchor_id` to `IntelligenceFeedRow` (`anchor_id: string; is_lead: boolean;`). Add `is_lead` likewise.

- [ ] **Step 2: Build to typecheck**

Run: `cd src/client && npx tsc -p tsconfig.app.json --noEmit`
Expected: errors ONLY in consumers updated in Tasks 10-14 (service, components). That confirms the type change propagates.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/models/primary-intelligence.model.ts
git commit -m "feat(model): PrimaryIntelligenceBrief + briefs[] detail bundle"
```

---

## Task 10: Frontend service

**Files:**
- Modify: `src/client/src/app/core/services/primary-intelligence.service.ts`
- Test: `src/client/src/app/core/services/primary-intelligence.service.spec.ts`

**Interfaces:**
- Produces: `upsert(input)` sends `p_anchor_id`; `setLead(anchorId, spaceId, entityType, entityId)`; `reorder(spaceId, entityType, entityId, anchorIds)`; `loadHistory(anchorId, spaceId, entityType, entityId)`; detail getters return `briefs[]` bundles; delete/withdraw/purge read scope via the anchor.

- [ ] **Step 1: Write/adjust the unit test first** (the spec already tests the service against a mocked supabase client; add cases)

```ts
it('upsert sends p_anchor_id', async () => {
  rpcSpy.mockResolvedValue({ data: 'new-id', error: null });
  await service.upsert({ ...baseInput, anchor_id: 'anc-1' });
  expect(rpcSpy).toHaveBeenCalledWith('upsert_primary_intelligence', expect.objectContaining({ p_anchor_id: 'anc-1' }));
});

it('setLead calls set_intelligence_lead and invalidates the detail tag', async () => {
  rpcSpy.mockResolvedValue({ data: null, error: null });
  await service.setLead('anc-1', 'space-1', 'trial', 'trial-1');
  expect(rpcSpy).toHaveBeenCalledWith('set_intelligence_lead', { p_anchor_id: 'anc-1' });
  expect(invalidateSpy).toHaveBeenCalledWith(expect.arrayContaining(['trial:trial-1:detail']));
});
```

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement** — add `p_anchor_id: input.anchor_id` to the `upsert` rpc payload. Add methods:

```ts
async setLead(anchorId: string, spaceId: string, entityType: IntelligenceEntityType, entityId: string): Promise<void> {
  await this.supabase.client.rpc('set_intelligence_lead', { p_anchor_id: anchorId }).throwOnError();
  this.invalidateEntity(spaceId, entityType, entityId);
}
async reorder(spaceId: string, entityType: IntelligenceEntityType, entityId: string, anchorIds: string[]): Promise<void> {
  await this.supabase.client.rpc('reorder_intelligence', {
    p_space_id: spaceId, p_entity_type: entityType, p_entity_id: entityId, p_anchor_ids: anchorIds,
  }).throwOnError();
  this.invalidateEntity(spaceId, entityType, entityId);
}
```

Add a private `invalidateEntity(spaceId, entityType, entityId)` that centralizes the tag list currently duplicated across upsert/delete/withdraw/purge (DRY). Change `loadHistory` to take `anchorId` and call `get_primary_intelligence_history` with `{ p_anchor_id: anchorId }` (keep entityType/entityId params only for the cache tag). **Fix the broken column reads:** in `delete`/`withdraw`/`purge`, the `.from('primary_intelligence').select('space_id, entity_type, entity_id')` reads will 400 now (columns moved). Replace with a join to the anchor:

```ts
const { data: existing } = await this.supabase.client
  .from('primary_intelligence')
  .select('space_id, primary_intelligence_anchors!inner(entity_type, entity_id)')
  .eq('id', id)
  .single();
const ent = existing?.primary_intelligence_anchors as unknown as { entity_type: IntelligenceEntityType; entity_id: string } | undefined;
```

and use `ent?.entity_type` / `ent?.entity_id` for the tags. Detail getters keep the same RPC names; only the returned shape changed (no code change needed there since `data as IntelligenceDetailBundle`). Verify the cast shape matches Task 5's jsonb keys.

- [ ] **Step 4: Run tests + build.**

Run: `cd src/client && npx vitest run src/app/core/services/primary-intelligence.service.spec.ts && ng lint`
Expected: PASS, lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/services/primary-intelligence.service.ts src/client/src/app/core/services/primary-intelligence.service.spec.ts
git commit -m "feat(service): anchor-aware upsert + setLead/reorder + briefs[] bundles"
```

---

## Task 11: intelligence-brief-list presenter

**Files:**
- Create: `src/client/src/app/shared/components/intelligence-brief-list/intelligence-brief-list.component.{ts,html,spec.ts}`

**Interfaces:**
- Consumes: `PrimaryIntelligenceBrief[]` (the non-lead briefs).
- Produces: `<app-intelligence-brief-list [briefs]="..." [canManage]="..." (open)="..." (pin)="..." (reorderTo)="...">` — renders collapsed rows (headline + author + date + version_count), expandable in place; agency-only pin + drag handles.

- [ ] **Step 1: Write the component test first**

```ts
it('renders one collapsed row per brief and expands on click', async () => {
  const fixture = TestBed.createComponent(IntelligenceBriefListComponent);
  fixture.componentRef.setInput('briefs', [
    { anchor_id:'a1', is_lead:false, display_order:1, published:{ record:{ headline:'Row one' } }, draft:null, updated_at:'2026-06-01', version_count:1 },
  ] as any);
  fixture.componentRef.setInput('canManage', false);
  fixture.detectChanges();
  const row = fixture.nativeElement.querySelector('[data-testid="brief-row"]');
  expect(row.textContent).toContain('Row one');
});
```

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement** the standalone OnPush component (signals, `input()`/`output()`, native control flow, `bg-brand-*`, PrimeNG where needed). Collapsed row shows the published (or draft, agency) headline, author byline, updated date, and a "vN" chip when `version_count > 1`. Expansion toggles a signal per `anchor_id`. When `canManage()`, render a "Pin as lead" action (emits `pin`) and a drag handle (PrimeNG reorderable or CDK drag-drop emitting `reorderTo` with the new anchor-id order). Follow the empty-state-audit rules and copy ("entry").

- [ ] **Step 4: Run test + lint.** Expected: PASS, lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/shared/components/intelligence-brief-list/
git commit -m "feat(ui): intelligence-brief-list collapsed presenter"
```

---

## Task 12: Detail pages render lead + drawer of briefs

**Files:**
- Modify: trial/company/asset/engagement detail components + templates (the four hosts of `app-intelligence-block`).

**Interfaces:**
- Consumes: `IntelligenceDetailBundle.briefs` (Task 9), `intelligence-brief-list` (Task 11), service `setLead`/`reorder`/`upsert` (Task 10).

- [ ] **Step 1: Wire the lead + list** — in each detail component, derive from the bundle: `lead = briefs.find(b => b.is_lead) ?? briefs[0] ?? null`, `others = briefs.filter(b => b !== lead)`. Render `lead` via the existing `app-intelligence-block` (unchanged) and `others` via `app-intelligence-brief-list`. Add an agency-only **"Add brief"** action that opens the editor drawer in new-anchor mode (`anchor_id: null`). Wire `(pin)` -> `service.setLead(...)`, `(reorderTo)` -> `service.reorder(...)`, `(open)` -> open the drawer/expand. Header reads "Intelligence (N)".

- [ ] **Step 2: Update each component's drawer/edit affordance** to pass the brief's `anchor_id` when editing an existing brief and `null` when adding.

- [ ] **Step 3: Build + lint + manual smoke**

Run: `cd src/client && ng lint && ng build`
Expected: clean. Then exercise a trial detail page in the browser (lead expanded, others collapsed, add a second brief, pin it). Per the local-auth memory, inject the local Supabase session to skip OAuth.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/**/trial-detail* src/client/src/app/features/**/company-detail* src/client/src/app/features/**/asset-detail* src/client/src/app/features/**/engagement*
git commit -m "feat(ui): entity detail pages render lead brief + drawer of entries"
```

---

## Task 13: Compose dialog new-anchor mode

**Files:**
- Modify: `src/client/src/app/shared/components/intelligence-compose-dialog/intelligence-compose-dialog.component.ts`
- Test: its spec (create if absent)

- [ ] **Step 1: Write/adjust the test** — picking an entity emits a `ComposeTarget` with `anchorId: null` (always a new brief).

```ts
it('emits a new-anchor compose target', () => {
  const target = component.buildTarget('trial', 'trial-1');
  expect(target).toEqual({ entityType: 'trial', entityId: 'trial-1', anchorId: null });
});
```

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement** — extend `ComposeTarget` with `anchorId: string | null` (always `null` from the feed compose path) and thread it into the drawer open call so feed-composed briefs create a new anchor.

- [ ] **Step 4: Run test + lint.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/shared/components/intelligence-compose-dialog/
git commit -m "feat(ui): compose dialog always creates a new brief (anchor)"
```

---

## Task 14: History panel keyed by anchor

**Files:**
- Modify: `src/client/src/app/shared/components/intelligence-history-panel/*`

- [ ] **Step 1: Update inputs** — the panel takes an `anchorId` (plus spaceId/entityType/entityId for the cache tag) and calls `service.loadHistory(anchorId, ...)`. On detail pages, mount one history affordance per brief (or per the lead, with each collapsed brief exposing its own history). Keep the existing timeline/diff rendering unchanged (the `{ current, draft, versions, events }` shape is the same).

- [ ] **Step 2: Build + lint + a unit test** asserting `loadHistory` is called with the anchor id.

Run: `cd src/client && ng lint && ng build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/shared/components/intelligence-history-panel/
git commit -m "feat(ui): history panel keyed by anchor (per brief)"
```

---

## Task 15: E2E coverage

**Files:**
- Create: `src/client/e2e/intelligence-multi-briefs.spec.ts`

- [ ] **Step 1: Write the e2e spec** (service-role fixtures per the existing `intelligence-crud.spec.ts` pattern; local-auth session injection per memory). Cover: detail page renders lead expanded + a collapsed second brief; add-brief flow creates a new entry; pin promotes a brief to lead (it moves to the top and expands); per-brief history opens; empty-state shows "Add primary intelligence".

- [ ] **Step 2: Run the spec.**

Run: `cd src/client && npx playwright test e2e/intelligence-multi-briefs.spec.ts`
Expected: PASS (cold-start `toBeVisible` flake is known; re-run once before treating a timeout as real; CI is canonical).

- [ ] **Step 3: Commit**

```bash
git add src/client/e2e/intelligence-multi-briefs.spec.ts
git commit -m "test(e2e): multi-brief drawer, add, pin, history"
```

---

## Task 16: Docs regen + final verification

**Files:**
- Modify: runbook (`docs/runbook/07-database-schema.md` prose, `06-backend-architecture.md` prose), help page if one exists for intelligence, regen auto-gen blocks.
- Update: `.claude/hooks/runbook-review-guard.sh` `helpRules` if a help page maps to `primary_intelligence_anchors`.

- [ ] **Step 1: Regenerate architecture docs**

Run: `cd src/client && npm run docs:arch`
Expected: the ER diagram in `07-database-schema.md` now includes `primary_intelligence_anchors` and the `anchor_id` FK; the RPC->table matrix in `06-backend-architecture.md` lists the new RPCs. Hand-write surrounding prose describing many-briefs-per-entity (outside the AUTO-GEN markers).

- [ ] **Step 2: Full verification sweep**

Run:
```bash
supabase db reset
supabase db advisors --local --type all
cd src/client && ng lint && ng build && npm run grants:check && npm run features:check
SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o json | jq -r .SERVICE_ROLE_KEY) npx vitest run integration/tests/intelligence-multi-briefs.spec.ts
npx vitest run src/app/core/services/primary-intelligence.service.spec.ts src/app/shared/components/intelligence-brief-list/intelligence-brief-list.component.spec.ts
```
Expected: all green; advisors no new ERROR/WARN; grants/features pass.

- [ ] **Step 3: Commit**

```bash
git add docs/ src/client/ .claude/hooks/runbook-review-guard.sh
git commit -m "docs: multi-intelligence-briefs runbook + arch regen"
```

---

## Self-review (author checklist — completed)

- **Spec coverage:** anchors table + re-key (T1), upsert (T2), lead/order (T3), list (T4), detail bundles (T5), history+lifecycle+auto-promote (T6), feed+landscape (T7), seed+grants+manifest+RLS (T8), model (T9), service (T10), brief-list (T11), detail pages (T12), compose (T13), history panel (T14), e2e (T15), docs (T16). G1 (cascade) in T1+T6; G2 (lead invariants) in T3+T6; G3 (anchor cleanup) in T6; G4 (reorder validation) in T3; G5 (terminology) in T8+T11+T12. Every spec test-matrix row maps to a `it(...)` in T2-T8.
- **Type consistency:** `PrimaryIntelligenceBrief` (T9) is consumed identically in service (T10), brief-list (T11), detail pages (T12). RPC names match across migrations and service: `set_intelligence_lead`, `reorder_intelligence`, `list_intelligence_for_entity`, `upsert_primary_intelligence` (11-arg), `get_primary_intelligence_history(p_anchor_id)`.
- **Gotchas embedded:** base-on-live-def, notify pgrst, jsonb shape diff, grants/features ERROR gates, integration env var, db-reset-not-hand-apply — all in Global Constraints and referenced per task.
