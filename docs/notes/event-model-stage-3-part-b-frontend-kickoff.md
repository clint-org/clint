# Stage 3 Part B frontend - kickoff (fresh session)

The Stage 3 merged Event form + its backend are built and verified on branch
`feat/event-model-stage-3` (worktree `.worktrees/event-model-stage-3-impl`, off the
cutover tip with develop merged in). This session finishes the **frontend half of Part B**
and gets the branch merge-ready.

## Already done + verified (do NOT redo)
- Merged Event form: `src/client/src/app/features/events/event-form/` (`event-payload.ts`
  builders, `event-form.component.ts`, `event-form-dialog.component.ts`); write path via
  `EventService.createEvent`/`updateEvent` (unified RPCs). Tags + regulatory pathway
  (FDA-Submission type only) supported via `events.metadata`.
- First entry point: "Add event" on trial detail (`trial-detail.component`), trial-anchored.
- Backend migrations (mine): `20260629040000` (create_event/update_event gain `p_metadata`),
  `20260629040100` (rename `get_catalyst_detail` -> `get_event_detail`, unified-superset shape,
  drop dead `get_key_catalysts`). Re-anchor (`20260629030000`) was the cutover session's.
- Gates currently green: `ng lint`, `ng build`, `test:units` (1464), advisors "No issues found",
  `grants:check` PASS, `features:check` RPC errors cleared (25 `route-unmapped` are PRE-EXISTING
  baseline - not introduced here; do not chase them).

## Setup
```
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/event-model-stage-3-impl
git status   # expect clean, on feat/event-model-stage-3
# local Supabase is running and the DB is FREE (the E4 session is not touching it):
supabase db reset    # applies all migrations incl. mine; safe now
```
`src/client/node_modules` is already symlinked. Integration tests need:
```
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o env | grep '^SERVICE_ROLE_KEY=' | cut -d'"' -f2)
```

## The three remaining items

### 1. Edit-hydration (the core piece)
`EventFormComponent` (`event-form.component.ts`) already has `mode`, `eventId`, and all the
signals, but nothing loads an existing event. In `ngOnInit`, when `mode()==='edit' && eventId()`,
fetch via `CatalystService.getCatalystDetail(eventId())` (now calls `get_event_detail`) and read
`response.catalyst` (the RPC returns `{ catalyst, upcoming_markers, related_events }`). Map the
unified keys -> form signals:
- `event_type_id`->`eventTypeId`; `anchor_type`->`anchorType`; `anchor_id`->`anchorId`
- `title`, `description`; `event_date`/`end_date` -> `Date` (parse `YYYY-MM-DD`)
- `date_precision`->`datePrecision` (+ for fuzzy, derive `periodYear`/`periodSub` from the date)
- extent: `is_ongoing` -> `'onwards'`; `end_date` not null -> `'until'`; else `'point'`
- `projection`->`projection`; `significance` `'high'|'low'|null` -> `'High'|'Low'|'Default'`;
  `visibility` `'pinned'|'hidden'|null` -> `'Pinned'|'Hidden'|'Default'`; `no_longer_expected`
- `metadata.tags`->`tags` (?? []); `metadata.pathway`->`regulatoryPathway` (?? null)
- `sources` (`[{id,url,label}]`) -> `sources` (`{url, label: label ?? ''}`)

Add the reverse mappers as PURE functions in `event-payload.ts` with specs (TDD):
`significanceChoiceFromValue`, `visibilityChoiceFromValue`, `extentFromEndFields(end_date, is_ongoing)`,
and a `periodFromDate(precision, isoDate)` for fuzzy hydration. Pair tests in
`event-payload.spec.ts`.

Then wire one **edit entry point**: add edit/delete affordances on the timeline/feed detail
panel (`event-detail-panel.component`) guarded by `spaceRole.canEdit()`, opening
`EventFormDialogComponent` with `[mode]="'edit'"` `[eventId]="..."`. (Delete via
`EventService.delete`.) CT.gov-owned events open read-only - decide the lock signal (e.g. derive
from the event's source origin; there is no explicit ctgov flag on the detail today, so either
add one to `get_event_detail` or gate on a known ctgov source_doc origin - flag the choice).

### 2. Sources rendering host-fallback (D1)
`event-detail-panel.component.html` ~line 93 renders `{{ src.label || src.url }}`. Change to a
**host fallback** (label, else URL host) by importing `sourceDisplay` from
`event-form/event-payload` and exposing a component method. Add the derived CT.gov **registry**
link as a SEPARATE affordance (the `catalyst.registry_url` the RPC now returns), not folded into
the citations list. Compact surfaces (tooltip/feed row): primary source + "+N" if not already.

### 3. Integration tests + un-defer
Add to `src/client/integration/tests/` (or extend `event-producers`/`event-sources`):
- create_event with `p_metadata` -> read back `events.metadata.tags`/`.pathway`.
- update_event re-anchor (change `anchor_type`/`anchor_id`/`event_type_id`) -> verify row + that
  the `trial_change_events` activity row still emits (do not regress it).
- get_event_detail returns the unified keys for a seeded event.
Run the FULL integration suite as a gate.

## Final gates before merge/PR
```
cd src/client
npx ng lint && npx ng build
npm run test:units -- --run
npm run test:integration           # with the env exported above
npm run grants:check
npm run features:check             # RPC clean; 25 route-unmapped are pre-existing baseline
npm run docs:arch                  # migrations changed -> regen, commit
cd .. && supabase db advisors --local --type all
```

## Constraints
- No emojis, no em-dashes, no Claude attribution (copy, comments, commits, PR body).
- Stay on `feat/event-model-stage-3`. Do NOT push `feat/event-model` (E4 session's branch).
- When green, merge to develop or open a PR (no `gh pr merge --auto`; use `--merge`/`--admin`).
- Optional follow-up (not required to merge): the `get_event_detail` legacy keys are a
  transitional superset; once all consumers read the unified keys, drop the legacy ones.

## References
- Backend handoff (now done): `docs/notes/event-model-stage-3-backend-handoff.md` (commit 646dac96).
- Spec: `docs/superpowers/specs/2026-06-28-event-model-stage-3-ia-rename.md`.
- Plan: `docs/superpowers/plans/2026-06-29-event-model-stage-3-ia-rename.md`.
