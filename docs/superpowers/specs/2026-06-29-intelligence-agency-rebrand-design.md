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

The bullseye and heatmap detail panels surface an "Intelligence" section
(`pi-detail-section`: owned brief headline/summary + references). The timeline's marker
detail pane gains the same "Intelligence" section so the three landscape views are
consistent. See the follow-up implementation for the data wiring.

## Verification

`cd src/client && ng lint && ng build`; `npm run test:units`.
