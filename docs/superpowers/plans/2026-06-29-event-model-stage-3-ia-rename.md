# Event Model Stage 3: IA Rename, Merged Event Form, Taxonomy Admin - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the user-facing surface match the unified event model the cutover already shipped: rename routes/labels/code off the retired "catalyst"/"marker" vocabulary, split the Events page into authored-events surfaces + a read-only Activity page, ship one merged Event authoring form, and fold the glyph taxonomy into the Taxonomies settings screen.

**Architecture:** Frontend-heavy Angular 19 work over a stable data model. Two small DB migrations only (a `get_catalyst_detail -> get_event_detail` RPC rename, and the D2 taxonomy name-uniqueness constraints). Everything else is route/component/service/copy edits guarded by a committed rename-guard test, plus a new merged form built from the cutover's `create_event`/`update_event`/`update_event_sources`/`event_sources` contract.

**Tech Stack:** Angular 19 (standalone components, signals), PrimeNG, Tailwind v4, Supabase (Postgres + RPCs), Vitest (`npm run test:units`), Playwright (e2e), local Supabase for integration.

**Source spec:** `docs/superpowers/specs/2026-06-28-event-model-stage-3-ia-rename.md` (read it before starting; this plan implements it section-for-section).

## Global Constraints

- No emojis, no em dashes (`-`/`,`/`:` only), no Claude attribution anywhere (copy, code comments, commits, PR bodies).
- Branch from the **post-merge develop** (after the cutover + timeline-grid-redesign land), not from `feat/event-model`. See Task 0.
- Tests pair with each behavior-bearing task; no trailing "tests phase". Run unit tests with `npm run test:units` (never bare `vitest run`).
- Integration specs run in isolation against local Supabase; schema is applied via `supabase db reset` (the local DB is shared across worktrees).
- Audit fields (`created_by`/`updated_by`/timestamps) are server-side only (DB triggers); never client-supplied.
- Theme: Tailwind `*-brand-*` utilities, never `*-teal-*`; data colors (slate/red/amber/green/cyan/violet) stay hard-coded.
- After any change to `supabase/migrations/`, `app.routes.ts`, or `package.json`, run `npm run docs:arch` (from `src/client/`) and commit the regen in the same task.
- Provenance values are `actual > company > primary > forecasted` (label "Forecasted"); significance is `high`/`low`. Never reintroduce `stout`/`estimate`/`catalyst` user-facing tokens.
- Do NOT push or open a PR without explicit user go-ahead. Commit per task; the user merges.

---

## Task 0: Drift reconciliation pre-flight (no code)

The line numbers and a few file shapes in this plan are a snapshot of `feat/event-model` at 2026-06-29, before the cutover finished and before the timeline-grid-redesign merge. Re-anchor before writing any code.

**Files:** none modified; this is verification only.

- [ ] **Step 1: Confirm the base is merged and stable**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2
git fetch origin
git log origin/develop -1 --oneline
# Confirm the cutover landed:
git merge-base --is-ancestor feat/event-model origin/develop && echo "cutover ON develop" || echo "STOP: cutover not merged yet"
# Confirm the timeline redesign landed (its grid files are present):
git -C <worktree> grep -l "indent ladder\|grid UX redesign" src/client/src/app/features/dashboard/grid 2>/dev/null
```
Expected: cutover is on develop. If not, STOP and wait (per the spec, Stage 3 builds on the merged base).

- [ ] **Step 2: Create the Stage 3 implementation worktree off the merged develop**

```bash
git worktree add -b feat/event-model-stage-3 .worktrees/event-model-stage-3-impl origin/develop
cd .worktrees/event-model-stage-3-impl/src/client
ln -s ../../../../src/client/node_modules node_modules   # worktrees lack node_modules
npm run test:units -- --run 2>&1 | tail -5                # sanity: suite is green on the base
```

- [ ] **Step 3: Re-grep every rename target against the live base and correct this plan's line numbers**

```bash
cd .worktrees/event-model-stage-3-impl
F=src/client/src/app
grep -nE "catalysts|'events'|activityRedirect|marker-types|marker-categories|future-events|'activity'" $F/app.routes.ts
grep -rnE "Future Catalysts|'catalysts'|'events'|Marker Types|Markers guide" $F/core/layout $F/features 2>/dev/null | head -60
grep -rn "update_event_links\|updateLinks" $F 2>/dev/null   # MUST be gone post-cutover; if present, the cutover did not remove it (see Task 1 note)
```
Update the `:line` references in Tasks 2-15 to match what you find. Do not trust the 2026-06-29 numbers blindly.

- [ ] **Step 4: Commit nothing; record the reconciled baseline**

Write the corrected line numbers into a scratch note (`docs/notes/stage-3-baseline-<date>.md`) so later tasks reference a single reconciled source. Commit that note.

```bash
git add docs/notes/stage-3-baseline-*.md
git commit -m "docs(notes): Stage 3 reconciled baseline line anchors"
```

> **Note on `update_event_links`:** the cutover's own review found `event-form.component.ts` calls `eventService.updateLinks()` (-> the dead `update_event_links` RPC -> dropped `event_links` table) unconditionally on every event edit. The cutover should remove that before merge. If Step 3 shows it still present on develop, fix it as the first sub-step of Task 9 (the merged form drops pairwise links anyway): delete the `updateLinks` call + the `event.service.ts` `updateLinks` method + its spec, and confirm the suite stays green.

---

## Phase 1: Database (two migrations)

### Task 1: Rename `get_catalyst_detail` RPC to `get_event_detail`

**Files:**
- Create: `supabase/migrations/<ts>_rename_get_catalyst_detail_to_get_event_detail.sql`
- Modify (frontend caller): `src/client/src/app/core/services/catalyst.service.ts` (renamed in Task 7; for now repoint the RPC name + cache tag)
- Test: in-migration smoke block + `src/client/src/app/core/services/catalyst.service.spec.ts`

**Interfaces:**
- Produces: SQL function `public.get_event_detail(p_event_id uuid)` with the identical signature/return of the old `get_catalyst_detail`; the old name is dropped.

- [ ] **Step 1: Capture the current definition** so the rename preserves the body verbatim.

```bash
infisical run --env dev --path /supabase -- psql "$SUPABASE_DEV_DB_POOLER_URL" \
  -c "select pg_get_functiondef('public.get_catalyst_detail'::regproc);" > /tmp/get_catalyst_detail.sql
```

- [ ] **Step 2: Write the migration** (rename via new fn + drop old; reuse the captured body). End with a PostgREST reload so the app does not 404 the new name.

```sql
-- Rename get_catalyst_detail -> get_event_detail (Stage 3 IA rename).
-- Body copied verbatim from pg_get_functiondef (see /tmp capture); only the name changes.
create or replace function public.get_event_detail(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- <PASTE THE CAPTURED BODY HERE, renaming only the function header and any self-reference>
$$;

drop function if exists public.get_catalyst_detail(uuid);

-- in-migration smoke: the new fn resolves and returns for a seeded event
do $$
declare v_id uuid;
begin
  select id into v_id from public.events limit 1;
  if v_id is not null then
    perform public.get_event_detail(v_id);
  end if;
end $$;

notify pgrst, 'reload schema';
```

- [ ] **Step 3: Apply locally and verify**

```bash
supabase db reset 2>&1 | tail -20
infisical run --env dev --path /supabase -- true   # (local) confirm fn exists:
psql "$LOCAL_DB_URL" -c "select 'get_event_detail'::regproc;" && psql "$LOCAL_DB_URL" -c "select 'get_catalyst_detail'::regproc;" 2>&1 | grep -q "does not exist" && echo OK
```
Expected: `get_event_detail` resolves; `get_catalyst_detail` does not exist.

- [ ] **Step 4: Repoint the caller + cache tag** in `catalyst.service.ts`:

```ts
// was: .rpc('get_catalyst_detail', { p_event_id: id })
const { data } = await this.supabase.client.rpc('get_event_detail', { p_event_id: id });
// cache tag: was `catalyst:${id}:detail` -> `event:${id}:detail`
```

- [ ] **Step 5: Update the service spec** to assert the new RPC name + cache tag, run it.

```bash
cd src/client && npm run test:units -- --run core/services/catalyst.service.spec.ts
```
Expected: PASS (asserts `rpc` called with `'get_event_detail'`).

- [ ] **Step 6: Map the RPC in the feature manifest** (so `features:check` stays green). Find the manifest mapping `get_catalyst_detail` and rename it to `get_event_detail`; remove the dead `get_key_catalysts` mapping.

```bash
grep -rn "get_catalyst_detail\|get_key_catalysts" src/client/scripts ../../docs ../../supabase 2>/dev/null
cd src/client && npm run features:check
```
Expected: PASS, no unmapped RPC.

- [ ] **Step 7: Regenerate arch docs + commit**

```bash
cd src/client && npm run docs:arch
git add supabase/migrations src/client/src/app/core/services/catalyst.service.* docs/runbook *features-manifest*
git commit -m "feat(events): rename get_catalyst_detail RPC to get_event_detail"
```

### Task 2: D2 taxonomy name-uniqueness migration

**Files:**
- Create: `supabase/migrations/<ts>_event_taxonomy_name_uniqueness.sql`
- Test: in-migration smoke block + integration spec `supabase/tests/` (or the project's integration harness) asserting the constraint behavior

**Interfaces:**
- Produces: `unique(space_id, name)` + partial unique index `where space_id is null` on both `public.event_types` and `public.event_type_categories`.

- [ ] **Step 1: Write the migration**

```sql
-- D2: restore taxonomy name-uniqueness dropped during the cutover.
-- Space-scoped uniqueness (NULLs are distinct, so system rows are NOT deduped by this):
alter table public.event_types
  add constraint event_types_space_name_key unique (space_id, name);
alter table public.event_type_categories
  add constraint event_type_categories_space_name_key unique (space_id, name);

-- System rows live at space_id IS NULL; a partial unique index dedups them:
create unique index event_types_system_name_key
  on public.event_types (name) where space_id is null;
create unique index event_type_categories_system_name_key
  on public.event_type_categories (name) where space_id is null;

-- in-migration smoke: a duplicate custom name in the same space is rejected; a custom name
-- reusing a system name (different space_id) is allowed.
do $$
declare v_space uuid;
begin
  select id into v_space from public.spaces limit 1;
  if v_space is not null then
    begin
      insert into public.event_type_categories (space_id, name) values (v_space, '__dup_smoke__');
      insert into public.event_type_categories (space_id, name) values (v_space, '__dup_smoke__');
      raise exception 'expected duplicate-name rejection, got none';
    exception when unique_violation then
      null; -- expected
    end;
    delete from public.event_type_categories where space_id = v_space and name = '__dup_smoke__';
  end if;
end $$;
```

- [ ] **Step 2: Apply + advisors**

```bash
supabase db reset 2>&1 | tail -20
supabase db advisors --local --type all
```
Expected: reset succeeds (smoke passes); advisors show no new warnings (additive indexes/constraints).

- [ ] **Step 3: Integration spec** for the constraint + the system-vs-custom rule (run in isolation):

```ts
// asserts: duplicate custom name in one space -> 23505; custom name == a system name (diff space) -> ok;
// two system rows same name -> blocked by the partial index.
```

- [ ] **Step 4: Regen + commit**

```bash
cd src/client && npm run docs:arch
git add supabase/migrations supabase/tests docs/runbook
git commit -m "feat(events): restore event taxonomy name-uniqueness (D2)"
```

---

## Phase 2: Routes, redirects, and the rename guard

### Task 3: Route renames + redirects

**Files:**
- Modify: `src/client/src/app/app.routes.ts` (catalysts ~:338, activity guard ~:361, marker-types ~:429, marker-categories ~:437, events ~:485 - reconfirm via Task 0)
- Delete: `src/client/src/app/core/guards/activity-redirect.guard.ts` (+ its spec) once `/activity` renders directly
- Test: `src/client/src/app/app.routes.spec.ts`

**Interfaces:**
- Produces: live routes `future-events`, `activity` (renders the Activity page), `settings/taxonomies` (already exists); redirects from `catalysts`, `events`, `settings/marker-types`, `settings/marker-categories`.

- [ ] **Step 1: Write failing route tests** in `app.routes.spec.ts` asserting the new segments resolve and the old ones redirect:

```ts
it('redirects /catalysts -> /future-events preserving query', () => {
  // resolve the route config; assert redirectTo on the 'catalysts' path = 'future-events'
});
it('serves the Activity page at /activity without the redirect guard', () => {
  // assert the 'activity' route loadComponent points at the activity page, canActivate has no activityRedirectGuard
});
it('redirects settings/marker-types -> settings/taxonomies?tab=event-types', () => { /* ... */ });
```

- [ ] **Step 2: Run, verify they fail**

```bash
cd src/client && npm run test:units -- --run app.routes.spec.ts
```
Expected: FAIL.

- [ ] **Step 3: Edit `app.routes.ts`:**
  - `path: 'catalysts'` -> `path: 'future-events'` (loadComponent dir updated in Task 7).
  - Add `{ path: 'catalysts', redirectTo: 'future-events', pathMatch: 'full' }` (and preserve `?markerId=` -> `?eventId=` via the alias in Task 5).
  - `path: 'activity'` -> remove `canActivate: [activityRedirectGuard]`, point `loadComponent` at the Activity page (Task 8).
  - `path: 'events'` -> add redirect to `activity` for the detected case; keep an authored-event deep-link resolver per spec 1.1.
  - `settings/marker-types` / `settings/marker-categories` -> redirects to `settings/taxonomies?tab=event-types|event-categories`.

- [ ] **Step 4: Delete `activity-redirect.guard.ts` + spec**; remove its import (line ~15).

- [ ] **Step 5: Run route tests + full unit suite**

```bash
cd src/client && npm run test:units -- --run app.routes.spec.ts && npm run test:units -- --run
```
Expected: PASS.

- [ ] **Step 6: docs:arch (routes changed) + commit**

```bash
cd src/client && npm run docs:arch
git add src/client/src/app/app.routes.ts src/client/src/app/app.routes.spec.ts src/client/src/app/core/guards docs/runbook
git commit -m "feat(routes): rename catalysts->future-events, events->activity; add redirects"
```

### Task 4: The committed rename-guard test

**Files:**
- Create: `src/client/src/app/core/testing/rename-guard.spec.ts`
- Test: itself (a guard spec)

**Interfaces:**
- Produces: a CI-enforced assertion that no user-facing `catalyst` string and no retired route segment survives, while data-layer `events` is allowed.

- [ ] **Step 1: Write the guard spec** implementing the spec Section 5 method (exact-quoted-token grep across ALL of `src/client/src`, no folder exclusion, line-by-line, array-segment forms, `events` route-vs-data discrimination):

```ts
import { readFileSync } from 'node:fs';
import { globSync } from 'glob';

const files = globSync('src/client/src/**/*.{ts,html}', { ignore: ['**/*.spec.ts'] });

it('no user-facing catalyst tokens remain', () => {
  const hits: string[] = [];
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/['"]catalysts?['"]/.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  expect(hits, hits.join('\n')).toEqual([]);
});

it('no route/nav use of the retired "events" path segment', () => {
  // allow data-layer: table name `events`, event.model, rpc args. Flag routerLink arrays + path:'events'.
  const hits: string[] = [];
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/path:\s*['"]events['"]/.test(line)) hits.push(`${f}:${i + 1}`);
      if (/\[[^\]]*['"]events['"][^\]]*\]/.test(line) && /\/t['"]|routerLink/.test(line)) hits.push(`${f}:${i + 1}`);
    });
  }
  expect(hits, hits.join('\n')).toEqual([]);
});

it('no retired marker-types / marker-categories route segments', () => { /* /['"]marker-(types|categories)['"]/ */ });
```

- [ ] **Step 2: Run it** (it will fail until Tasks 5-9 finish the renames):

```bash
cd src/client && npm run test:units -- --run core/testing/rename-guard.spec.ts
```
Expected: FAIL initially (lists remaining hits). This is the working checklist for Tasks 5-9.

- [ ] **Step 3: Commit the guard** (red is expected; it goes green as renames land):

```bash
git add src/client/src/app/core/testing/rename-guard.spec.ts
git commit -m "test(events): committed rename-guard for the Stage 3 IA rename"
```

### Task 5: RouterLink arrays, string URLs, and the `markerId`->`eventId` alias

**Files (reconfirm via Task 0 grep):**
- Modify: `engagement-landing.component.ts` (~:183,195,213,223,433), `seed-demo.component.ts` (~:47), `competitive-read-strip.component.ts` (~:198), `change-event-row.component.ts` (~:61), `palette-command.registry.ts` (~:56), `command-palette.component.ts` (~:231)
- Test: the rename-guard spec (Task 4) + a redirect/alias spec in `app.routes.spec.ts`

- [ ] **Step 1: Add a failing alias test** asserting `/future-events?markerId=X` resolves as `eventId=X` for one release:

```ts
it('accepts legacy ?markerId= and treats it as ?eventId=', () => { /* resolver/guard maps markerId -> eventId */ });
```

- [ ] **Step 2: Replace every array segment + string URL** `'catalysts'` -> `'future-events'` and `?markerId=` -> `?eventId=` at the sites above. Implement the alias (a small resolver or the Future Events page reading both params, preferring `eventId`).

- [ ] **Step 3: Run the rename-guard + alias tests**

```bash
cd src/client && npm run test:units -- --run app.routes.spec.ts core/testing/rename-guard.spec.ts
```
Expected: the catalyst-token guard and alias test PASS for these files.

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(nav): repoint catalyst routerLinks to future-events; markerId->eventId alias"
```

---

## Phase 3: Nav, copy, and the catalyst code surface

### Task 6: Nav / topbar / breadcrumb maps + user-facing copy

**Files (reconfirm):** `core/layout/sidebar-nav.ts` (:61,79,107-111,126), `app-shell.component.ts` (:489,510,568-571,593,638,639,641,804), `sidebar.component.ts` (:631), `landscape-shell.component.ts` (:62,248), `landscape.model.ts` (:325), `icon-rail.component.ts`; copy in `catalysts-page.component.{ts,html}`, `catalyst-table.component.ts`, `competitive-read-strip.component.ts`, `view-clauses.ts`, `palette-result-row.component.ts`, `bullseye-detail-panel.component.html`, plus specs.

- [ ] **Step 1: Update the relevant component specs first** (assert the new strings): nav label specs, topbar title-map specs. Run, watch them fail.
- [ ] **Step 2: Apply the rename table** from spec Sections 1.2 and 1.6 verbatim (`Future Catalysts`->`Future Events`, `Events`->`Activity` nav, retire `Marker Types` item, `Markers guide`->`Event glyphs guide`, value `catalysts`->`future-events`, all copy literals). Count units: `X event(s)`; Intelligence keeps `entry/entries`; landscape strip stays `At a glance`.
- [ ] **Step 3: bullseye-detail-panel** `Recent markers`->`Recent events` and add the symmetric `Upcoming events` list (per parent spec).
- [ ] **Step 4: Run specs + rename guard**

```bash
cd src/client && npm run test:units -- --run && npm run test:units -- --run core/testing/rename-guard.spec.ts
```
Expected: PASS (no `Future Catalysts`/`Events` nav/`Marker Types` strings).

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(nav): rename nav/topbar/breadcrumb + copy to Event vocabulary"
```

### Task 7: Catalyst code-surface rename (dir / files / model / service)

**Files:** `features/catalysts/` -> `features/future-events/`; rename `catalysts-page.*`->`future-events-page.*`, `catalyst-table.*`->`event-table.*`, `catalyst-row-tooltip.*`->`event-row-tooltip.*`, `catalysts-export.util.*`->`events-export.util.*`, `group-catalysts.*`->`group-events.*`, `core/models/catalyst.model.ts`->`core/models/event-detail.model.ts`, `core/services/catalyst.service.ts`->`core/services/event-detail.service.ts` (+ all specs). Update all imports.

- [ ] **Step 1: `git mv` each file/dir** (preserves history; stage the moves):

```bash
git mv src/client/src/app/features/catalysts src/client/src/app/features/future-events
git mv src/client/src/app/features/future-events/catalysts-page.component.ts src/client/src/app/features/future-events/future-events-page.component.ts
# ...repeat for each file; then class renames inside.
```

- [ ] **Step 2: Rename classes/symbols** (`CatalystsPageComponent`->`FutureEventsPageComponent`, `CatalystService`->`EventDetailService`, etc.) and fix every import across the app.

```bash
grep -rln "CatalystsPageComponent\|CatalystService\|catalyst.model\|catalysts-export\|group-catalysts" src/client/src
```

- [ ] **Step 3: Keep `marker-*` glyph primitives untouched** (`MarkerIconComponent`, `marker-visual.ts`, `GLYPH_RATIOS`, `hexagon-icon.component`) - internal names survive per spec.
- [ ] **Step 4: Run full unit suite + build + rename guard**

```bash
cd src/client && npm run test:units -- --run && ng build && npm run test:units -- --run core/testing/rename-guard.spec.ts
```
Expected: PASS; build clean.

- [ ] **Step 5: Commit** (verify the moves carried edits, not pure renames - `git show HEAD --stat`):

```bash
git commit -am "refactor(events): rename catalyst code surface to future-events/event-detail"
```

---

## Phase 4: Events -> Activity split

### Task 8: Activity page (read-only detected changes)

**Files:** Create `src/client/src/app/features/activity/activity-page.component.{ts,html}` (+ spec); retire `features/events/events-page.component.*` as a browse surface (its authored-events role moves to the feed/profile per spec Section 2). Reuse `change-event.service.ts` / `get_activity_feed`.

**Interfaces:**
- Consumes: `get_activity_feed` over `trial_change_events` (the cutover's read RPC).
- Produces: `ActivityPageComponent` at `/activity`, read-only, no "Log event" button.

- [ ] **Step 1: Write the failing component spec** - renders detected changes only, no authored events, no create button, read-only:

```ts
it('renders only detected changes and exposes no Log event control', () => { /* ... */ });
```

- [ ] **Step 2: Build `ActivityPageComponent`** reading `get_activity_feed` (CT.gov diffs + analyst event-edit history from `trial_change_events`). Do NOT read `event_changes` (that is the per-event audit log, not Activity - spec Section 2).
- [ ] **Step 3: Wire `/activity` loadComponent** (Task 3 already removed the redirect guard).
- [ ] **Step 4: Run spec + e2e smoke**

```bash
cd src/client && npm run test:units -- --run features/activity
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(activity): read-only Activity page at /activity (events->activity split)"
```

---

## Phase 5: Merged Event authoring form

### Task 9: Merged Event form component (create + edit, single anchor)

**Files:** Create `src/client/src/app/features/events/event-form/event-form.component.{ts,html}` as the single merged form (absorbs the old `marker-form.component` and `events/event-form.component`); a reusable dialog wrapper so every entry point opens the same component. Delete the old `marker-form.component` + old `event-form.component` after parity. Test: `event-form.component.spec.ts` + a pure payload-builder spec.

**Interfaces:**
- Consumes: `create_event(space_id, payload, p_sources jsonb)`, `update_event(id, payload)`, `update_event_sources(id, sources)` (cutover contract); `event_types` grouped by `event_type_categories`.
- Produces: `EventFormComponent` (signals-based), `buildEventPayload(form): EventPayload` pure fn, `buildSourcesPayload(rows): SourceRow[]`.

- [ ] **Step 0 (if Task 0 Step 3 found it): remove the dead `updateLinks` path** (see Task 0 note) and confirm the suite stays green.

- [ ] **Step 1: Write the payload-builder unit spec** (pure logic, no DB) covering the spec Section 3.2 field map + Section 3.3 rules:

```ts
import { buildEventPayload } from './event-payload';

it('maps anchor Level=trial to anchor_type/anchor_id', () => {
  expect(buildEventPayload({ level: 'trial', entityId: 'T1', /*...*/ }))
    .toMatchObject({ anchor_type: 'trial', anchor_id: 'T1' });
});
it('Significance "Default" stores null; "High"/"Low" set the value', () => {
  expect(buildEventPayload({ significance: 'Default', /*...*/ }).significance).toBeNull();
});
it('Extent=onwards sets is_ongoing=true and no end_date; Extent=until requires end_date', () => { /* ... */ });
it('Provenance options are actual|company|primary|forecasted (no stout/estimate)', () => { /* ... */ });
it('blocks end_date < event_date', () => { /* validity */ });
it('asset level maps to anchor_type "asset" (not "product")', () => { /* ... */ });
```

- [ ] **Step 2: Run, verify fail**

```bash
cd src/client && npm run test:units -- --run features/events/event-form
```
Expected: FAIL.

- [ ] **Step 3: Implement `event-payload.ts`** (pure builder) + the form component per spec 3.1-3.5: anchor Level/Entity (pre-filled read-only-with-override when contextual), Event type select grouped by category, Title, Date + precision, Extent -> end/`is_ongoing`, End date/precision, Provenance (`forecasted` not `stout`), Significance (Default=null), Visibility, No-longer-expected, conditional Regulatory pathway, Description, Sources repeater (`{url, label}`, url required), Tags into `metadata`. CT.gov-owned events render read-only (lock controls, hide save, show message).

- [ ] **Step 4: Run payload spec, then the component spec**

```bash
cd src/client && npm run test:units -- --run features/events/event-form
```
Expected: PASS.

- [ ] **Step 5: Integration round-trip** (isolation, local Supabase): create with multi-source + fuzzy date + extent; edit; assert `event_sources` rows in `sort_order`; CT.gov lock; significance null-vs-override persisted.

- [ ] **Step 6: Delete the old forms**, fix imports, run full suite + build.

- [ ] **Step 7: Commit**

```bash
git commit -am "feat(events): merged Event authoring form (single anchor, multi-source)"
```

### Task 10: Sources rendering (detail panel + compact surfaces)

**Files:** Modify the feed-item / timeline detail panel (`event-detail-panel.component.*`) and the compact surfaces (timeline marker tooltip, feed row). Add a `ctgovRegistryUrl` consumer. Test: rendering specs.

**Interfaces:**
- Consumes: `event_sources` rows (`url NOT NULL`, `label NULL`, `sort_order`), `ctgovRegistryUrl(nct)` (cutover TS util).
- Produces: detail-panel stacked source list + separate registry affordance; compact primary-source + "+N".

- [ ] **Step 1: Write rendering specs** (spec Section 3.6): detail panel = one row per citation in `sort_order`, label OR url-host fallback when label null, external-link affordance, registry link as a separate "Registry" affordance, omit the block when zero sources + no registry; compact = first source by `sort_order` (host fallback) + non-interactive "+N".

```ts
it('falls back to URL host when a source label is null', () => {
  expect(sourceDisplay({ url: 'https://clinicaltrials.gov/x', label: null })).toBe('clinicaltrials.gov');
});
it('renders the CT.gov registry link as a separate affordance, not in the citations list', () => { /* ... */ });
it('compact surface shows primary source + "+N" only', () => { /* ... */ });
```

- [ ] **Step 2: Implement** a `sourceDisplay(row)` helper (host fallback) + the two render paths; a11y names per spec ("Open source: <label or host> (opens in new tab)").
- [ ] **Step 3: Run specs + axe check**

```bash
cd src/client && npm run test:units -- --run features/events
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(events): sources rendering (stacked list + registry affordance + compact +N)"
```

### Task 11: Entry points + edit/delete on surviving surfaces

**Files:** Profile pages (company/asset/trial), timeline, `manage/trials` (create entry points); feed item detail + timeline detail panel (edit/delete wiring, editor-gated). Test: e2e + unit for `spaceRole.canEdit()` gating.

- [ ] **Step 1: Write a guard unit spec** - editor sees edit/delete; viewer sees read-only.
- [ ] **Step 2: Wire "Log event"/"Add event"** entry points to open the merged dialog with anchor pre-filled.
- [ ] **Step 3: Add edit/delete** to the feed item detail + timeline detail panel, guarded by `spaceRole.canEdit()`.
- [ ] **Step 4: Run unit + e2e**

```bash
cd src/client && npm run test:units -- --run && npx playwright test --grep "event create|event edit"
```
Expected: PASS (e2e may flake on cold start; CI is canonical).

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(events): contextual create + edit/delete on feed and timeline detail"
```

---

## Phase 6: Taxonomy admin

### Task 12: Event Categories + Event Types tabs in Taxonomies

**Files:** Modify `features/manage/taxonomies/taxonomies-page.component.*` (add two tabs); reuse the marker-type SVG glyph preview. Create `event-category-list` + `event-type-list` tab content (or generic dialog host per spec 4.4). Repoint `MarkerTypeService`/`MarkerCategoryService` data access at `event_types`/`event_type_categories` (or new `EventTypeService`/`EventCategoryService`). Test: integration CRUD + system-row locking + duplicate-name error.

**Interfaces:**
- Consumes: `event_types` (system + custom, `default_significance` on the type), `event_type_categories` (no category-level default significance - spec 4.2), the D2 constraints (Task 2).
- Produces: `Indications | MOA | ROA | Event Categories | Event Types` tabbed screen.

- [ ] **Step 1: Write integration specs** - Event Types CRUD with glyph fields + system read-only; Event Categories CRUD + delete blocked when types reference it; duplicate custom name -> friendly error (catches `23505`); custom name reusing a system name allowed.
- [ ] **Step 2: Build the two tabs** adopting the per-tab table + row-actions + form-dialog pattern. Event Categories form: Name + display order (no default significance). Event Types form: Name, Category, Shape, Fill, Color, Inner mark, Default significance, Display order + live glyph preview. System rows read-only (UI guard, not only the query).
- [ ] **Step 3: Rename grid `persistenceKey`** `manage-marker-types` -> `taxonomies-event-types` (avoid localStorage collision).
- [ ] **Step 4: Run integration + unit**

```bash
cd src/client && npm run test:units -- --run features/manage/taxonomies
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(taxonomy): Event Types + Event Categories tabs in Taxonomies"
```

### Task 13: Retire standalone marker-type/-category screens

**Files:** Delete `features/manage/marker-types/` + `features/manage/marker-categories/` (and specs); remove the nav item + cross-links (Task 6 removed the nav item; confirm). Redirects already added (Task 3).

- [ ] **Step 1: Delete the dirs**, fix imports.
- [ ] **Step 2: Run full suite + build + rename guard**

```bash
cd src/client && npm run test:units -- --run && ng build && npm run test:units -- --run core/testing/rename-guard.spec.ts
```
Expected: PASS; `marker-types`/`marker-categories` route tokens gone.

- [ ] **Step 3: Commit**

```bash
git commit -am "refactor(taxonomy): retire standalone marker-type/-category screens"
```

---

## Phase 7: Help, docs, drift hooks

### Task 14: Help pages + runbook + drift hook

**Files:** `features/help/markers-help.component.ts` (repoint FAQ "Settings > Marker Types" -> "Settings > Taxonomies"; reframe as event-glyph reference; point at `docs/runbook/features/glossary.md`), `taxonomies-help.component.ts` (add Event Types/Categories coverage), `.claude/hooks/runbook-review-guard.sh` (`helpRules`: add `event_types`/`event_type_categories`/merged-form -> help page; keep `marker_types` during transition), runbook feature prose for renamed surfaces.

- [ ] **Step 1: Update help pages** to point at the glossary (do not duplicate definitions) per spec 1.7.
- [ ] **Step 2: Extend `helpRules`** in the hook; run the hook on a sample changed path to confirm it fires.
- [ ] **Step 3: Run help specs**

```bash
cd src/client && npm run test:units -- --run features/help
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git commit -am "docs(help): repoint marker help to Taxonomies + glossary; extend drift hook"
```

### Task 15: Final drift-gate + acceptance sweep

**Files:** none new; verification + any fixups.

- [ ] **Step 1: Run every drift gate**

```bash
cd src/client && npm run features:check && npm run grants:check && npm run docs:arch && npm run migrations:check-redefs
supabase db advisors --local --type all
npm run test:units -- --run
```
Expected: all green.

- [ ] **Step 2: Walk the acceptance matrix** (spec Section 6, S1-S16 incl. S10b sources rendering + S13b name uniqueness) on cloud dev with Playwright + Chrome MCP; screenshot each renamed surface (use the chrome-channel + automation-flag fingerprint + pre-authenticated dev profile).
- [ ] **Step 3: Commit any fixups; STOP for user review** (do not merge; the user merges feat/event-model-stage-3 -> develop).

```bash
git commit -am "test(events): Stage 3 acceptance + drift-gate sweep green" || echo "nothing to commit"
```

---

## Self-Review notes (plan vs spec coverage)

- Spec Section 1 (rename inventory) -> Tasks 3,5,6,7 + the rename guard (Task 4).
- Section 2 (Events->Activity split) -> Task 8.
- Section 3 (merged form, incl. 3.6 sources rendering) -> Tasks 9,10,11.
- Section 4 (taxonomy admin, incl. 4.5 D2 migration) -> Tasks 2,12,13.
- Section 5 (rename-guard method) -> Task 4.
- Section 6 (acceptance matrix) -> Task 15.
- Section 7 (testing) -> per-task specs + Task 15 gates.
- Section 8 (blast radius) -> covered across Tasks 3-14.
- Section 9 open items: get_event_detail rename (Task 1, decided), category-level default significance (resolved - dropped, Task 12), glossary field drift + get_key_catalysts (Stage 5, not in scope; Task 1 only drops the dead get_key_catalysts mapping).
- Deferred (NOT in this plan, per spec non-goals): event threads/storylines (fast-follow), all-authored-events export, the Stage 5 deck/glossary field-level sweep.

## Drift watch (per the user's note)

Before executing, and again before Phase 5 (the form, the highest-overlap area), re-run Task 0 Step 3 against `origin/develop` to catch anything the cutover or the timeline-grid-redesign moved. The timeline redesign touches only `dashboard/grid/*` + `landscape-state.service.ts` + `timeline-insight-strip.component.ts` (no Stage 3 file overlap), but the timeline detail panel that Task 11 wires edit/delete into sits near it - reconfirm the panel's component path after that merge.
