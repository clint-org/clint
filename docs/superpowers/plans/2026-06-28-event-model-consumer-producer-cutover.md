# Event Model Consumer + Producer Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repoint every remaining DB function and frontend service that still reads or writes the dropped `markers` / `marker_assignments` / `marker_types` / `marker_categories` / `marker_changes` tables onto the unified `events` + `event_types` + `event_type_categories` schema, so the whole app runs error-free on the new model and a clean dev deploy is possible.

**Architecture:** Greenfield (no data backfill). Each broken SQL function is redefined from its live `pg_get_functiondef` body with the table references swapped per the Repoint Mapping below; each ships in a migration with an in-migration smoke and `notify pgrst`. Frontend services that embed the old marker schema are rewritten to read the new shape. Work proceeds read-path first (Phases A-B, restores the app), then producers (Phase C, Stage 4 territory), then cleanup/admin and gates (Phases D-E). The IA/terminology rename (Primary Intelligence -> Intelligence, Events page -> Activity) is explicitly OUT of scope here and gets its own Stage 3 plan.

**Tech Stack:** PostgreSQL (Supabase migrations), Angular 19 + PrimeNG (supabase-js PostgREST), Vitest.

## Global Constraints

- Branch `feat/event-model` in worktree `.worktrees/event-model`; never touch the main checkout's branch. node_modules is symlinked.
- All schema work is a new timestamped migration in `supabase/migrations/`; never edit an applied migration. Verify with `supabase db reset` (clean) + `supabase db advisors --local --type all`.
- Redefine every SQL function from its **live** `pg_get_functiondef` body (codebase convention: avoids the stale-base clobber). Never hand-reconstruct from an old migration file.
- Every migration that changes an RPC signature or body ends with `notify pgrst, 'reload schema';`.
- Every migration carries an in-file smoke `do $$ ... $$` that asserts the repointed function returns without error on seeded/synthetic data, then is data-conditional or self-cleaning (runs against prod too).
- Tier-1 audit RPCs keep `record_audit_event()` + the `-- @audit:tier1` marker (none in this plan touch those, but `permanently_delete_space`/`redact_user` are audited -- preserve their audit calls).
- Angular guardrails in `src/client/CLAUDE.md` are mandatory (standalone, OnPush, `inject()`, signals, native control flow, no emojis, no em dashes).
- No emojis, no em dashes anywhere. Commits omit Claude attribution.
- Commit per task. Do not push or use `--no-verify` unless the executor is told to; the orchestrator handles pushes.
- `features:check` is allowed to stay red until Phase E; it is a CI-only gate, not a deploy gate.

## Repoint Mapping (the recipe every SQL task applies)

| Old reference | New reference |
| --- | --- |
| `public.markers m` (anchored to a trial via `marker_assignments`) | `public.events e` with `e.anchor_type = 'trial' and e.anchor_id = <trial_id>` |
| `join public.marker_assignments ma on ma.marker_id = m.id` (then `ma.trial_id`) | drop the join; use `e.anchor_id` directly (events are anchored inline) |
| `public.marker_types mt` / `m.marker_type_id` | `public.event_types et` / `e.event_type_id` |
| `public.marker_categories mc on mc.id = mt.category_id` | `public.event_type_categories ec on ec.id = et.category_id` |
| `m.title`, `m.event_date`, `m.projection`, `m.source_doc_id`, `m.space_id` | identical columns exist on `events` |
| primary_intelligence_links / material_links `entity_type = 'marker'` (target id is a marker) | `entity_type = 'event'` (target id is an event) |
| `trial_change_events.marker_id` -> `markers` | `trial_change_events.event_id` -> `events` (see Task A0) |

Anchoring note: a marker could be assigned to multiple trials via `marker_assignments`; an event has exactly one anchor. Greenfield, so there is no fan-out to preserve -- one event, one trial row. Where a function counted "markers on a trial", count `events where anchor_type='trial' and anchor_id = t.id`.

---

## Phase A: Read-path RPCs (restores the app on the new schema)

### Task A0: Schema prerequisites (link entity_type + change-event column)

**Files:**
- Create: `supabase/migrations/<ts>_event_cutover_schema_prereqs.sql`

**Interfaces:**
- Produces: `primary_intelligence_links.entity_type` accepts `'event'`; `trial_change_events.event_id uuid references events(id)` (the orphaned `marker_id` column repointed/renamed).

- [ ] **Step 1: Inspect live state**

Run:
```bash
PSQL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
psql "$PSQL" -c "select pg_get_constraintdef(con.oid) from pg_constraint con join pg_class c on c.oid=con.conrelid where c.relname='primary_intelligence_links' and con.conname like '%entity_type%';"
psql "$PSQL" -c "\d public.trial_change_events" | grep -i marker
```
Expected: the check lists `trial, marker, company, asset, product` (no `event`); `trial_change_events` has `marker_id` + `derived_from_marker_change_id`, both now FK-less (the markers/marker_changes FKs were dropped by `20260628070739`).

- [ ] **Step 2: Write the migration**

Replace the `primary_intelligence_links_entity_type_check` to swap `'marker'` for `'event'` (drop+add). Rename `trial_change_events.marker_id` to `event_id` and add `references public.events(id) on delete set null`; drop the now-meaningless `derived_from_marker_change_id` column (the `marker_changes` change log is gone; the Event change log `event_changes` from Stage 1 replaces it). Add an in-file smoke that inserts a `primary_intelligence_links` row with `entity_type='event'` and a real event id, asserts it persists, deletes it. End with `notify pgrst, 'reload schema';`.

- [ ] **Step 3: Apply + verify**

Run: `supabase db reset` then `supabase db advisors --local --type all`
Expected: clean apply, smoke PASS notice, no new advisor errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/<ts>_event_cutover_schema_prereqs.sql
git commit -m "feat(events): cutover schema prereqs (link entity_type=event, change-event event_id)"
```

### Task A1: Activity surfaces -- get_activity_feed, get_trial_activity

**Files:**
- Create: `supabase/migrations/<ts>_activity_feed_reads_events.sql`

**Reference lines (from live bodies):** both join `trial_change_events ce` to `marker_types mt` via a subselect `(select m.marker_type_id from public.markers m where m.id = ce.marker_id)` and `left join public.marker_categories mc`. After A0, `ce.event_id` points at `events`; the marker_type lookup becomes `(select e.event_type_id from public.events e where e.id = ce.event_id)` joined to `event_types`/`event_type_categories`.

- [ ] **Step 1: Capture live bodies**

Run: `psql "$PSQL" -c "select pg_get_functiondef('public.get_activity_feed(uuid,jsonb,timestamptz,uuid,integer)'::regprocedure);"` and the same for `get_trial_activity(uuid,integer)`. Save verbatim as the base.

- [ ] **Step 2: Redefine both, applying the Repoint Mapping**

Swap `markers->events`, `ce.marker_id->ce.event_id`, `marker_types->event_types`, `marker_categories->event_type_categories`, `m.marker_type_id->e.event_type_id`. Keep all other logic (cursor pagination, filters, ordering) byte-identical.

- [ ] **Step 3: In-file smoke**

Assert `get_activity_feed(<seed space>)` returns a jsonb object with the expected top-level keys and does not raise; `get_trial_activity(<seed trial>, 10)` returns an array. Data-conditional skip when the seed space is absent.

- [ ] **Step 4: Apply + verify**

Run: `supabase db reset`; then `psql "$PSQL" -c "select public.get_activity_feed('00000000-0000-0000-0000-0000000d0100', '{}'::jsonb, null, null, 20);"`
Expected: returns without error.

- [ ] **Step 5: Commit** `git commit -m "feat(events): get_activity_feed + get_trial_activity read events"`

### Task A2: Future Events list -- get_events_page_data, get_key_catalysts

**Files:**
- Create: `supabase/migrations/<ts>_events_page_data_reads_events.sql`

**Reference lines:** `get_events_page_data` joins `markers m` + `marker_assignments ma on ma.marker_id=m.id` + `marker_types mt` + `marker_categories mc`. `get_key_catalysts` does the same plus a `marker_assignments ma_inner` existence check. Apply the mapping: drop the `marker_assignments` join, anchor on `e.anchor_type='trial' and e.anchor_id`; `markers->events`, types/categories swap. Preserve filters (date range, category, priority/significance, search, sort, pagination). Note: the function's `priority` concept maps to the event `significance` field.

- [ ] **Step 1:** Capture live bodies for `get_events_page_data(uuid,date,date,text,uuid,uuid[],text[],text,text,integer,integer,uuid,text,text,text,text[])` and `get_key_catalysts(uuid,uuid[],uuid,uuid,uuid)`.
- [ ] **Step 2:** Redefine both applying the mapping; collapse `marker_assignments` joins into `events.anchor_*`.
- [ ] **Step 3:** In-file smoke: both return without error on the seed space; assert `get_events_page_data` returns the paginated envelope shape.
- [ ] **Step 4:** `supabase db reset`; call both via psql against the seed space; confirm the 3 seeded asset/company events + 5 trial events surface where expected.
- [ ] **Step 5: Commit** `git commit -m "feat(events): get_events_page_data + get_key_catalysts read events"`

### Task A3: Engagement landing -- get_space_landing_stats

**Files:**
- Create: `supabase/migrations/<ts>_landing_stats_reads_events.sql`

**Reference lines:** three `from public.markers m`, one `join public.marker_types mt`, one `join public.marker_assignments ma on ma.marker_id=m.id`. These power the hero band counts, the next-90-days catalyst count, and the what-changed widget. Apply the mapping; the "next 90 days" window filters `events.event_date` with `significance='high'` (or `is_projected`) per the existing logic -- preserve whatever predicate the live body uses, only swapping the table.

- [ ] **Step 1:** Capture live body of `get_space_landing_stats(uuid)`.
- [ ] **Step 2:** Redefine applying the mapping.
- [ ] **Step 3:** In-file smoke: returns the stats jsonb with the same keys; counts are >= 0.
- [ ] **Step 4:** `supabase db reset`; `psql "$PSQL" -c "select public.get_space_landing_stats('00000000-0000-0000-0000-0000000d0100');"`; confirm non-zero event-derived counts.
- [ ] **Step 5: Commit** `git commit -m "feat(events): get_space_landing_stats reads events"`

### Task A4: Landscape phase reads -- get_bullseye_assets, get_bullseye_data

**Files:**
- Create: `supabase/migrations/<ts>_bullseye_reads_events.sql`

**Reference lines:** both join `marker_assignments ma` -> `markers mk` -> `marker_types mt` -> `marker_categories mc` to surface `recent_markers` and read phase signals. Apply the mapping; `recent_markers` becomes recent events anchored to the asset's trials (anchor on trial ids belonging to the asset), ordered by `event_date desc limit 3`. Keep the bullseye payload keys (`recent_markers`, etc.) unchanged so the frontend is untouched in this task -- only the source table changes.

- [ ] **Step 1:** Capture live bodies of `get_bullseye_assets(uuid,uuid[],uuid[],uuid[],uuid[],text[],uuid[],uuid[])` and `get_bullseye_data(uuid,uuid)`.
- [ ] **Step 2:** Redefine both applying the mapping.
- [ ] **Step 3:** In-file smoke: both return without error on the seed space; `get_bullseye_assets` payload still has `assets` + `companies_with_intelligence` + per-asset `recent_markers` arrays.
- [ ] **Step 4:** `supabase db reset`; call both via psql.
- [ ] **Step 5: Commit** `git commit -m "feat(events): bullseye RPCs read events"`

### Task A5: Command palette -- search_palette, palette_empty_state

**Files:**
- Create: `supabase/migrations/<ts>_palette_reads_events.sql`

**Reference lines:** both build a per-trial category-name subselect `(select mc.name from marker_types mt join marker_categories mc ... join marker_assignments ma on ma.trial_id=t2.id)` and `palette_empty_state` also `join public.markers m on m.id = pr.entity_id` / `rr.entity_id` (recent/pinned palette rows whose entity is a marker). Apply the mapping; the marker-entity palette rows become event-entity rows (`entity_type='event'`), reading `events`/`event_types`.

- [ ] **Step 1:** Capture live bodies of `search_palette(uuid,text,text,integer)` and `palette_empty_state(uuid)`.
- [ ] **Step 2:** Redefine both applying the mapping (including the `entity_type='marker'->'event'` for palette entity rows).
- [ ] **Step 3:** In-file smoke: both return without error on the seed space.
- [ ] **Step 4:** `supabase db reset`; call both via psql.
- [ ] **Step 5: Commit** `git commit -m "feat(events): command palette reads events"`

### Task A6: Inventory + AI source counts -- get_space_inventory_snapshot, get_ai_call_detail, get_ai_usage_rollup

**Files:**
- Create: `supabase/migrations/<ts>_inventory_ai_counts_read_events.sql`

**Reference lines:** `get_space_inventory_snapshot` counts markers via `marker_assignments` and emits a `'marker_types'` rollup key; `get_ai_call_detail`/`get_ai_usage_rollup` count `markers mk where mk.source_doc_id = a.source_doc_id`. Apply the mapping: marker counts -> event counts (anchored), `source_doc_id` counts -> `events` with that `source_doc_id`. Decide the snapshot key name: keep `'marker_types'` key as-is for hash stability OR rename to `'event_types'`; since the inventory hash is only compared to itself going forward (greenfield), rename to `'event_types'` for clarity and update any frontend reader (none expected -- the hash is opaque).

- [ ] **Step 1:** Capture the three live bodies.
- [ ] **Step 2:** Redefine all three applying the mapping; rename the snapshot rollup key to `event_types`.
- [ ] **Step 3:** In-file smoke: all three return without error; the AI count keys (`markers`->rename to `events`) reflect events with the source doc.
- [ ] **Step 4:** `supabase db reset`; call all three via psql.
- [ ] **Step 5: Commit** `git commit -m "feat(events): inventory snapshot + AI source counts read events"`

### Task A7: Link targets -- get_primary_intelligence_history, build_intelligence_payload_for_row, list_materials_for_entity/_for_space/_recent

**Files:**
- Create: `supabase/migrations/<ts>_link_targets_read_events.sql`

**Reference lines:** each resolves a link/material whose `entity_type='marker'` via `(select ... from public.markers where id = l.entity_id)`; `list_materials_*` also `select ma.trial_id from marker_assignments`. After A0 the link entity_type is `'event'`; resolve titles from `public.events`. For the `list_materials_*` trial-derivation (materials linked to a marker that belongs to a trial), derive the trial from the event's anchor (`events where id=l.entity_id and anchor_type='trial'`).

- [ ] **Step 1:** Capture the five live bodies.
- [ ] **Step 2:** Redefine all five: `entity_type='marker'->'event'` branches read `public.events`; marker-via-trial derivations use `events.anchor_*`.
- [ ] **Step 3:** In-file smoke: all five return without error on the seed space.
- [ ] **Step 4:** `supabase db reset`; call all five via psql.
- [ ] **Step 5: Commit** `git commit -m "feat(events): intelligence + material link targets resolve events"`

### Task A8: Delete previews + counts -- preview_trial_delete, preview_asset_delete, preview_company_delete

**Files:**
- Create: `supabase/migrations/<ts>_delete_previews_count_events.sql`

**Reference lines:** each counts `marker_assignments ma` (and emits a `'marker_assignments'` count key) to warn how many markers a delete removes. Apply the mapping: count `events where anchor_type in ('trial'|'asset'|'company') and anchor_id = <id>`; rename the count key `marker_assignments`/`markers` -> `events`. The frontend delete-confirmation dialogs read these keys -- record the renamed key for Phase B (Task B3).

- [ ] **Step 1:** Capture the three live bodies; note the exact JSON count keys they emit.
- [ ] **Step 2:** Redefine all three counting anchored events; rename the marker count key to `events`.
- [ ] **Step 3:** In-file smoke: each returns the preview jsonb with an `events` count >= 0 for the seed entities.
- [ ] **Step 4:** `supabase db reset`; call all three via psql for the seed trial/asset/company.
- [ ] **Step 5: Commit** `git commit -m "feat(events): delete previews count anchored events"`

---

## Phase B: Frontend read services (the timeline + manage pages stop erroring)

### Task B1: trial.service.ts -- read trial events instead of the marker_assignments embed

**Files:**
- Modify: `src/client/src/app/core/services/trial.service.ts`
- Test: `src/client/src/app/core/services/trial.service.spec.ts`

**Reference:** lines 12-30 embed `marker_assignments(... markers ... marker_types(*, marker_categories(*)))` in a PostgREST `select` on `trials`, then `flattenMarkers` lifts `marker_assignments[].markers` into `trial.markers[]`. This is the query that throws `Could not find a relationship between 'trials' and 'marker_assignments'` on the timeline filter bar.

- [ ] **Step 1: Write the failing test**

Add a spec asserting the trial select string no longer contains `marker_assignments` and instead embeds `events(...)` (or fetches events anchored to the trial), and that the mapped `trial.markers[]` carries `marker_type_id` + nested type. Mirror the existing dashboard.service.spec source-contract style if the service is not mountable.

- [ ] **Step 2:** Run it, confirm FAIL.
- [ ] **Step 3:** Rewrite the embed to `events!events_anchor_id_fkey(...)` filtered to `anchor_type=eq.trial` (or a direct events fetch keyed by trial id), and map event rows into the existing `Marker` shape (`marker_type_id=event_type_id`, nested `marker_types` from `event_types`). Reuse the `normalizeMarkers` shape from dashboard.service if practical; keep `trial.markers[]` output identical so phase-bar derivation and the manage page are unaffected.
- [ ] **Step 4:** Run the spec, confirm PASS; run `npm run test:units -- trial.service`.
- [ ] **Step 5: Commit** `git commit -m "feat(events): trial.service reads anchored events, not marker_assignments"`

### Task B2: marker-category.service.ts -- read event_type_categories

**Files:**
- Modify: `src/client/src/app/core/services/marker-category.service.ts`
- Test: `src/client/src/app/core/services/marker-category.service.spec.ts` (create if absent)

**Reference:** `.from('marker_categories')` in four places; feeds the landscape filter bar's category options.

- [ ] **Step 1:** Write a failing source-contract test: the service queries `event_type_categories`, not `marker_categories`.
- [ ] **Step 2:** Run, confirm FAIL.
- [ ] **Step 3:** Swap all `.from('marker_categories')` to `.from('event_type_categories')`; adjust any selected columns to the event_type_categories shape. If the consuming filter binds `markerCategoryIds`, keep the public field names for now (rename is Stage 3) -- only the data source changes.
- [ ] **Step 4:** Run the spec; `npm run test:units -- marker-category`.
- [ ] **Step 5: Commit** `git commit -m "feat(events): marker-category.service reads event_type_categories"`

### Task B3: Delete-confirmation dialogs + export util -- consume renamed keys

**Files:**
- Modify: the components that read `preview_*_delete` count keys (find via `grep -rn "preview_trial_delete\|preview_asset_delete\|preview_company_delete" src/app`), and `src/client/src/app/core/services/export-common.util.ts` (lines ~177, 258-272 read `marker_categories`/`marker_types`).
- Test: the matching specs.

- [ ] **Step 1:** Write failing tests asserting the dialog reads the `events` count key (from Task A8) and the export util reads the event-shaped fields.
- [ ] **Step 2:** Run, confirm FAIL.
- [ ] **Step 3:** Update the dialogs to read the `events` count key; update `export-common.util.ts` to read `marker_types`/`marker_categories` off the already-normalized marker shape (these are the client-side `marker_types` produced by `normalizeMarkers`, so they may already be correct -- verify and only change the RPC-key reads).
- [ ] **Step 4:** Run the specs; `cd src/client && ng build`.
- [ ] **Step 5: Commit** `git commit -m "feat(events): delete dialogs + export read event-shaped counts"`

### Task B4: Verify the app loads clean

- [ ] **Step 1:** `cd src/client && ng lint && ng build` -> clean.
- [ ] **Step 2:** `npm run test:units` -> full suite green.
- [ ] **Step 3:** Serve local + inject the demo session (see the Stage 2c recipe in `project_event_model_rewrite` memory); load the timeline route; read console -> the `marker_assignments` PostgrestError is gone; load the engagement landing + Activity + Future Events routes -> no dropped-table errors.
- [ ] **Step 4:** No commit (verification only); note any residual errors as new tasks.

---

## Phase C: Producers (Stage 4 -- the write paths)

> These functions WRITE markers today. They must emit unified events via the Stage 1 `create_event` RPC (per the shared-RPC rule: no inline event inserts). `_seed_demo_markers` is large (104 marker references); budget it as its own task.

### Task C1: Marker trigger + change-log functions -- retire or repoint

**Files:**
- Create: `supabase/migrations/<ts>_retire_marker_triggers.sql`

**Functions:** `_log_marker_change`, `_cleanup_orphan_marker`, `_emit_events_from_marker_change`, `backfill_marker_history`. These were triggers/helpers on the dropped `markers`/`marker_changes` tables. Their triggers are already gone (tables dropped). Drop the now-orphaned functions (the Event change log `event_changes` + its trigger from Stage 1 already cover change history). Confirm nothing else calls them first.

- [ ] **Step 1:** `psql "$PSQL" -c "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and pg_get_functiondef(p.oid) ~* '_log_marker_change|_cleanup_orphan_marker|_emit_events_from_marker_change|backfill_marker_history';"` -- confirm no live caller besides themselves.
- [ ] **Step 2:** Write the migration: `drop function if exists` each, guarded. If any is still referenced, repoint that caller first.
- [ ] **Step 3:** `supabase db reset` + advisors; smoke confirms the functions are gone and `event_changes` logging still fires (insert a test event via `create_event`, assert an `event_changes` row, clean up).
- [ ] **Step 4: Commit** `git commit -m "feat(events): retire dropped-marker trigger + changelog functions"`

### Task C2: update_marker_assignments -> event anchor update; marker CRUD in manage/trials

**Files:**
- Create: `supabase/migrations/<ts>_event_anchor_crud.sql`
- Modify: the manage/trials marker CRUD frontend (find via `grep -rn "update_marker_assignments\|create_marker\|update_marker" src/app`).

**Reference:** `update_marker_assignments(p_marker_id, p_trial_ids)` rewired marker<->trial links. With single-anchor events, "assign to trials" becomes "set the event's anchor". Decide: the manage UI edits an event's anchor via `update_event` (Stage 1) -- so `update_marker_assignments` is likely retired and the UI calls `update_event`. Confirm the UI's needs before dropping.

- [ ] **Step 1:** Map the frontend marker-CRUD callers and what they need (create/edit/delete/assign).
- [ ] **Step 2:** Migration: drop `update_marker_assignments`; ensure `create_event`/`update_event` cover the UI's needs (add params only if a real gap exists).
- [ ] **Step 3:** Repoint the manage/trials marker CRUD components to `create_event`/`update_event`/`delete` on events. Tests per touched component.
- [ ] **Step 4:** `supabase db reset`; `ng build`; `npm run test:units`.
- [ ] **Step 5: Commit** `git commit -m "feat(events): manage marker CRUD edits events via create/update_event"`

### Task C3: CT.gov sync -> emit clinical events

**Files:**
- Create: `supabase/migrations/<ts>_ctgov_sync_emits_events.sql`

**Functions:** `_create_trial_date_markers`, `_seed_ctgov_marker_upsert`, `_seed_ctgov_markers`, and `create_trial` (calls `_create_trial_date_markers`). These derive Trial Start / PCD / Trial End markers from CT.gov dates. Repoint to emit clinical `events` (anchored to the trial) via `create_event`, keyed by event_type. Preserve the UPSERT-by-(trial, event_type, field) drift behavior from the ctgov-trial-dates spec.

- [ ] **Step 1:** Capture the four live bodies; identify the marker_type_id -> event_type_id mapping for Trial Start/PCD/Trial End.
- [ ] **Step 2:** Redefine to insert/upsert `events` (anchor_type='trial') instead of markers + assignments; `create_trial` calls the new helper.
- [ ] **Step 3:** In-file smoke + integration: a CT.gov sync produces the expected clinical events; re-sync updates in place (no dupes).
- [ ] **Step 4:** `supabase db reset`; run the ctgov integration spec if present.
- [ ] **Step 5: Commit** `git commit -m "feat(events): CT.gov sync emits clinical events"`

### Task C4: commit_source_import -> Event create path

**Files:**
- Create: `supabase/migrations/<ts>_commit_source_import_emits_events.sql`

**Reference:** `commit_source_import` creates markers (and events) on separate paths today. Collapse onto `create_event` (no inline inserts -- the shared-RPC rule, see the `commit_source_import skipping create_trial` lesson). Map the proposal's marker entries to events anchored per the proposal's target entity.

- [ ] **Step 1:** Capture the live body; locate its marker-insert block.
- [ ] **Step 2:** Replace the marker-insert block with `create_event` calls; remove the marker_assignments writes.
- [ ] **Step 3:** In-file smoke + the import integration/dedup spec (`docs/superpowers/plans/2026-06-27-import-marker-event-dedup.md` context) stays green.
- [ ] **Step 4:** `supabase db reset`; run the import integration spec.
- [ ] **Step 5: Commit** `git commit -m "feat(events): commit_source_import emits events via create_event"`

### Task C5: Demo seed producers -> emit events

**Files:**
- Create: `supabase/migrations/<ts>_seed_demo_emits_events.sql`

**Functions:** `_seed_demo_markers` (104 refs -- the bulk), `_seed_demo_activity_variety`, `_seed_demo_recent_activity`, `_seed_demo_trials`, `_seed_demo_primary_intelligence` (link target entity_type), `seed_demo_data`. Rewrite `_seed_demo_markers` to emit the same demo timeline as events (clinical + commercial + leadership + a brief), spanning the new surfaces per the spec's "demo/seed data must produce Events". This is the largest single task; the existing `supabase/seed.sql` event block (Stage 2b/2c) is the reference shape for `create_event` calls.

- [ ] **Step 1:** Capture `_seed_demo_markers` live body; inventory the marker set it produces (types, dates, trials).
- [ ] **Step 2:** Rewrite it to `create_event` calls producing the equivalent event set (anchored to trials/assets/companies); repoint `_seed_demo_activity_variety` / `_seed_demo_recent_activity` to events; `_seed_demo_primary_intelligence` link entity_type 'marker'->'event'.
- [ ] **Step 3:** In-file smoke: `seed_demo_data(<fresh space>)` populates events and `get_dashboard_data` renders them; clean up the test space.
- [ ] **Step 4:** `supabase db reset`; run `seed_demo_data` against a scratch space; spot-check `get_dashboard_data`.
- [ ] **Step 5: Commit** `git commit -m "feat(events): /seed-demo producers emit events"`

---

## Phase D: Cleanup + admin

### Task D1: permanently_delete_space, redact_user -- drop marker cleanup

**Files:**
- Create: `supabase/migrations/<ts>_admin_cleanup_drops_markers.sql`

**Reference:** both `delete from public.markers` / count markers in their cascade. The `events` table is `on delete cascade` from `spaces`, so space deletion already removes events -- drop the explicit marker delete. For `redact_user`, repoint any `markers.created_by/updated_by` nulling to `events`. Preserve `record_audit_event()` + `-- @audit:tier1`.

- [ ] **Step 1:** Capture both live bodies.
- [ ] **Step 2:** Redefine: remove marker deletes; add equivalent `events` handling only where the cascade does not already cover it; keep audit calls.
- [ ] **Step 3:** In-file smoke (self-cleaning): create scratch space + event, run delete, assert gone.
- [ ] **Step 4:** `supabase db reset` + advisors.
- [ ] **Step 5: Commit** `git commit -m "feat(events): admin cleanup paths drop marker references"`

---

## Phase E: Drift gates + docs

### Task E1: features:check capability mapping

**Files:**
- Modify: the feature manifests under `docs/runbook/features/` (or wherever `features:check` maps RPCs) for every renamed/new RPC in this plan.

- [ ] **Step 1:** Run `cd src/client && npm run features:check` -> list the unmapped RPCs.
- [ ] **Step 2:** Map each repointed RPC to its capability; remove mappings for dropped functions (`update_marker_assignments`, the retired trigger fns).
- [ ] **Step 3:** Re-run `features:check` -> green.
- [ ] **Step 4: Commit** `git commit -m "docs(features): map event-model cutover RPCs"`

### Task E2: Regenerate runbook auto-gen + glossary touch

**Files:**
- Modify: runbook auto-gen blocks (via `npm run docs:arch`), and any hand-written runbook prose naming markers in the repointed surfaces.

- [ ] **Step 1:** `cd src/client && npm run docs:arch` (local Supabase up).
- [ ] **Step 2:** Review the regen diff; update surrounding prose only where it now misstates the source table.
- [ ] **Step 3:** `npm run docs:arch` again -> no diff; commit.
- [ ] **Step 4: Commit** `git commit -m "docs(runbook): regenerate after event-model cutover"`

### Task E3: Full-suite + advisor gate

- [ ] **Step 1:** `cd src/client && ng lint && ng build` -> clean.
- [ ] **Step 2:** `npm run test:units` -> green; run integration tests per the local-integration memory recipe.
- [ ] **Step 3:** `supabase db reset` + `supabase db advisors --local --type all` -> clean; `npm run grants:check` -> PASS.
- [ ] **Step 4:** Visual: serve + demo session; load timeline, landing, Activity, Future Events, bullseye, a manage trial page, the command palette -> all render without console dropped-table errors.
- [ ] **Step 5:** No commit (gate); fix-forward any failure as a new task.

---

## Self-Review notes

- **Coverage:** every function from the discovery inventory (33) maps to a task: A1 (get_activity_feed, get_trial_activity), A2 (get_events_page_data, get_key_catalysts), A3 (get_space_landing_stats), A4 (get_bullseye_assets/_data), A5 (search_palette, palette_empty_state), A6 (get_space_inventory_snapshot, get_ai_call_detail, get_ai_usage_rollup), A7 (get_primary_intelligence_history, build_intelligence_payload_for_row, list_materials x3), A8 (preview_* x3), C1 (4 trigger/changelog fns), C2 (update_marker_assignments), C3 (create_trial, _create_trial_date_markers, _seed_ctgov x2), C4 (commit_source_import), C5 (_seed_demo x4 + seed_demo_data), D1 (permanently_delete_space, redact_user). Plus A0 schema prereqs and the frontend services (B1-B3).
- **Out of scope (separate plans):** the IA/terminology rename (Intelligence/Activity/Event route + label renames, merged Event form, taxonomy admin) = Stage 3; the `stout-intro.html` deck refresh = Stage 5.
- **Ordering rationale:** A0 unblocks A1/A7/A8 (link entity_type + change-event column). Phase A is independently shippable (RPCs return correct data even before the frontend services are repointed, since the frontend still gets valid shapes). Phase B makes the app visibly clean. Phase C (producers) can lag because the seed.sql event block already feeds the demo space; dev gets event data when C5 lands or via manual create_event.
