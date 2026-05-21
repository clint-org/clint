# Trial phase & timeline: ct.gov as source of truth

**Date:** 2026-05-21
**Status:** Design, not yet implemented
**Spec owner:** Aaditya

## Problem

Three fields on `public.trials` (`phase_type`, `phase_start_date`, `phase_end_date`) are silently allowed to diverge from ct.gov. The current materialize function (`_materialize_trial_from_snapshot`, migration `20260503050000`) writes them with reverse coalesce (`coalesce(existing, derived)`), so the first ct.gov sync seeds them but no later sync ever overwrites. Meanwhile the trial edit dialog (`src/client/src/app/features/manage/trials/trial-edit-dialog.component.ts`) only exposes `name / identifier / product_id / therapeutic_area_id`. The result:

- A trial can display `phase_type = "P3"` on the timeline while ct.gov.phase says `"PHASE2"`, with no UI affordance to reconcile and no audit trail of how the divergence happened.
- New trials without an NCT also have no edit path for these fields; whatever the seed/demo data wrote is what they get forever.
- The "Phase" card on the trial detail page is hidden when `phase_type` is null, so trials missing the data give no cue that they need any.

Ct.gov is the canonical source for clinical trial phase, study start, and primary completion. The product's job is to mirror that, not to maintain an independent narrative. The exception: when ct.gov has no data, the analyst fills the gap and ct.gov can later overwrite, with a visible change-feed event rather than a silent flip.

## Goal

Make ct.gov the source of truth for `phase_type`, `phase_start_date`, `phase_end_date`. Allow analyst entry only where ct.gov is null. On every sync, ct.gov values overwrite previous values and the change is recorded in the existing change feed. The trial edit dialog exposes the three fields with per-field lock state driven by which side last wrote them.

## Non-goals

- We are not rewriting bullseye / timeline / landscape / dashboard consumers. They keep reading `phase_type / phase_start_date / phase_end_date` unchanged. Only the write paths change.
- We are not changing the raw `trials.phase` (varchar) column or its existing pure-mirror behavior. The "CT.gov data" block on trial detail keeps showing the verbatim upstream phase string.
- We are not introducing per-field "pending acceptance" queues. Ct.gov wins immediately; the analyst learns about it through the change feed.

## Decisions captured during brainstorming

1. **Sync conflict policy.** Ct.gov always overwrites on divergence; the diff appears in the per-trial change feed. Analyst is informed, not asked.
2. **Edit surface.** Phase fields live in the trial create dialog and the trial edit dialog. Not inline on the detail page (Phase card stays read-only with source tags).
3. **Lock granularity.** Per-field, not per-trial. Each of phase / phase start / phase end is locked independently when ct.gov has a value for it.
4. **Schema shape.** Keep the three analyst-facing columns where they are (Approach A). Add three sibling `*_source` columns. Flip the materialize function's coalesce direction. Smallest blast radius for consumers.

## Architecture

### 1. Schema

```sql
alter table public.trials
  add column phase_type_source       text check (phase_type_source       in ('ctgov','analyst')),
  add column phase_start_date_source text check (phase_start_date_source in ('ctgov','analyst')),
  add column phase_end_date_source   text check (phase_end_date_source   in ('ctgov','analyst'));
```

- Nullable. Null source means the field itself is null / unset.
- One source column per analyst-facing field. The raw `trials.phase` does not get a source column; it stays a pure ct.gov mirror with no analyst write path.
- Check constraint keeps the value domain narrow; no enum type because adding new states (e.g. `'agency'`) later should not require a CREATE TYPE migration.

### 2. Sync materialization

Replace `_materialize_trial_from_snapshot` with the per-field flow below.

```sql
-- 1. derive from snapshot
v_phase            := public._map_phase_array(payload->'phases');
v_phase_type       := public._derive_phase_type(payload->'phases', v_study_type);
v_phase_start_date := public._safe_iso_date(payload #>> '{...,startDateStruct,date}');
v_phase_end_date   := coalesce(
                        public._safe_iso_date(payload #>> '{...,primaryCompletionDateStruct,date}'),
                        public._safe_iso_date(payload #>> '{...,completionDateStruct,date}')
                      );

-- 2. snapshot previous values for diff
select phase_type, phase_start_date, phase_end_date,
       phase_type_source, phase_start_date_source, phase_end_date_source,
       space_id
  into v_prev_phase_type, v_prev_phase_start, v_prev_phase_end,
       v_prev_phase_type_source, v_prev_phase_start_source, v_prev_phase_end_source,
       v_space_id
  from public.trials where id = p_trial_id;

-- 3. write (ct.gov-first coalesce on value, stamp source when ct.gov supplied)
update public.trials
   set phase                   = coalesce(v_phase, phase),
       phase_type              = coalesce(v_phase_type,       phase_type),
       phase_start_date        = coalesce(v_phase_start_date, phase_start_date),
       phase_end_date          = coalesce(v_phase_end_date,   phase_end_date),
       phase_type_source       = case when v_phase_type       is not null then 'ctgov' else phase_type_source       end,
       phase_start_date_source = case when v_phase_start_date is not null then 'ctgov' else phase_start_date_source end,
       phase_end_date_source   = case when v_phase_end_date   is not null then 'ctgov' else phase_end_date_source   end,
       ...other ct.gov columns unchanged...
 where id = p_trial_id;

-- 4. emit one change-feed event per field that actually changed
--    rule: prev was non-null AND new differs from prev
--    seeding (prev null) is not a "change" and emits nothing
--    no-op syncs (new == prev) emit nothing
```

Three event types, snake_case to match `marker_added / date_moved / projection_finalized`:
- `phase_changed`: payload `{ field: 'phase_type', old_value, new_value, old_source }`
- `phase_start_changed`: payload `{ field: 'phase_start_date', old_value, new_value, old_source }`
- `phase_end_changed`: payload `{ field: 'phase_end_date', old_value, new_value, old_source }`

One sync can emit zero / one / two / three events on a trial. `source = 'ctgov'` on every event (the trial_change_events.source column, distinct from the per-field source on trials).

The `coalesce(derived, existing)` flip means: when `_derive_phase_type` returns null (ct.gov gave `"NA"`, blank, or an ambiguous combo it can't collapse), the analyst-set value survives and `phase_type_source` is not touched.

### 3. Edit UI

**Trial create dialog** (`trial-create-dialog.component.ts`). Add three fields:

- **Phase**: `<p-select>` over the enum `P1 / P2 / P3 / P4 / PRECLIN / APPROVED / LAUNCHED / OBS`. Optional.
- **Phase start**: date picker. Optional.
- **Phase end**: date picker. Optional.

When the analyst types a valid NCT and the existing autopopulate flow hits ct.gov, extend it to also read phase + start + end. If those are present in the lookup response, pre-fill the three inputs in **disabled** state with a `[ct.gov]` badge. Analyst sees what ct.gov has before saving; if they want different values they clear the NCT.

On save:
- For each filled field, write the value plus a source: `'ctgov'` if the field was pre-filled by the lookup, `'analyst'` if the analyst typed it (NCT blank, or NCT returned null for that field).
- Empty fields stay null, source null.

**Trial edit dialog** (`trial-edit-dialog.component.ts`). Add the same three fields. Each is enabled or disabled based on the trial's matching `*_source` column:

| Source column value | Field state |
|---|---|
| `'ctgov'` | disabled, `[ct.gov]` badge, tooltip: "Managed by ct.gov. Edit at clinicaltrials.gov or remove the NCT to override." |
| `'analyst'` or `null` | editable |

`isValid()` extends with: each filled phase field passes its enum/format check. No new required fields.

`save()` writes only the editable fields, never the locked ones. When the analyst supplies a value, `TrialService.update` also writes `<field>_source = 'analyst'` alongside.

**Server-side guard.** A `before update` trigger on `public.trials` rejects writes that change `phase_type` (or `phase_start_date`, `phase_end_date`) when the matching source column equals `'ctgov'` and the new value differs from the existing one. The UI lock is the user-facing constraint; the trigger is belt-and-suspenders so a misbehaving client (or RLS bypass) can't quietly stomp a ct.gov value.

**Service layer.** `TrialService.update(id, changes)` now accepts the three fields and their sources as optional. The dialog is the only place client code writes to the source columns; everywhere else they're read-only in TypeScript types.

### 4. Trial detail display

`trial-detail.component.html`:

- **Header chip (line 87-92).** Unchanged. `phaseLabel(t.phase_type || t.phase)` keeps working: `phase_type` is whichever side wrote it, with the raw `phase` as backstop for the rare case where derive returned null but phase exists.
- **Phase card (line 400-427).** Two changes:
  1. Always render. Today it's hidden when `phase_type` is null; that hides the empty-state cue that the trial needs data. Render with an empty-state below the dl: *"No phase set. Edit this trial to add one."* with the existing edit button (or, for viewers, an explanation that the trial owner can add one).
  2. Each `<dd>` gets a small `[ct.gov]` or `[analyst]` source tag (slate, uppercase, tracked, matching `app-ctgov-source-tag` already used on markers at line 551). No tag if the field is null.
- **CT.gov data block (line 326-332).** Unchanged. Still shows the raw `phase` string verbatim, distinct from the derived enum, useful when derive returned null and the analyst wants to know what ct.gov actually said.

### 5. Help page

`help/phases` is the editorial home for the phase enum. Add one paragraph: "Phase values for trials with an NCT are managed by ct.gov; for trials without an NCT, or for fields ct.gov leaves blank, analysts can set them on the trial edit dialog. On sync, ct.gov values overwrite previous analyst values and the change appears in the activity feed."

Per the help-page convention in `CLAUDE.md`, this is editorial drift territory. Add the `help/phases` page to the `helpRules` map in `.claude/hooks/runbook-review-guard.sh` so future changes to the materialize function flag the page for review.

### 6. Backfill

One migration runs after the source columns are added. For every trial with a latest snapshot, compute what ct.gov would say today via `_derive_phase_type` + the existing snapshot path helpers. Then for each of the three fields independently:

| Existing | Derived | Result |
|---|---|---|
| non-null | non-null, equal | source = `'ctgov'` |
| non-null | non-null, different | source = `'analyst'` (preserves the override on backfill day; the next sync overwrites and emits the change-feed event, which is the intended teaching moment) |
| non-null | null | source = `'analyst'` |
| null | n/a | source stays null |

Trials with no snapshot but a non-null analyst-facing field: source = `'analyst'`.

Idempotent on re-run: any row already tagged is skipped.

After backfill, the next polling cycle re-runs ct.gov sync on every trial, and the new `_materialize_trial_from_snapshot` overwrites the surviving `'analyst'` divergences (emitting one event per field per trial). This is the only large burst of phase-change events the activity feed will see; subsequent syncs only fire when ct.gov itself actually changes.

Seed: `supabase/seed.sql` is regenerated by `seed_demo_data` on `db reset`. Update that function to stamp the source columns when it inserts trials: `'ctgov'` for seeded NCT trials, `'analyst'` for non-NCT ones.

## Testing

Three layers, matching what the codebase already does (inline psql smoke in migrations, Vitest for services/utilities, Playwright e2e + manual browser verification for dialogs and detail pages). No new component-level Vitest specs: the project does not currently unit-test dialog or detail components, and adding bespoke test infrastructure for this feature would be out of pattern.

### Migration-level (psql inline smoke)

Append to the same migration that replaces `_materialize_trial_from_snapshot`, matching the pattern at the bottom of `20260503050000_derive_phase_type_from_ctgov.sql` and the audit smokes (`20260510002000_audit_coverage_smoke.sql`).

Materialize-function coverage:

- Materialize over a payload with phase + dates against a row where all three are null: all three source columns become `'ctgov'`, values overwrite, **no** events fire (seeding is not changing).
- Materialize with a changed phase against a row with `phase_type = 'P2', source = 'ctgov'`: `phase_type` updates, source stays `'ctgov'`, **one** `phase_changed` event row appears with old/new in payload, event row's own `source` column is `'ctgov'`, payload `old_source` is `'ctgov'`.
- Materialize with a changed `phase_start_date` only: one `phase_start_changed` event fires; phase/end unchanged, no other events.
- Materialize with a changed `phase_end_date` only: one `phase_end_changed` event fires; phase/start unchanged, no other events.
- Materialize where all three fields change in the same sync: exactly three events of the three distinct types.
- Materialize where prev == new on all three (no-op sync): zero events.
- Materialize with `phases: ["NA"]` (derive returns null) against a row with `phase_type = 'OBS', source = 'analyst'`: unchanged, no event, source still `'analyst'`.
- Materialize against a row with `phase_type = 'P3', source = 'analyst'` while derive returns `'P2'`: updates to `'P2'`, source flips to `'ctgov'`, one event with `old_source: 'analyst'` in payload.

Server-side guard trigger coverage:

- Direct `update public.trials set phase_type = 'P1' where ... and phase_type_source = 'ctgov'` raises a clear error from the `before update` trigger.
- Same UPDATE that does not change the value (`phase_type = 'P2'` against an existing `'P2'`) is allowed (the trigger only blocks changes).
- The trigger does not block updates to other columns on a ct.gov-locked trial (e.g. `notes`, `display_order`).

Backfill coverage:

- Seed four trials: (a) snapshot with derive matching existing, (b) snapshot with derive diverging from existing, (c) snapshot with derive null on one of three fields, (d) no snapshot but non-null existing. Assert source columns land where the §6 table says.
- Re-run the backfill once after the first pass: zero rows changed (idempotency).

### Service-level (Vitest, `trial.service.spec.ts`)

- `update` with `{ phase_type: 'P2' }` sends `{ phase_type: 'P2', phase_type_source: 'analyst' }`.
- `update` with all three fields sends each value plus its `_source = 'analyst'` sibling.
- `update` omitting phase fields does not touch source columns.

### End-to-end + manual (Playwright, `e2e/tests/trial-management.spec.ts`, plus browser verification per `src/client/CLAUDE.md` §12)

Extend the existing `trial-management.spec.ts` with one scenario covering the new edit-dialog lock state (mock or use seed data with `phase_type_source = 'ctgov'`): open the edit dialog, assert the Phase select is disabled with the `[ct.gov]` badge visible; close and re-open against an analyst-managed trial, assert the Phase select is enabled and a save round-trips.

Manual browser verification on implementation:

- Trial create dialog with valid NCT: phase + dates pre-fill in disabled state with `[ct.gov]` badges.
- Trial create dialog with no NCT: phase + dates are editable; saving writes them with `source = 'analyst'`.
- Trial edit dialog with mixed sources (phase ct.gov, dates null): phase locked, date pickers editable.
- Trial detail Phase card on a trial with `phase_type = null`: empty-state copy renders; the edit button is visible for editors and absent for viewers.
- Trial detail Phase card source tags: `[ct.gov]` / `[analyst]` appears next to each populated value.
- After triggering a manual ct.gov resync that changes a phase value, the trial's activity feed shows a `phase_changed` row.

Per the *Pair tests with each task* memory: every task in the implementation plan includes its smoke / Vitest case / e2e extension / manual-verification step inline, not piled into a "Phase N: Tests" section.

## Failure modes

- **Ct.gov returns the same value twice in a row.** No event; the value-equality check stops it. Cheap.
- **Ct.gov returns a value that's structurally novel** (a phase string `_derive_phase_type` can't collapse). `v_phase_type` is null, the field is left alone, source unchanged. Analyst still has whatever was there.
- **A misbehaving client posts `{ phase_type: 'P1' }` against a ct.gov-locked trial.** Server-side `before update` trigger rejects the row with a clear error. The dialog never sends this in practice.
- **Two simultaneous syncs on the same trial.** The materialize function runs in a single SQL `update`; Postgres serializes them. Whichever sync's snapshot is newer wins; if both have the same snapshot, one is a no-op.
- **A trial loses its NCT** (analyst clears it on edit). The source columns stay as they were; ct.gov will never sync them again, so the values are effectively frozen in their last known state with the existing source tags. If the analyst wants to take ownership, they can edit the trial, but the UI lock stays on until the source is explicitly flipped, which we are not building here. (Future work, if it comes up.)

## Open questions

- None at design freeze.

## Touched files

| File | Change |
|---|---|
| `supabase/migrations/<new>_trial_phase_ctgov_truth.sql` | Add source columns, replace `_materialize_trial_from_snapshot`, add `before update` guard trigger, append inline smoke tests, run backfill. |
| `supabase/seed.sql` / `seed_demo_data` function | Stamp source columns on seeded trials. |
| `src/client/src/app/core/models/trial.model.ts` | Add the three `*_source` fields to the `Trial` type. |
| `src/client/src/app/core/services/trial.service.ts` | `update()` accepts the three fields plus sources; writes `*_source = 'analyst'` when caller supplies a value. |
| `src/client/src/app/features/manage/trials/trial-create-dialog.component.ts` / `.html` | Add the three fields, extend NCT autopopulate to pre-fill them. |
| `src/client/src/app/features/manage/trials/trial-edit-dialog.component.ts` / `.html` | Add the three fields with per-field lock state. |
| `src/client/src/app/features/manage/trials/trial-detail.component.html` | Always render Phase card, add source tags, add empty-state. |
| `src/client/src/app/features/help/phases-help.component.ts` (or `.html`) | Add ct.gov-managed paragraph. |
| `.claude/hooks/runbook-review-guard.sh` | Add `help/phases` to `helpRules`. |
| `src/client/src/app/core/services/trial.service.spec.ts` | New cases. |
| `src/client/src/app/features/manage/trials/trial-edit-dialog.spec.ts` | New cases. |
