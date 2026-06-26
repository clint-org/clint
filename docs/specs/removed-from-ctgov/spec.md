---
id: spec-2026-removed-from-ctgov
title: "Surface \"Removed from CT.gov\" (registry-removal) in the UI + restore-on-resync"
slug: removed-from-ctgov
status: draft
created: 2026-06-26
updated: 2026-06-26
depends-on: null
supersedes: null
---

# Surface "Removed from CT.gov" in the UI

## Summary

The daily CT.gov sync already detects when a trial's NCT has been **removed from
the ClinicalTrials.gov registry** (the API 404s the full pull) and records it
(migration `20260625200000_ctgov_withdrawn_trials.sql`):

- `trials.ctgov_withdrawn_at timestamptz` (null = live; set on first 404),
- a one-time `trial_change_events` row, `event_type = 'trial_withdrawn'`,
  payload `{nct_id, reason: 'ctgov_404'}`,
- the trial is dropped from `get_trials_for_polling` so it is no longer
  re-fetched daily (this stopped a permanently-dead NCT from pushing a 404 into
  `error_summary` on every run).

That state has **no UI surface today**, so an analyst cannot tell a trial fell
out of CT.gov. This spec surfaces it on the **trial detail header**, in the
**activity feed**, and as a **muted treatment on the dashboard timeline**, and
adds a **manual restore path**: the "Sync from CT.gov" button stays enabled so a
trial that returns to the registry is un-withdrawn (flag cleared, re-included in
daily polling, un-muted) and the round trip is recorded as a new
`trial_restored` event.

It also fixes a latent bug found during exploration: the existing
`trial_withdrawn` activity-feed summary reads `payload.last_seen_post_date`,
which the worker payload never sets, so it currently renders "(last seen
**undefined**)".

## Critical terminology (do not conflate)

Three distinct concepts share the word "withdrawn"; the UI must keep them apart.

1. **`trials.status`** (development status, e.g. "Terminated") -- the study's
   clinical status, readable on a *live* CT.gov record. Renders today as the
   header badge via `<app-status-tag [label]="t.status">`.
2. **CT.gov `overallStatus = WITHDRAWN`** -- a *study status* meaning withdrawn
   before enrollment; lands in `recruitment_status` on ingest. Still a live
   record.
3. **`ctgov_withdrawn_at` / `trial_withdrawn` (reason `ctgov_404`)** -- the
   *registry record itself was removed*; the NCT no longer resolves at all, so
   its status can no longer be read. **THIS feature.**

Because of (2), the user-facing label is **"Removed from CT.gov"**, never
"Withdrawn". A trial can be both "Terminated" (status) and "Removed from CT.gov"
(registry-gone) at once; they are orthogonal, which is exactly why this cannot
be a status value and needs a separate indicator.

## Motivation

- An analyst reviewing a trial whose registry record has been pulled sees no
  signal; they may read stale CT.gov columns as current.
- The only related affordance is a **transient, client-side** probe
  (`nctValidity()` in `trial-detail.component.ts`, lines ~196-221) that fetches
  `clinicaltrials.gov/api/v2/studies/<nct>` on load and shows a "not found"
  `p-message` near the Sync button (template lines ~607-614). It is not
  persisted, is invisible offline, and does not reflect the authoritative
  `ctgov_withdrawn_at` state.
- The activity-feed entry exists but is mislabelled ("Trial withdrawn",
  conflating with concept 2) and renders a broken "(last seen undefined)"
  summary.
- There is **no path anywhere that clears `ctgov_withdrawn_at`**, so a trial
  that returns to CT.gov would stay marked removed forever, and the manual
  "Sync from CT.gov" button silently no-ops on a withdrawn trial (its NCT is
  excluded from `get_trials_for_polling`, so the worker reports it as
  `unknown_nct` and ingests nothing).

## Goals

- Trial detail header shows a distinct **amber** "Removed from CT.gov · <date>"
  indicator when `ctgov_withdrawn_at` is set, visually separate from the status
  badge, with a tooltip explaining it is a registry-removal (not a status).
- The persisted `ctgov_withdrawn_at` state drives the CT.gov-section messaging
  (replacing the transient `not_found` probe message when both could show).
- The "Sync from CT.gov" button stays **enabled** on a removed trial and can
  actually reach it; a successful re-fetch (HTTP 200) clears
  `ctgov_withdrawn_at`, re-includes the trial in daily polling, un-mutes it, and
  emits a `trial_restored` event.
- Activity feed: rename `trial_withdrawn` to "Removed from CT.gov", fix the
  broken summary, and add a `trial_restored` ("Restored to CT.gov") entry.
- Dashboard timeline: the trial's label row + phase bar render in a subtle
  **muted** treatment when removed, with a tooltip.

## Non-Goals

- **Daily auto-poll re-checking removed trials.** The daily queue keeps
  *excluding* withdrawn trials (the whole point of `20260625200000`); restoration
  is **manual-re-check only** via the Sync button. Re-including them daily would
  reintroduce the per-NCT 404 noise the migration removed.
- A true "re-registered on <date>" timestamp. CT.gov does not expose when a
  record was un-deleted. The restore event uses the re-fetched snapshot's
  `last_update_posted_date` (the registry's own "last update posted" date) as
  the closest honest proxy; the event's `occurred_at` remains our detection
  time.
- Any change to the daily 404 detection / `mark_trials_ctgov_withdrawn` write
  path beyond what restoration requires.
- Changing how `trials.status` / `recruitment_status` render.

## Design

### Backend: restore-on-resync (migration A)

Three existing functions change. All three are redefined with
`create or replace` based on their **live** definitions (`pg_get_functiondef`),
never an older copy in the repo, to avoid silently reverting newer logic
(see memory: "CREATE OR REPLACE stale-base clobber").

1. **`get_trials_for_polling(p_secret, p_limit, p_include_withdrawn boolean
   default false)`.** New trailing optional param. When `false` (the daily
   poller's call, unchanged) keep the `ctgov_withdrawn_at is null` filter. When
   `true` (the manual backfill's call) drop that filter so a removed trial is
   reachable. Adding a trailing defaulted param keeps the daily-poll callsite
   binary-compatible. End the migration with `notify pgrst, 'reload schema'`
   (see memory: PostgREST reload after RPC signature change).

2. **`ingest_ctgov_snapshot(...)`.** This RPC runs only on a successful 200
   fetch, so it is the natural "the record came back" signal. In its watermark
   update (currently sets `last_polled_at`, `latest_ctgov_version`,
   `last_update_posted_date`), also `set ctgov_withdrawn_at = null`. Capture the
   prior value first; if it was non-null (the trial *was* removed), insert one
   `trial_change_events` row:

   ```sql
   event_type = 'trial_restored', source = 'ctgov',
   payload = jsonb_build_object('nct_id', p_nct_id,
                                'last_update_posted_date', p_post_date)
   ```

   Clearing on a non-withdrawn trial (the daily case) is a harmless no-op and
   emits no event.

3. **`get_activity_feed(...)`.** Add `'trial_restored'` to the `high_signal`
   whitelist branch (alongside the existing `trial_withdrawn`) so restorations
   appear in the high-signal feed.

Migration A smoke (DO block, resolving the worker secret from
`vault.decrypted_secrets` like `20260625200000`): create a trial; assert it is
excluded from `get_trials_for_polling(secret, n)` default but included with
`p_include_withdrawn => true` once withdrawn; mark it withdrawn; call
`ingest_ctgov_snapshot` with a minimal valid payload; assert `ctgov_withdrawn_at`
is now null, exactly one `trial_restored` event exists with a
`last_update_posted_date` payload key, and a second ingest emits no further
`trial_restored` event; assert `get_activity_feed` under `high_signal` returns
the `trial_restored` row.

### Backend: dashboard surface (migration B)

**`get_dashboard_data(...)`** does not currently emit `ctgov_withdrawn_at`.
Redefine it from its live body and add `'ctgov_withdrawn_at', t.ctgov_withdrawn_at`
to the per-trial `jsonb_build_object`. Smoke: a withdrawn trial appears in the
RPC output with a non-null `ctgov_withdrawn_at`.

### Worker: manual sync reaches removed trials

`runManualBackfill` (`worker/ctgov-sync/poller.ts`, ~482-585) resolves trial
rows via `get_trials_for_polling`, then filters client-side by requested NCT.
Pass `p_include_withdrawn: true` on that call so a removed trial is no longer
dropped to `unknown_nct`. The two outcomes then fall out for free:

- **200**: `fetchAndIngestNct` calls `ingest_ctgov_snapshot`, which now clears
  the flag and emits `trial_restored`.
- **404 (still gone)**: `fetchAndIngestNct` returns `withdrawnTrialIds`,
  `markWithdrawn` -> `mark_trials_ctgov_withdrawn` is idempotent (already
  withdrawn, no second event), trial stays removed.

The scheduled daily run (`runScheduledSync`) keeps calling
`get_trials_for_polling` **without** the new flag, so removed trials stay out of
the daily queue.

### Frontend: trial detail

- **Model**: add `ctgov_withdrawn_at?: string | null` to `Trial`. The detail
  reads use `TRIAL_SELECT` which is `*`-based, so the column flows through with
  no service change.
- **Header indicator** (template ~83-109, next to the NCT link / status tag):
  `@if (t.ctgov_withdrawn_at)` render a small **amber** chip
  (`bg-amber-100 text-amber-800`, hard-coded data color, not brand) reading
  `Removed from CT.gov · <Mon D>` with a `pTooltip` ("This trial's record was
  removed from the ClinicalTrials.gov registry on <date> and no longer resolves.
  Distinct from its clinical status."). The chip text/tooltip/date come from a
  small pure helper `ctgovRemovedChip(iso)` (own spec) so the formatting is unit
  tested without rendering the component. The status `<app-status-tag>` stays
  independent and unchanged.
- **CT.gov section** (template ~594-614): when `t.ctgov_withdrawn_at` is set,
  show a persisted amber `p-message` ("Removed from the CT.gov registry on
  <date>. Re-syncing will restore it if the record has returned.") and
  **suppress** the transient `nctValidity() === 'not_found'` message (persisted
  state wins). Keep the existing transient message only for the
  `ctgov_withdrawn_at == null && nctValidity() === 'not_found'` case (a freshly
  broken NCT the backend has not yet marked). The **Sync button stays enabled**
  (gated only by `t.identifier` as today). Role affordances unchanged
  (`trigger_single_trial_sync` already gates on owner/editor; viewers see the
  message but the button is hidden as it is today).

### Frontend: activity feed mapping

- `change-event.model.ts`: add `'trial_restored'` to the `ChangeEventType`
  union.
- `change-badge/change-badge.logic.ts`: `trial_withdrawn` label
  `'Trial withdrawn'` -> `'Removed from CT.gov'`; add
  `trial_restored: 'Restored to CT.gov'`.
- `shared/utils/change-event-summary.ts`: in both `summaryFor` and
  `summarySegmentsFor`, change `trial_withdrawn` to `'Removed from the CT.gov
  registry'` (drop the nonexistent `last_seen_post_date`; the row already shows
  `occurred_at` as relative time). Add `trial_restored` ->
  `'Restored to CT.gov'` plus `(registry updated <date>)` when
  `payload.last_update_posted_date` is present.
- `change-event-row/change-event-row.component.ts` `iconFor`: add
  `trial_restored` -> `'fa-solid fa-rotate-left'` (`trial_withdrawn` keeps
  `fa-ban`).

### Frontend: dashboard muted treatment

- `dashboard.service.ts` trial mapping: carry `ctgov_withdrawn_at` from the RPC
  row onto the `Trial` object (explicit mapper, so it must be added).
- `dashboard-grid.component` (`FlattenedTrial` + template label pane ~112-291):
  when `row.trial.ctgov_withdrawn_at` is set, mute the row (reduced opacity /
  slate text) and show a small `fa-ban` icon with a `pTooltip` ("Removed from
  CT.gov") beside the identifier. Dedupe is by `trial.id`, so the whole row
  mutes across that trial's indications.
- `phase-bar.component`: accept a `withdrawn` input and lower the bar
  `fill-opacity` when set, so removed trials recede.

### Related capabilities

Before implementation, run
`npm run features:near -- --tables trials,trial_change_events --rpcs get_dashboard_data,ingest_ctgov_snapshot,get_trials_for_polling,get_activity_feed`
and reference any adjacent capability hits here. No **new** RPC or table is
introduced (existing functions are modified; `trial_restored` is a new
event_type value, not a capability), so no new feature-manifest mapping is
expected; `npm run features:check` is run in verification to confirm.

## Test Plan

- **Unit (frontend, `npm run test:units`)**
  - `change-event-summary.spec.ts`: `trial_withdrawn` maps to "Removed from the
    CT.gov registry" with no "undefined"; `trial_restored` maps to "Restored to
    CT.gov" both with and without `last_update_posted_date`.
  - `change-badge.logic.spec.ts`: `trial_withdrawn` -> "Removed from CT.gov";
    `trial_restored` -> "Restored to CT.gov".
  - `ctgov-removed-chip.spec.ts`: helper formats the chip label + tooltip + date
    for a set date and is empty/absent for null.
- **DB smoke (in-migration DO blocks, run via `supabase db reset`)**
  - Migration A: include/exclude by `p_include_withdrawn`; ingest clears
    `ctgov_withdrawn_at` + emits exactly one `trial_restored`; idempotent on
    re-ingest; `get_activity_feed` high-signal surfaces it.
  - Migration B: `get_dashboard_data` emits `ctgov_withdrawn_at`.
- **Worker (`npm run test:worker`)**: `runManualBackfill` calls
  `get_trials_for_polling` with `p_include_withdrawn: true`; a 200 path for a
  previously-withdrawn NCT results in an ingest (restoration), a 404 path leaves
  it withdrawn; the scheduled run does **not** pass the flag.
- **Live (dev, read-only)**: `NCT04882961` (Danuglipron P2) on dev already has
  `ctgov_withdrawn_at` set and a `trial_withdrawn` event. Use it to eyeball the
  header chip, the suppressed-transient CT.gov message, the muted dashboard row,
  and the renamed ACTIVITY entry. Read-only query via:
  `infisical run --projectId 7c227e8b-b355-46cb-8912-701104e2415b --env dev --recursive --path / -- bash -c 'psql "$SUPABASE_DEV_DB_POOLER_URL" -c "..."'`.
- **Build/lint**: `cd src/client && ng lint && ng build`.
- **Advisor + docs**: `supabase db advisors --local --type all` and
  `npm run docs:arch` after the migrations.

## Tasks

```yaml
tasks:
  - id: migration-restore
    title: Migration A -- restore-on-resync (poll param, ingest clear+event, feed whitelist)
    domain: database
    description: |
      New migration supabase/migrations/20260626120000_ctgov_restore_path.sql.
      Redefine all three functions from their LIVE pg_get_functiondef bodies
      (never an older repo copy):
      (a) get_trials_for_polling: add trailing param
          p_include_withdrawn boolean default false; keep the
          `ctgov_withdrawn_at is null` filter only when false.
      (b) ingest_ctgov_snapshot: capture prior ctgov_withdrawn_at; in the
          watermark UPDATE also set ctgov_withdrawn_at = null; if prior was
          non-null, insert one trial_change_events row event_type
          'trial_restored', source 'ctgov', payload {nct_id, last_update_posted_date}.
      (c) get_activity_feed: add 'trial_restored' to the high_signal whitelist
          alongside trial_withdrawn.
      Re-issue revoke/grant/comment for the new get_trials_for_polling
      signature. End with `notify pgrst, 'reload schema'`. Add a DO smoke block
      (resolve worker secret from vault.decrypted_secrets, skip if absent)
      asserting: default queue excludes a withdrawn trial; p_include_withdrawn
      => true includes it; ingest clears the flag + emits exactly one
      trial_restored with a last_update_posted_date payload key; second ingest
      emits no further restored event; get_activity_feed high_signal returns it.
      Verify: supabase db reset && supabase db advisors --local --type all
    estimate: large
    depends_on: []

  - id: migration-dashboard
    title: Migration B -- get_dashboard_data emits ctgov_withdrawn_at
    domain: database
    description: |
      New migration supabase/migrations/20260626120100_dashboard_data_ctgov_withdrawn.sql.
      Redefine get_dashboard_data from its LIVE body; add
      'ctgov_withdrawn_at', t.ctgov_withdrawn_at to the per-trial
      jsonb_build_object (after ctgov_last_synced_at). DO smoke: a withdrawn
      trial appears in the RPC output with a non-null ctgov_withdrawn_at.
      Verify: supabase db reset && supabase db advisors --local --type all
    estimate: medium
    depends_on: [migration-restore]

  - id: worker-manual-reach
    title: Manual backfill reaches removed trials (p_include_withdrawn) + worker test
    domain: worker
    description: |
      In src/client/worker/ctgov-sync/poller.ts runManualBackfill, pass
      p_include_withdrawn: true to the get_trials_for_polling call so a removed
      trial is no longer dropped to unknown_nct. Confirm runScheduledSync does
      NOT pass the flag. Add/extend the poller worker test
      (src/client/worker/ctgov-sync/*.test.ts): manual backfill sends
      p_include_withdrawn true; a 200 fetch for a previously-withdrawn NCT routes
      to ingest (restoration), a 404 keeps it withdrawn (markWithdrawn called);
      scheduled run omits the flag.
      Verify: cd src/client && npm run test:worker && ng lint
    estimate: medium
    depends_on: [migration-restore]

  - id: models
    title: Trial + ChangeEventType model fields, dashboard mapping
    domain: frontend
    description: |
      core/models/trial.model.ts: add ctgov_withdrawn_at?: string | null (group
      with ctgov_* sync fields). core/models/change-event.model.ts: add
      'trial_restored' to the ChangeEventType union. core/services/dashboard.service.ts:
      carry ctgov_withdrawn_at from the RPC trial row into the mapped Trial.
      (trial.service.ts uses TRIAL_SELECT '*' so needs no change -- note in PR.)
      Verify: cd src/client && ng lint && ng build
    estimate: small
    depends_on: []

  - id: feed-mapping
    title: Activity-feed label/summary/icon for trial_withdrawn (relabel) + trial_restored
    domain: frontend
    description: |
      change-badge/change-badge.logic.ts: trial_withdrawn -> 'Removed from CT.gov';
      add trial_restored -> 'Restored to CT.gov'.
      shared/utils/change-event-summary.ts: in summaryFor AND summarySegmentsFor,
      trial_withdrawn -> 'Removed from the CT.gov registry' (drop last_seen_post_date);
      add trial_restored -> 'Restored to CT.gov' + ' (registry updated <date>)'
      when payload.last_update_posted_date present.
      change-event-row/change-event-row.component.ts iconFor: add trial_restored
      -> 'fa-solid fa-rotate-left'.
      Specs: change-badge.logic.spec.ts (both labels); change-event-summary.spec.ts
      (trial_withdrawn no-undefined; trial_restored with/without date).
      Verify: cd src/client && npm run test:units && ng lint && ng build
    estimate: small
    depends_on: [models]

  - id: trial-detail
    title: Trial detail -- amber "Removed from CT.gov" chip + persisted CT.gov message; sync stays enabled
    domain: frontend
    description: |
      New pure helper features/manage/trials/ctgov-removed-chip.ts
      (ctgovRemovedChip(iso) -> {label, tooltip} with formatted date) + spec.
      trial-detail.component.html: render the amber chip
      (bg-amber-100 text-amber-800, hard-coded data color) next to the NCT/status
      row when t.ctgov_withdrawn_at, with pTooltip; status tag stays independent.
      In the CT.gov section, when t.ctgov_withdrawn_at is set show a persisted
      amber p-message and suppress the transient nctValidity()==='not_found'
      message (persisted wins); keep the transient message only when
      ctgov_withdrawn_at is null. Sync button stays enabled ([disabled]="!t.identifier").
      Verify: cd src/client && npm run test:units && ng lint && ng build
    estimate: medium
    depends_on: [models]

  - id: dashboard-muted
    title: Dashboard timeline -- muted row + phase bar for removed trials
    domain: frontend
    description: |
      dashboard-grid.component.ts: carry ctgov_withdrawn_at onto FlattenedTrial.
      dashboard-grid.component.html: when row.trial.ctgov_withdrawn_at, mute the
      label row (reduced opacity / slate) and show a fa-ban icon with pTooltip
      "Removed from CT.gov" beside the identifier.
      phase-bar.component.ts/.html: add a `withdrawn` input and lower the bar
      fill-opacity when set.
      Verify: cd src/client && ng lint && ng build
    estimate: medium
    depends_on: [models, migration-dashboard]

  - id: verify
    title: Docs regen, advisors, and live dev eyeball
    domain: frontend
    description: |
      Run npm run docs:arch and npm run features:check after the migrations and
      commit any regen. supabase db advisors --local --type all clean. On dev,
      use NCT04882961 (already removed) to eyeball the header chip, suppressed
      transient message, muted dashboard row, and renamed ACTIVITY entry
      (read-only via the Infisical psql command in the Test Plan).
      Verify: supabase db advisors --local --type all && cd src/client && ng lint && ng build && npm run test:units && npm run test:worker
    estimate: small
    depends_on: [feed-mapping, trial-detail, dashboard-muted, worker-manual-reach]
```
