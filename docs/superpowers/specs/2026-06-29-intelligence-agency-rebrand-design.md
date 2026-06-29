# Intelligence terminology rebrand: retire "Primary", brand authored briefs as "{Agency} intelligence"

Date: 2026-06-29
Status: Approved (design), pending implementation plan

## Problem

Now that `/intelligence` is a unified feed interleaving authored briefs and events, the
qualifier "Primary" in "Primary intelligence" has lost its contrast. There is no
"secondary intelligence" anywhere, so "Primary" reads as noise. At the same time the
authored-brief deliverable is the agency's premium, human-written product and deserves
attribution that reinforces its value to the pharma client.

The fix: retire "Primary" everywhere, and where the deliverable is named in formal
surfaces, brand it with the resolved agency name, e.g. "Stout intelligence".

## The semantic boundary that drives everything

**"{Agency} intelligence" names the authored-brief deliverable specifically** -- the
human-written artifact the PI bookmark mark flags. It is NOT a rename of the unified
`/intelligence` feed, which blends briefs and events and stays plain **"Intelligence"**.

- Where a string meant "the brief" -> becomes the composed agency label.
- Where a string meant "the feed / the nav / the broad concept" -> stays "Intelligence"
  (minus any stray "Primary").

## The PI mark

Unchanged visually (brand-filled bookmark glyph, white stroke, `PiMarkComponent`). Its
*meaning* shifts in documentation only: from "has primary intelligence" to "has an
authored {agency} brief". It remains the at-a-glance density signal across dashboard
rows, bullseye nodes, heatmap cells, and detail section eyebrows -- more useful than
ever now that the feed blends briefs with lower-effort events, because the mark is the
one cue that says "a human wrote this one".

## Label resolution (single source of truth)

The agency name is already in the brand record (`BrandContextService`). Resolution rule:

- `kind === 'agency'` -> `app_display_name` (the agency's own host)
- `kind === 'tenant'` -> `agency?.name` (parent agency; populated by `get_brand_by_host`)
- `super-admin` / `default` / agency null -> no name -> plain **"Intelligence"**

Add two computeds to `BrandContextService`:

- `agencyName(): string | null`
- `intelligenceLabel(): string` -> `"{name} intelligence"` when a name resolves, else
  `"Intelligence"`.

Canonical casing is sentence case (`Stout intelligence`). Surfaces that render
uppercase-tracked eyebrows transform via existing CSS (`STOUT INTELLIGENCE`), which
reads as a product mark. No per-surface string variants.

`engagement-landing.component.ts` and `sidebar.component.ts` currently hand-roll this;
`engagement-landing` hardcodes a `?? 'Stout'` fallback, which is a whitelabel bug for any
non-Stout agency. Both fold into the shared computed; the hardcoded fallback is removed
as a side effect.

## Scope boundary: user-facing strings only

No code identifiers change. `PiMarkComponent`, `primary-intelligence.model.ts`, the
`primary_intelligence` table, RPC names, DB columns, component selectors -- all stay.
Renaming internals would be a high-churn, route-guard-tripping refactor with zero user
value.

## Formal vs compact mapping

| Surface | Today | Becomes |
|---|---|---|
| Detail section headers (trial/asset/company) | "Primary intelligence" | `{Agency} intelligence` |
| Heatmap/bullseye detail-panel sections | "Primary intelligence" | `{Agency} intelligence` |
| Engagement detail | "Primary intelligence for the whole space" | `{Agency} intelligence for the whole space` |
| Empty-state heading | "No primary intelligence yet" | `No {Agency} intelligence yet` |
| Authoring drawer/dialog **title** | "Primary intelligence" | `{Agency} intelligence` |
| Marker cross-ref section | "Referenced in intelligence" | `Referenced in {Agency} intelligence` |
| PI mark aria-label | "Has primary intelligence" | `Has {Agency} intelligence` |
| Nav item, icon-rail, topbar, breadcrumbs | "Intelligence" | unchanged |
| `/intelligence` feed page title | "Intelligence" | unchanged (briefs + events) |
| Action buttons ("Publish", "Add", "Write") | terse | stay terse, no agency name |
| Toasts, badges, tight tooltips | "Intelligence" | unchanged |

Decisions confirmed during brainstorming: (a) the feed page stays "Intelligence";
(b) action buttons stay terse (no "Publish {Agency} intelligence").

## Docs + tests

- Update `docs/runbook/features/primary-intelligence.md` terminology section.
- Update `docs/superpowers/specs/2026-06-26-primary-intelligence-on-landscape-surfaces-design.md`
  references to the label.
- Editorial review of help page prose if it names "Primary intelligence".
- Unit spec on the new `intelligenceLabel()` computed: all four brand kinds + null-agency
  fallback. This is the only piece with real logic; the rest is string swaps verified by
  `ng build` and existing component specs.

## Verification

`cd src/client && ng lint && ng build`. Manual smoke via dev brand override
(`?wl_kind=tenant&wl_agency_name=Stout`) to confirm the composed label renders on a
detail pane and falls back to "Intelligence" with no agency.
