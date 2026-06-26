# Primary Intelligence on Landscape Surfaces

- Status: Draft (design)
- Date: 2026-06-26
- Author: Aaditya Madala
- Related: `primary-intelligence.model.ts`, `primary-intelligence.service.ts`, whitelabel theming (`buildBrandPreset`, `--brand-*`)

## Summary

Primary intelligence (PI) is the authored analytical deliverable in Clint. Today it is surfaced in only one landscape view (the bullseye asset detail panel). This design extends a single, consistent PI signal across all three landscape surfaces - **timeline**, **bullseye**, and **heatmap** - so an analyst can tell at a glance where intelligence exists and open it in place.

The model is deliberately uniform:

- One **presence mark** (a brand-colored bookmark glyph) means "this entity has primary intelligence," rendered the same way on every surface.
- One **reading component** in every detail pane: a "Primary intelligence" block (headline + summary) plus a reference list.
- The split between owner and reference is preserved: **a trial/asset owns its PI** (shown on the row/node), while **a marker surfaces incoming references** - the PI entries that cite that catalyst.

No new backend or RPC work is required for the core behavior; the necessary RPCs already exist. Two small read-path extensions are needed for efficient presence signaling (see Data Layer).

## Current State

- **Bullseye** already signals intelligence: nodes with `intelligence_count > 0` get a static **blue** halo ring, and the detail panel (`bullseye-detail-panel.component.ts`) shows an intelligence section. The blue halo collides semantically with the blue **approval** marker.
- **Timeline** does not surface PI. `marker-tooltip.component.ts` has an unused `intelligenceHeadline` input (never populated); the detail pane (`marker-detail-content.component.ts`) is fed `CatalystDetail` from `get_catalyst_detail`, which carries no PI.
- **Heatmap** has no PI concept at all - neither cells nor the detail panel reference intelligence.

## Goals

1. A consistent, glanceable "has PI" signal on timeline, bullseye, and heatmap.
2. Read PI in place from each surface's detail pane via one shared component.
3. Correct owner/reference semantics: trial/asset rows show owned PI; markers show incoming references.
4. Whitelabel-correct: the PI signal follows the tenant brand the way the rest of the chrome does.
5. Accessibility: the signal must not rely on color alone and must hold WCAG AA contrast on any tenant brand and any background.

## Non-Goals

- No change to how PI is authored, versioned, or published.
- No change to the PI data model or to who can own PI (trials/assets own; markers are link targets only).
- No reading of full PI prose inline on the data surfaces - prose lives in the detail pane.

## The PI Signal System (shared across surfaces)

### Presence mark

- **Shape: a bookmark glyph.** Chosen because (a) every other mark in the app is a circle (markers, node dots, activity rings), so a non-circular shape is unambiguous, and (b) the bookmark reads as "authored/curated note," matching what PI is.
- **Fill: the tenant brand color** (`--brand-600`), never `teal-*`. The mark recolors per tenant exactly like the rest of the chrome.
- **Outline: a white (1px-equivalent) stroke**, always. This is what keeps the mark legible on any background and on any brand hue, including same-hue phase tints (e.g. a teal-brand mark on the teal P3 heatmap column).
- **State: static.** Motion is reserved for the activity signal (below).
- **Size: ~9-11px**, tuned per surface.

Because the signal is carried by **form + outline**, the brand hue is free to be anything without colliding with the fixed data colors (markers, phase tints) or with the activity ring.

### Relationship to other signals

- **Recent activity** (existing bullseye signal) stays a **hollow, pulsing ring** (orange). It is distinguished from PI by *form* (hollow ring vs filled bookmark) and *motion* (pulsing vs static), so the two never read as the same thing even when the tenant brand is orange. PI and activity can coexist on one node.
- The existing bullseye **blue intelligence halo is removed** and replaced by the brand bookmark mark. This both unifies the signal and resolves the blue-halo / blue-approval collision.

### Color rule (whitelabel)

- PI mark fill, the "Primary intelligence" detail block, the reference cards, the headline text, and the "PI" affordance all use `--brand-*`.
- Data colors stay hardcoded: marker hues (green/slate/orange/blue/violet/amber), phase tints (slate/cyan/teal/violet/amber), and the activity orange. These are not brand and must not move with the tenant.

### Shared detail-pane component

A single component renders in every detail pane that shows PI:

1. **Primary intelligence block** - headline + summary (brand-tinted surface).
2. **Reference list** - zero or more entries, each showing the citing entity (company / asset / trial), an entity-type label, and the entry headline. A **count** is shown where multiple references are expected (markers, heatmap groups): "Referenced in N intelligence entries."

## Per-Surface Design

### Timeline

- **Trial row (owner).** A trial owns one PI. The bookmark mark appears beside the trial name in the left rail.
  - **Headlines (default on).** When the intelligence-headline density control is on, the PI headline renders as a single truncated line under the trial name, prefixed with the mark. When off, the row collapses to the compact mark beside the name only - reclaiming vertical density for the Bloomberg-style dense view. The headline only costs vertical space; horizontal time axis and marker positions are unaffected.
  - **Clickable.** Clicking any trial row (regardless of headline on/off) opens that trial's PI in the detail pane.
- **Marker (references).** The marker tooltip and the marker detail pane show **incoming references** - PI entries that cite this catalyst - via the shared reference list with a count. The marker's own catalyst-level write-up continues to live in its description; markers do not own PI.

### Bullseye

- **Asset node (owner).** Replace the blue intelligence halo with the brand bookmark badge at the node corner when the asset has PI. Activity stays a pulsing ring; both can appear on one node.
- **Detail panel.** Align the existing intelligence section to the shared PI block + reference-list component.

### Heatmap (net-new)

- **Cell.** A cell aggregates assets, so the cell-level signal is a small brand bookmark flag in the corner when *any* asset in that cell has PI. The white outline keeps it visible on the cell's phase tint.
- **Detail panel.** Row click opens the group; add an intelligence section listing the group's assets with PI-bearing ones flagged (mark + headline), reusing the shared reference list. Show "N of M assets have intelligence."

## Data Layer

All core RPCs already exist (`primary-intelligence.service.ts`):

- **Trial PI (timeline row + pane):** `getTrialDetail` -> `get_trial_detail_with_intelligence`.
- **Marker references (tooltip + pane):** `list({ referencing_entity_type: 'marker', referencing_entity_id })` -> `list_primary_intelligence(..., p_referencing_entity_type, p_referencing_entity_id)`.
- **Asset PI (bullseye):** `getAssetDetail` / existing `intelligence_count` already drives the node; lightweight notes via `getIntelligenceNotesForAsset`.

Two read-path extensions for efficient **presence** signaling (avoid per-row / per-hover RPC calls):

1. **Timeline presence + headline.** Extend the existing timeline/grid trial fetch to include, per trial, a `has_intelligence` boolean and the PI `headline`. This renders all marks and headlines from the data already loaded for the grid; full PI loads only on row click. Do **not** fetch per hover.
2. **Heatmap presence.** Extend the heatmap payload so each cell/asset carries a `has_intelligence` flag for the corner mark; the detail panel loads per-group intelligence on row click.

Marker references are fetched on marker selection (folded into `LandscapeStateService` alongside `get_catalyst_detail`, or as a second call). This is a single selection, so no batching concern.

## Components / Architecture

- **`PiMark`** - one small presentational component for the bookmark glyph: takes the brand color from CSS vars, renders the white-outlined SVG, exposes size. Used by timeline rail, bullseye badge, heatmap cell, and legends. Single source of truth for the shape.
- **`PiDetailSection`** - the shared detail-pane component (PI block + reference list with optional count). Used by the timeline marker pane, bullseye detail panel, and heatmap detail panel.
- Keep each surface's existing container component; these two new components slot in. This avoids duplicating the PI rendering three times and keeps the signal consistent if it ever changes.

## Accessibility

- **Not color-only.** The signal is a distinct shape; on the timeline it is additionally accompanied by the headline text. Each mark carries an accessible label (e.g. `aria-label="Has primary intelligence"`), and the activity ring carries its own label so screen-reader users get both.
- **Contrast.** The mandatory white outline guarantees the mark separates from any background and any tenant brand hue (WCAG AA), including same-hue phase tints.
- **Distinct from activity.** Form (filled bookmark vs hollow ring) and motion (static vs pulsing) distinguish PI from recent activity independent of hue.
- Existing keyboard/focus/aria behavior of each detail pane is preserved; the shared `PiDetailSection` must be reachable and its reference cards focusable where they link out.

## Behavior

- **Presence marks are always rendered** where PI exists, on all three surfaces - the mark is cheap and non-intrusive.
- **Timeline headline density** is a per-view control (default on), persisted per user, that shows/hides the inline headlines. (The prototype used a single global toggle for demo convenience; the production control is timeline-scoped because only the timeline has inline headlines.)

## Decisions Resolved

- Owner vs reference split: trial/asset rows show owned PI; markers show incoming references. (Confirmed.)
- Signal carried by brand color **and** non-circular form **and** white outline - not hue alone. (Driven by the whitelabel clash with activity-orange / approval-blue and same-hue tints.)
- Mark shape: **bookmark**.
- Headline is the default timeline treatment; density reclaimed by the headline toggle.
- Heatmap PI is **in scope** for this work.
- Bullseye blue halo is replaced (not kept alongside).

## Out of Scope / Future

- Filtering or sorting any surface by "has intelligence."
- Surfacing draft (unpublished) PI on the data surfaces - presence reflects published PI.
- Cross-surface "jump to intelligence" navigation beyond the existing detail-pane links.

## Prototype

A clickable HTML prototype of all three surfaces (tenant-brand switcher, mark-shape switcher, timeline headline toggle, worst-case orange-brand test) was used to settle this design during brainstorming. It is a throwaway artifact (scratchpad), not committed.
