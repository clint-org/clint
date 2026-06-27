# Idempotent Source Import: Marker/Event Dedup

**Status:** Design approved, pending spec review
**Date:** 2026-06-27
**Area:** Source import (AI extraction → review → commit)

## Problem

Re-importing a source document creates duplicate markers and events on a trial. This was confirmed against the dev DB: the VANQUISH-1 trial (`adcf5fd2-…`) held 3 markers + 2 events after a first import, then 6 markers + duplicate events after a near-identical second import where the source text differed by a few characters.

Root causes, established by investigation:

1. **No per-marker/event matching anywhere.** Companies, assets, and trials carry a `match` field (the LLM tags `existing` vs `new`, the worker verifies, the commit RPC reuses the id). Markers and events have no `match` field in the schema, no matching instruction in the prompt, no verification in the validator, and no match handling in `commit_source_import` — they are always created.

2. **The only existing guard is whole-source and exact.** `commit_source_import` rejects a re-commit when a `source_documents` row with the same `text_hash` already exists in the space (returns `{code:'duplicate_source'}`). This blocks *byte-identical* re-imports only. Any change to the source text (a reworded press release, a second outlet covering the same readout) changes the hash, bypasses the guard, and — with no per-item dedup — re-inserts every marker/event.

3. **The duplicate-source guard fails silently in the UI.** When the guard fires, the RPC returns a *success* payload `{code:'duplicate_source'}` (not a PG error). `review-page.confirm()` checks only `error`, so it shows the green "Committed N items" toast and navigates away having inserted nothing.

4. **Extraction runs at temperature 1.0.** The worker sets no `temperature`, so it defaults to 1.0 (maximum). A temperature sweep (24 calls, `claude-sonnet-4-6`, the VANQUISH-1 source, 6 runs per temp) showed temperature 1.0 is the worst for run-to-run reproducibility of marker titles, while faithfulness, latency, and token cost are unaffected by temperature. This is not the cause of cross-source duplication, but it amplifies the title variance that makes dedup necessary.

### Why exact-string dedup cannot work

The same temperature sweep, plus the two real prod imports, showed the model varies **both** the marker `title` and the marker `type` across extractions of near-identical text (e.g. Mar 12 topline produced 4 distinct titles in 6 runs at temp 1.0; the NDA marker drifted `Submission` → `Regulatory Filing` between the two prod imports). The only stable fields are **trial + event_date**. No deterministic key on (type, title) survives this drift, and a key on (trial, date) alone is too coarse — it would merge two genuinely different milestones that share a date. Matching must be **semantic**, judged by the model, not a SQL equality.

## Decisions

- **Match approach: LLM semantic match.** Extend the existing company/asset/trial pattern to markers/events. The model sets `match.kind='existing'` when a proposal is the *same real-world milestone* as an existing inventory instance, anchoring on **trial + event_date** as the strong prior while tolerating title/type drift, and reading title/type/category/evidence to distinguish genuinely different same-date items.
- **On match: skip (idempotent).** A matched marker/event is left untouched and not re-inserted. Re-importing becomes a no-op for matched items; manual edits made after the first import are preserved. A future "update from source" can be added separately.

### Safeguards against false merge

Because skip-on-match *drops* the second item, a wrong merge is costlier than a missed dup (which is just noise). Two safeguards bias toward the safe failure:

1. **Prompt bias toward `new` under uncertainty.** The prompt states explicitly that a missed duplicate is recoverable but a wrongly-merged distinct item is lost, so the model marks `existing` only when confident it is the same milestone; otherwise `new`.
2. **One-to-one constraint in the validator.** Each existing inventory id may be claimed by at most one proposal in a batch. If two proposals both claim the same existing marker/event id, the validator keeps the first and demotes the rest to `new`. This structurally prevents two distinct items collapsing onto one existing record.

Plus visibility: matched rows render as `EXISTING` in the review grid, so the user sees what is being treated as a duplicate before confirming.

## Components

### 1. Inventory snapshot — emit existing instances
`public.get_space_inventory_snapshot(p_space_id)` currently emits company/asset/trial/indication/MOA/ROA instances plus the `marker_types` and `event_categories` *catalogs*. Add, for each trial already in the snapshot:

- existing **markers**: `id`, `trial_id`, marker-type name, `title`, `event_date`
- existing **events**: `id`, anchor (level + entity id), category name, `title`, `event_date`

Events anchor at space/company/asset/trial — the snapshot must include events at every in-scope anchor level, not just trial-anchored ones. These instances flow into the snapshot hash, so `inventory_drift` detection continues to work. Bound the payload with a per-trial cap on instances; if a trial exceeds the cap, include the most recent and emit a logged warning (no silent truncation).

### 2. Schema + prompt + validator (worker `src/client/worker/source-extract/`)
- **`types.ts`** — `MarkerSchema` and `EventSchema` gain a `match` discriminated union (`{kind:'existing', id}` | `{kind:'new'}`), identical in shape to `CompanySchema`/`AssetSchema`/`TrialSchema`.
- **`prompt-builder.ts`** — the `markers`/`events` output shapes gain the `match` key. Instructions: set `existing` with the inventory id when the proposal is the same real-world milestone as an existing instance — anchor on trial + event_date, tolerating wording/type drift; read title/type/category/evidence to keep genuinely distinct same-date items separate; **when uncertain, mark `new`** (a missed dup is recoverable; a wrong merge loses data). The existing instances from Component 1 are already serialized into the `<inventory>` block.
- **`response-validator.ts`** — add a `checkExistingId`-style step for markers/events:
  - claimed id not present in the supplied inventory instance set → demote to `{kind:'new'}` (safe; worst case a tolerated dup, never data loss);
  - matched record must belong to the same trial/anchor the proposal resolves to → else demote to `new` (blocks cross-trial mismatch);
  - **one-to-one**: track claimed ids; a second proposal claiming an already-claimed id is demoted to `new`.

### 3. `commit_source_import` — honor existing match (skip)
The markers and events loops currently call `create_marker`/`create_event` unconditionally. Change: if `v_item->'match'->>'kind' = 'existing'`, verify the id exists and belongs to `p_space_id`, then **skip creation** and record the id under a `skipped`/`existing` key in the returned JSON (separate from `created`). Implement as a new migration using `CREATE OR REPLACE` based on the **live** `pg_get_functiondef('public.commit_source_import')` (not the migration-file copy) to avoid reverting newer logic. Signature is unchanged (only the body changes), so no PostgREST reload is required, but verify with a call-time smoke that all prior behavior is retained.

### 4. Frontend — badge + selection (`src/client/src/app/features/source-import/`)
`review-grid.logic.ts::entityState()` already returns `'existing'` when `match.kind==='existing'` or `existing_id != null`, so matched leaf rows get the `EXISTING` badge and drop out of the "New" filter once the data carries a match. Two wirings:
- `review-page.component.ts::leafRow()` must thread `match` from the marker/event proposal onto the grid node.
- Default matched markers/events to **deselected**, so "Confirm N items" reflects what is actually added (matched items are skipped on commit regardless, but the count must be honest).

### 5. Fix: silent no-op on duplicate-source commit (`review-page.component.ts`)
`confirm()` (≈ line 1241) checks only `error`. The RPC returns `{code:'duplicate_source', existing_id}` as a *success* payload, so the handler falls through to the success toast and navigates away with nothing inserted. Fix:
- inspect `data.code`; if `'duplicate_source'`, do **not** show the success toast — warn "This exact source was already imported; nothing was added" and offer a **Commit anyway** action;
- Commit anyway re-sends with `allow_duplicate:true` in `p_source_document` (`buildCommitPayload()` at ≈ line 1420 currently omits the flag; the RPC already honors it).

This is self-contained and shippable independently of the dedup work. With per-item dedup in place, "Commit anyway" on identical text would skip all matched markers/events rather than duplicating them.

### 6. Temperature tweak (`handler.ts`, `nct-handler.ts`)
Set `temperature: 0.2` on the `client.messages.create` call. **Guard by model**: Sonnet 4.6 accepts `temperature`, but an Opus 4.7/4.8-class adaptive-thinking model rejects it with a 400 — send the parameter only for models that accept it (or gate on the preflight-resolved model). Complementary improvement; not load-bearing for dedup.

## Error handling / known risks

- **False merge** — the LLM maps two genuinely-different same-date items to one existing record; skip drops the second. Mitigated by the prompt `new`-bias, the validator one-to-one constraint, date-exact anchoring, and review-grid visibility. Residual risk accepted for v1 and documented.
- **Hallucinated id** — claimed id not in inventory → validator demotes to `new` (creates a fresh record; safe).
- **Snapshot bloat** — per-trial cap with a logged warning.
- **Anchor coverage** — events must be matched at their true anchor level; the snapshot includes events at every in-scope anchor level.

## Testing (paired per task, not deferred)

- **Integration** (local Supabase, real RPCs): import source A → re-import a near-duplicate covering the same trial → assert zero new marker/event rows and that the commit result reports them under `existing`/`skipped`. Mind seeding order (insert trials before `asset_indications` so `trg_auto_derive` does not null `development_status`) and shared-local-DB contention (apply via `db reset`, verify in isolation).
- **Validator unit**: demotion when claimed id absent from inventory; cross-trial rejection; one-to-one demotion of a duplicate claim.
- **Snapshot**: existing marker/event instances present per trial at each anchor level; hash stable across calls; cap + warning on overflow.
- **Frontend** (`review-grid.logic.spec.ts` / component spec): matched marker leaf row → `state:'existing'`, deselected by default; `confirm()` on a `duplicate_source` payload shows the warning + "Commit anyway", not the success toast.

## Scope / sequencing

- **Task #1 (silent no-op fix)** and **Task #6 (temperature)** are self-contained and can land first.
- **Task #2 (snapshot + schema + prompt + validator + commit)** is the core dedup work.
- **Task #3 (honest `New` badge)** falls out of #2 once markers/events carry a match.

## Out of scope (future)

- "Update from source" on match (overwrite existing fields from the new extraction).
- Per-row skip-vs-update choice in the review UI.
- Relaxing the whole-source `text_hash` guard now that per-item dedup exists.
- Letting a user manually un-match a wrongly-matched row in review.
