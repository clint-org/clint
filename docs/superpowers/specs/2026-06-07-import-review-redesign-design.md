# Import Review Grid Redesign — Native Controls + Dialog Editing

**Status:** Design approved (pending spec review)
**Date:** 2026-06-07
**Supersedes:** the "Option A" review-table work (resizable columns, inline name-links, inline
field editing) — those affordances are removed/replaced by this design.

## Problem

The source-import review grid (`features/source-import/review-page.component.ts`) grew an
ad-hoc editing surface that does not match the rest of the app and feels janky in use:

- **Reinvented controls.** The expandable row detail edits reference data (phase, status,
  indication) with **free-text inputs**, and manages assets with a bespoke chip+star control.
  Everywhere else in the app these are PrimeNG `Select` / `MultiSelect` / `DatePicker` controls
  (`asset-form`, `company-form`, `trial-edit-dialog`). Typing reference data into text boxes is
  the wrong pattern.
- **Resizable columns are janky.** `columnResizeMode="fit"` squeezes neighbouring columns; users
  want overflow to **scroll**, not squeeze. (Resize discoverability and the drag-indicator
  offset were patched, but the feature still isn't worth its complexity.)
- **Unclear how to edit.** The expansion affordance (a bare chevron, later a "DETAIL"/"ASSETS"
  pill) is not intuitive.
- **Inconsistent affordances.** Entity names are links only when the entity matched an existing
  record; new entities render as plain text ("Retatrutide isn't clickable"), which reads as a bug.

## Goals

1. The review grid is a clean, read-only table; overflow scrolls horizontally.
2. Editing a proposed entity uses the **same controls as the Manage screens**, via a dialog —
   no free-text reference data, no bespoke controls.
3. A single, obvious **Edit** affordance per row (the Manage "⋯ → Edit" pattern).
4. Match resolution (existing vs new) moves into the edit dialog.
5. Manage screens keep working unchanged (shared components, no drift, no regressions).

## Non-goals

- No change to `commit_source_import`, the extraction worker, or the data model.
- No change to the import entry flow (`import-page`, NCT input) or the commit gate.
- No new "create reference data on the fly" behaviour beyond what Manage already supports.

## Architecture: extract shared presentational form bodies

The Manage forms use the right controls but are coupled to the database: options load from
`*.list(spaceId)` and Save calls RPCs. The review grid edits an **in-memory proposal**
(`SourceImportService.proposal()`) whose entities are not in the DB and may be brand new, so it
cannot save to the DB or rely on DB-only option lists.

Resolve this by extracting the form **bodies** into presentational components that take values +
option lists as inputs, expose value via `model()` signals, emit a validity signal, and contain
**no persistence and no service injection for saving**:

- `CompanyEditFormComponent` — name, logoUrl, displayOrder.
- `AssetEditFormComponent` — name, genericName, company (Select), MOA (MultiSelect), ROA
  (MultiSelect), logoUrl, displayOrder.
- `TrialEditFormComponent` — name, identifier (NCT), assets (MultiSelect), primary (Select),
  indication (Select), phase (Select), phaseStart/phaseEnd (DatePicker).

These reuse the existing `FormFieldComponent` / `FormActionsComponent` wrappers and the exact
controls already in `asset-form` / `company-form` / `trial-edit-dialog`.

Two containers consume each form body:

- **Manage** (`trial-edit-dialog`, `trial-create-dialog`, `asset-form`, `company-form`): load
  options from services, render the form body, save via the existing RPCs. Behaviour identical to
  today (this is a refactor, regression-checked against existing specs).
- **Review grid** (`features/source-import/`): a per-type edit dialog that renders the same form
  body with proposal-sourced options and writes changes back into the in-memory proposal.

### Options in the review grid

Options come from **existing space records ∪ entities proposed in this import**, so a brand-new
asset is still selectable as a trial's asset:

- **Trial → assets:** the proposal's `assets` array (each labelled by name, existing or new).
  The control's option id is the asset's **index** in `proposal.assets`; `asset_refs` /
  `primary_asset_ref` are indices, so mapping is index⇄string.
- **Trial → indication:** space indications (`IndicationService.list`) ∪ the proposal's
  indication string. Value is the indication name; `commit_source_import` resolves create/match
  by name on commit.
- **Asset → company:** the proposal's `companies` array (by index, matching `company_ref`).
- **Asset → MOA / ROA:** space mechanisms/routes (`MechanismOfActionService` /
  `RouteOfAdministrationService`) ∪ the proposal asset's proposed moa/roa names. Values are names.

### Match resolution control (review-only)

The dialog gains a **Match** control at the top for company/asset/trial: "Create new '\<name\>'"
versus an existing record, listing the fuzzy candidates with their scores (from
`proposal.fuzzy_alternates`) — and for trials, NCT-keyed identity. Selecting writes the match
override (the existing `setMatchOverride` logic moves here). This replaces the inline
"LLM pick / alternates / Create new" buttons. Manage containers do not render this control.

### Proposal write-back

Pure mapping functions (unit-tested, in a `review-edit.logic.ts` alongside `review-grid.logic.ts`)
translate between proposal entities and form values, e.g.:

- `proposalTrialToForm(trial, proposal)` → form value (option ids, indices→strings).
- `applyTrialForm(form, trial, proposal)` → new proposal trial (strings→indices, match override).
- Equivalents for asset and company.

The dialog commits its result by writing the updated entity back into a cloned
`proposal.proposals[type][index]` and calling `SourceImportService.setProposal(next)`. Nothing
touches the DB until **Confirm** (`commit_source_import`), unchanged.

## The grid

- **Read-only display.** Remove inline inputs, the chip+star editor, name-links, and the
  DETAIL/ASSETS toggle. Keep: checkbox selection, tree grouping (company → asset → trial),
  primary/also-tested badges, flag badges, CT.gov source badge.
- **Overflow scrolls.** Drop `resizableColumns` / `columnResizeMode` and the `ttResizableColumn`
  handles and the `primeng-overrides.css` resize block. Give the table a sensible min-width and
  wrap it in a horizontally scrollable container so columns keep their width and the pane scrolls
  (no squeeze). Text columns may still wrap.
- **Edit affordance.** An actions column per row with an **Edit** control (reuse the
  `row-actions` / Manage "⋯ → Edit" pattern) that opens the type-appropriate review edit dialog.
- Flags (no-asset, duplicate) stay as badges; `canConfirm` / commit gate unchanged.

## Components and files

New (review side):
- `features/source-import/review-edit-dialog.component.ts` — hosts the right form body by entity
  type + the Match control; reads/writes the proposal.
- `features/source-import/review-edit.logic.ts` (+ `.spec.ts`) — pure proposal⇄form mappings.

New (shared, extracted):
- `manage/trials/trial-edit-form.component.ts`
- `manage/assets/asset-edit-form.component.ts`
- `manage/companies/company-edit-form.component.ts`
(Or `shared/components/` if cleaner; keep next to their Manage usage by default.)

Modified:
- Manage dialogs/forms → consume the extracted form bodies (no behaviour change).
- `review-page.component.ts` → read-only grid + Edit actions; remove inline editing, links,
  resize, rowDetail editing controls.
- `primeng-overrides.css` → remove the TreeTable resize block; keep `display:block` only if still
  needed for layout.

## Testing

- **Unit (Vitest):** the pure `review-edit.logic.ts` mappings (proposal⇄form, match override,
  index⇄id) — the highest-value, most error-prone logic. Keep `review-grid.logic.ts` specs green.
- **Manage regression:** existing Manage specs stay green after the form-body extraction.
- **Runtime:** drive the local review-grid repro harness (auth + seeded space + injected proposal,
  documented in this branch's history) to verify: read-only grid, horizontal scroll, Edit opens
  the dialog with real controls, edits persist into the proposal, Confirm still commits. Verify
  Manage trial/asset/company create+edit still work in-app.

## Risks / mitigations

- **Manage regression from extraction** → shared form body keeps one source of truth; run existing
  specs + exercise Manage create/edit in-app before merge.
- **Proposal⇄form mapping complexity** (indices, matches, new entities) → isolate in pure,
  unit-tested functions; the dialog stays thin.
- **Indication semantics** (name vs id, create-on-commit) → model as name; rely on
  `commit_source_import`'s existing name resolution; do not introduce DB writes pre-commit.
- **Scope** → larger than the prior patches; if needed, land the shared-form extraction +
  trial dialog first, then asset/company, behind the same grid shell.

## Rollback

The change is front-end only (no migration). Revert the branch to restore the prior grid.
