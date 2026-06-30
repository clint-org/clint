# Branded large loader for visualization pages

Date: 2026-06-29
Status: Approved

## Problem

On the timeline / clinical-trial dashboard, the empty-state message
"No clinical trial data to display. Add companies, assets, and trials to see
them on the dashboard." flashes briefly before real data renders.

Root cause: `timeline-view.component.html` gates its template as
`@if (dataLoading()) ... @else if (dataError()) ... @else if (companies().length) ... @else <empty>`.
`LandscapeStateService.dataLoading` starts `false`, so on first render the
template falls straight through to the `@else` "no data" branch in the window
before `loadData()` flips the flag to `true`. The empty state is reachable
before any load has resolved.

The bullseye and heatmap views do not have this bug: both gate on
`resource().isLoading()`, which is `true` from the first tick, so their empty
state is only reachable after the load resolves. They do, however, show a plain
grey skeleton while loading, which is generic and off-brand.

## Goal

1. Eliminate the timeline empty-state flash.
2. Give the three major landscape visualization pages (timeline, bullseye,
   heatmap) a single, consistent, branded loading state: the Clint mark shown
   large and centered, replacing the grey skeletons.

## Decisions

- Scope: all three landscape viz pages (timeline, bullseye, heatmap). Replace
  the existing skeleton loaders.
- Mark size: 96px.
- Caption: yes, per-page ("Loading timeline" / "Loading landscape" /
  "Loading heatmap"), rendered below the mark.
- Flash guard: minimum display of ~400ms once the loader is shown, so fast
  loads do not produce a flash-on / flash-off.
- Out of scope: events/activity tables (PrimeNG `[loading]`), detail panels,
  and all error states are unchanged. This is purely the loading state plus the
  timeline empty-state gate.

## Design

### `app-viz-loader` (new shared component)

`src/client/src/app/shared/components/loader/viz-loader.component.ts`

A full-area, vertically-centered loading state for visualization pages. It
composes the existing `app-loader` at `size=96` (so the mark geometry, colors,
and draw animation stay single-sourced in `clint-mark.ts` /
`loader.component.ts`) inside a flex-column frame that fills its container, with
the caption rendered below the mark in uppercase-tracked slate-400.

- Inputs:
  - `loading: boolean` — the upstream loading flag.
  - `label: string` — caption, e.g. `"Loading timeline"`.
- Owns the min-display guard. Internal `visible` signal driven by an `effect()`
  on `loading`:
  - `loading` -> true: record start timestamp, set `visible = true`.
  - `loading` -> false: if elapsed >= MIN_DISPLAY_MS (400), set
    `visible = false` immediately; otherwise schedule the hide for the
    remaining time. Any pending timer is cleared on a new transition and on
    destroy.
- The min-display decision is extracted as a pure helper
  (`nextLoaderHide(startedAt, now, minMs)` or equivalent) in a sibling module so
  it is unit-testable without TestBed rendering.
- `app-loader` already carries `role="status"` and reduced-motion handling, so
  accessibility is inherited.

### Timeline — fix the flash and adopt the branded loader

`timeline-view.component.html` + `LandscapeStateService`

- Gate the empty state so it is only reachable after a load has resolved. The
  exact mechanism (initialize the loading flag `true`, or add an explicit
  `hasLoaded` signal) is confirmed against the service during implementation; it
  must be guaranteed that a load kicks off, so the loader cannot spin forever.
- Replace the current table-skeleton block with `app-viz-loader`
  `[loading]="dataLoading()"` `label="Loading timeline"`.

### Bullseye + heatmap — swap skeletons for the branded loader

`landscape.component` + `heatmap-view.component`

- Replace the grey skeleton blocks with `app-viz-loader`
  `[loading]="...isLoading()"`, labels `"Loading landscape"` and
  `"Loading heatmap"`.
- Empty-state and error branches untouched (they already gate correctly).

## Testing

- Vitest spec for the min-display helper:
  - Fast load (loading true then false within the window): the computed hide
    time is pushed out to >= start + 400ms.
  - Slow load (elapsed already past the window): hide time is now (immediate).
- Verification: `cd src/client && ng lint && ng build`, then exercise the three
  pages in the browser on dev to confirm the branded loader shows and the
  timeline no longer flashes the empty state.

## Rollout

Feature branch off `develop` -> merge to `develop` (auto-deploys dev) -> verify
on dev -> merge `develop` to `main` and approve the prod deploy gate.
