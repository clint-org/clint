# Surfacing trials with no indication ("Unspecified" bucket)

**Date:** 2026-06-27
**Status:** Design approved, pending spec review

## Problem

A user can create an asset and a trial without assigning an indication. The
trial is written to the `trials` table, the create dialog shows a success
toast, and the trial then never appears in the timeline. There is no error and
no hint. This is silent data loss from the user's point of view.

### Root cause

The timeline is built by the `get_dashboard_data` RPC, which assembles a strict
hierarchy: **company -> asset -> indication -> trials**. Within each asset's
indication node, trials are pulled through a chain of INNER JOINs
(`supabase/migrations/20260605030919_dashboard_data_multi_asset.sql:78-89`):

```
trials -> trial_assets -> trial_conditions -> condition_indication_map -> indications
```

The indication nodes themselves come from `asset_indications` joined to
`indications` (same file, lines 64-195). A trial with no mapped condition
produces no `asset_indications` row and matches none of the trial JOINs, so it
is dropped from the result entirely.

The create path makes this easy to hit:

- Indication is **not required** in the create dialog
  (`trial-create-dialog.component.html:92-103`) and is **not part of**
  `isValid()` (`trial-create-dialog.component.ts:159-166`).
- On save, `setIndications()` runs only when at least one indication is selected
  (`...ts:383-386`).
- With no indication names, `create_trial` writes zero `trial_conditions` /
  `asset_indications` (`20260607140000_multi_indication_on_import.sql:69-76`).

Keeping indication optional is intentional (a user may log a trial before
classifying it). The defect is that the optional case becomes invisible.

## Goals

1. A trial is **never** structurally invisible to the timeline, regardless of
   how it was created (manual create, source import, or deleting the last
   indication off an existing trial).
2. Nudge users toward classifying trials, without blocking the legitimate
   "log now, classify later" workflow.

## Non-goals

- Making indication a required field (rejected: kills the stub-now workflow).
- Writing a placeholder "Unspecified" indication record into the taxonomy
  (rejected: pollutes shared reference data; the fix must stay read-side and
  reversible).

## Design

Two reinforcing parts. Part 1 (read-side query change) is the load-bearing
correctness fix. Part 2 (create-dialog note) is the behavioral nudge on top.

### Part 1 -- Synthetic "Unspecified" bucket in `get_dashboard_data` (backend, read-side only)

Append **one synthetic indication node per asset**, after that asset's real
indications, collecting trials linked to the asset (via `trial_assets`) that map
to no indication:

```sql
not exists (
  select 1
  from public.trial_conditions tc
  join public.condition_indication_map cim on cim.condition_id = tc.condition_id
  where tc.trial_id = t.id
)
```

The synthetic node carries a sentinel identity so the frontend can recognize it:

- `id`: `null`
- `name`: `'Unspecified'`
- `is_unspecified`: `true`
- `development_status`: `null` (no `asset_indications` row to read)

The node is emitted **only** when at least one such trial exists for the asset.
Orphan trials reuse the exact same `trial_obj` shape as classified trials
(markers, recent-change rollup, notes, `phase_data`). Their phase bar /
development status falls back to the trial's own `phase_type`, which the
timeline already tolerates (`phase_data` is built from `t.phase_type` directly,
independent of `asset_indications`).

Implementation notes:

- The `indications` jsonb array (currently built from
  `asset_indications ai join indications ind`) becomes a UNION of the real
  indications and the synthetic bucket. To avoid duplicating the ~100-line
  `trial_obj` lateral across both branches, factor it into a helper SQL function
  (e.g. `public._dashboard_trial_obj(t public.trials, p_space_id uuid,
  p_start_year int, p_end_year int) returns jsonb`) and call it from both. This
  also de-risks the CREATE OR REPLACE stale-base clobber pattern by isolating
  the large body.
- A multi-asset orphan trial appears under the Unspecified bucket of **each**
  asset it tests, consistent with how classified multi-asset trials nest.
- **Filter interaction:** when `p_indication_ids` is non-null (user filtered to
  specific indications), the Unspecified bucket is **suppressed** -- it has no
  real id to match and represents the absence of classification. The existing
  recruitment/study-type/phase filters still apply to orphan trials.
- End the migration with `notify pgrst, 'reload schema'` per project convention
  (RPC body changes; signature is unchanged but the helper function is new).

Because this lives at the query layer, it covers every path that can orphan a
trial, not just the create dialog.

### Part 2 -- Create/edit dialog note (frontend, dynamic, non-blocking)

In `trial-create-dialog` (and the edit path in the same component family), show
**no helper text in the default state**. When the indication field is empty,
surface a single inline note. Per the visibility analysis, the note is anchored
to the **dialog footer, directly above the `app-form-actions` row**
(`trial-create-dialog.component.html:189`) -- the commit point where the user's
eyes are when clicking Create -- not under the mid-form indication field where
it would be scrolled out of view.

- Trigger: `computed()` over the indication-ids signal -> note shown iff empty.
- Treatment: slate/amber note per the design-system note treatment
  (non-blocking, informational). Save is never gated.
- Copy:

  > No indication set. This trial will appear under *Unspecified* until you
  > classify it.

- The note disappears the moment an indication is selected.
- Applies on **edit** too: editing a trial down to zero indications shows the
  same footer note.

### Part 3 -- Timeline rendering (frontend, muted + needs-attention)

`mapDashboardCompanies` (`core/services/dashboard.service.ts`, plus the
indication view model in `core/models`) maps the synthetic node like any
indication but threads the `is_unspecified` flag into the view model. In the
landscape/timeline grid (`features/landscape/`):

- **Label:** `Unspecified indication`, muted slate, italic -- visually distinct
  from the structural uppercase-tracked real indication labels, reading as a
  holding area rather than a real classification.
- **Order:** always sorted **last** under its asset, after all real indications.
- **Count badge:** a small slate count of orphan trials on the bucket header, so
  the cleanup debt is visible at a glance without shouting.

## Testing

- **SQL smoke (in the migration):** create a trial with no condition; assert
  `get_dashboard_data` returns it under a node with `is_unspecified = true` and
  `id = null`, sorted after real indications. Assert a normally-classified trial
  still lands under its real indication and is **absent** from the Unspecified
  bucket. Assert the bucket is suppressed when `p_indication_ids` is passed.
- **Frontend unit (Vitest):**
  - `mapDashboardCompanies` maps the sentinel node and threads
    `is_unspecified` into the view model.
  - The grid sorts the Unspecified bucket last and applies the muted treatment.
  - The create/edit dialog shows the footer note iff the indication set is
    empty, and never blocks save.

## Files touched (anticipated)

- `supabase/migrations/<new>_dashboard_unspecified_indication_bucket.sql` --
  helper fn + `get_dashboard_data` UNION + smoke + schema reload.
- `src/client/src/app/core/services/dashboard.service.ts` /
  `core/models/*` -- map `is_unspecified` into the view model.
- `src/client/src/app/features/landscape/*` -- muted bucket, sort-last, badge.
- `src/client/src/app/features/manage/trials/trial-create-dialog.component.{ts,html}`
  -- footer note (covers create + edit).
- Corresponding `.spec.ts` files alongside each touched component/service.

## Open questions

None outstanding. Copy and placement for both the footer note and the bucket
label are settled above.
