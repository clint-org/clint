# Deck screenshot capture

`capture-deck-shots.mjs` refreshes the product screenshots embedded in the Stout
intro deck (`src/client/public/internal/stout-intro.html`) so they stay current
when the design changes. Each shot is taken at 2x against a real engagement in a
working state (selections, detail panels, pasted input), with no env/incident
chrome.

## Run

From `src/client/`:

```bash
node scripts/capture-deck-shots.mjs
```

A headed Chrome window opens. If you are not already signed in, sign in with
Google to the target account once; the script then captures every shot and
exits. The login persists in a gitignored profile dir (`.shots-profile-run/`),
so later runs skip the login.

## Target engagement

Default target is the prod Pfizer/Stout demo engagement **"Obesity Competitive
Landscape"**. To point at a different engagement, copy any in-app URL of it and
pass it as `DECK_URL`:

```bash
DECK_URL="https://<host>/t/<tenantId>/s/<spaceId>" node scripts/capture-deck-shots.mjs
```

The signed-in account must be able to view that engagement (and, for the
`source-import` shot, be an owner/editor of a tenant with AI import enabled).

## Refreshing a subset

When only a few surfaces changed, capture just those with `ONLY` (comma-separated
PNG basenames):

```bash
ONLY=timeline,materials,bullseye node scripts/capture-deck-shots.mjs
```

Shot names: `whitelabel-stout-login`, `engagement-landing`, `timeline`,
`heatmap`, `activity`, `bullseye`, `catalysts`, `events`, `source-import`,
`command-palette`, `materials`, `intelligence`, `trial-detail`.

## Editing what a shot shows

Each shot is a clearly labelled block in `capture-deck-shots.mjs`. To change what
a shot captures, edit that block's interactions (which row/dot it selects, what
text it pastes, which anchor it scrolls to) or its `settle()` delay. Selectors
can drift when components are refactored (e.g. the import page moved to a tabbed
`app-nct-input`); update them in place.

## Shots that depend on seed data

Three shots rely on data that the demo seed must provide, so they only look right
against a space seeded by the current `seed_demo_data()` (migration
`20260626120000` and later):

- **events** selects a threaded event (the seeded "Pfizer oral GLP-1 retreat"
  thread) so the detail pane renders its Thread section.
- **trial-detail** pins **REDEFINE-2** (`NCT05394519`), which the seed gives
  trial-scoped events, a referenced-in published read, activity, and markers, so
  every section is populated.
- **intelligence** pins **ATTRibute-CM** (`NCT03860935`): published intelligence
  + CT.gov-synced.

The seed does **not** set CT.gov fields (the live CT.gov sync job does). After a
fresh reseed, run with `SYNC=1` so the script clicks the trial-detail "Sync"
button on those two trials before capturing, or wait for the nightly CT.gov job.

The **source-import** shot pastes a real article into the "From text" tab, runs
extraction (logs an ai_call but commits no entities), and composes the processing
stepper and the resolved review screen side by side into `source-import.png`
(intermediate `source-import-processing.png` / `source-import-results.png` are
also written).

## Other options

- `HIDE=0` keep the env banner + AI-incident banner visible (hidden by default)
- `HEADLESS=1` run headless (only works once a login profile exists)
- `SYNC=1` click CT.gov "Sync" on the intelligence/trial-detail trials first
  (needed right after a fresh space reseed; see above)
- `INTEL_TRIAL_ID=<uuid>` / `DETAIL_TRIAL_ID=<uuid>` pin the intelligence /
  trial-detail trials instead of resolving them by NCT

## Verify and commit

Eyeball the new PNGs (a near-empty file usually means a too-early capture or a
guard redirect). Stage only the changed PNGs explicitly, never `git add -A`
here, because the gitignored profile holds a real session.

The repo's pre-push hook runs the full e2e suite, which flakes on cold-start
timeouts unrelated to image assets. For an assets-only change you can push with
`--no-verify` after confirming lint/units/build pass; CI is canonical.
