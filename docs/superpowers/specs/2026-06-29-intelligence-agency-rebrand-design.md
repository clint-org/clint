# Intelligence terminology cleanup: retire "Primary", call it "Intelligence" everywhere

Date: 2026-06-29
Status: Implemented

## Problem

Now that `/intelligence` is a unified feed interleaving authored briefs and events, the
qualifier "Primary" in "Primary intelligence" had lost its contrast. There is no
"secondary intelligence" anywhere, so "Primary" read as noise.

## Decision history

The first cut tried agency-branding the authored-brief deliverable as
"{Agency} intelligence" (e.g. "Stout intelligence"), composed at runtime from the
resolved agency name, on formal surfaces only. Seen live, the full agency display name
("Stout Strategy Dev intelligence") was too long and heavy for the dense detail panels,
and it rendered inconsistently (the heatmap picked it up while the bullseye, already
plain, did not).

**Final decision: drop the agency name from the UI entirely.** Retire only "Primary" and
call the deliverable plain **"Intelligence"** on every surface. The whole app is already
whitelabel-branded (logo, colors, title), so the agency attribution is implicit; plain
"Intelligence" is terser and consistent with the brand's no-cheerleading voice.

## Scope

User-facing strings only. No code identifiers change: `PiMarkComponent`,
`primary-intelligence.model.ts`, the `primary_intelligence` table, RPC names, DB columns,
and component selectors all keep the internal "PI" / "primary_intelligence" names.

## Changes

- "Primary intelligence" -> "Intelligence" in every section header, eyebrow, empty state,
  authoring drawer title, marker cross-ref section, and the trial TOC link.
- PI mark default aria-label: "Has primary intelligence" -> "Has intelligence".
- Bullseye node aria-labels: drop "primary".
- The PI bookmark mark itself is unchanged (brand-filled bookmark glyph). Its meaning is
  unchanged: "this entity has an authored brief".
- The unified `/intelligence` feed, nav, badges, and tooltips were already plain
  "Intelligence" and stay so.
- No runtime agency-name resolution: the agency-aware `BrandContextService.agencyName` /
  `intelligenceLabel` computeds and the `intelligence-label.ts` helper added in the first
  cut were removed.

## Timeline detail pane

The bullseye and heatmap views render their own detail panel for the selected
asset/bubble with an "Intelligence (N)" section. The timeline's only detail pane is the
shared marker detail panel, which previously showed only "Referenced in intelligence"
(briefs citing the clicked marker), never an owned block.

To bring the timeline to parity, the marker pane now also shows an "Intelligence (N)"
section listing the owned briefs of the marker's parent trial AND asset:

- `LandscapeStateService.loadEntityIntelligence` fetches `getTrialDetail(trial_id)` and
  `getAssetDetail(asset_id)` in parallel (both cached RPCs), maps published briefs to
  `PiReference[]` via the pure `briefsToReferences` helper, de-dupes by brief id with
  `dedupeReferencesById`, and publishes `selectedEntityIntelligence`.
- `landscape-shell` binds it into `marker-detail-panel` -> `marker-detail-content`, which
  renders the new section above "Referenced in intelligence".
- The merge/map logic is pure and unit-tested (`intelligence-references.spec.ts`). The
  fetch is non-critical: failures leave the section empty without disturbing the pane.

## Verification

`cd src/client && ng lint && ng build`; `npm run test:units`.
