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

## Timeline rendering reality (correction)

The timeline does **not** render indication grouping rows. `dashboard-grid`
flattens company -> asset -> trial into `flattenedTrials()` -- one row per
trial per asset (`dashboard-grid.component.ts:180-216`). Indications appear only
as small chips in an optional, toggle-able **indication column**
(`dashboard-grid.component.html:233-259`); a trial with no indication already
renders a muted placeholder in that column's `@else` branch. There is no bucket
to "sort last" or badge. The design below reflects this: the orphan fix gets the
trial onto a normal row, and the "needs attention" signal lives in the
indication column placeholder.

## Design

Three parts. Part 1 (read-side query change) is the load-bearing correctness
fix. Part 2 (create-dialog note) is the behavioral nudge. Part 3 (column
placeholder) is the in-timeline "needs classification" signal.

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
  indications and the synthetic node. To avoid duplicating the ~100-line
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

### Part 3 -- Timeline rendering (frontend, column placeholder)

Two changes, both in `features/dashboard/grid/`:

**Mapper (`core/services/dashboard.service.ts:71-120`).** When the synthetic
node is encountered (`ind.is_unspecified === true`, or equivalently `ind.id`
is null), still fold its trials into the per-asset `byTrialId` flat list so they
render as normal rows, but do **not** push an `indicationRef` for them. The
orphan trial therefore lands in the timeline with an **empty `_indications`**
array. This is deliberate: it keeps the synthetic node from rendering as a fake
"Unspecified" chip in the indication column, and it lets the existing
empty-indications branch carry the signal. (A trial with no real indication can
never also have a real one, so there is no merge conflict.)

**Indication column placeholder
(`features/dashboard/grid/dashboard-grid.component.html:233-259`).** The
`@else` branch (trial has zero indications) currently renders a bare
placeholder using an em-dash (`&mdash;`), which both reads as "no data" and
violates the project no-em-dash rule. Replace it with a muted but legible
"Unclassified" affordance -- e.g. a small slate pill or italic slate label
reading `Unclassified`, with a `pTooltip` (from `primeng/tooltip`, positioned
`top`) reading `No indication set. Classify to group this trial.` This is the
in-timeline "needs attention" signal.

Caveat (accepted): the indication column is toggle-able
(`showIndicationColumn() && !hideIndicationColumn()`), so this signal is only
visible when the column is shown. The **correctness** fix (the trial appearing
at all) is independent of the column and always applies; only the nudge is
column-gated.

## Scope note: landscape strip inherits the same behavior

Orphan trials appear in both the timeline grid and the landscape "At a glance" strip, because both surfaces call `get_dashboard_data` with null indication filters. When an indication filter is active, the Unspecified bucket is suppressed in both surfaces the same way: the RPC omits it whenever `p_indication_ids` is non-null.

## Testing

- **SQL smoke (in the migration):** create a trial with no condition; assert
  `get_dashboard_data` returns it under a node with `is_unspecified = true` and
  `id = null`, sorted after real indications. Assert a normally-classified trial
  still lands under its real indication and is **absent** from the Unspecified
  bucket. Assert the bucket is suppressed when `p_indication_ids` is passed.
- **Frontend unit (Vitest):**
  - `mapDashboardCompanies` folds synthetic-node trials into the flat
    per-asset `trials` list with an **empty `_indications`** array (no fake
    chip), while real-indication trials keep their `_indications` refs.
  - The create/edit dialog shows the footer note iff the indication set is
    empty, and never blocks save.
  - (Template behavior -- the `Unclassified` placeholder + tooltip rendering
    in the indication column's empty branch -- is verified manually in the
    browser per the client a11y/verification convention; quoted in the plan.)

## Files touched (anticipated)

- `supabase/migrations/<new>_dashboard_unspecified_indication_bucket.sql` --
  helper fn + `get_dashboard_data` UNION + smoke + schema reload.
- `src/client/src/app/core/services/dashboard.service.ts` -- fold synthetic-node
  trials into the flat list with empty `_indications`.
- `src/client/src/app/features/dashboard/grid/dashboard-grid.component.html` --
  replace the em-dash placeholder with the `Unclassified` affordance + tooltip.
- `src/client/src/app/features/manage/trials/trial-create-dialog.component.{ts,html}`
  -- footer note (covers create + edit).
- Corresponding `.spec.ts` files alongside the touched service.

## Open questions

None outstanding. Copy and placement for both the footer note and the bucket
label are settled above.
