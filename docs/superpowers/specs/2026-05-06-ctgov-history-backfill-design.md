# CT.gov History Backfill and Marker Sync Design

**Date:** 2026-05-06
**Status:** Draft

## Problem

Two related gaps in how Clint surfaces CT.gov change activity:

1. **No historical events.** When a trial is first synced, only the current state is ingested as a single snapshot. The diff/classify pipeline needs at least two consecutive snapshots to emit `trial_change_events`, so freshly-synced trials show an empty activity feed -- even though CT.gov has months or years of authoritative history available via its internal history API. The engagement-landing "What changed" widget stays dark for any newly-seeded space until two scheduled syncs have run with intervening real-world changes.

2. **Auto-seeded timeline markers go stale.** `_seed_ctgov_markers` creates Trial Start, Primary Completion Date (PCD), and Trial End markers from each new snapshot but only on first creation. If CT.gov later flips PCD from `ANTICIPATED 2026-09-15` to `ACTUAL 2026-11-30`, the marker stays at the original date forever. The activity feed gets the right `date_moved` event from the CT.gov diff path, but the timeline visualization is wrong.

The fix: load real CT.gov version history on first sync of each NCT (capped per space), and let sync update CT.gov-sourced markers as their underlying CT.gov dates change.

## Goals

- Demo and production spaces both show real CT.gov-derived events (`phase_transitioned`, `status_changed`, `sponsor_changed`, `date_moved`, etc.) immediately after first sync of each NCT, drawn from authentic CT.gov history.
- CT.gov-sourced timeline markers (Trial Start, PCD, Trial End) stay in sync with the latest CT.gov payload.
- History depth is configurable per space, defaulting to 18 months -- the recent-relevance window for the activity feed.
- The full pipeline is idempotent: rerunning a backfill against the same NCTs is a no-op.
- Local-dev workflow uses the existing `wrangler dev` flow; no new CLI scripts.

## Non-Goals

- **No locking on analyst edits to CT.gov-sourced markers.** Sync always overwrites CT.gov-sourced markers from the latest payload. Analyst edits are temporary until next sync. If an analyst wants persistent disagreement with CT.gov, the future-state move is to create an independent (analyst-sourced) marker -- a separate spec.
- **No "rebuild history" super-admin UI.** Manual triggering happens via a worker route (curl-able). A super-admin button is a future enhancement.
- **No expansion of auto-seeded marker types.** Trial Start / PCD / Trial End remain the only CT.gov-sourced markers. Topline Data, Approval, LOE etc. need separate feeds (FDA / EMA / press releases) and are out of scope.
- **No per-NCT parallel fetch within history.** Historical version payloads are fetched sequentially per NCT to avoid hammering `/api/int/`. Cross-NCT parallelism stays at the existing `CTGOV_PARALLEL_FETCHES` level.

## Architecture

### Schema change: per-space history window

```sql
alter table public.spaces
  add column ctgov_history_window_months int not null default 18;

comment on column public.spaces.ctgov_history_window_months is
  'Maximum age (in months) of CT.gov historical snapshots fetched on first sync of an NCT in this space. Default 18 = recent-relevance window for the activity feed. Set higher to backfill deeper history; set lower for faster first-syncs at the cost of older events.';
```

No RLS change required: `spaces` is already covered via `has_space_access`. For v1 the value is set via direct UPDATE; a super-admin/owner UI is a future addition.

### CT.gov client extension

Add one method to `src/client/worker/ctgov-sync/ctgov-client.ts`, mirroring the opportunistic style of `fetchHistory`:

```ts
fetchHistoryVersion(nctId: string, version: number): Promise<unknown | null>
```

Hits `/api/int/studies/{nctId}/history/{version}` and returns the parsed JSON payload, or `null` on any failure (HTTP, parse, network). Like `fetchHistory`, never throws -- the caller treats `null` as "history endpoint unavailable" and falls back.

The existing `fetchHistory` continues to drive the version list; `fetchHistoryVersion` retrieves the actual payload at each version.

### Poller: first-sync history backfill

Modify `fetchAndIngestNct` in `poller.ts`. The flow becomes:

1. Fetch current state via `/api/v2/studies/{nct}` (unchanged).
2. Extract `last_update_posted_date` from the payload (unchanged).
3. **For each assignment**, branch on `latest_ctgov_version`:
   - **`IS NULL` (first-time):** attempt history backfill (steps 4-7 below).
   - **Already populated:** existing single-snapshot ingest of current state.
4. Look up `ctgov_history_window_months` for this assignment's space (one query up front for all unique space_ids in the batch).
5. Call `fetchHistory(nct)` to get version metadata.
6. Filter the version list: keep entries with `date >= today - window_months months`.
   - If 0 or 1 entries survive: skip backfill, fall back to single current-state ingest. (One entry means there's nothing to diff against; the existing single-ingest path is correct.)
7. Pre-fetch all historical payloads via `fetchHistoryVersion` for entries 1..N-1 (the last entry equals the current state already fetched in step 1). Sequential per NCT.
   - **On any single payload fetch failure: abort backfill for this assignment.** Log the error in `error_summary` and fall back to single current-state ingest. No partial history ever lands in the DB.
8. On all-success: ingest payloads in ascending version order via `ingest_ctgov_snapshot` with `fetched_via='int_backfill'`. The diff/classify pipeline runs naturally between consecutive ingests, emitting all the historical `trial_change_events` retroactively.

**Idempotency.** Snapshot insert uses `on conflict (trial_id, ctgov_version) do nothing`. The diff/event/marker emission in `ingest_ctgov_snapshot` only fires when a snapshot is newly inserted (existing early-exit guards). Rerunning the manual trigger against the same NCTs is a pure no-op.

**Cross-space sharing.** Each assignment is independent because snapshots are keyed `(trial_id, ctgov_version)` and trial_id is per-space. Pre-fetched payloads can be cached in memory across the assignment loop for a single NCT to avoid duplicate fetches when the same NCT is in multiple spaces.

### CT.gov marker sync (replaces `_seed_ctgov_markers`)

Rename `_seed_ctgov_markers` to `_sync_ctgov_markers`. The new behavior on each `ingest_ctgov_snapshot` call:

For each of the three CT.gov-sourced marker types (Trial Start, PCD, Trial End):

1. Look for an existing marker assignment of that type on the trial.
2. **If none exists:** create the marker (current behavior, unchanged).
3. **If one exists with `metadata->>'source' = 'ctgov'`:** update `event_date` and `projection` to match the new payload's date and `type` (ACTUAL → 'actual', otherwise → 'company'). Also update the `metadata.snapshot_id` to point at the latest snapshot for provenance.
4. **If one exists without `metadata->>'source' = 'ctgov'`:** skip. The marker is analyst-created from scratch (not auto-seeded), so sync has no claim on it.

The existing dedup-on-restoration trade-off (deleted auto-seeded markers get re-created on next sync) carries over -- still acceptable for v1.

### Suppress double-counting on marker events

The existing CT.gov diff pipeline (`_classify_change` in `20260502120400_ctgov_helper_functions.sql`) already emits `date_moved` events with `source='ctgov'` for changes to:
- `protocolSection.statusModule.startDateStruct.date`
- `protocolSection.statusModule.primaryCompletionDateStruct.date`
- `protocolSection.statusModule.completionDateStruct.date`

If the new `_sync_ctgov_markers` updates a marker's `event_date`, the markers audit trigger would emit a second `date_moved` with `source='analyst'` -- double-counting in the activity feed.

**Solution: session-local GUC.**

```sql
-- inside _sync_ctgov_markers, before any UPDATE:
perform set_config('clint.ctgov_sync_in_progress', 'on', true);

-- inside _emit_events_from_marker_change:
if current_setting('clint.ctgov_sync_in_progress', true) = 'on' then
  -- skip event emission; CT.gov diff path already emitted authoritative events
  return;
end if;
```

The `marker_changes` audit row is still written for traceability (the audit log captures every state change regardless of source). Only the typed-event fan-out is suppressed.

`set local` semantics: the GUC scope is the current transaction. Each `ingest_ctgov_snapshot` call runs in its own transaction (worker-driven), so the flag never bleeds to UI-driven UPDATEs.

### Worker route: manual trigger

New `POST /admin/history-backfill` route in the worker. Body:

```ts
type Body =
  | { nct_ids: string[] }   // targeted: backfill these specific NCTs
  | { space_id: string }    // bulk: backfill every NCT in this space
```

Validated as exactly-one-of (request fails with 400 if both or neither set).

**Auth:** `Authorization: Bearer ${CTGOV_WORKER_SECRET}` header (matches the existing pattern for worker-only endpoints).

**Behavior:** Calls a new `runHistoryBackfill(env, args)` poller entry point. Internally reuses `fetchAndIngestNct`, which already branches on `latest_ctgov_version IS NULL`. For the `space_id` form, runs a SECURITY DEFINER RPC up front to resolve the space's NCTs, then proceeds.

Records one `ctgov_sync_runs` row with status, same as scheduled syncs.

### Auto-trigger via existing scheduled sync

No additional trigger needed for production. The existing `runScheduledSync` already picks up freshly-created trials because:

- `get_trials_for_polling` returns trials with `last_update_posted_date IS NULL`.
- `needsFullPull` returns true when `ourLastPost` is null.
- `latest_ctgov_version IS NULL` on a fresh trial routes through the new history-backfill branch in `fetchAndIngestNct`.

So when an analyst adds a new trial, the next cron tick automatically backfills its history. The manual route exists for retro-backfilling trials that were synced before this feature shipped (and for local-dev demo lighting).

## Local Dev Workflow

After `supabase db reset`:

```bash
# Terminal 1: start the worker locally
cd src/client && wrangler dev

# Terminal 2: trigger history backfill for the entire demo space
curl -X POST http://localhost:8787/admin/history-backfill \
  -H "Authorization: Bearer $CTGOV_WORKER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"space_id": "<demo-space-uuid>"}'
```

The seeded cardiometabolic NCTs (SURMOUNT-1 / NCT04184622, ATTAIN-1 / NCT05869903, etc.) all have real CT.gov history. After the curl returns, the engagement-landing "What changed" widget shows real `phase_transitioned`, `status_changed`, `sponsor_changed`, and `date_moved` events from CT.gov, and the Trial Start / PCD / Trial End markers reflect their current CT.gov values.

A snippet under "Demo data: lighting up the activity feed" gets added to `CLAUDE.md`.

## Migration Plan

Single migration file: `supabase/migrations/<ts>_ctgov_history_backfill.sql`.

Contents:
1. `alter table public.spaces add column ctgov_history_window_months int not null default 18`
2. Replace `_seed_ctgov_markers` with `_sync_ctgov_markers` (drop the old function, create the new one). Update the call site in `ingest_ctgov_snapshot`.
3. Update `_emit_events_from_marker_change` to early-return when `clint.ctgov_sync_in_progress = 'on'`.
4. End-to-end smoke test: bootstrap fixture, ingest two snapshots with shifting PCD, verify (a) the marker date updates, (b) exactly one `date_moved` event exists for the field (CT.gov-sourced), (c) `marker_changes` has the audit row.

Worker code changes ship in the same PR:
- `ctgov-client.ts`: add `fetchHistoryVersion`.
- `poller.ts`: history backfill branch in `fetchAndIngestNct`, new `runHistoryBackfill` entry point.
- New worker route handler in the existing fetch handler.
- Tests in `worker/test/ctgov-sync/`.

Existing already-synced trials in any production space stay at their current marker dates until the next scheduled sync of each NCT, which then runs through the new sync logic and updates them. No one-shot retroactive marker fix needed.

## Testing

Test coverage matches the existing patterns in the codebase: every new or modified stored procedure ships with an inline `do $$ ... $$` smoke test in its migration; worker code gets unit tests in `worker/test/ctgov-sync/`; the end-to-end UI flow gets a Playwright test.

### Stored procedure tests (in-migration smoke)

Bottom of the new migration, hermetic fixture (agency / tenant / space / company / product / TA / trial / users), exercises every branch then tears down. Mirrors the structure of `20260503060000_seed_ctgov_markers_on_sync.sql` and `20260502120800_change_feed_surface_rpcs.sql`.

Cases to cover:

- **`_sync_ctgov_markers`, first sync, all three dates present.** Asserts 3 markers created with correct projection mapping (ACTUAL → 'actual', ANTICIPATED → 'company'), each linked to one snapshot via `metadata.snapshot_id`.
- **`_sync_ctgov_markers`, second sync with shifted PCD.** Asserts the PCD marker's `event_date` updated to the new value, projection updated, `metadata.snapshot_id` points at the latest snapshot, and `marker_changes` has exactly one `'updated'` audit row for it.
- **`_sync_ctgov_markers`, second sync with PCD ANTICIPATED → ACTUAL.** Asserts projection flipped from 'company' to 'actual'.
- **`_sync_ctgov_markers`, marker exists but `metadata.source` is not 'ctgov'.** Asserts the marker is left untouched (analyst-created marker is sacred to sync).
- **Double-counting suppression.** Two snapshots with PCD date shift; assert exactly one `date_moved` event exists in `trial_change_events` for the relevant field, and it has `source='ctgov'` (from the diff path), not `source='analyst'` (from the marker trigger). Belt-and-suspenders: assert no analyst-source `date_moved` events were emitted with `derived_from_marker_change_id` pointing at the sync-driven audit row.
- **GUC scope isolation.** Inside one transaction, `_sync_ctgov_markers` runs (sets the GUC, updates a marker, suppresses event). In a separate transaction, an analyst-driven UPDATE on a different marker fires the trigger and emits an event normally. Asserts the GUC didn't bleed across transactions.
- **`ingest_ctgov_snapshot` with `int_backfill` source.** Existing tests cover `manual_sync` and `v2_poll`; add one ingest with `fetched_via='int_backfill'` to confirm the new code path works end-to-end.
- **History backfill replay produces the right event sequence.** Insert three snapshots in ascending version order via direct calls (simulating what the worker would do for a 3-version history backfill), assert the expected `phase_transitioned` and `status_changed` events are emitted between consecutive versions, and the timeline markers reflect the final state.

### Worker unit tests

Files in `src/client/worker/test/ctgov-sync/`:

- **`ctgov-client.test.ts` extension.** New cases for `fetchHistoryVersion`:
  - Happy path: returns parsed payload.
  - 404: returns null.
  - 5xx: returns null (opportunistic, never throws).
  - Network error: returns null.
  - Malformed JSON: returns null.
- **`poller.test.ts` (or new `history-backfill.test.ts`).** Mock the CT.gov client and Supabase RPC layer:
  - First-time sync (`latest_ctgov_version IS NULL`), happy path: fetches history list, fetches all per-version payloads, calls `ingest_ctgov_snapshot` once per version in ascending order with `fetched_via='int_backfill'`.
  - First-time sync, history list empty: falls through to single current-state ingest with `fetched_via='v2_poll'`.
  - First-time sync, one history entry only: falls through to single current-state ingest (no diff possible).
  - First-time sync, window filter leaves only 1 entry: falls through to single current-state ingest.
  - First-time sync, mid-backfill payload fetch failure: aborts backfill, falls through to single current-state ingest, no historical snapshots written. Error logged in `error_summary`.
  - Already-synced (`latest_ctgov_version` set): existing single-snapshot path runs, no history fetch attempted.
  - Cross-space: same NCT in two spaces, one fresh and one populated -- fresh gets backfill, populated gets single ingest, payloads cached and not refetched.
  - `runHistoryBackfill` entry point: `nct_ids` form filters to requested NCTs; `space_id` form resolves all NCTs in the space; unknown NCTs surface as errors.
- **Route handler test.** Verifies auth (rejects without secret, accepts with secret), body validation (rejects when both or neither of `nct_ids` / `space_id` are set), and routes to `runHistoryBackfill`.

### End-to-end Playwright test

New spec in `src/client/e2e/`:

- **Activity feed populates after history backfill.** Sign in to a fresh demo space, navigate to engagement landing, assert the "What changed" widget is empty. Run the worker history-backfill against the space (via the existing test helper that calls the worker's local URL, or by directly calling `ingest_ctgov_snapshot` with synthetic snapshots if the worker isn't running in CI). Reload, assert the widget now shows multiple events with the expected event types (`phase_transitioned`, `status_changed`, `date_moved`).
- **Trial detail provenance.** Navigate to a trial that was history-backfilled. Assert the snapshot history list (under field-visibility / provenance UI) shows multiple versions, each marked `fetched_via='int_backfill'` for the historical ones and `'v2_poll'` for the most recent.
- **Marker date update.** Trigger a second sync against a snapshot with a shifted PCD date. Reload the trial detail timeline. Assert the PCD marker has moved to the new date and that exactly one `date_moved` event for that change appears in the trial activity panel.

If running the worker in CI is too heavy, the Playwright tests can short-circuit by calling the SQL pipeline directly (insert synthetic snapshots) and exercising the rendered UI -- the worker-poller path is already covered by unit tests, so the E2E test just needs to verify "events on disk → UI renders correctly." Decision deferred to the implementation plan.

## Open Questions

None blocking. A few items called out as future enhancements:

- Super-admin UI for `ctgov_history_window_months` (post v1).
- "Detach from CT.gov" action on individual markers for analysts who want persistent disagreement (post v1, separate spec).
- Per-NCT parallel fetch within history (only if rate limits become a real bottleneck).

## File Touch List

- `supabase/migrations/<ts>_ctgov_history_backfill.sql` (new)
- `src/client/worker/ctgov-sync/ctgov-client.ts` (extend)
- `src/client/worker/ctgov-sync/poller.ts` (extend)
- `src/client/worker/ctgov-sync/types.ts` (minor: maybe extend `IngestArgs.fetched_via` if not already covering `'int_backfill'` -- already does)
- Worker route handler (entry point, file location TBD by writing-plans skill)
- `src/client/worker/test/ctgov-sync/*.test.ts` (extend with `fetchHistoryVersion` cases, history-backfill cases, route handler tests)
- `src/client/e2e/*.spec.ts` (new Playwright spec for activity-feed-populates-after-backfill, marker-date-update, and trial-detail-provenance)
- `CLAUDE.md` (local-dev snippet)
