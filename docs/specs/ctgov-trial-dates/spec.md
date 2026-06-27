# CT.gov Trial Date Representation + Marker Date Precision

## Overview

A trial's start/end dates are stored in two places that currently disagree:

1. **Columns on `trials`** (`phase_start_date`, `phase_end_date`, plus `phase_start_date_source` / `phase_end_date_source`). These drive the **phase bar**. They are re-derived **every** ct.gov sync by `_materialize_trial_from_snapshot`, ct.gov-wins, and analyst edits are blocked by the `_guard_ctgov_locked_phase_fields` trigger when the source is `ctgov`.
2. **Markers** (`Trial Start`, `PCD`, `Trial End`), created by `_seed_ctgov_markers`. These render as timeline markers. The seeder is **create-once** (exists-guard, never updates) and uses `_safe_iso_date`, which **drops** month/year partials and **never** sets `date_precision`.

This produces two defects:

- **Latent drift bug:** because the seeder is create-once but the columns are live-updated, after a ct.gov date change the **bar moves but the marker stays frozen** at the first-sync date. The marker is effectively never updated again.
- **Precision loss:** ct.gov frequently emits month- or year-only dates (anticipated dates especially). `_safe_iso_date` drops these, so no marker is created at all for partial-date trials, even though `markers` already supports `date_precision` and the timeline already renders approximate markers.

This spec redesigns both representations as **one combined effort**, organized into two workstreams that ship together in a single PR:

- **Workstream A (precision + drift fix):** make `_seed_ctgov_markers` precision-native and convert it from create-once to a **source-aware UPSERT** (fixing the drift bug), via a new SQL date-resolution helper.
- **Workstream B (markers become the source of truth):** drop `trials.phase_start_date` / `phase_end_date` (+ the two `*_source` columns + the date branches of the guard trigger) and **derive the phase bar from the trial's Trial Start / Trial End markers**. This removes the duplication and makes the bar precision-native.

## Sequencing decision

**Combined A + B in one PR** (decided after weighing the ramifications). Rationale:

- There is no interim where the columns still drive the bar, so the visible inconsistency window (a precision-native marker beside a partial-dropping bar) never exists, and no throwaway interim scaffolding (a midpoint shim inside `_materialize_*`, or precision columns on `trials`) is built.
- A and B share the same machinery anyway: the source-aware UPSERT + `metadata.source='ctgov'` ownership model is needed for both, so doing them together avoids building it twice.
- The cost is a single larger PR: ~14 SQL functions + ~13 client files + an irreversible column drop, landing atomically (GHA runs `supabase db push` then `wrangler deploy` in one PR, so client readers never lag the schema). It requires a pre-migration backup and a down-migration (see B4).

Because the columns are dropped in the same change, `_materialize_trial_from_snapshot` **stops writing the date columns entirely** (it keeps deriving `phase_type`), and the marker UPSERT becomes the sole writer of ct.gov date truth from day one. The SQL date-resolution helper is used only by the seeder; there is no midpoint shim in `_materialize_*`.

---

## Settled design decisions

| Decision | Resolution |
|---|---|
| **Bar derivation (Goal B)** | **Deterministic aggregation.** Bar start = earliest `Trial Start` marker's resolved date; bar end = latest `Trial End` marker's resolved date. 0 markers -> no bar (graceful). No cross-table uniqueness constraint added; tolerates manual + multi-trial markers. |
| **Bar end fallback (Goal B)** | Bar end = latest `Trial End`, **else** latest `PCD`. Preserves today's column behavior, where `phase_end_date = coalesce(completionDate, primaryCompletionDate)`. PCD remains its own point marker *and* serves as the bar-end fallback. |
| **ct.gov / analyst ownership + lock** | **Faithful port of today's ct.gov-wins model.** The seeder becomes a source-aware UPSERT keyed on `markers.metadata.source = 'ctgov'`, so ct.gov keeps its markers live each sync. Analyst edits to a ct.gov-owned Trial Start / End / PCD marker are **blocked** (mirrors the current guard trigger). Removing the NCT releases the markers to analyst ownership. |
| **Event emission on ct.gov marker UPSERT** | **The marker-audit becomes the single emitter, correctly sourced.** Because the date columns are dropped in this same change, `_materialize_*` no longer emits `phase_*_changed` events from a column diff, so there is no double emission to suppress. Instead, `_log_marker_change` must label seeding-driven marker moves as `source='ctgov'` (it currently hardcodes `'analyst'`) — driven by a transaction-local GUC (`clint.ctgov_seeding`) the seeder sets. So a ct.gov date slip emits exactly one `date_moved`-class event, sourced `ctgov`. |
| **`phase` and `phase_type` stay columns** | Only the two **date** columns move to markers. Both `phase` (human-readable string, e.g. "Phase 2/Phase 3", written by `_map_phase_array`) and `phase_type` (bucketed code `P1..P4/OBS`, written by `_derive_phase_type` / `create_trial`) remain on `trials`, along with `phase_type_source`. Neither is a Postgres `GENERATED` column — they are function-derived-and-stored. The bar still reads `phase_type` for color/label. The guard trigger is **slimmed** (its `phase_start_date` / `phase_end_date` branches removed), not deleted; the `phase_type` ownership lock is retained. |
| **Import → first-sync handoff** | The seeder UPSERT gains an **adoption** step so an NCT-bearing import does not spawn a duplicate Trial Start/End (see A2 + the Import handoff section). Preserves today's "ct.gov wins for NCT trials" while keeping the bar visible immediately on import. |
| **Fuzzy bar-endpoint rendering** | **Option C — marker-carried hollow cap** (chosen against a rendered prototype). An exact endpoint keeps a clean hard bar edge; an approximate (month/quarter/year) endpoint additionally gets the hollow end-cap (white fill, phase-colored ring) borrowed from the existing marker range-tail vocabulary, plus the `~caption`. This stays distinct from the existing ongoing/clipped feather (so "ongoing" never reads as "approximate") and invents no new visual token. Rejected: (A) hard edge + caption only (bar looks more precise than the data); (B) feathered fuzzy edge (collides with the ongoing feather). |

---

## Goal A: precision + drift fix on ct.gov-seeded markers

### A1. New SQL helper: `_ctgov_resolve_partial_date(text)`

Resolves a ct.gov date string into `(midpoint date, precision)`. CT.gov only emits `exact` (`YYYY-MM-DD`), `month` (`YYYY-MM`), or `year` (`YYYY`).

```sql
create or replace function public._ctgov_resolve_partial_date(p_text text)
returns table (resolved date, precision text)
language sql immutable set search_path = ''
as $$
  select
    case
      when p_text ~ '^\d{4}-\d{2}-\d{2}$' then p_text::date
      when p_text ~ '^\d{4}-\d{2}$'       then (p_text || '-15')::date            -- month -> YYYY-MM-15
      when p_text ~ '^\d{4}$'             then (p_text || '-07-01')::date         -- year  -> YYYY-07-01
      else null
    end,
    case
      when p_text ~ '^\d{4}-\d{2}-\d{2}$' then 'exact'
      when p_text ~ '^\d{4}-\d{2}$'       then 'month'
      when p_text ~ '^\d{4}$'             then 'year'
      else null
    end;
$$;
```

The midpoint values are **pinned to `precisionMidpointISO`** in `src/client/src/app/core/models/marker-date-precision.ts` (`month -> YYYY-MM-15`, `year -> YYYY-07-01`). CT.gov never emits quarter/half, so only `month` and `year` apply here. SQL and TS share one set of expected literals via the test layers below.

> Why not reuse `create_marker`? That RPC requires `auth.uid()` + `has_space_access` and rejects the anon/secret-gated ingest worker, and it does **not** compute midpoints (the Angular client does, before calling it). The SQL midpoint helper is genuinely needed, not duplication.

### A2. Rewrite `_seed_ctgov_markers`: precision-native + source-aware UPSERT

Current: create-once exists-guard, `_safe_iso_date` drops partials, never sets `date_precision`. (`supabase/migrations/20260503060000_seed_ctgov_markers_on_sync.sql:72-252`.)

New behavior, applied to all three system markers (`Trial Start` `…011`, `PCD` `…008`, `Trial End` `…012`):

1. Resolve `(event_date, date_precision)` from the ct.gov date string via `_ctgov_resolve_partial_date` instead of `_safe_iso_date`.
2. Derive `projection` as today: `actual` if ct.gov `type = ACTUAL`, else `company`.
3. **UPSERT with adoption**, matched on this trial + marker type, in priority order:
   - **(a) ct.gov-owned exists** (`marker_type_id` matches and `metadata->>'source' = 'ctgov'`, joined through `marker_assignments`): `update` `event_date`, `date_precision`, `projection`, and `metadata` (`snapshot_id`, `ctgov_date_type`). This is the steady-state path.
   - **(b) adoption** — no ct.gov-owned one, but exactly one **un-owned** marker of that type exists for this trial (an import/manual Trial Start/End: `metadata->>'source'` is null or not `'ctgov'`): **adopt it** — re-stamp `metadata.source='ctgov'` (preserving any other metadata keys) and update date/precision/projection. This prevents an NCT-bearing import from producing a duplicate on first sync and reproduces today's "ct.gov takes over the NCT trial's dates" lifecycle. (If two or more un-owned markers of that type exist, do **not** adopt — fall through to insert — to avoid guessing.)
   - **(c) insert** — otherwise `insert` the marker + assignment, `metadata.source='ctgov'`.
   - **null resolved date** (string unparseable/absent): no insert/adopt; if a ct.gov-owned marker already exists, leave it (do not delete) — a transient missing field should not destroy history.

   Once a marker is ct.gov-owned (via b or c), the analyst lock applies and ct.gov updates it every sync. Non-NCT trials never reach this function, so their analyst-owned markers are never adopted.
4. Set the `clint.ctgov_seeding = 'on'` GUC (transaction-local) around the writes so `_log_marker_change` labels the emitted events `source='ctgov'` (see A3).

The return value (count of markers created) becomes count created **or updated**, surfaced in the ingest summary's `markers_seeded`.

### A3. Correctly-sourced event emission (marker-audit is the single emitter)

`_log_marker_change` (BEFORE INSERT/UPDATE/DELETE on `markers`, `supabase/migrations/20260502120700_marker_changes_trigger.sql`) currently emits `trial_change_events` with a hardcoded `source='analyst'`. Because this combined change drops the date columns, `_materialize_*` no longer emits `phase_*_changed` events from a column diff, so the marker-audit is now the **only** emitter of these events. Change `_log_marker_change` to read the source from the GUC: when `current_setting('clint.ctgov_seeding', true) = 'on'`, label the emitted `trial_change_events` rows `source='ctgov'`; otherwise `'analyst'` as today. Net result: a ct.gov date slip produces exactly **one** `date_moved`-class event, correctly sourced.

> `_materialize_trial_from_snapshot` (latest: `supabase/migrations/20260625190000_restore_phase_materialization_with_acronym.sql:32-143`) is updated to **stop writing `phase_start_date` / `phase_end_date`** (the columns are dropped) while keeping its `phase_type` derivation and the events it emits for `phase_type`. See B2 for the full reader/writer rewrite list and B4 for the column-drop ordering.

### A4. Migration ordering (combined; see B4 for the full single-migration sequence)

The Workstream-A function changes are the first steps of the single combined migration (timestamp after `20260625190000`):
1. `create or replace function public._ctgov_resolve_partial_date(...)`.
2. `create or replace function public._log_marker_change(...)` (GUC-driven `source` selection; full body re-stated).
3. `create or replace function public._seed_ctgov_markers(...)` (precision + UPSERT + `clint.ctgov_seeding` GUC; full body re-stated).

The remaining steps (reader rewrites, write-path changes to markers, guard-trigger slim, the column drop, smoke, `notify pgrst`) are in **B4**, because they must land in the same migration before the columns are dropped.

> Re-state each function body from its current live definition (`select pg_get_functiondef(...)`), not from an older migration copy, to avoid silently reverting newer logic (the `restore_phase_materialization` history shows this exact regression class).

### A6. Goal A tests

**SQL in-migration smoke** (models `20260502120500_ctgov_ingest_rpc.sql:187-363`):
- `_ctgov_resolve_partial_date`: `'2026'`->`('2026-07-01','year')`, `'2026-11'`->`('2026-11-15','month')`, `'2026-11-03'`->`('2026-11-03','exact')`, malformed/null->null.
- **Over-time UPSERT**: bootstrap one trial; ingest three versions of the same NCT with an evolving start date:
  - v1 `{date:'2026', type:'ANTICIPATED'}` -> exactly **one** Trial Start marker, `event_date='2026-07-01'`, `date_precision='year'`, `projection='company'`.
  - v2 `{date:'2026-11', type:'ANTICIPATED'}` -> **same marker id** (count still 1), `'2026-11-15'` / `month` / `company`.
  - v3 `{date:'2026-11-03', type:'ACTUAL'}` -> `'2026-11-03'` / `exact` / `projection='actual'`.
  - Cleanup in reverse-dependency order.

**Vitest integration** (`npm run test:integration`), new `integration/tests/ctgov-marker-precision-over-time.spec.ts` using `buildPersonas()` + `createScratchAgency()` + `adminClient()`:
- Calls `ingest_ctgov_snapshot` across versions (service role, `local-dev-ctgov-secret`); reads markers back from the DB after each sync.
- **SQL/TS drift pin (runtime):** `expect(marker.event_date).toBe(precisionMidpointISO('month', 2026, 11))` etc., tying the SQL helper output to the TS source of truth.
- Asserts exactly one Trial Start / one Trial End / one PCD per trial after N syncs (drift fix).
- **Projection flip:** `company` -> `actual` when ct.gov `type` goes ANTICIPATED -> ACTUAL.
- **Date slip:** an anticipated date moving later/earlier updates the same marker and emits exactly **one** `date_moved`-class event (not two, and not `source='analyst'`).
- **Lock:** an analyst `update_marker`/edit of a ct.gov-owned Trial Start marker is rejected (faithful port); a subsequent sync still updates it (ct.gov retains ownership).

**Vitest units** (`npm run test:units`): `marker-date-precision.spec.ts` already pins every midpoint; Goal A reuses those exact expected values, so the SQL literals and the TS function share one source of truth.

**Worker** (`npm run test:worker`): `poller.spec.ts` mocks `ingest_ctgov_snapshot`; the worker poller/fetch layer is untouched by this change, so worker tests are unaffected (recorded for completeness).

---

## Goal B: derive the phase bar from markers, drop the columns

### B0. Why the columns can be dropped (server-side predicate audit)

A grep of all migrations for filter/sort/join/aggregate uses of `phase_start_date` / `phase_end_date` (not plain projection) found **no live RPC that predicates on these columns**. The only comparison uses are: (1) the `_materialize_*` write path, which Goal B rewrites anyway; and (2) two one-time backfill migrations (`20260618150000`, `20260618160000`) that already ran. Every dashboard / bullseye / landscape / preview RPC only **projects** the columns into returned JSON, and landscape time-range filtering is client-side. Therefore **pure client-side derivation is safe** — no denormalized trigger-maintained column or server-side span function is needed to keep queries working. The columns can be fully dropped once the projections stop emitting them.

### B1. Derivation helper (client): `deriveTrialPhaseSpan`

One pure function (node-testable) that the whole client uses instead of reading `trial.phase_start_date` / `phase_end_date`:

```
deriveTrialPhaseSpan(markers) -> {
  start: string | null, startPrecision: DatePrecision | null,
  end:   string | null, endPrecision:   DatePrecision | null,
}
```
- `start` = earliest `Trial Start` marker `event_date` (+ its `date_precision`).
- `end` = latest `Trial End` marker `event_date`, else latest `PCD` marker `event_date` (+ precision). Fallback preserves today's bar-end behavior.
- 0 relevant markers -> all null (bar does not render).

**Aggregation comparison rule (resolved):** earliest/latest is computed by comparing the stored `event_date` (the midpoint) — the single scalar each marker carries. Accepted edge case: a `year`-precision midpoint (`YYYY-07-01`) can sort as "later" than an exact January date even though the real year could start earlier; comparing by midpoint is the only honest single-scalar rule and avoids precision-aware interval math.

**Which markers participate (resolved):** match by the system `marker_type_id`s, and **include analyst-created markers of those types** (the reason aggregation was chosen over enforced uniqueness). Accepted consequence: an analyst manually adding a second `Trial Start` with a far-off date will move the bar — this is treated as analyst intent.

`get_dashboard_data` already returns markers per trial, so derivation is client-side with **no new query**. The Trial Start / End / PCD markers are identified by their system `marker_type_id`s (`…011` / `…012` / `…008`).

### B2. DB changes

**Stop selecting the columns** in every reader (each must change before/with the drop, or `42703` at call):
`get_dashboard_data`, `get_bullseye_data` (+ `_by_company` / `_by_moa` / `_by_roa`), `get_bullseye_assets`, `get_landscape_index` (+ 3 cut variants), `get_events_page_data`, `preview_company_delete`, `preview_asset_delete`. These already return markers per trial (or can join them); they drop the `phase_data.phase_start_date` / `phase_end_date` keys.

**Change write-path behavior** from columns to markers:
- `create_trial` (`supabase/migrations/20260607140000_multi_indication_on_import.sql:29-126`): the `p_phase_start_date` / `p_phase_end_date` params now create **analyst-owned** Trial Start / Trial End markers (via a new internal SQL helper, since `create_marker` needs `auth.uid()`). `phase_type` write is unchanged.
- `commit_source_import` (same file, `:145-552`): already calls `create_marker`; stop passing phase dates to `create_trial`, instead create Trial Start / End markers from the proposal's phase dates.
- `_materialize_trial_from_snapshot`: stop writing the date columns (keep `phase_type`); the seeder (now the UPSERT from Goal A) is the sole writer of ct.gov date truth.
- Demo seed: `_seed_demo_trials` (`20260502130000:551-919`) stops inserting `phase_start_date` / `phase_end_date` and instead seeds Trial Start / End markers; `seed_demo_data`'s `*_source` backfill (`20260521200900`) is removed.

**Slim the guard trigger:** `_guard_ctgov_locked_phase_fields` keeps the `phase_type` branch, drops the `phase_start_date` / `phase_end_date` branches.

**Marker-audit is the sole, correctly-sourced event emitter:** `_log_marker_change` selects `source` from the `clint.ctgov_seeding` GUC (see A3) — `ctgov` during seeding, `analyst` otherwise. Since `_materialize_*` no longer emits phase-date events, this is the only emitter; no double emission, no mis-sourcing.

**Drop columns last**, in the same migration, after all the above: `alter table trials drop column phase_start_date, drop column phase_end_date, drop column phase_start_date_source, drop column phase_end_date_source;`

### B-import. The three import paths and the ct.gov handoff

All three trial-creation paths funnel through `create_trial` / `commit_source_import`, so the write-path change in B2 covers them. What each does with phase dates, and how it hands off to ct.gov:

| Import path | Entry | Phase dates origin | Marker created |
|---|---|---|---|
| **NCT list import** | worker resolves NCTs → `commit_source_import` → `create_trial` | ct.gov data already in the proposal | analyst-owned Trial Start/End (un-owned tag) |
| **Source-document import** (URL / paste / PDF) | AI extract → review → `commit_source_import` → `create_trial` | AI-extracted from the document | analyst-owned Trial Start/End |
| **Manual single-trial** | trial-create dialog → `create_trial` (optionally ct.gov-autofilled) | analyst-typed | analyst-owned Trial Start/End |

**Ownership tag on import:** imports create the Trial Start/End markers **un-owned** (no `metadata.source='ctgov'`). This keeps `create_trial` uniform across all three paths and keeps the bar visible immediately (no "no bar until first sync" gap).

**Handoff to ct.gov:** for an NCT-bearing trial, the **first** `ingest_ctgov_snapshot` runs the seeder, which hits the **adoption** branch (A2 step b): it re-stamps the lone import-created Trial Start/End as `ctgov`-owned and refreshes the date/precision/projection — no duplicate, and from then on ct.gov owns and re-asserts it each sync, with the analyst locked out. This reproduces today's column lifecycle (import sets a provisional date; ct.gov takes over on first sync) without a parallel marker. Non-NCT trials never sync, so their import/manual markers stay analyst-owned permanently.

**Why not tag NCT-import markers `ctgov` up front?** NCT list import does have ct.gov dates in hand, so it *could* stamp `ctgov` directly. Adoption makes that unnecessary and handles all three paths (including doc/manual imports that happen to carry an NCT) with one rule, so imports stay uniform.

### B3. Client blast radius

Switch every consumer to `deriveTrialPhaseSpan` (and `phase-bar` to render precision):
- `core/models/trial.model.ts`: remove `phase_start_date` / `phase_end_date` / `phase_start_date_source` / `phase_end_date_source`; keep `phase_type` (+ `phase_type_source`).
- `features/dashboard/grid/phase-bar.component.ts`: gains `startPrecision` / `endPrecision` inputs and renders **Option C** (see B-render below). Already takes `startDate` / `endDate`.
- `features/dashboard/grid/dashboard-grid.component.ts`: bar gate + timeline domain min/max derive from the span.
- `features/manage/trials/trial-create-dialog.component.ts` + `trial-edit-dialog.component.ts`: phase start/end fields create/edit markers; the edit dialog's lock state reads marker ownership (`metadata.source==='ctgov'`) instead of `phase_*_date_source`.
- `features/manage/trials/trial-detail.component.html`: phase start/end display + source badge from markers.
- `core/services/dashboard.service.ts` + `trial.service.ts`: stop mapping `phase_data` dates / stop sending `p_phase_*_date` as columns.
- `core/services/export-common.util.ts`, `pptx-export.service.ts`, `features/manage/trials/trials-export.util.ts`: read the derived span.
- `features/source-import/review-edit.logic.ts`: source-import phase dates -> markers.
- `features/landscape/timeline-view.component.ts`, `landscape-filter-bar.component.ts`, `landscape-state.service.ts`: year-range / time-range filtering derive from the span.

### B-render. Fuzzy bar-endpoint rendering (Option C)

Chosen against a rendered prototype (kept alongside this spec: `prototype-phase-bar-optionC.html` / `prototype-optionC-detail.png`, and the three-way comparison `prototype-phase-bar-options.html` / `prototype-options-compared.png`). `phase-bar.component.ts` takes the derived span's `startPrecision` / `endPrecision` and renders:

- **Exact endpoint** (`precision === 'exact'`): unchanged — clean hard bar edge, no cap, no caption. Exact trials look exactly as they do today.
- **Approximate endpoint** (`month` / `quarter` / `year`): a hollow end-cap (white fill, phase-colored 1.5–1.8px ring, r≈5–6) centered on the bar edge, plus a mono `~caption` (`markerStartCaption` / `markerPeriodLabel` from `marker-date-precision.ts`, the same source the markers use) below the edge.
- **Ongoing / window-clipped edge**: the existing `phaseFadeStops` feather is retained and stays the meaning of "continues into the unknown." The hollow cap (bounded-but-approximate) is visually distinct from the feather (open/ongoing), so the two never collide. An endpoint cannot be both — `is_ongoing` markers have no end, so the end is feathered, not capped.

The cap reuses the marker range-tail's existing hollow-cap token; no new visual vocabulary is introduced. Captions reuse `marker-date-precision.ts`, so the bar and the co-located Trial Start/End marker show the same period string.

### B4. Migration ordering + safety (the single combined migration)

1. Take a pre-migration backup (the prod path already snapshots before every prod migration).
2. One migration: re-state all reader functions without the columns; change the write paths to markers; slim the guard trigger; update marker-audit emission; **then** drop the four columns; `notify pgrst, 'reload schema'`.
3. Provide a down-migration that re-adds the columns and re-backfills them from the Trial Start / End / PCD markers (mirror of the forward derivation) so the change is reversible.
4. Client deploy ships in the **same PR** (GHA runs `supabase db push` then `wrangler deploy` atomically), so readers never lag the schema.
5. Run `npm run docs:arch` (route/RPC/schema regen) and `supabase db advisors --local --type all` after the migration.

### B5. Goal B tests

- **Unit** (`npm run test:units`): `deriveTrialPhaseSpan` — 0/1/N Trial Start/End markers; **PCD fallback for bar end**; precision propagation; latest-wins/earliest-wins aggregation.
- **Integration** (`npm run test:integration`): after `ingest_ctgov_snapshot`, `get_dashboard_data` returns the markers needed to derive the span, and the derived span matches what the dropped columns would have held (including the PCD fallback case: completion date absent, PCD present -> bar end = PCD).
- **Component**: `phase-bar` renders Option C — exact endpoint = hard edge (no cap); approximate endpoint = hollow cap + `~caption`; ongoing endpoint = feather (distinct from the cap). Assert an approximate end and an ongoing end render different treatments (no collision).
- **Regression**: `create_trial` and `commit_source_import` with analyst phase dates produce Trial Start / End markers and a correctly-rendered bar.
- **Import → ct.gov handoff (adoption)**: import an NCT trial (creates an un-owned Trial Start), then `ingest_ctgov_snapshot` for that NCT → assert there is still exactly **one** Trial Start marker (adopted, now `metadata.source='ctgov'`, date refreshed from ct.gov), not two. Then assert a non-NCT manual trial's analyst Trial Start is never adopted across syncs. Also assert the two-un-owned-markers case falls through to insert (no adoption guess).

---

## Out of scope

- Quarter/half precision from ct.gov (it never emits these; only `month` / `year` partials).
- Changing the `PCD` marker into a bar endpoint in its own right (it stays a point marker; it is only the bar-end *fallback*).
- Enforcing one-Trial-Start-per-trial via DB constraint (deterministic aggregation is used instead).
- Any change to the worker poller / fetch layer (`poller.spec.ts` orchestration is untouched).
- Analyst-override-wins ownership (rejected in favor of the faithful ct.gov-wins port).

## Open questions

None block the spec. Two implementation-time confirmations remain:

1. The exact `update_marker` / edit RPC path that must enforce the ct.gov-owned lock (A6 lock test) — confirm whether the lock lives in the edit RPC or a trigger on `markers`, mirroring how `_guard_ctgov_locked_phase_fields` works for columns today.
2. Whether the down-migration's column re-backfill (B4.3) needs to reconstruct `*_source` values, or whether re-adding the columns nullable-and-empty is an acceptable rollback floor.

> Resolved during speccing: fuzzy bar-endpoint rendering = **Option C** (marker-carried hollow cap), chosen against the `phase-bar-optionC.html` prototype. See the Settled decisions table and B-render.
