# Clint — App Tour & Domain Guide

Personal study guide built during a live page-by-page walkthrough of the app, for demo preparation. Captures what each surface does, the pharma/clinical-trial meaning behind every data point and control, your questions and their answers, and a running list of issues to watch.

Reread before the demo. Sections are added page-by-page as we go.

---

## How we're testing

- Environment: **dev** (`https://*.dev.clintapp.com`), the real deployed cloud env, on your own Google account (`aadityamadala@gmail.com`).
- Your account is an **agency owner of "Stout"** (the consultancy). Stout manages two pharma-client tenants on dev: **BI** and **Pfizer**.
- Main tour playground: **BI tenant -> "seeded" space** (`bi.dev.clintapp.com`) — 35 trials, 12 companies, 27 assets. Same GLP-1 / cardiometabolic dataset as the local seed.
- Dev is a shared deployed DB. We keep "seeded" **read-only**; form-heavy stops either open dialogs and explain fields then **cancel**, or write into the throwaway **"test"** space.

---

## Domain primer (read this first)

The product is **competitive intelligence (CI) for pharma**. An analyst tracks rival drug programs and tells their client what is happening and what is coming.

**The data hierarchy (memorize this):**

- **Company** — a pharma firm (Eli Lilly, Novo Nordisk, Roche, Pfizer, Cytokinetics, Viking).
- **Asset** — a single drug/drug-candidate owned by a company (orforglipron, retatrutide, CagriSema, aficamten, CT-388). One company has many assets.
- **Trial** — a clinical study testing an asset (ATTAIN-1, REDEFINE-2, TRIUMPH-1, ACACIA-HCM). One asset has many trials. Real trials have an **NCT number** (the ClinicalTrials.gov registry ID).
- **Marker** — a dated event on a trial's timeline (a readout, a milestone, a regulatory action). Markers are the colored dots on the timeline and the foreground of the whole product.
- **Catalyst** — a *future* dated marker that can move the market (a topline readout, a PDUFA decision). "Catalyst" = the forward-looking view of markers.

**Clinical trial phases (the spine of the product):**

- **Preclinical** — lab/animal, before human testing.
- **Phase 1 (P1)** — first in humans; safety/dosing; small.
- **Phase 2 (P2)** — does it work? efficacy signal + safety; medium size.
- **Phase 3 (P3)** — large, pivotal trial that supports approval. **P3 readouts are the highest-stakes catalysts.**
- **Filed / Approved / Launched** — submitted to the regulator (FDA etc.), approved, then on the market.
- **LOE (Loss of Exclusivity)** — patent/exclusivity expiry; generics/biosimilars enter.

**Key vocabulary:**

- **Topline** — the first high-level results of a trial's *primary endpoint*, released before the full publication. The single most-watched moment for a program; stock and competitive read move on it.
- **Primary completion** — the date the trial finishes collecting its primary-endpoint data (precedes topline).
- **Confirmed vs PROJECTED** — confirmed = a company-announced/known date; **PROJECTED = an estimate** (modeled or analyst-guided). This distinction is everywhere and is a core data-quality signal.
- **Mechanism of action (MoA)** — how a drug works (e.g. GLP-1 receptor agonist). **Route of administration (RoA)** — how it's given (oral, subcutaneous injection). **Indication** — the disease it targets (obesity, type-2 diabetes, HCM).
- **Intelligence ("reads" / posts)** — analyst write-ups published by the agency (Stout) to the client, tagged by what they're about (Trial / Company / Engagement).

**The dataset's real-world context:** this is the live GLP-1 / obesity / cardiometabolic race. Lilly (orforglipron oral, retatrutide), Novo Nordisk (CagriSema), Pfizer (danuglipron — discontinued), Roche (CT-388), Viking (VK2735), Cytokinetics (aficamten, for HCM — a heart condition). Learning this dataset = learning the actual landscape the demo audience knows.

---

## Tour map

1. Analyst views: **Home** -> Timeline -> Bullseye -> Heatmap -> Future Catalysts
2. Engagement: Engagement detail -> Intelligence Feed -> Materials -> Events
3. Data model: Companies -> Assets -> Trials -> detail pages
4. Configuration: Marker Types -> Taxonomies -> Fields -> Members -> General -> Audit log
5. Workflows & platform: Source import (NCT) -> command palette -> Agency portal -> Super-admin

---

## Stop 1 — Home (Engagement Landing)

The analyst's morning screen: "what changed and what's coming" for this engagement. Read-only; everything links deeper.

**Top bar (every page):** tenant name (BI) + space switcher (seeded) + the five Landscape tabs (Home / Timeline / Bullseye / Heatmap / Future Catalysts — five lenses on the same trial data) + `⌘K` command palette.

**Summary strip:** `35 trials · 12 companies · 27 assets` (engagement inventory) · `Active since 2026-Q2` · `IMPORT` (entry to the ClinicalTrials.gov import flow; visible to owner/editor).

**Hero catalyst:** the next/most-notable upcoming dated event (e.g. "ACACIA-HCM primary completion projected, Cytokinetics").

**Four motion signals:** P3 readouts (next 90d) · Catalysts (next 90d) · New reads (last 7d) · Trial moves (last 30d). See Q1/Q2 below for the coloring and counting rules.

**Latest from Stout:** the agency's intelligence feed, filterable All / Trial / Company / Engagement.

**Next 90 days (right rail):** the catalyst calendar; each entry tagged `PROJECTED` when the date is an estimate.

**What changed (last 7d):** auto-detected trial changes (date slips, phase transitions, status changes), each with a type icon. Source `Clint` = system-detected.

**Recent materials:** uploaded deliverables (PPT briefings) with download/delete.

### Questions & answers — Home

**Q1. Why is "Catalysts next 90d" orange (amber)?**
It is **conditional, not a fixed category color.** The stat turns amber only when the count is greater than 0; at 0 it stays dark slate. The same rule applies to "P3 readouts next 90d" (so on dev, "1 P3 readout" is also amber). The two right-hand signals ("New reads", "Trial moves") never change color. Meaning: amber = "there is something on the calendar that needs attention." It is a UI attention cue (`text-amber-700`), and is **not** the same thing as the marker palette's "orange = regulatory" — don't conflate the two in the demo.
(`engagement-landing.component.ts` sets `warn: count > 0`; `engagement-landing.component.html` renders amber when `stat.warn`.)

**Q2. Why the "+" in "+8 New reads last 7d", and why does it differ from "Latest from Stout: 8 intelligence posts · 3 this week"?**
- The **"+"** is a formatting convention meaning "net additions in the window" — new reads are framed as things that got *added*, so the value shows as `+N` (and plain `0` when none).
- The two numbers are computed **two different ways**, so they legitimately differ:
  - **"New reads last 7d" (the motion signal)** comes from the server stats RPC (`get_space_landing_stats`): it counts *all* `primary_intelligence` rows in the space with `state = published` and **`published_at`** within the rolling last 7 days.
  - **"8 intelligence posts · 3 this week" (the feed header)** is computed client-side from only the **8 most-recent posts the feed loaded** (`limit: 8`). "8 posts" = how many it loaded (capped at 8); "3 this week" = of those loaded rows, how many have **`updated_at`** within the last 7 days.
  - So three differences stack up: `published_at` vs `updated_at`, *all rows* vs *only the fetched 8*, and the cap at 8.
- Takeaway for the demo: these are **different metrics that happen to look similar**. Don't present them as the same number.

**Q3. The CT-388 "What changed" row says "Event date delayed 120 days (Mar 15 -> Jul 13)" — what event?**
The underlying entity is a **marker** (a dated milestone on the CT-388 trial) whose date moved. In this dataset that delayed marker is the **"P2 final analysis projected"** readout — which is why, after slipping 120 days, it now appears in the 90-day catalyst rail on Jul 13.
**Clarity gap (FLAG):** the data model *does* know the milestone name (the change record carries `marker_title` / `marker_type_name`, and the shared renderer is built to print `"{marker_title}: event date delayed..."`). But these seeded change rows render a generic **"Event date delayed"** with no milestone name — meaning `marker_title` isn't populated on these synthetic events. In production, a real slip should read e.g. *"P2 final analysis: event date delayed 120 days."* Worth confirming before the demo so a viewer isn't left asking "which event?"

**Q4. Why the calendar icon in "What changed"?**
It's **semantic, not decorative.** Each change type has its own icon: date change -> calendar (`fa-calendar-days`), phase transition -> arrows, status change -> flag, marker added -> plus-circle, etc. The calendar specifically signals "a date moved." So the icon lets you read the *kind* of change at a glance before reading the text.

**Q5. Why does "Recent materials" use "All materials" with no arrow, while other sections use "View all ->"?**
Confirmed **inconsistency (FLAG, minor/cosmetic).** Every other Home section uses the pattern `View all [context] ->` with a trailing arrow (`View all intelligence ->`, `View all ->`). The Recent materials widget instead says **"All materials"** with no arrow and different styling. Not a functional bug — a polish/consistency item. Easy fix: align it to `View all materials ->`.

**Q6. "Latest from Stout" says "8 intelligence posts · 3 this week" but only 4 posts are visible — why, and what's the value of limiting to 8?**
Code-confirmed behavior: the widget **fetches 8** posts (`limit: 8`), but **renders only 4** (1 featured/hero + `restPosts = slice(1, 4)`). The header's "8" is the **fetched count (capped at 8)**, and "3 this week" is "3 of those fetched 8 updated in the last 7 days." Fetched (8), displayed (4), and this-week (3) were never designed to agree.
- Why fetch 8 but show 4: the extra rows populate the **filter-chip counts** (All / Trial / Company / Engagement) and give the list something to show after filtering.
- **The flaw:** "8 intelligence posts" reads like a summary total but is just the fetch buffer — a space with 50 posts would still say "8." And "3 this week" is only "3 of the loaded 8," not the true weekly count.
- **Decision (option B):** make the header an honest summary — compute the **true total** and **true this-week** counts **server-side** (independent of the 8-row fetch), show e.g. "47 intelligence posts · 6 this week," then keep the latest 4 as a teaser. This mirrors how the `+8 New reads last 7d` motion signal already counts (server-side, all rows) — see Q2.

---

## Stop 2 — Timeline

The core visualization: every trial in the engagement as a horizontal bar on one shared time axis, with dated events ("markers") plotted along it. Grouped Company -> Asset -> Trial. Purpose: read the whole competitive field's timing at a glance.

**Zoom (Y/Q/M/D):** Year / Quarter / Month / Day granularity of the time axis.

**Filter bar:** Company, Asset, Trial, Indication, MOA, ROA, Phase, Status, Category dropdowns + PERIOD (From/To quarter pickers) + COLUMNS toggles (MOA, ROA, Notes show/hide left columns). These filters drive all Landscape views.

**The competitive READ (headline strip):** an auto-generated natural-language synthesis of the filtered data, e.g. "Eli Lilly leads: 4 assets, 8 at Phase 3 | 8 catalysts in next 90 days (4 Eli Lilly, 2 Cytokinetics, 1 Novo Nordisk, 1 Roche) | Novo Nordisk most active (9 recent changes)." Demo beat: the tool reads the field for you.

**STATS:** count of what's in view (companies / assets / trials / catalysts in 90d).

**Left grid columns (ASSET | MOA | ROA | TRIAL), grouped by company:**
- **MOA (mechanism of action)** = how the drug works. In this data: GIP/GLP-1 dual agonist (tirzepatide = Mounjaro/Zepbound), GLP-1 receptor agonist (semaglutide = Ozempic/Wegovy/Rybelsus; orforglipron), GIP/GLP-1/glucagon triple agonist (retatrutide). This is the real scientific axis of the obesity race.
- **ROA (route of administration):** SC = subcutaneous (injection), PO = per os (oral pill). Oral vs injectable is a major competitive differentiator.
- **TRIAL** + its **NCT number** (ClinicalTrials.gov registry ID).

**Canvas:** horizontal bar = a trial's phase span; shapes = markers (dated events) with small date labels; dashed vertical line = TODAY.

**The legend (master key): color = category, shape/fill = type + confidence.**
- Date confidence: Actual (filled = happened/confirmed), Projected (hollow = estimated), NLE = No Longer Expected (struck-through = was expected, now cancelled). Separately, each marker has a `date_precision` (exact/month/quarter/half/year) for how exact the date is.
- Clinical-trial milestones (slate): Primary Completion Date (PCD = primary-endpoint data collection finishes; precedes topline), Trial Start, Trial End.
- Data readouts (green): Topline (first headline result), Interim (planned mid-trial look), Full Data (complete dataset/publication).
- Regulatory (orange): Filing, Submission, Acceptance (regulator agrees to review).
- Approval (blue) -> Launch (violet).
- Loss of Exclusivity (amber): LOE Date (X), Generic Entry Date (patent cliff / generics arrive).

**Export (top-right):** exports the timeline to a PowerPoint briefing (same deliverables as Materials).

### Questions & answers — Timeline

**Q1. What is "8 cat/90d"?** 8 catalysts in the next 90 days = count of distinct markers whose `event_date` is within [today, today+90d], future-only, de-duplicated across multi-asset trials. Your near-term watch list. (`timeline-stats.ts`)

**Q2/Q3/Q4. Can the READ strip link to filtered pages?** Not today — the whole READ is plain text (`innerHTML`), nothing clickable. But it's built from discrete `ReadSegment` objects that already carry company + window, so per-segment linking is very feasible: "8 catalysts next 90d" -> catalysts filtered `within=90d`; per-company counts -> filter to company; "9 recent changes" -> activity/events filtered to that company; single-company "next catalyst in 2 days: REDEFINE-2 readout" -> that marker. Every READ variation is segment-based, so the right move is to make the READ one linkable component (covers Q2-Q4 at once). (`competitive-read/`, `timeline-insight-strip.component.ts`)

**Q5. No sorting on the Timeline — should there be?** Correct, no user sort; rows are fixed company -> asset -> trial in server order (`display_order` exists but isn't a control). Worth adding: highest-value sorts are "soonest upcoming catalyst first", "most advanced phase first", "most recently active". Bigger feature than the cosmetic items. (`dashboard-grid.component.ts` flattenedTrials)

**Q6. Do phase bars fade to today or to the CT.gov completion date? (fact-checked)** The chart logic is correct and the CT.gov mapping already exists; the demo bars feather to today only because of seed data.
- Bar right edge = trial `phase_end_date` if set; only if null does it feather to **today** (open-ended "continues into the unknown"). (`phase-bar.component.ts`, `phase-bar-fade.ts`)
- CT.gov sync `_materialize_trial_from_snapshot` sets `phase_end_date = coalesce(primaryCompletionDate, studyCompletionDate)` and stamps source `ctgov`. (`20260521200200_trial_phase_ctgov_truth.sql:56-84`)
- So a properly synced trial's bar runs to its completion date. The demo bars feather to today because the **seed trials have no `phase_end_date`** (not synced) — a seed-data gap, not a chart bug.
- Nuance: we map **primary completion first**, study completion as fallback (arguably better for a readout-focused view; primary completion = primary-endpoint data collected, study completion = incl. follow-up). Flippable if full study-completion is preferred.

## Stop 3 — Bullseye

Competitive-positioning view shaped like a target. Distance to center = closeness to market.

**Rings = development phase**, outer edge inward: PH 1 -> PH 2 -> PH 3 -> PH 4 -> APPROVED -> center (Launched / on market). Early assets on the rim, marketed assets at the core.

**Wedges = the grouping dimension** (default Company): each pie slice is a company, labeled around the rim. A company's assets are dots placed at the ring matching their phase.

**Dots = assets**, colored by phase (Phase 1 slate, Phase 2 cyan, Phase 3 teal = hero, Phase 4 violet, Approved, Launched green). Ring decorations: hollow blue outline = "Intelligence attached" (an analyst read exists); amber outline = "Recent activity."

**GROUP BY (left) — the power control:** re-slice wedges by Company / Indication / Mechanism of Action / Route of Administration / Asset. Switching to MoA shows which *mechanism* is winning (GLP-1 vs GIP/GLP-1 dual vs triple agonist) — a different competitive question than "which company."

**READ:** radial variation of the auto-summary, e.g. "Eli Lilly leads: 5 assets, 2 at Phase 3 | Novo Nordisk only credible challenger (1 asset at Phase 3)." **STATS:** companies / assets count. Filters + Export as on Timeline.

### Questions & answers — Bullseye

**Q1. Grouped by Asset, the asset count shows twice — why?** Real bug. STATS always renders [group-dimension count] + [total assets]; when the dimension IS asset, both compute to the same number -> "23 assets" twice. (`bullseye-controls-panel.component.ts` spokeCount + assetCount; `landscape.component.html`.) Fix: when groupBy===asset show one box (or substitute trials/companies for the second).
Related: chart CENTER counts placements (`dots().length`), STATS counts unique assets (`allAssets().length`). Under Indication: center "28 assets" vs STATS "23" because an asset on 2 indications draws on 2 spokes. Logic correct, but "28 assets" in the center is misleading (it's 28 placements across 23 assets). (`bullseye-chart.component.ts:306-311`.)

**Q2. Why do detail panes show "DRUG" on top?** It's the entity-type eyebrow. On Bullseye every dot is an asset (a drug), so it always says DRUG — contextually correct, but hardcoded to `'Drug'` (`bullseye-detail-panel.component.ts:252`), not derived. Two nits: it's the one place the UI says "Drug" while everywhere else says "Asset"; and the Timeline marker panel is a different component that DOES vary its label. Polish/consistency item, not a functional bug.

**Q3. The hover tooltip covers the chart.** Real UX defect. Tooltip is positioned at the cursor with a fixed "centered above" transform and no collision avoidance / viewport clamp / flip (`bullseye-tooltip.component.ts`, `landscape.component.ts` onAssetHover). Dots are often near the center, so the tooltip lands on the chart. Fix: larger offset / anchor outside chart radius / flip-and-clamp / positioning lib.

**Q4. READ linkability.** Same segment-based READ as the Timeline; the radial variation ("Obesity most active (7 recent events)") should deep-link too. Covered by the existing "make the READ linkable" backlog item.

## Stop 4 — Heatmap

The density / white-space view: a matrix answering "where is the competition crowded, where are the gaps?"

**Grid:** rows = competitive buckets (the GROUP BY dimension; default MOA + Indication, e.g. "GIP/GLP-1 dual agonist + Obesity"), each row also shows company count. Columns = phase pipeline P1 / P2 / P3 / P4 / APP / LNCH / TOTAL. Cells = a count shaded by intensity (darker = more assets there; empty = nobody). Read it as a pressure map: dark cluster = crowded/contested; empty early-phase stretch = white space; row lit only under LNCH = mature market.

**Left controls:** GROUP BY (Mechanism of Action / Indication / MOA + Indication / Company / Route of Administration) re-buckets rows; COUNT (Assets / Trials / Companies) sets what cells tally (Trials = clinical activity, Assets = distinct programs). READ + STATS as elsewhere. TOTAL column (with the sort caret) sorts rows by size. Filters + Export as on other views.

**Console check:** loaded clean (0 errors, 0 warnings).

### Questions & answers — Heatmap

**Q1. Filtered to one company (Eli Lilly), STATS says "6 companies" — bug?** Yes, real bug. STATS total = `bubbles().reduce((sum,b) => sum + b.unit_count, 0)` (`heatmap-controls-panel.component.ts:259`) — it SUMS each bucket's count instead of counting distinct entities. Eli Lilly sits in 6 MOA+Indication buckets (each "1 company") -> sums to 6, though there's exactly 1 distinct company. Same mechanism inflates the "assets" total to placements (the 28-vs-23). "groups" (row count) is correct. Fix: count distinct company/asset IDs across buckets, not sum per-bucket unit_count — one fix covers both.

**Q2. Filtered to Indication = Heart Failure but the Indication-grouped heatmap shows 3 rows (HF + CKD + Obesity) — are filters broken?** No, working correctly (with one design nuance). The Indication filter is asset-scoped: it selects assets that HAVE Heart Failure among their indications (`get_positioning_data`, `asset_indications.indication_id = any(p_indication_ids)`). Because assets are multi-indication, grouping by Indication then fans each matched asset out across ALL its indications (unconditional `LEFT JOIN asset_indications`), so the same HF assets also appear under CKD/Obesity. Not a leak.
- Design nuance: filtering Indication = X while grouping by Indication arguably should scope buckets to X (one row); the code shows the full indication footprint instead. Product decision, not a bug.
- "7 of 10 assets" in the READ: the 10 is a SUM across buckets (placements), so multi-indication assets are counted more than once — same placements-vs-distinct issue.

**Q3. (feedback) The READ is the weakest part of the heatmap.** Agreed. It restates structure ("Spread across N buckets, no single focus") and goes circular under filters ("Concentrated in Heart Failure" right after you filtered to Heart Failure). The heatmap has the richest material (white space, crowding, concentration) but doesn't use it. See design ideas.

## Stop 5 — Future Catalysts

The operational watch list: the same markers as the Timeline dots, presented as a chronological calendar of what's coming. Spatial views (Timeline/Bullseye/Heatmap) answer "where does everyone sit"; this answers "what fires next, and when."

**Layout:** table grouped into time buckets of decreasing urgency — THIS WEEK -> NEXT WEEK -> by MONTH -> by QUARTER. Near-term events get day rows; distant ones roll up to quarters.

**Columns:** DATE / CATEGORY / CATALYST / COMPANY-ASSET / STATUS.
- CATEGORY uses the marker taxonomy (Data green, Trial milestone slate, Regulatory orange diamond, Approval blue, Launch violet, LOE amber).
- STATUS = date confidence (Projected vs Confirmed; all Projected in the seed).

**Controls:** free-text Search, per-column filter funnels (Category, Company/Asset), the shared Landscape filters (which persist across all five views — an MOA filter from the Heatmap carried in here), and Export — this one exports to **Excel** (a dated list), vs PowerPoint on the chart views. Rows are clickable for the marker detail panel; a Markers help link explains the colors.

This is where Home's "8 catalysts next 90d" and the READ catalyst links should land. Domain note: NDA = New Drug Application (the FDA submission); "CagriSema NDA projected" = Novo expected to file with FDA.

**Cross-view behavior learned here:** the five Landscape views (Timeline/Bullseye/Heatmap/Future Catalysts + Home tabs) share ONE persisted filter state, so filters follow you between them.

### Questions & answers — Future Catalysts

(none yet)

## Stop 6 — Engagement (space-level Primary Intelligence)

Top nav group switches to Intelligence: Engagement / Intelligence Feed / Materials / Events. This page is the engagement's headline analyst read.

**Primary Intelligence (core concept):** a structured analyst write-up with a publish lifecycle — the actual deliverable the agency produces. Three scopes, same object type: space-level (this engagement headline), company-level, trial-level (on entity pages). Home's "Latest from Stout" is the stream of all of them, tagged Engagement/Company/Trial.

**Card anatomy:**
- Status PUBLISHED + Edit / Withdraw (owner/editor only) — the publish->withdraw lifecycle.
- Title, Contributors + updated-by (authorship/audit).
- SUMMARY = what's happening (observation). IMPLICATIONS = the "so what" / recommendation. This split is the backbone of every post.
- LINKED = cross-references to entities, each with an annotation (e.g. "COMPANY Eli Lilly -- Lilly multi-asset readout cluster").
- HISTORY = version history (posts are versioned).
- MATERIALS = attached deliverables with category tabs (ALL / BRIEFING / CONFERENCE REPORT / PRIORITY NOTICE / AD HOC).

Domain: MAPLE-HCM = aficamten (Cytokinetics) head-to-head trial; HCM = hypertrophic cardiomyopathy; "head-to-head" = tested directly vs a competitor.

### Questions & answers — Engagement

**Q1. The LINKED relationship reads like a disconnected label.** Confirmed UX issue. The read view groups links by relationship (`linkedGroups()`): a relationship chip (FUTURE WINDOW) followed by all entities sharing it, then the next relationship — but styled as flat sibling chips, so the relationship reads as just another label, not a header for the following entities (`intelligence-block.component.html:119-157`). Fix (preferred): one chip per entity with the relationship inline, e.g. "[COMPANY] Eli Lilly · Future window -- note". Alt: keep grouping but make it visually legible (distinct relationship row label + contained entities).

**Q2. "2 versions  v2" is repetitive.** Confirmed redundant. "2 versions" = count of PUBLISHED versions; "v2" = latest published version_number — always equal (sequential), so only the date adds info (`intelligence-history-panel.component.ts:65-80`). Fix: show "v2 · Jun 17, 2026" collapsed, keep the count in the expanded list. Nuance: expanded list shows 4 rows (DRAFT, PUBLISHED v1, DRAFT, PUBLISHED v2) but "2 versions" counts only published snapshots — drafts are intermediate, unnumbered (correct). Enhancement: when an unpublished draft is pending, neither label signals it; could add a "draft pending" hint.

**Q3. History toggle isn't obviously clickable; use cursor on clickables.** The toggle IS a real <button> (keyboard-accessible, good) but lacks `cursor-pointer`, so no hand cursor on hover (`intelligence-history-panel.component.html:2-33`); same for the working-draft row and version rows. No lint rule enforces cursor-pointer though it's a de-facto convention (35+ uses). Fix: add cursor-pointer to these buttons + adopt a convention (CLAUDE.md note + ideally an ESLint rule) so every clickable gets it.

## Stop 7 — Intelligence Feed

The full browse/stream of all Primary Intelligence posts (the expanded "Latest from Stout"). Filterable list of posts, each with a scope tag (Engagement / Company / Trial), title, summary excerpt, and date; "Publish intelligence" action for owner/editor. Reviewed, no issues.

## Stop 8 — Materials

The engagement's document library: every deliverable and source document, categorized and linked to entities. ~76 items.

**Two filter rows:** TYPE = material category (ALL / BRIEFING / CONFERENCE REPORT / PRIORITY NOTICE / AD HOC) — Briefing = recurring client deliverable; Conference report = write-up from a congress (AHA = American Heart Association, ObesityWeek); Priority notice = urgent alert; Ad hoc = one-off. ENTITY = what it's linked to (ALL / TRIAL / MARKER / COMPANY / ASSET / ENGAGEMENT). Each row: file-type badge (PPT/DOC/PDF -> backlog 1 icons), title, category tag, date, link scope, size. "Register material" (owner/editor) uploads; rows download + uploader-only delete.

### Questions & answers — Materials

**Q1. Does "Register material" make sense, or should upload happen from where you link it?** Both flows already exist (verified). Central "Register material" (Materials page): upload + link to MULTIPLE entities in one form; links are OPTIONAL (only title required). Contextual upload: every trial/company/asset/engagement detail page has an embedded materials drop zone that PRE-FILLS the link to that entity (`app-materials-section` -> `material-upload-zone` pre-selects current entity). So "upload from where you link it" is built. Keeping the hybrid is correct (central = multi-entity/library/unlinked; contextual = obvious correct link). Two real gaps the question exposes:
  - **No edit-links UI (recover from mis-link).** `update_material` RPC supports editing links, but the material row only has Download/Delete — no edit affordance. A wrong link (or a link you want to add later) can't be fixed in the UI; you'd delete + re-upload. -> backlog 12.
  - **Picker missing Engagement/space.** The linked-entities picker offers only 4 of 5 types (Trial/Marker/Company/Asset); Engagement (space) is auto-attached only when uploading from the engagement page, never user-selectable. So the central form can't link a doc to the engagement. -> backlog 13.

## Stop 9 — Events

The change-monitoring / activity feed — full version of Home's "What changed" widget. A detailed log of every change across the engagement.

**Layout:** searchable table (LOGGED / SOURCE / TITLE / CATEGORY / ENTITY) + right-side overview (N in window, high-priority count, counts by category). Filters, Export, New event (manual). SOURCE = DETECTED means auto-detected (largely from ClinicalTrials.gov syncs); manual events are the alternative.

**Change categories + domain:**
- Timeline = date slips (event date delayed N days, old -> new).
- Phase = phase transitions (PHASE2 -> PHASE3).
- Trial status = recruitment status changes (Recruiting -> Active, not recruiting = fully enrolled, not taking new patients).
- Catalyst lifecycle = marker added/removed (e.g. deprecated forecast removed).
- Protocol design = the trial design changing: enrollment target (planned participant count), arm added/removed (an "arm" = a treatment group), intervention changed (drug/dose tested).

Powers the "Trial moves" signal on Home and the competitor-change auto-detection.

**Refinement to Home Q3:** on dev, the Events page DOES name the milestone ("CT-388 P2 final analysis projected: event date delayed 120 days"), so the renderer works when `marker_title` is populated. The generic "Event date delayed" seen earlier was a LOCAL seed-data gap (missing marker_title), not a rendering bug.

### Questions & answers — Events

(none yet)

## Stop 10 — Data model: Companies / Assets / Trials

The data-entry/management surfaces under "Manage". Hierarchy: Company -> Asset (product) -> Trial.

**Companies list:** NAME / LOGO / ORDER. "Order" = `display_order`, a manual ranking that drives the sequence companies appear in every company-grouped view — most visibly Timeline ROW order (top-to-bottom) and Bullseye/Heatmap wedge order (`get_dashboard_data` sorts `companies order by display_order`, then assets, then trials by their own display_order). It's the analyst's "house order" of competitors (Lilly 1, Novo 2, ...). This is also the answer to Timeline Q5: row order IS controlled, via this manual order, not an on-chart sort.

**Trials grid:** default columns Trial / NCT ID / Asset / Company / Status / Phase / Markers / Brief title. NOT the full trial record.
- Configurable: Settings -> Fields -> "Trial list" adds extra ClinicalTrials.gov fields as columns (catalogue ~30+: start/primary/study completion dates, enrollment, sponsor, overall status, why-stopped, conditions, etc.). Driven by `CTGOV_FIELD_CATALOGUE` / `trial_list_columns` surface.
- Indications: NOT shown and NOT addable as the structured taxonomy. The CT.gov catalogue has a raw "Conditions" field (registry disease text) you can add, but that is distinct from Clint's structured Indications taxonomy (Obesity/Heart Failure/CKD) that powers the Indication filter + Heatmap buckets + Bullseye grouping. Structured indications appear on the trial detail page and as a filter/group dimension, but not as a trial-grid column.

### Questions & answers — Data model

**Q1. What does "Order" do in Companies?** display_order — manual ranking controlling company sequence in all company-grouped views (Timeline rows, Bullseye/Heatmap wedges). See above. (= Timeline Q5 mechanism.)

**Q2. Are all trial fields in the grid? Are indications shown?** No to both. Grid is a curated subset (+ optional CT.gov columns via Settings -> Fields). Structured Indications are not a column option (only raw CT.gov "Conditions" is). Gap: Indications is first-class everywhere else but not viewable here. See design ideas.

### Add-trial form + the Phase enum (form-field deep dive)

The manual "Add trial" form is intentionally lean: NCT identifier (optional, NCT+8 digits — also enables later CT.gov sync), Name (required), Asset (required, data-driven), Indication(s) (multi-select taxonomy), Phase, Phase start/end (dates). Status, study type, enrollment, completion dates are NOT in the create form — they come from CT.gov sync or the detail/edit page.

**Trial Phase enum (`phase_type`):** Preclinical · Phase 1 · Phase 2 · Phase 3 · Phase 4 · Observational.
- Preclinical = pre-human (lab/animal); HIDDEN by default — per-space `show_preclinical` opt-in (hard to track).
- P1 = first in humans, safety/dosing, small. P2 = efficacy signal, medium. P3 = large pivotal, supports approval, highest-stakes readouts. P4 = post-approval/post-marketing studies. Observational = non-interventional (watches patients, no assigned treatment); colored amber as off the normal progression.

**Key distinction — trial Phase vs asset Development Status (commonly conflated):**
- A TRIAL has a Phase, topping out at P4/Observational. A trial is never "approved/launched."
- An ASSET (drug) has a Development Status: Preclinical · P1 · P2 · P3 · P4 · Approved · Launched — tracked PER asset-indication (a drug can be Launched for obesity but P3 for heart failure).
- Bullseye rings + Heatmap phase columns use Development Status (hence APPROVED/LAUNCHED appear there); the trial form's Phase does not.

**Recruitment Status enum** (shown in the Trials grid, populated by CT.gov, not the create form): Recruiting · Active, not recruiting (fully enrolled, not taking new patients) · Completed · Terminated.

## Stop 11 — Marker Types (the encoding system)

The master key for every timeline dot: 13 marker types, each = shape + color + fill + inner mark. ORIGIN = SYSTEM (built-in, shared across spaces) vs custom (space-scoped, via "Add marker type"). Color = category (fixed, never whitelabeled).

**The 13 system types by category:**
- Data readouts (green circle, inner mark sub-divides): Topline Data (dot), Interim Data (minus), Full Data (solid).
- Trial milestones (slate): Primary Completion Date (PCD), Trial Start, Trial End (dashed lines).
- Regulatory (orange diamond): Regulatory Filing, Submission, Acceptance.
- Approval (blue flag). Launch (violet triangle).
- Loss of exclusivity (brown/amber square): LOE Date (X inner), Generic Entry Date (outline square).

**Two rules to internalize:**
1. Shape + color = event category; the inner mark sub-divides it (three green circles = Topline vs Interim vs Full). Same as the Timeline legend + Future Catalysts CATEGORY column.
2. The FILL column is the type's base style, but on the timeline an individual marker's fill also carries CONFIDENCE: filled = confirmed/actual, outline = projected, struck-through = No Longer Expected. Type gives shape/color/inner; the marker's state drives fill.

Custom marker types can be added (scoped to the space). "Markers guide" help link = the editorial color-rules page.

### Questions & answers — Marker Types

**Q1. What does each marker mean? (lifecycle order)**

Trial milestones (slate):
- Trial Start = study begins (first patient dosed).
- Primary Completion Date (PCD) = data collection on the PRIMARY endpoint finishes (the main question answered); topline follows shortly after. The date analysts circle.
- Trial End (Study Completion) = the whole trial wraps incl. secondary endpoints + follow-up; after PCD.

Data readouts (green circle):
- Interim Data = a PLANNED early look before the trial completes; an independent committee can stop the trial early for success or futility. (inner: minus)
- Topline Data = the FIRST high-level headline of the primary results (hit or miss) — the biggest market-moving moment. (inner: dot)
- Full Data = the COMPLETE dataset, usually at a congress or in a journal (efficacy/safety detail, subgroups). (solid)

Regulatory (orange diamond):
- Regulatory Filing = company submits its marketing application (umbrella term).
- Submission = submitting the specific application (US: NDA small-molecule / BLA biologic; EU: MAA). Often == filing.
- Acceptance = regulator ACCEPTS it for review (validates completeness, starts the review clock / sets the PDUFA target date). Filing = sent; Acceptance = they agreed to review.

Approval & launch:
- Approval (blue flag) = regulator approves (FDA approval / EU authorization) — may now be sold.
- Launch (violet triangle) = actually commercially available (first sales). Approval != Launch; can be weeks-months apart.

Loss of exclusivity (brown/amber square):
- LOE Date = patent/regulatory exclusivity ENDS, opening the door to generics/biosimilars. (inner: X)
- Generic Entry Date = generics/biosimilars actually LAUNCH (the revenue cliff); at or after LOE.

Commonly-confused pairs: PCD vs Trial End (primary data done vs everything done); Interim/Topline/Full (peek -> headline -> complete); Filing/Submission vs Acceptance (sent vs agreed-to-review); Approval vs Launch (allowed vs selling); LOE vs Generic Entry (exclusivity expires vs generics arrive).

## Stop 12 — Taxonomies

Three space-scoped controlled vocabularies (tabs): Indications (diseases), MOA (mechanisms of action), ROA (routes of administration); each a list of name + abbreviation, editable (add/edit/delete). They are the source lists behind every dropdown / filter / grouping: trial-form Indication picker, asset MoA/RoA, landscape filters, Bullseye/Heatmap "group by". Editing one propagates everywhere.

Indications in the demo dataset: ATTR Cardiomyopathy (ATTR-CM), Chronic Kidney Disease (CKD), Heart Failure (HF), Obesity (OB), Type 2 Diabetes (T2D). (MOA/ROA values not enumerated.)

## Issues to watch (running list)

- **[Timeline] Cosmetic:** the "TODAY" label overlaps the "2026" year-axis label near the today line.
- **[Bullseye] Bug:** grouped by Asset, STATS shows "N assets" twice. (backlog 6)
- **[Bullseye] Misleading wording:** chart-center "N assets" counts placements (dots), not unique assets (e.g. 28 vs STATS 23 under Indication); consider "N placements across M assets".
- **[Bullseye] UX defect:** hover tooltip covers the chart / adjacent spokes (no collision avoidance). (backlog 7)
- **[Bullseye] Vocab:** detail-panel eyebrow says "Drug" (hardcoded) while the rest of the app says "Asset".
- **[Heatmap] Bug:** STATS total sums per-bucket counts instead of distinct entities — "6 companies" when only Eli Lilly is filtered (should be 1); also inflates assets to placements (28 vs 23). (backlog 8)
- **[Engagement] UX:** LINKED relationship renders as a flat group-label chip, not visibly tied to its entities. (backlog 9)
- **[Engagement] Cosmetic:** history header "N versions  vN  date" is redundant (N == vN). (backlog 10)
- **[Engagement/global] Affordance:** clickable buttons (history toggle, version rows) lack `cursor-pointer`; no lint/convention enforcing it. (backlog 11)

- **[Home] Clarity gap (local-seed only):** "What changed" date-slip rows showed generic "Event date delayed" on LOCAL seed because `marker_title` was unpopulated. On dev the Events page names the milestone correctly ("CT-388 P2 final analysis projected: event date delayed..."), so the renderer is fine — this is a seed-data gap, not a code bug. (Q3, refined at Stop 9)
- **[Home] Cosmetic:** "Recent materials" link is "All materials" (no arrow) vs the "View all ->" pattern used by every other section. (Q5)
- **[Home] Misleading count (could read as a bug):** "Latest from Stout: N intelligence posts" shows the fetch buffer (capped at 8), not the true total — a space with >8 posts still shows "8". "N this week" is only counted within the loaded 8. Fix = option B in the polish backlog. (Q6)

## Polish backlog (to implement in one batch, push to develop)

These are decided UI improvements to do together (worktree off `develop`, lint + build, single push so they deploy to dev at once):

1. **[DONE] Materials file-type icons.** Replace the text chips (`PPT`/`PDF`/`DOC`/`FILE`) in the shared `material-row.component.ts` with Font Awesome file glyphs, keeping the color coding: PowerPoint `fa-file-powerpoint` (amber), PDF `fa-file-pdf` (red), Word `fa-file-word` (blue), other `fa-file-lines` (slate). Improves both the Home "Recent materials" widget and the Materials page (shared component). Alternative considered: monochrome slate icons (more restrained); chose colored for scan-ability.
2. **[DONE] Materials "View all" arrow.** Change the Recent-materials widget link from "All materials" to "View all materials ->" to match every other Home section. (= Issue Q5)
3. **Change-feed milestone name (seed only, low priority).** RESOLVED as not-a-code-bug at Stop 9: dev names the milestone correctly; the generic "Event date delayed" was a LOCAL seed gap (missing `marker_title`). Only action: populate `marker_title` on local seed change-events if the local demo needs it. (= Issue Q3)
4. **Latest-from-Stout header = honest summary (option B).** Replace the fetch-buffer count with a true total + true this-week, computed server-side (a count query independent of the `limit: 8` feed fetch), e.g. "47 intelligence posts · 6 this week"; keep the latest 4 as the teaser. Mirrors the `new_intel_7d` motion-signal approach. (= Issue Q6 Home)
5. **Make the READ strip linkable (Timeline AND Bullseye).** Turn the segment-based competitive READ into clickable deep links across all variations and views: leader/company -> filter to company; "N catalysts next 90d" + per-company counts -> catalysts page filtered (`within=90d`, company); "next catalyst in 2 days: X readout" -> that marker; "most active (N recent changes/events)" -> activity/events filtered to that company. Segments already exist (`ReadSegment[]`); only the render layer needs routing. (Timeline Q2-Q4, Bullseye Q4)
6. **[DONE] Bullseye STATS doubling.** When GROUP BY = Asset, both STATS boxes read "N assets". Show one box (or substitute trials/companies for the second) when the grouping dimension is asset. (Bullseye Q1)
7. **Bullseye tooltip positioning.** Stop the hover tooltip covering the chart: anchor it outside the chart radius / flip-and-clamp to viewport / larger offset. (Bullseye Q3)
8. **[DONE] Heatmap STATS count distinct, not summed.** `totalCount` sums per-bucket `unit_count` (`heatmap-controls-panel.component.ts:259`), over-counting any company/asset that spans multiple buckets — e.g. "6 companies" when one company (Eli Lilly) is filtered. Count distinct entity IDs across buckets instead. Fixes both the company overcount and the asset placements inflation. (Heatmap Q1)
9. **[DONE] Intelligence LINKED: relationship clarity.** Render one chip per entity with the relationship inline ("[COMPANY] Eli Lilly · Future window -- note") instead of a grouped relationship chip + sibling entity chips. (`intelligence-block.component.html:119-157`; Engagement Q1)
10. **[DONE] Intelligence history header dedupe.** Replace "N versions  vN  date" with "vN · date" collapsed; keep the count in the expanded list. Optional: "draft pending" hint when an unpublished draft exists. (`intelligence-history-panel.component.html:16-24`; Engagement Q2)
11. **[PARTIAL] cursor-pointer on clickables + convention.** Add `cursor-pointer` to the intelligence-history-panel buttons (header toggle, working-draft row, version rows) and audit other clickable elements. Adopt a convention: CLAUDE.md note + ideally an ESLint rule so every clickable gets a pointer cursor (de-facto already, 35+ uses, but unenforced). (Engagement Q3) -- DONE: cursor-pointer added to the three history-panel buttons (with `disabled:cursor-default`). ASK: the CLAUDE.md convention + ESLint rule + global clickable audit (tooling change) is deferred to user decision.
12. **Materials: edit-links UI.** Add an edit-material affordance so a material's entity links can be changed after upload (the `update_material` RPC already supports it; no UI exists). Makes mis-links recoverable and enables "upload now, link later." (Materials Q1)
13. **Materials: add Engagement to the link picker.** The linked-entities picker omits Engagement/space (only 4 of 5 types); add it so the central Register form can link a doc to the engagement, not just via contextual upload. (Materials Q1)

## Design ideas (bigger, not quick fixes)

- **Timeline sorting.** Add a user-facing sort: soonest upcoming catalyst first / most advanced phase first / most recently active / by company. Currently fixed to server order. (Timeline Q5)
- **Seed data: populate `phase_end_date`.** Demo trials lack `phase_end_date`, so their phase bars feather to today instead of running to the CT.gov primary/study completion date. Fill `phase_end_date` on seed trials (or re-sync from CT.gov) so the demo shows bars extending to completion. (Timeline Q6)
- **Rework the Heatmap READ.** It currently restates chart structure ("Spread across N buckets, no single focus") and is circular under filters ("Concentrated in Heart Failure" after filtering to HF). Replace with genuine insight: white space ("no P1/P2 in CKD"), crowding ("most contested: GLP-1 + Obesity, 5 assets / 4 companies"), non-tautological concentration ("Lilly holds 3 of 6 late-stage HF assets"); and suppress the dimension the user filtered on. (Heatmap Q3)
- **Indication filter + Indication grouping: decide bucket-scoping.** When grouping by the same dimension that's filtered, decide whether to scope buckets to the filtered value(s) (one row) or keep showing the matched assets' full footprint (current). (Heatmap Q2)
- **Add structured Indications as an optional Trials-grid column.** Indications is a first-class filter/group dimension (heatmap, bullseye, filter bar) but isn't viewable as a trial-list column — only raw CT.gov "Conditions" is addable. Add the structured taxonomy as a selectable column (needs multi-value chip/overflow handling). (Data model Q2)

---

## Glossary

- **Asset** — a drug/candidate owned by a company.
- **Catalyst** — a future, market-moving dated event (forward view of a marker).
- **Confirmed / Projected** — known date vs estimated date.
- **Indication** — the disease a drug targets.
- **Intelligence / read / post** — analyst write-up published to the client.
- **LOE** — loss of exclusivity (patent expiry).
- **Marker** — a dated event on a trial timeline (the colored dots).
- **MoA** — mechanism of action (how the drug works).
- **NCT number** — ClinicalTrials.gov registry ID for a trial.
- **Phase (Preclinical/P1/P2/P3/Filed/Approved/Launched)** — stage of development.
- **Primary completion** — date primary-endpoint data collection finishes.
- **RoA** — route of administration (oral, subcutaneous, etc.).
- **Space / Tenant / Agency** — engagement / pharma client / consultancy (the three-tier hierarchy).
- **Topline** — first high-level readout of a trial's primary results.
