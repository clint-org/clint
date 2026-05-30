# Import review redesign: grouped grid

Date: 2026-05-30
Status: Design, pending implementation plan
Surface: `src/client/src/app/features/source-import/review-page.component.ts`
Route: `/t/:tenantId/s/:spaceId/import/:aiCallId/review`

## Problem

The "Review import proposals" screen renders the company > asset > trial proposal
tree with every node at equal visual weight. On an NCT batch import almost every
node is new, so the signals meant to help the reviewer instead saturate the page:

1. The green "New" badge fires on nearly every row, plus an Existing/New sub-tag
   inside every MOA and ROA pill. A signal present on ~90% of rows carries no
   information.
2. Brand teal is overloaded across New badges, MOA pills, ROA pills, source
   links, and CT.gov pills, so nothing recedes and nothing pops.
3. `SOURCE: NCTxxxx` repeats on the company, asset, and trial row, and for an NCT
   import the trial name is itself that same NCT id, so it prints twice on one
   line.
4. Each item is one long flex-wrap row, so attribute-heavy rows wrap to full
   width and break vertical scan rhythm.
5. A `generic_name` text input renders open under every asset even when nobody is
   editing, and the footer summary `3C/6A/6T/0M/0E` needs decoding.

The reviewer's job is three things at once: catch mismatches and errors, correct
fields inline, and confirm. The current layout serves none of them well because
the eye has no resting state.

## Principle

Suppress the routine, surface the exception. New is the default, so it carries no
badge. Slate is the resting color. Color and chips appear only where a human is
needed: a match conflict, a missing link, a data gap. This principle holds
regardless of layout and is the core of the redesign.

## Chosen direction: grouped grid (tree-table)

Evaluated four directions via an HTML prototype (refined tree, dense grid,
list+inspector, grouped grid). Selected the grouped grid: the grid's
column-aligned scanning, with trials nested under their asset and per-row detail
that expands inline.

Rationale: a flat grid is unbeatable for comparing attributes down aligned
columns and scales to large batches, but it loses two things this importer needs.
First, linkage: the importer creates the company-asset-trial graph, and a
mislinked trial is the most expensive error to miss, so trial-under-asset nesting
must stay visible. Second, the rich per-item review affordances already in the
code (CT.gov candidate picker, fuzzy-match override, missing-asset notice,
inline edit) need somewhere to live other than a separate inspector. The grouped
grid keeps both: aligned columns plus nesting plus expand-on-demand detail.

### Information architecture

Columns, left to right:

| Column | Content |
|---|---|
| Select | Checkbox. Company and asset checkboxes cascade to descendants. |
| Entity | Indented by depth. Company group header row (mono, uppercase, tracked). Asset name (slate-900). Trial NCT id (mono, brand link) under its asset with a guide. |
| Type | `asset` / `trial` / `marker` / `event` (mono, slate-400). |
| Phase | Trials only. P3 rendered as a subtle teal pill (pivotal-as-hero per brand). |
| Status | Trial status (slate). |
| MOA / ROA | Asset attributes as calm slate chips. No Existing/New sub-tags. |
| Source | One quiet cyan `ct.gov` tag linking to ClinicalTrials.gov. No repeated SOURCE strings. |
| Flag | Amber chip only when a review state applies (see taxonomy). Otherwise empty. |

Grouping and nesting:

- Companies are group headers spanning the full width.
- Assets are parent rows; their trials are child rows indented beneath with a
  left guide tying them to the asset. The asset row shows its trial count.
- Markers and events (present on text/URL imports, absent on the NCT batch) nest
  under their trial or asset, or render in the existing "Unlinked markers" /
  "Unlinked events" sections when they have no parent.

Row expansion:

- A chevron appears only on rows that have review detail (a flag to resolve, or
  an editable field). Clicking it expands an inline detail panel spanning the
  data columns. Routine rows have no chevron, keeping them flat and calm.
- Asset detail panel: editable `generic_name` field, and for an existing match a
  note that the asset resolves to an existing record so trials attach without
  creating a duplicate.
- Trial detail panel: CT.gov candidate radio picker (when multiple candidates),
  fuzzy-match override chips (when alternates exist), and the missing-asset
  blocker message (when unlinked).

### Signal economy: states and flags

States (calm, not amber):

- Existing match: an entity resolves to an existing company/asset/trial. Render
  the name as a brand link with a quiet slate `existing` tag and a brand left
  rail. This replaces the inverted "New everywhere" treatment.
- New: the default. No badge.

Flag taxonomy (amber chip, plus an amber left rail on the row):

| Tier | Flag | Source signal | Blocks Confirm |
|---|---|---|---|
| Blocking | Trial has no asset | `trialMissingAsset` | Yes |
| Blocking | Within-batch duplicate | `resolved_identifiers` collision (same identifier or NCT proposed twice) | Yes |
| Attention | CT.gov needs pick | more than one `ctgov_candidates` entry | No |
| Attention | Fuzzy name uncertain | `fuzzy_alternates` present for the entity | No |
| Attention | No MOA/ROA | both `moa` and `roa` empty on an asset | No |
| Attention | Observational trial | trial `study_type` indicates observational (replace the current `asset_ref == null` proxy in `isObservationalTrial`) | No |
| Attention | Missing phase/status | `phase` or `status` empty on a trial | No |
| Info | CT.gov lookup failed | `trialCtgovStatus === 'failed'` | No |

Blocking flags disable Confirm and are summarized in the footer. Attention and
info flags never block; they draw the eye and expand to the relevant affordance.

Indication, open decision: Indication is a first-class concept in this product
(the `indications`, `asset_indications`, `trial_conditions`, and
`condition_indication_map` tables, and the per-indication bullseye), but it is
not part of an import proposal. For a new asset the analyst assigns
`asset_indications` after import; trial-level indication derives from CT.gov
conditions through `condition_indication_map`. So at review time there is no
indication value on a proposal to validate. Two options:

- (a) Leave indication off the flag set. Recommended for v1: nothing to flag yet.
- (b) Add an Attention flag on new assets meaning "no indication will be set,
  assign one after import" as a forward reminder, since indication drives the
  bullseye and an asset with none is invisible there.

Extending the importer to actually propose an indication per asset is a larger,
separate change and is out of scope here.

Already handled elsewhere, kept off the per-row flag system: proposal-level
`warnings[]` (banner at top), and `dropped` items (the collapsible "Dropped"
disclosure).

### Filters and bulk actions

- Toolbar segmented control: All / Needs review / New. "Needs review" collapses
  the grid to flagged rows only (and their parents for context), so a large batch
  reduces to the handful that need a human.
- A select-all control and cascading group/asset checkboxes.

### Footer

Replace the coded summary `15 of 15 selected (3C/6A/6T/0M/0E)` with readable
counts: `15 of 15 selected: 3 companies, 6 assets, 6 trials`. When blocking flags
are unresolved, the footer states what blocks Confirm (for example "1 trial needs
an asset") and Confirm stays disabled.

## Implementation approach

Per project convention (PrimeNG for tables, never reinvent), use PrimeNG
`TreeTable` for the column-aligned company/asset/trial nesting. Per-row review
detail (CT.gov picker, fuzzy override, generic_name edit, missing-asset notice)
renders in the TreeTable row-expansion slot, toggled by the chevron that appears
only on rows with detail.

Risk to validate in the plan with a short spike: TreeTable couples tree nesting
and row expansion, and we want nesting for hierarchy plus a separate detail
expansion. If those fight, fall back to PrimeNG `Table` with self-managed
grouping rows and `rowexpansion`, keeping the same visual result. Decide during
the plan, not now.

Reuse: the existing helper methods (`assetMoas`, `assetRoas`, `trialPhase`,
`trialStatus`, `isObservationalTrial`, `trialMissingAsset`, `trialCtgovStatus`,
`fuzzyAlternatesFor`, `ctgovCandidatesFor`, `editableFields`, `entityKey`,
selection signals) carry over. The change is presentational plus the new flag
derivation and the within-batch duplicate check. Build a single `computed()` that
derives each entity's state and flag list so the template stays declarative.

Component conventions: standalone, OnPush, signals, native control flow, reactive
state, `inject()`. Any plain props bound via `[(ngModel)]` that feed a `computed()`
must be signals (a recurring trap in this codebase). Brand tokens only
(`bg-brand-*`, `{primary.X}`), with slate/amber/cyan/violet as data colors. The
1584-line component should be split where the grid, the row detail, and the flag
derivation form natural units rather than growing the single file further.

## Accessibility

WCAG AA. The grid is keyboard navigable with visible focus; chevrons are real
buttons with `aria-expanded` and a `pTooltip`; the expanded detail is in the
accessibility tree; flag chips have text labels, not color alone; amber contrast
holds against white and against the amber row wash; the radio picker is a labeled
group; on entry focus lands on the main heading; dynamic count and blocker
changes announce via `aria-live`.

## Testing

Per project rule, pair tests with each task inline, never deferred. Vitest specs
cover: state derivation (existing vs new), each flag's derivation from its source
signal, the within-batch duplicate detector, blocking-flag gating of Confirm
(`canConfirm`), cascading selection, the Needs review filter, and the readable
footer summary.

## Non-goals

- No change to the import pipeline, RPCs, or schema. Presentation only.
- No new `indication` field (parked).
- No change to the two-pane source-text view for URL/text imports beyond
  applying the same grid to the proposals pane.

## Follow-ups

- Run `npm run features:near` for related-capability hits to cite once the touched
  files are known in the plan.
- In-app help and runbook: no schema or RPC change, so no runbook auto-gen
  impact. Confirm during the plan whether any help page references the old layout.
