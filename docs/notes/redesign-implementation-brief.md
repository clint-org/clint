# Implementation Brief — Tour Backlog + Marker Tooltip/Pane Redesign

This is the execution prompt for the consolidated work coming out of the app walkthrough. Read it top to bottom before touching code.

## Mission

Implement the consolidated **polish backlog** and the **marker tooltip + detail-pane redesign** in this worktree (`.worktrees/redesign-polish`, branch `feat/redesign-polish`, based on `origin/develop`). Work against Clint's existing Angular 19 / PrimeNG / Tailwind v4 codebase and theme tokens — do not invent a parallel design system.

## Sources to read first (and review for accuracy)

1. **Todos** — `docs/notes/clint-app-tour-and-domain-guide.md` (copied into this worktree). The authoritative list lives in three sections: **Issues to watch**, **Polish backlog (1-13)**, **Design ideas**.
2. **Redesign handoff (FULL SCOPE — all pages)** — Claude Design project **"Hover tooltips and detail panes"**, id `1a808a4b-c18c-4fc3-b6f8-06c2b2d33e7a`. Read files with the `DesignSync` tool (`get_file`). **Implement every page redesign in the project, not just `index.html`.** The mockups map to existing Angular surfaces:

   | Mockup (DesignSync path) | JSX | Target Angular surface |
   |---|---|---|
   | `index.html` (Tooltips & Detail Pane) | `marker-kit.jsx`, `tooltips.jsx`, `panes.jsx`, `app.jsx` | marker hover tooltip + detail pane (`marker-detail-panel`, bullseye tooltip/pane) |
   | `Bullseye.html` | `bullseye.jsx`, `bullseye-app.jsx` | `features/landscape/` bullseye (`landscape.component`, `bullseye-chart`, `bullseye-controls-panel`, `bullseye-detail-panel`) |
   | `Heatmap.html` | `heatmap.jsx`, `heatmap-app.jsx` | `features/landscape/heatmap*` |
   | `Future Catalysts.html` | `catalysts.jsx`, `catalysts-app.jsx` | `features/catalysts/catalysts-page` |
   | `Engagement.html` | `engagement-app.jsx` | `features/manage/engagement/engagement-detail` + intelligence block |
   | `Intelligence Feed.html` | `feed-app.jsx` | `shared/components/intelligence-browse` |
   | `Materials.html` | `materials-app.jsx` | `features/materials-browse` + `material-row` |
   | `Events.html` | `events.jsx`, `events-app.jsx`, `event-panes.jsx` | `features/events/events-page` + change-event row/panel |
   | `Entity Records.html` | `entity-pages.jsx`, `entity-pages-app.jsx` | `features/manage/{companies,assets,trials}` detail pages |

   Shared primitives across mockups: `marker-kit.jsx` (glyph/status), `phase-kit.jsx` (phase chips), `library-kit.jsx`, `view-nav.jsx`, and the `_ds/` token bundle. Build these shared pieces once and reuse.
3. The JSX/HTML is a **SPEC for appearance and behavior, not code to port**. Recreate in Angular/PrimeNG. Go page by page: read the mockup, diff against the current component, implement the restyle, flag anything that needs new data/features.

**Review-for-accuracy rule:** before implementing any backlog item, re-verify its claim against current code (file:line cited in the guide). Before implementing a redesign surface, diff the design against the current component to separate "re-layout existing data" (do it) from "needs data/fields/capabilities we don't have" (flag — see boundary below).

## Autonomy boundary (the hard rule)

- **DO autonomously:** pure **UI / styling / layout / copy** changes, cosmetic fixes, and **clear correctness bugfixes** that do not change the data model, add a capability, or add navigation. Re-laying-out existing data into a new visual design counts as autonomous.
- **STOP and run by the user FIRST** (do NOT implement without explicit approval): anything that **adds a new feature, a new UI flow, a new field/column, new navigation/deep-linking, a new server query/RPC/migration**, or that **invents a surface/behavior not currently in the app**. When in doubt, treat it as a new feature and ask.

## Brand vs fixed colors (must honor — same as the app today)

- **Tenant-overridable brand accent:** use the semantic brand tokens / Tailwind `bg-brand-*` `text-brand-*` `border-brand-*` `ring-brand-*` (PrimeNG `{primary.X}`). These re-skin per tenant and **fall back to Clint teal** when no tenant brand is set. Never hardcode `teal-*` or `indigo-*`.
- **Fixed, NEVER whitelabeled** (identical for every tenant): **marker colors** (data green / trial slate / regulatory orange / approval blue / launch violet / LOE amber) and their shapes; **phase colors**; the **PROJECTED amber** status treatment; feedback severity. The company/asset tile uses the *company's* own brand color, not the tenant's.
- Rationale: brand color signals *whose instance this is*; data/marker/phase color signals *what the thing is*. Keep them separate. Style against tokens so the tenant override cascades without conditionals.

## Pre-triage of the backlog

### AUTO (UI/styling/layout/copy/bugfix — implement, then show diff)
- **#1** Materials file-type icons (FA glyphs, keep color coding) — `material-row.component.ts`.
- **#2** Materials "View all materials ->" arrow — recent-materials widget.
- **#6** Bullseye STATS doubling: when group=Asset, don't render two identical "N assets" boxes.
- **#7** Bullseye tooltip positioning: stop it covering the chart (offset/flip/clamp outside the radius).
- **#8** Heatmap STATS: count distinct entities, not summed per-bucket (`heatmap-controls-panel.component.ts:259`).
- **#9** Intelligence LINKED: one chip per entity with the relationship inline (`intelligence-block.component.html:119-157`).
- **#10** Intelligence history header dedupe: "vN · date" collapsed (`intelligence-history-panel.component.html:16-24`).
- **#11** Add `cursor-pointer` to the history-panel clickables + audit nearby clickables. (The ESLint-rule/CLAUDE.md convention part is a tooling change — propose it, but adding the rule itself = ASK.)
- **Issue** Bullseye detail-pane eyebrow: "Drug" -> "Asset" (vocab consistency).
- **Issue** Bullseye chart-center wording: "N placements across M assets" instead of bare "N assets".
- **Issue** Timeline "TODAY" label overlapping the "2026" axis label (CSS/layout).
- **Redesign — ALL pages** (index.html tooltip/pane + Bullseye + Heatmap + Future Catalysts + Engagement + Intelligence Feed + Materials + Events + Entity Records): implement each page's visual restyle (layout/glyph/status/spacing/typography/tokens) faithfully WHERE it re-presents data already loaded. For each page, flag any section that needs data/features we don't already have (see ASK). Build shared primitives (marker glyph kit, phase chip, status tag) once.

### ASK FIRST (new feature / new data / new flow / decision — do not build yet)
- **#4** Latest-from-Stout "honest count" (true total + true this-week, server-side) — needs a new count query/RPC field.
- **#5** Make the READ strip linkable (Timeline + Bullseye) — new deep-linking navigation.
- **#12** Materials edit-links UI — new affordance/flow (RPC exists, UI does not).
- **#13** Materials: add Engagement/space to the link picker — feature + auto-link behavior.
- **Design idea** Timeline sorting control — new feature.
- **Design idea** Rework the Heatmap READ to surface white-space/crowding/concentration — new insight logic.
- **Design idea** Indication filter + Indication grouping bucket-scoping — product decision.
- **Design idea** Add structured Indications as a Trials-grid column — new feature (multi-value column).
- **Design/seed** Populate `phase_end_date` on seed trials — data/seed decision, not an app feature.
- **Redesign sections needing new data** (e.g. tooltip/pane "related events", "upcoming", "source line", an "Edit" affordance) — only build if the data already loads; otherwise ASK.
- **#3** Change-feed milestone name — RESOLVED (seed-only); no action.

## Workflow

- One logical commit per item (or per tight group). Conventional-commit messages. Do not attribute Claude; no emojis; no em dashes.
- After each batch: `cd src/client && ng lint && ng build`. For UI, exercise in a browser where feasible.
- Honor `src/client/CLAUDE.md` guardrails (standalone components, signals, OnPush, `inject()`, native control flow, PrimeNG for controls, a11y/AXE, empty-state audit, `pTooltip` on icon-only buttons).
- Do NOT push or open a PR without checking in. Surface the diff and the ASK list for review first.
- Keep `docs/notes/clint-app-tour-and-domain-guide.md` in sync: tick items as done.
