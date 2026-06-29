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

## Testing doctrine (every phase backtests against the parent spec)

Testing is a first-class deliverable, not a trailing phase (parent spec, "Testing and verification"). Three layers, and **EVERY phase ends with a backtest task** that proves the phase against the spec's Acceptance Matrix before the next phase starts:

- **Unit (Vitest `npm run test:units`):** pure logic, paired with (ideally before) each behavior-bearing task. No separate tests phase.
- **Integration (local Supabase, service-role):** the repointed RPCs return the CORRECT rows/shape against the QA fixture (Phase 0) -- not merely "without error." Run in isolation (the local DB is shared across worktrees; a parallel `db reset` can wipe functions mid-run -- see the memory note). Export `SUPABASE_SERVICE_ROLE_KEY` from `supabase status` first.
- **Visual (Chrome MCP, local serve + injected demo/QA session):** the affected surface renders the expected glyphs/rows; screenshot + pass/fail per matrix row. The authoritative cloud-dev visual artifact (all 14 rows on `dev.clintapp.com`, every toggle state) is produced at the end (Task E4), per the spec's "Visual confirmation artifact."

**Backtest rule:** every phase's final task names the Acceptance Matrix rows it proves and records pass/fail. The cutover is not "done" until all 14 rows are green at their stated layers, the full pre-existing suite + drift gates are green, and the surfaces are visually confirmed. Treat the matrix as the definition of done -- this is how we stay authoritative that the result meets the parent spec's vision.

**Acceptance Matrix -> phase mapping** (rows are from the parent spec's matrix):
- Rows 1,2,3,4,12 (event-to-row/feed membership, significance defaulting, fuzzy/projected, hidden) -> RPC-layer data correctness in **A9**; unit already covered by Stage 2c (`effectiveVisibility`, gridRows); visual in **B4** / **E4**.
- Rows 7,8,13,14 (default-view regression, Compare preset, company lane, pinned company band) -> visual in **B4** (local) + **E4** (dev); rows 8,12,13 also unit (Stage 2c).
- Rows 5,6 (event edit -> Activity not Intelligence feed; brief cites an event) -> integration in **C6** once producers + Activity wiring are on events.
- Row 11 (phase-bar derivation regression) -> unit + integration in **A9** / **C6**.
- Rows 9,10 (asset expanded, two-asset comparison gap) -> visual in **E4**.

## Phase 0: Deterministic QA fixture (the backtest backbone)

### Task 0.1: Build the "Events model QA" fixture

**Files:**
- Create: `supabase/migrations/<ts>_events_model_qa_fixture.sql` -- a SECURITY DEFINER seed `seed_events_model_qa(p_space_id uuid)`, gated/idempotent like `seed_demo_data`.
- Test: `src/client/integration/events-model-qa-fixture.spec.ts` (integration) asserting the fixture composition.

**Interfaces:**
- Produces: `seed_events_model_qa(uuid)` populating one space with EVERY acceptance-matrix scenario, built via `create_event` (no inline inserts): a trial with clinical events (Trial Start / PCD / Topline / Approval); an asset with an approval + a high-significance commercial Distribution (hexagon) event; a company with a low-significance leadership event (feed-only) AND a pinned company event (band glyph); a fuzzy-dated projected event (`~Q4 2026`, `projection='primary'`); an Intelligence brief that cites an event (a link); a `visibility='hidden'` high-significance event; and a SECOND company/asset so the comparison view has two stacked rows.

- [ ] **Step 1: Write the failing integration test** asserting `seed_events_model_qa` yields the exact scenario set: counts per `anchor_type`, exactly one pinned company event, one hidden event, one projected event, one brief-with-event-citation, two companies/assets.
- [ ] **Step 2:** Run it -> FAIL (function absent).
- [ ] **Step 3:** Implement `seed_events_model_qa` via `create_event` calls (+ brief + citation link), mirroring `supabase/seed.sql`'s event block; idempotent (skip if already seeded). In-file smoke seeds a scratch space, asserts the composition, cleans up.
- [ ] **Step 4:** Run the integration test -> PASS; `supabase db reset` clean; advisors clean.
- [ ] **Step 5: Commit** `git commit -m "test(events): deterministic Events model QA fixture"`

This fixture is the dataset every Phase A and Phase C backtest asserts against.

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

### Task A9: Phase A backtest -- read RPCs against the QA fixture

**Files:**
- Create: `src/client/integration/event-read-rpcs.integration.spec.ts`

**Backtest target:** Acceptance Matrix rows 1, 2, 3, 4, 11, 12 at the RPC/data layer.

- [ ] **Step 1:** Seed a fresh space via `seed_events_model_qa`. Write integration assertions: `get_events_page_data` returns the projected `~Q4 2026` event with its period/precision + `projection='primary'` fields and orders by date (rows 4); the hidden high-significance event never appears in any timeline-membership read (row 12); `get_space_landing_stats` counts equal the fixture's event counts (rows 1-2); `get_bullseye_assets.recent_markers` reflect anchored events; `get_activity_feed` carries detected changes, not analyst-authored events (sets up row 5).
- [ ] **Step 2:** Run -> the assertions encode expected values; confirm PASS against the repointed RPCs.
- [ ] **Step 3: Regression (row 11):** `get_dashboard_data` on the QA space still derives phase bars from clinical events and renders trial/asset/company events (Stage 2c) unchanged.
- [ ] **Step 4:** Record pass/fail per matrix row in `docs/superpowers/plans/2026-06-28-event-model-consumer-producer-cutover.md` under a "Phase A backtest results" note (or the PR body).
- [ ] **Step 5: Commit** `git commit -m "test(events): Phase A read-RPC backtest against QA fixture"`

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

### Task B4: Phase B backtest -- visual + load-clean against the QA fixture

**Backtest target:** Acceptance Matrix rows 1, 2, 3, 7, 8, 13, 14 (local visual); plus the load-clean regression.

- [ ] **Step 1:** `cd src/client && ng lint && ng build` -> clean; `npm run test:units` -> full suite green.
- [ ] **Step 2:** Seed a local space via `seed_events_model_qa`; serve local + inject the demo session (Stage 2c recipe in the `project_event_model_rewrite` memory note; serve on a free port, e.g. :8100).
- [ ] **Step 3: Console regression:** load the timeline, engagement landing, Activity, and Future Events routes; read console -> the `marker_assignments` PostgrestError and all dropped-table errors are gone.
- [ ] **Step 4: Visual acceptance (screenshot each, assert + record pass/fail):** timeline default view shows trial rows + phase bars + the asset-lane hexagon + the pinned company-band glyph and NOT the feed-only leadership event (rows 1,2,3,7,13,14); Compare preset hides trials and shows the asset lead-phase chip (row 8); Future Events lists the projected event; Activity shows detected changes only.
- [ ] **Step 5:** Record pass/fail per matrix row in the plan's "Phase B backtest results" note. No code commit (verification only); file any residual error as a new task.

---

## Phase S: Sources model (A-derived) -- folded into the cutover

> ADDED 2026-06-28 mid-cutover (locked with the user). The "A-derived" sources model
> (see the parent spec "Event sources" section) is pulled forward from Stage 3 because
> the producers (C3-C5) and the already-shipped read RPCs (A/B) must reflect it now or
> they get built twice. Only the merged-form multi-source authoring UI stays in Stage 3.
>
> **Locked model:** (1) `event_sources` side table (FK -> events, cascade) = the single
> source of truth for attached citations; (2) `events.source_url` is DROPPED; (3) the
> CT.gov registry link is DERIVED (`https://clinicaltrials.gov/study/<nct>`), never
> stored, via ONE SQL helper + a TS util mirror; (4) `source_doc_id` is unchanged.
> `event_links` / `event_threads` are explicitly NOT touched here (open Stage 3).
>
> **Verified current state (2026-06-28):** `event_sources`/`event_links`/`event_threads`
> tables do NOT exist (Stage 1 dropped the old events feature); orphaned
> `update_event_sources(uuid,text[],text[])` + `update_event_links` functions remain
> (broken). `events.source_url` + `source_doc_id` exist. So S1 CREATES `event_sources`
> (not repoint). source_url read/write surface (psql `pg_get_functiondef ~* 'source_url'`):
> read RPCs `_dashboard_anchor_events`, `get_events_page_data`, `get_catalyst_detail`,
> `get_key_catalysts`; producers `_seed_ctgov_marker_upsert`, `_seed_ctgov_markers`,
> `_seed_demo_markers`, `commit_source_import`, `create_event`, `update_event`; plus
> `get_source_document` (that one is source_doc, leave it). Hardcoded registry literal in
> SQL: `_seed_ctgov_markers`, `_seed_demo_markers`, `get_events_page_data`.
>
> **Execution order (this folds into Phase C):** S1 (foundation) -> S2 (read RPCs) ->
> S3 (frontend readers + the C2 marker-write surface) -> C3 -> C4 -> C5 -> S4 (fixture) ->
> S5 (drop source_url) -> C6 (backtest incl. sources) -> S6 (docs). source_url stays live
> until S5 so the transition is additive; drop it only once every reader/producer is off it.

### Task S1: event_sources foundation (table + RLS + grants + registry helper + create_event sources param + update_event_sources)

**Files:** new migration(s) `supabase/migrations/<ts>_event_sources_foundation.sql`; `supabase/data-api-grants.json`; TS util `src/client/src/app/shared/utils/ctgov-registry-url.ts` (+ spec); the matching grant matrix row.

- Create `event_sources(id uuid pk, event_id uuid not null references events(id) on delete cascade, url text not null, label text, sort_order int not null default 0, created_at timestamptz not null default now())` + index on `(event_id, sort_order, created_at)`. Enable RLS; policies: SELECT `has_space_access((select space_id from events where id = event_id))`, INSERT/UPDATE/DELETE `has_space_access(..., array['owner','editor'])`. Model on the events policies. Add to `data-api-grants.json` (starts dark; authenticated gets the right verbs, anon none) so `grants:check` passes.
- SQL helper `public.event_registry_url(p_identifier text) returns text` -> `'https://clinicaltrials.gov/study/' || p_identifier` when identifier is non-empty, else null. TS mirror `ctgovRegistryUrl(identifier)` with a unit spec (trial w/ NCT -> URL; empty/null -> null). This is the ONE home for the format.
- `create_event`: add a trailing `p_sources jsonb default null` (array of `{url,label}`); after the event insert, insert the `event_sources` rows atomically in the same tx (deterministic `sort_order` by array index). DROP+CREATE (adding a param changes identity); re-grant EXECUTE to the roles it currently holds (capture with `has_function_privilege`); redefine from the LIVE body. Do NOT remove `p_source_url` yet (S5 does that) -- keep it accepted but the column write stays until S5; simplest is to keep inserting source_url for now and let S5 remove both the param and column together. (Your call: either keep p_source_url passthrough until S5, or have S1 already stop writing it -- but the column is NOT dropped until S5.)
- `update_event_sources(p_event_id, p_urls text[], p_labels text[])`: redefine to target the new `event_sources` table (replace-all semantics: delete existing rows for the event, insert the new set with sort_order by index), guarded by `has_space_access(owner/editor)`. Keep the url[]/label[] contract.
- In-file smoke (self-cleaning): insert an event via create_event with two sources, assert two event_sources rows ordered, update_event_sources to one, assert one; firewall-adjacent checks where practical. End with `notify pgrst, 'reload schema';`.
- Tests: unit (the TS registry-url util); integration paired here or in C6 (event_sources CRUD via create_event + update_event_sources, RLS firewall: viewer-deny / non-member-deny / sibling-no-leak).

### Task S2: read RPCs return sources[] + derived registry link (off source_url)

**Files:** new migration repointing `_dashboard_anchor_events`, `get_events_page_data`, `get_catalyst_detail`, `get_key_catalysts` (redefine each from LIVE body).

- Each RPC that emitted `source_url` now emits a `sources` array (from `event_sources`, ordered) AND a derived `registry_url` (via `event_registry_url(trial.identifier)` when `anchor_type='trial'` and the trial has an NCT identifier), kept SEPARATE from the citations list. The detail panel already renders a `d.sources[]` list -- match that shape. Replace the hardcoded registry literal in `get_events_page_data` with the helper. Preserve all other output keys. In-file smoke + `notify pgrst`. Integration coverage folds into C6 (readers return sources[] + link against the QA fixture).

### Task S3: frontend readers + the C2 marker-write surface consume the sources model

**Files:** find via `grep -rln "source_url\|clinicaltrials.gov/study" src/client/src/app` (≈30 files; the live ones: `event.service`, `trial.service`/`mapEventToMarker`, `event-detail-panel`, `marker-detail-content`, `catalyst-row-tooltip`, `marker.component.html`, `trial-detail.component.html`, `marker-form.component`, `marker.service`, `source-provenance`).

- Read consumers render the `sources[]` citation list + the derived registry link (reuse the existing `d.sources[]` shape + the `ctgovRegistryUrl` util; do not jam the registry link into the citation list).
- **The C2 marker write surface** (`marker.service.ts` `create`/`update`, `marker-form.component`): the form's single "Source URL" field becomes ONE `event_sources` citation -- `create` passes `p_sources: source_url ? [{url, label:null}] : null` to `create_event` (instead of `p_source_url`); edits go through `update_event_sources`. This supersedes the C2 source_url write path.
- Tests per touched unit (primary-source selection rule; the util; the mapped write payload).

### Task S4: extend seed_events_model_qa for sources

- Add to the QA fixture: one business/analyst event (e.g. the Distribution) with TWO labeled `event_sources` (asserts multi-source), and confirm the clinical trial-anchored events have ZERO source rows but a DERIVABLE registry link (asserts the derived path). Update the fixture integration spec assertions (counts per anchor unchanged; new source-count + derived-link assertions). This keeps the backtest authoritative.

### Task S5: DROP events.source_url

- After S2/S3/C3/C4/C5 are off the column: new migration drops `events.source_url`, and removes the now-dead `p_source_url` param from `create_event`/`update_event` (DROP+CREATE, re-grant, redefine from LIVE). In-file smoke asserts the column is gone and create_event still works with sources. `notify pgrst`. Verify nothing in `pg_get_functiondef ~* 'source_url'` remains except `get_source_document` (source_doc, unrelated).

### Task S6: docs -- sources model

- Update the runbook events feature doc + the authoritative glossary entry for "Event" (event_sources = attached citations; CT.gov registry link = derived; source_doc_id = ingest provenance), and any help page that described marker/event sourcing. Regen auto-gen blocks via `npm run docs:arch` if schema-touching. Fold the visual evidence (multi-citation business event + derived Registry link on a clinical event) into E4's all-14-rows artifact.

---

## Phase C: Producers (Stage 4 -- the write paths)

> These functions WRITE markers today. They must emit unified events. `_seed_demo_markers` is large (104 marker references); budget it as its own task. **Sources behavior (Phase S):** C3 writes NO source rows (registry link derived); C4 attaches AI proposal URLs as `event_sources` via `create_event(p_sources)`; C5 gives a couple of business/analyst demo events MULTIPLE labeled sources (clinical events get none).

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

**Functions:** `_create_trial_date_markers`, `_seed_ctgov_marker_upsert`, `_seed_ctgov_markers`, and `create_trial` (calls `_create_trial_date_markers`). These derive Trial Start / PCD / Trial End markers from CT.gov dates. Repoint to emit clinical `events` (anchored to the trial), keyed by event_type. Preserve the UPSERT-by-(trial, event_type, field) drift behavior from the ctgov-trial-dates spec. **NOTE (resolved during execution): a faithful INLINE repoint, NOT `create_event`** -- create_event enforces `has_space_access(owner/editor)` on `auth.uid()` (null for the anon sync), is insert-only (cannot do the 3-branch upsert), has no metadata param (the drift keys on `metadata.source='ctgov'`), and would force `created_by=null`. The `_set_created_by` trigger's `coalesce(auth.uid(), new.created_by)` lets an inline insert keep `created_by=p_created_by`. System UUIDs are identical (marker_type_id == event_type_id), so the retarget is mechanical. **Sources (Phase S):** the ctgov producer writes ZERO `event_sources` rows and sets NO `source_url` (registry link is derived by readers); drop the source_url handling + the hardcoded `clinicaltrials.gov/study` literal from these functions.

- [ ] **Step 1:** Capture the four live bodies; identify the marker_type_id -> event_type_id mapping for Trial Start/PCD/Trial End.
- [ ] **Step 2:** Redefine to insert/upsert `events` (anchor_type='trial') instead of markers + assignments; `create_trial` calls the new helper.
- [ ] **Step 3:** In-file smoke + integration: a CT.gov sync produces the expected clinical events; re-sync updates in place (no dupes).
- [ ] **Step 4:** `supabase db reset`; run the ctgov integration spec if present.
- [ ] **Step 5: Commit** `git commit -m "feat(events): CT.gov sync emits clinical events"`

### Task C4: commit_source_import -> Event create path

**Files:**
- Create: `supabase/migrations/<ts>_commit_source_import_emits_events.sql`

**Reference:** `commit_source_import` creates markers (and events) on separate paths today. Collapse onto `create_event` (no inline inserts -- the shared-RPC rule, see the `commit_source_import skipping create_trial` lesson). Map the proposal's marker entries to events anchored per the proposal's target entity. **Sources (Phase S):** when the proposal carries source URLs, attach them as `event_sources` by passing `p_sources` to `create_event` (atomic, no inline `event_sources` inserts).

- [ ] **Step 1:** Capture the live body; locate its marker-insert block.
- [ ] **Step 2:** Replace the marker-insert block with `create_event` calls; remove the marker_assignments writes.
- [ ] **Step 3:** In-file smoke + the import integration/dedup spec (`docs/superpowers/plans/2026-06-27-import-marker-event-dedup.md` context) stays green.
- [ ] **Step 4:** `supabase db reset`; run the import integration spec.
- [ ] **Step 5: Commit** `git commit -m "feat(events): commit_source_import emits events via create_event"`

### Task C5: Demo seed producers -> emit events

**Files:**
- Create: `supabase/migrations/<ts>_seed_demo_emits_events.sql`

**Functions:** `_seed_demo_markers` (104 refs -- the bulk), `_seed_demo_activity_variety`, `_seed_demo_recent_activity`, `_seed_demo_trials`, `_seed_demo_primary_intelligence` (link target entity_type), `seed_demo_data`. Rewrite `_seed_demo_markers` to emit the same demo timeline as events (clinical + commercial + leadership + a brief), spanning the new surfaces per the spec's "demo/seed data must produce Events". This is the largest single task; the existing `supabase/seed.sql` event block (Stage 2b/2c) is the reference shape. **Sources (Phase S):** give a couple of business/analyst demo events MULTIPLE labeled `event_sources` (e.g. a Distribution event with a press release + an earnings transcript) so the multi-source path has demo coverage; clinical events get none (derived link). Drop the hardcoded registry literal from `_seed_demo_markers`.

- [ ] **Step 1:** Capture `_seed_demo_markers` live body; inventory the marker set it produces (types, dates, trials).
- [ ] **Step 2:** Rewrite it to `create_event` calls producing the equivalent event set (anchored to trials/assets/companies); repoint `_seed_demo_activity_variety` / `_seed_demo_recent_activity` to events; `_seed_demo_primary_intelligence` link entity_type 'marker'->'event'.
- [ ] **Step 3:** In-file smoke: `seed_demo_data(<fresh space>)` populates events and `get_dashboard_data` renders them; clean up the test space.
- [ ] **Step 4:** `supabase db reset`; run `seed_demo_data` against a scratch space; spot-check `get_dashboard_data`.
- [ ] **Step 5: Commit** `git commit -m "feat(events): /seed-demo producers emit events"`

### Task C6: Phase C backtest -- producers + Activity wiring

**Files:**
- Create: `src/client/integration/event-producers.integration.spec.ts`

**Backtest target:** Acceptance Matrix rows 5, 6, 11 (integration). **Plus the Phase S sources hardening** (rows 1-2 detail reads): producers emit the right `event_sources` rows (AI import attaches sources; CT.gov attaches none, link derived); the read RPCs return `sources[]` + derived `registry_url` with the right shape against `seed_events_model_qa`; `event_sources` RLS firewall (viewer-deny / non-member-deny / sibling-no-leak).

- [ ] **Step 1:** Integration: `seed_demo_data(<fresh space>)` and `seed_events_model_qa` both produce events (not markers); `get_dashboard_data` renders them. Edit an event via `update_event` -> the change appears in Activity (`get_activity_feed`) and does NOT appear in the Intelligence feed (row 5). An Intelligence brief citing an event resolves its citation (row 6). A CT.gov re-sync updates clinical events in place with no duplicates (drift behavior).
- [ ] **Step 2: Regression (row 11):** clinical events from the producers derive the phase bar identically to the pre-cutover markers on the same fixture.
- [ ] **Step 2b (Phase S):** the QA-fixture multi-source business event returns its two `event_sources` (ordered); a clinical trial-anchored event returns ZERO source rows but a non-null derived `registry_url`; `event_sources` firewall rows pass.
- [ ] **Step 3:** Run the import dedup + ctgov integration specs -> green.
- [ ] **Step 4:** Record pass/fail per matrix row in the plan's "Phase C backtest results" note.
- [ ] **Step 5: Commit** `git commit -m "test(events): Phase C producer + Activity backtest"`

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

### Task D2: Phase D backtest -- destructive paths leave no orphans

- [ ] **Step 1:** Integration (self-cleaning scratch space): `seed_events_model_qa` then `permanently_delete_space` -> the space's `events`, `event_changes`, and links are all gone (cascade), no orphan rows; the audit event is recorded.
- [ ] **Step 2:** `redact_user` on a scratch user nulls `events.created_by/updated_by` it authored; audit recorded.
- [ ] **Step 3:** Record pass/fail in the plan's "Phase D backtest results" note.
- [ ] **Step 4: Commit** `git commit -m "test(events): Phase D admin-cleanup backtest"`

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

### Task E4: Authoritative visual artifact -- all 14 matrix rows on cloud dev

**Backtest target:** the FULL Acceptance Matrix (rows 1-14) at the visual layer, per the spec's "Visual confirmation artifact." This is the final authoritativeness gate.

- [x] **Step 1:** Merge `feat/event-model` -> `develop` (user-gated dev deploy); `supabase db push` applies the cutover migrations to dev. Seed a dev "Events model QA" space via `seed_events_model_qa` (or manual `create_event`). DONE (deployed `9816f111`; QA space seeded via the real auth-gated fixture with spoofed JWT claims over the dev pooler).
- [x] **Step 2:** Drive `dev.clintapp.com` with Chrome MCP using the pre-authenticated dev profile (clear Turnstile: chrome-channel + automation-flag fingerprint per the memory note). Capture a screenshot per matrix scenario at each toggle state (default / Compare preset / full detail). DONE (authenticated session, no Turnstile; verified against the detail-level depth selector that replaced the 3 toggles + Compare preset).
- [x] **Step 3:** Produce a verification report: screenshots + pass/fail for every one of rows 1-14. Any fail becomes a fix-forward task; the cutover is authoritative-done only when all 14 are green. DONE -- **all 14 rows PASS**; runtime clean (18/18 REST 200 on the events schema, zero dropped-table refs, zero console errors). Two `seed_events_model_qa` fixture gaps logged as fix-forward (row-10 Beta under-seeded; row-12 hidden event off-horizon).
- [x] **Step 4:** Save the report under `docs/notes/` and link it from the plan. DONE -- **report: [`docs/notes/event-model-e4-visual-results.md`](../../notes/event-model-e4-visual-results.md)**.

---

## Self-Review notes

- **Coverage:** every function from the discovery inventory (33) maps to a task: A1 (get_activity_feed, get_trial_activity), A2 (get_events_page_data, get_key_catalysts), A3 (get_space_landing_stats), A4 (get_bullseye_assets/_data), A5 (search_palette, palette_empty_state), A6 (get_space_inventory_snapshot, get_ai_call_detail, get_ai_usage_rollup), A7 (get_primary_intelligence_history, build_intelligence_payload_for_row, list_materials x3), A8 (preview_* x3), C1 (4 trigger/changelog fns), C2 (update_marker_assignments), C3 (create_trial, _create_trial_date_markers, _seed_ctgov x2), C4 (commit_source_import), C5 (_seed_demo x4 + seed_demo_data), D1 (permanently_delete_space, redact_user). Plus A0 schema prereqs and the frontend services (B1-B3).
- **Out of scope (separate plans):** the IA/terminology rename (Intelligence/Activity/Event route + label renames, merged Event form, taxonomy admin) = Stage 3; the `stout-intro.html` deck refresh = Stage 5.
- **Ordering rationale:** A0 unblocks A1/A7/A8 (link entity_type + change-event column). Phase A is independently shippable (RPCs return correct data even before the frontend services are repointed, since the frontend still gets valid shapes). Phase B makes the app visibly clean. Phase C (producers) can lag because the seed.sql event block already feeds the demo space; dev gets event data when C5 lands or via manual create_event.
- **Testing in every phase (per the spec's first-class-testing rule):** Phase 0 builds the QA fixture; each subsequent phase ends with a backtest task (A9, B4, C6, D2) that asserts behavior against that fixture and the Acceptance Matrix, plus the within-phase TDD pairing; E3 is the full-suite/advisor gate and E4 is the authoritative all-14-rows cloud-dev visual artifact. No phase is "done" until its matrix rows are green.
- **Session model:** each phase is executed in its own fresh session (clear context between phases). The plan + this doctrine are the only context a phase session needs; its kickoff prompt names the phase, the worktree setup, and the backtest-before-done rule.

---

## Phase A backtest results

Task A9 capstone, run 2026-06-28 against `seed_events_model_qa` seeded into the
personas space on a clean `supabase db reset`. New spec:
`src/client/integration/tests/event-read-rpcs.integration.spec.ts` (13 tests,
all green). Migrated firewall specs: `role-access.spec.ts`,
`events-hierarchical-scope.spec.ts` (+ the shared `integration/fixtures/scratch.ts`
cleanup, which still deleted the dropped `public.markers` table).

### Data-correctness matrix rows (RPC / data layer)

| Row | Scenario | Layer (RPC) | Status | Proving assertion |
|---|---|---|---|---|
| 1 | Clinical event on trial timeline | `get_dashboard_data` | pass | Topline (type `…013`) present in `trial.markers` under the auto-derived indication |
| 2 | High-sig commercial event on asset lane | `get_dashboard_data` + admin `events`/`event_types` | pass | Distribution (type `…040`) on `asset.events`; stored significance null + `event_types.default_significance='high'` (effective high) |
| 3 | Pinned -> band; feed-only flagged | `get_dashboard_data` + admin `events` | pass | Strategic on band with `visibility='pinned'`; Leadership returned with `visibility=null` (feed-only); Leadership stored sig null + type default `low` |
| 4 | Projected event | `get_dashboard_data` + `get_events_page_data` + admin `events` | pass | `is_projected=true` on both RPCs; `event_date='2026-10-01'`; admin row `projection='primary'`, `date_precision='quarter'` |
| 11 | Phase bar regression on event-sourced trial | `get_dashboard_data` | pass | `trial.phase='Phase 3'`, `phase_data={phase_type:'P3'}`, 4 clinical events present in `trial.markers` |
| 12 | Hidden high-sig not on timeline | `get_dashboard_data` + admin `events` | pass | LOE (type `…020`) returned with `visibility='hidden'`; admin row `visibility='hidden'`, `significance='high'` |
| 5 (setup) | Activity = detected changes only | `get_activity_feed` | pass | Feed returns 0 rows; the 10 authored events do NOT appear (no `trial_change_events` seeded) |
| Bullseye | Envelope shape (A4 limit) | `get_bullseye_assets` | pass (shape only) | `assets` + `companies_with_intelligence` are arrays, no error; both empty because the fixture seeds no indications/`asset_indications` (documented A4 limitation; `recent_markers` data deferred to E4) |

Notes on the two rows where the read RPC does not filter server-side: for the
feed-only Leadership (row 3) and the hidden LOE (row 12), `get_dashboard_data`
returns the event WITH its `visibility` flag rather than stripping it. The
band-vs-feed and hidden-timeline exclusion are applied by the Stage 2c
`effectiveVisibility` logic (client-side, unit-proven). The backtest asserts the
correct flag is present so the client has what it needs; the rows are NOT
weakened. `date_precision` is not exposed by any read-RPC item shape, so row 4's
precision is verified by a direct `adminClient` events query (called out in a
spec comment).

### Cross-space read firewall (previously-dark assertions now live)

| Firewall assertion | Layer | Status | Result |
|---|---|---|---|
| Viewer cannot INSERT events | `events` RLS (role-access) | pass | reader INSERT -> 42501 (migrated `eventBody` to `event_type_id`/`anchor_type='space'`) |
| Non-member (tenant/agency/platform admin) cannot INSERT on a non-member space | `events` RLS (role-access) | pass | tenant_owner / agency_owner / platform_admin INSERT -> 42501; admin read-bypass stays read-only |
| Non-member cannot READ another space's events (dashboard) | `get_dashboard_data` (INVOKER, RLS) | pass | `no_memberships` -> empty company array |
| Non-member cannot READ another space's events (future-events) | `get_events_page_data` (INVOKER, RLS) | pass | `no_memberships` -> `total=0`, no items |
| Non-member cannot READ activity | `get_activity_feed` (DEFINER, has_space_access) | pass | `no_memberships` -> 0 rows |
| Non-member cannot READ landing stats | `get_space_landing_stats` (DEFINER, has_space_access) | pass | `no_memberships` -> `null` |
| Sibling-product no-leak (A2 scope) | `get_events_page_data` entity-level scope | pass | product scope returns only its own + descendant-trial events; sibling asset's event excluded -> **no A2 leak** |

The four `events-hierarchical-scope` scope tests (trial direct-match, product =
product + its trials, company = whole subtree, sibling no-leak) all pass: the A2
`entity_level`/`entity_id` resolution does not leak across the hierarchy.

### Known-failing (Phase C, left red intentionally)

`role-access.spec.ts` has exactly 3 remaining failures, all `seed_demo_data`
(space_owner x2 + platform_admin), which still references the dropped
`public.markers` table. `seed_demo_data` is a Phase C producer not yet repointed
(Task C5); these are expected red and out of scope for A9. All `events` RLS
tests in the file pass.

### Deferred matrix rows (per the matrix -> phase mapping)

Rows 6, 7, 8, 9, 10, 13, 14 and the full row-5 (edit -> Activity) are not
data-layer assertions: they are covered by C6 (producer backtest), B4 (frontend
service backtest), and E4 (authoritative all-14-rows visual artifact on cloud
dev).

---

## Phase B backtest results

Run 2026-06-28. Tasks B1 (trial.service reads anchored events), B2
(marker-category.service reads event_type_categories), B3 (delete dialogs +
export util consume renamed keys, drop dead marker reads) implemented + reviewed
(Approved). Plus a discovered Phase A gap remediated this phase: B-a7fix
(`list_recent_materials_for_space` was missed by A7 because the plan named it
`list_materials_recent`, which does not exist; it still read `public.markers` /
`marker_assignments` and threw on the engagement-landing RECENT MATERIALS widget).

Gate: `ng lint` clean, `ng build` clean (only pre-existing CSS-budget + CommonJS
warnings), `npm run test:units` 1427/1427 green, `supabase db reset` clean from
the worktree, advisors clean.

Visual: local serve (`ng serve --configuration local --port 8123`) from the
worktree + injected demo session; QA space `00000000-0000-0000-0000-0000000d0199`
("Events QA", demo-user owned) seeded via `seed_events_model_qa` (10 events:
asset 4 incl. 1 hidden + 1 projected, company 2 incl. 1 pinned, trial 4 clinical).

### Acceptance Matrix rows (local visual)

| Row | Scenario | Status | Evidence |
|---|---|---|---|
| 1 | Clinical event on trial row | pass | Trial Start / PCD / Topline (green) / Approval glyphs on the "QA Trial Alpha Phase 3" row; REST: 4 trial-anchored events return 200 |
| 2 | High-sig commercial event on asset lane | pass | Distribution **hexagon** glyph on the "QA Asset Alpha" lane (~Q1 '25), distinct from circle/flag glyphs |
| 3 | Low-sig leadership feed-only (no glyph) + pinned -> company band glyph | pass | Pinned Strategic event renders as a circle on the "QA PHARMA ALPHA" band (~Apr '24); the feed-only Leadership event is NOT drawn on any row |
| 7 | Default view regression (trial rows + phase bars) | pass | PH3 phase bar + clinical glyphs render on the trial row exactly as pre-cutover |
| 8 | Compare preset (Assets on, Trials off) | pass | Clicking COMPARE unchecks Trials, hides the trial row, shows the "PH 3" lead-phase chip on the asset lane, and renders asset-anchored events only |
| 13 | Company events lane (company-anchored only, no phase chip) | pass | Company band shows only the company-anchored pinned event; no phase chip on the band |
| 14 | Pinned company band glyph in asset/trial view | pass | The ~Apr '24 pinned-event circle renders on the company group-header band while asset + trial rows are shown |

### Load-clean regression (the cutover acceptance for Phase B)

| Surface | Status | Evidence |
|---|---|---|
| Timeline | pass | Console has only Vite/Angular dev messages; zero PostgrestError / dropped-table errors. REST probe: OLD `trials?select=...marker_assignments(...)` -> 400 "Could not find a relationship"; NEW `events?...&anchor_type=eq.trial` -> 200 (4 rows); `event_type_categories` -> 200; dropped `marker_categories` -> 404 |
| Future Events (catalysts) | pass | Loads clean; normal empty state "No upcoming catalysts match your filters" (not an error state) |
| Engagement landing (Home) | pass (after B-a7fix) | Before the fix, RECENT MATERIALS showed `relation "public.markers" does not exist`; after B-a7fix, `list_recent_materials_for_space` returns 200 `{rows: []}` and the page renders clean (hero band, Stout intelligence post, Next 90 Days, What Changed) |

### Notes / deferrals

- The projected `~Q4 2026` event renders on the timeline (asset-lane diamond,
  fuzzy "~Q4 '26" label) but does NOT appear in the default Future Catalysts
  list, which is a next-90-days window (Q4 2026 is beyond it). The RPC returns it
  (A9 row 4); the projected-in-Future-Events visual at a widened period is an E4
  concern. No regression.
- Rows 4, 9, 10, 12 are not in Phase B's target set (row 4/12 are data-layer in
  A9 + Stage 2c unit; rows 9/10 two-asset comparison are E4). The QA space does
  carry a second company/asset and a hidden event for E4.
- The shared local DB was `db reset` during B-a7fix, which wipes the manually
  created QA space; re-seed `seed_events_model_qa` into a demo-user-owned space
  before re-verifying.

---

## Phase C backtest results

Run 2026-06-28 against a clean `supabase db reset` (worktree), service-role
integration in isolation. Phase C (producers C1-C6) executed subagent-driven WITH
the "A-derived" sources model (Phase S) folded in mid-cutover, plus an Activity-wiring
task (CA) that restored the `trial_change_events` emission C1 retired.

### Tasks (all committed + reviewed Approved)

| Task | Commit | What |
|---|---|---|
| C1 | `05a52b04` | retire dropped-marker trigger/changelog fns |
| C2 | `d7a403d7` | single-anchor marker CRUD on events (drop update_marker_assignments) |
| S1a | `006f92c7` | event_sources table + RLS + grants + `event_registry_url` helper (SQL+TS) |
| S1b | `a26fd5b5` | create_event gains atomic `p_sources`; update_event_sources repointed |
| S2 | `d3bbb74f` | read RPCs emit `sources[]` + derived `registry_url` |
| S3 | `4744f264` | frontend reads/writes sources + derived registry link |
| C3 | `b827a6d9` | CT.gov sync emits clinical events (inline; no source_url/event_sources) |
| C4 | `fc7ba9c4` | commit_source_import emits events via create_event (+ p_sources) |
| C5 | `b1cd9f95` | demo seed producers emit events (4 fns) + 2 multi-source demo events |
| CA | `bdcea34c` | restore date-move + event-edit emission into Activity (trial_change_events) |
| S4 | `3d64cbf5` | QA fixture: multi-source event + derivable registry link (NCT id on trial) |
| S5 | `500c7d2d` | drop `events.source_url` (vestigial p_source_url param kept) |
| C6 | `e9b2a141` | producer + Activity + sources backtest spec |

### Acceptance Matrix (integration layer)

| Row | Scenario | Status | Proving spec / evidence |
|---|---|---|---|
| 5 | Event edit -> Activity, NOT Intelligence feed | PASS | `activity-wiring.integration.spec.ts`: update_event on a trial event inserts an analyst `trial_change_events` row returned by `get_activity_feed`; no `primary_intelligence` brief created |
| 6 | Intelligence brief cites an event -> citation resolves | PASS | `event-producers.integration.spec.ts`: QA fixture brief cites the topline event; the intelligence read resolves `entity_id` + `entity_name` (fails on a dangling link) |
| 11 | Phase bar derives from clinical events | PASS | `event-read-rpcs.integration.spec.ts` (exact Phase 3 + 4-event regression) + `event-producers` (producer-level `phase_data.phase_type` coexists with clinical events) |
| Sources (hardens 1-2 detail reads) | multi-source business event; clinical/ctgov no-source + DERIVED registry link; event_sources firewall | PASS | `event-sources.integration.spec.ts` (CRUD + viewer-deny/sibling-no-leak firewall), `events-model-qa-fixture.spec.ts` (2 sources on Distribution, 0 on clinical, trial NCT id), `event-producers` (2 demo multi-source events, registry_url=`https://clinicaltrials.gov/study/NCT09000001` derived not stored) |

ctgov drift (`ctgov-marker-precision-over-time.spec.ts` 35/35, incl. the CA-restored
date_moved rows), import dedup (`import-dedup.integration.spec.ts`), and role-access
(`role-access.spec.ts` 52/52, the 3 `seed_demo_data` tests now green) all green.
Full Phase C/S run set: 8 spec files / 128 tests green.

### Gates

`supabase db reset` clean (worktree); `supabase db advisors --local --type all` clean;
`grants:check` PASS (event_sources added, dark-by-default with `select` to authenticated);
`ng lint` + `ng build` clean; `npm run test:units` green.

### Known pre-existing (NOT Phase C regressions; deferred)

- `event-sources-edit-flow.spec.ts` + `event-links-edit-flow.spec.ts` query the dropped
  `event_categories` / `events.category_id` (stale old-events-shape drift; proven failing
  at pre-S5 HEAD). Stage 3 / cleanup fix.
- `linked-entities-picker.component.ts` still reads dropped `from('markers')`. Stage 3 / E3.

### Deferred to Phase D / E (next sessions)

- Phase D: `_cleanup_polymorphic_refs` must delete anchored events on entity delete
  (events.anchor_id has no FK -> orphans); `permanently_delete_space` / `redact_user`
  marker cleanup.
- Phase E: S6 docs (runbook events feature doc + glossary "Event" entry + help pages on
  the sources model) folds into E2's runbook regen; E1 `features:check` mapping of the new
  RPCs (`event_registry_url`, `create_event(p_sources)`, `update_event_sources`) + the
  `event_sources` table.

---

## Phase D backtest results

Run 2026-06-28 against a clean `supabase db reset` (worktree), service-role
integration in isolation. Phase D (cleanup + admin) executed subagent-driven.
Repoints the destructive/admin paths so deletes leave no orphaned events; the
plan-missed `_cleanup_polymorphic_refs` entity-delete task was folded in. The
`redact_user` plan note ("nulls authorship") was corrected to the live design:
authorship is deliberately PRESERVED (created_by stays; the `user_redactions`
marker drives the "(redacted user)" label) -- confirmed by the existing
`rpc-redaction.spec.ts` assertion. No code caller exists; it is a platform-admin
Tier-1 RPC exercised only by integration specs.

### Tasks (all committed + reviewed Approved)

| Task | Commit | What |
|---|---|---|
| setup | `f6e63e42` | rename event prereq + QA-fixture migrations off a develop materials version collision (mine undeployed; develop's already on dev) |
| D-trig | `3b904ecf` | `_cleanup_polymorphic_refs` deletes anchored events on trial/asset/company delete (single `where anchor_type=v_type and anchor_id=old.id`; no 'product' alias for events) + 3 entity-delete tests |
| D1 | `6db7994f` | `permanently_delete_space` drops marker delete/counts/jsonb-keys/ctgov-bracket (keeps events count + all audit); `redact_user` stale comment markers->events only; tests repointed (cascade-safety + redaction markers->events) |
| D2 | `f79bc560`, `6eebd08e` | consolidated Phase D backtest spec + audit-emission markers->events drift fix + strengthened entity-delete sources proof |

### Destructive paths -- no orphans + audit recorded (integration layer)

| Path | Status | Proving evidence |
|---|---|---|
| Space delete (`permanently_delete_space`) | PASS | `event-admin-cleanup-backtest.spec.ts` Test 1: `seed_events_model_qa` populates events/event_changes/event_sources/primary_intelligence_links (+ a manual trial_change_events row), all asserted > 0 pre-delete; after delete ALL five reach 0 for the space; an `audit_events` row `action='space.deleted' resource_id=space source='rpc'` is recorded. Also `rpc-cascade-safety.spec.ts` ("leaves no orphaned events or event_sources") + `audit-emission.spec.ts` (space.deleted metadata shape). |
| Entity delete (trial/asset/company) | PASS | `event-admin-cleanup-backtest.spec.ts` Test 2: deleting the asset that anchors the fixture's 2-source Distribution event removes that event AND its 2 event_sources (asserted exactly 2 pre-delete, 0 post), sibling company-anchored events survive. Plus `rpc-cascade-safety.spec.ts` 3 dedicated trial/asset/company delete tests. |
| User redaction (`redact_user`) | PASS | `event-admin-cleanup-backtest.spec.ts` Test 3: a scratch-user-authored event's `created_by` STILL equals the scratch user after `redact_user` (authorship preserved by design, not nulled); an `audit_events` row `action='compliance.user_pii_redacted' resource_id=user` is recorded. Plus `rpc-redaction.spec.ts` (markers->events repoint, preserve-authorship) + `audit-emission.spec.ts`. |

Full Phase D run set: `rpc-cascade-safety.spec.ts` + `rpc-redaction.spec.ts` +
`audit-emission.spec.ts` + `event-admin-cleanup-backtest.spec.ts` = **80/80 green**.

### Key finding (TDD, corrected the plan premise)

The plan assumed space deletion could rely purely on the `events.space_id`
ON DELETE CASCADE. It cannot: the `_log_event_change` BEFORE DELETE trigger
inserts an `event_changes(space_id, ...)` row during the cascade, AFTER
PostgreSQL has already removed the parent `spaces` row -> FK violation 23503
(empirically confirmed). `permanently_delete_space` therefore keeps an explicit
`delete from public.events where space_id = p_space_id` BEFORE the spaces delete
(space still present -> trigger insert OK -> event_changes then cascades away on
the spaces delete) -- the same trigger-ordering reason the old code deleted
markers first. event_sources cascades from events. The entity-delete trigger is
unaffected (the space row persists on an entity delete).

### Gates

`supabase db reset` clean (worktree); `supabase db advisors --local --type all`
"No issues found"; `npm run grants:check` PASS (no schema change). Both Tier-1
audited RPCs retain `record_audit_event()` + the `-- @audit:tier1` marker
(audit-coverage smoke migration passes on reset).

### Audit firewall preserved

`permanently_delete_space` (`space.deleted`) and `redact_user`
(`compliance.user_pii_redacted`) both keep their audit emission + `@audit:tier1`
markers verbatim; the count breakdown jsonb swapped the dropped `markers`/
`marker_types` keys for the existing `events` key (no audit coverage lost).

### Known pre-existing (NOT Phase D regressions; deferred to Phase E / Stage 3)

- `event-sources-edit-flow.spec.ts` + `event-links-edit-flow.spec.ts` query the
  dropped `event_categories` / `events.category_id` (kept out of the Phase D
  green run set).
- `linked-entities-picker.component.ts` still reads dropped `from('markers')`.
- D1 in-file smoke is a weak probe (its trial-anchored event is removed by the
  D-trig trigger before the direct `events.space_id` cascade path; and like all
  phase smokes it skips prod-safe during `db reset` since the demo space seeds
  after migrations). The authoritative no-orphan proof is the integration suite.
