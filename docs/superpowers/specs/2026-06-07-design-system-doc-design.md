# Design System Documentation -- Spec 1 (the rulebook)

Status: Approved (design)
Date: 2026-06-07
Owner: Aaditya Madala

## Summary

Create `docs/design-system.md`: a single canonical, prescriptive engineering contract
for the Clint visual system, and wire it so it actually steers both engineers and AI
design tooling. The doc consolidates design decisions that are currently scattered
across `brand.md`, `primeng-theme.ts`, `phase-colors.ts`, `styles.css`, and
`src/client/CLAUDE.md`, and -- critically -- captures the **decision-layer rules**
(which control for which job, button hierarchy, label/copy conventions, form/dialog
structure) that are not written down anywhere today.

This is Spec 1 of a larger consistency initiative. It produces the **rulebook only**.
The audit (violation inventory) and normalize (code fixes) phases are downstream specs
that depend on the rules this doc settles.

## Motivation

A recon sweep of `src/client/src/app` (156 components, mostly inline templates) found:

- **Token hygiene is clean.** Zero `teal-N` / `indigo-N` / `gray-N` utility violations.
  The theme preset (`primeng-theme.ts`) enforces the primitive look (radius=0, button
  color states, form-field padding, toast/tooltip styling) globally, so the primitive
  layer cannot drift.
- **Drift lives entirely at the decision layer**, which tokens cannot enforce:
  - **Native vs PrimeNG buttons** -- 134 `p-button` vs 112 raw `<button>`; the boundary
    leaks (e.g. "New space" raw dropdown button vs "Create space" `p-button` for nearly
    the same act).
  - **Button hierarchy** -- destructive actions inconsistent (`danger` + outlined + icon
    vs `danger` + outlined + no icon); the primary commit action never uses
    `severity="primary"`, relying on the default. (`error`(57) vs `danger`(11) is *not*
    a bug -- `error` is on `p-message`, `danger` is on buttons.)
  - **Labels** -- generic Title Case ("Create space", "Add owner", "Save limits")
    coexisting with domain imperative ("Restore", "Permanently delete"). No rule.
  - **Selection controls** -- the same job rendered four ways: `p-select`,
    `p-selectButton`, `p-multiselect`, and hand-rolled `<button>` dropdowns.
  - **Form fields** -- a shared `app-form-field` component exists (10px uppercase label,
    `*` required marker, error text), but dialogs bypass it with raw
    `<label class="text-sm font-medium">`. Highest-value finding: the fix is mostly
    "adopt the component that already exists."
  - **Spacing** -- `space-y-4` vs `space-y-5` on sibling dialogs; footers have `pt-4` but
    no `pb`.

A rulebook does not fix existing drift on its own, but it is the prerequisite: it gives
one right answer per decision, and becomes the contract that the downstream audit/fix
phases enforce and that AI design tooling (the `impeccable` skills) reads from.

## Non-drift principle (load-bearing)

The doc **owns prose, rules, and rationale**. It **points to code** as the source of
truth for exact values and **never duplicates** hex codes, token values, or component
overrides. Duplicating those would create a second source of truth that drifts the
moment a token changes -- the same failure mode the runbook auto-gen blocks and the
live-render help pages exist to prevent.

Canonical value sources the doc links to (and must not copy from):

- `src/client/src/app/config/primeng-theme.ts` -- the Aura preset: `TEAL_SCALE`,
  `buildBrandPreset()`, all component token overrides (radius, button/select/multiselect,
  dialog, datatable, toast, tooltip, message).
- `src/client/src/app/core/models/phase-colors.ts` -- `PHASE_DESCRIPTORS`,
  `DEVELOPMENT_STATUS_COLORS`, labels, and per-space preclinical visibility helpers.
- `src/client/src/styles.css` -- the `--brand-*` / `--color-brand-*` CSS variable layer
  (host-aware whitelabel brand scale).
- `src/client/CLAUDE.md` -- the existing enforced Angular/PrimeNG/Tailwind/a11y rules
  (sections 8, 9, 13 especially).
- `docs/brand.md` -- the brand philosophy layer (complement, not superseded).

## Relationship to brand.md

`brand.md` remains the authoritative **philosophy / why** layer (it is referenced by the
root `CLAUDE.md` "Design Context" section). `design-system.md` is the **engineering /
how** layer beneath it. The two cross-link both ways; no content is moved out of
`brand.md` and `brand.md` is not retired. This avoids rewriting a load-bearing file and
avoids duplication.

## Deliverable: `docs/design-system.md`

Prescriptive, terse, AI-consumable. Each section scaled to its content. Sections:

1. **Purpose & how to use this doc.** Who reads it (engineers + AI design tools like the
   `impeccable` skills). States the non-drift principle: rules and rationale live here;
   exact values live in the linked code. Notes that the doc is loaded into agent context
   via the root `CLAUDE.md` reference.

2. **Foundations.** Pointers to the canonical value sources above. States the named,
   global decisions as rules (not value tables):
   - Border radius = 0 on data/control surfaces (enforced by preset).
   - Light mode only; dark mode disabled in the preset.
   - Slate is the neutral family; never `gray-*`.
   - Use `bg-brand-*` / `text-brand-*` / `border-brand-*` / `ring-brand-*`; never
     `bg-teal-*` / `indigo-*`. Data colors (slate/red/amber/green/cyan/violet) stay
     hard-coded.
   - Density and spacing scale: the canonical spacing rhythm for forms, dialogs, and
     toolbars (resolves the `space-y-4` vs `space-y-5` and footer-padding drift).
   - Type scale: mono/tabular for timeline headers; uppercase tracked structural labels;
     the 10px uppercase form-label convention.

3. **Data-viz color system.** Phase colors and development-status colors as a *system*
   with rationale (markers pop, phase bars recede), pointing to `phase-colors.ts` and the
   live `help/markers` and `help/phases` pages. No hex duplication.

4. **Primitives inventory.** For each: what it is, its canonical markup, and the mandatory
   shared wrapper where one exists. Covers: button, input (`pInputText`), select,
   multiselect, selectButton, checkbox, dialog, message, toast, tooltip, tag/chip, card.
   Names `app-form-field` and `form-actions` as the mandatory wrappers for form fields and
   dialog footers respectively.

5. **Control-selection rules** (the gap nothing documents today). A decision table:
   - Small fixed enum (2-5 stable options) -> `p-selectButton` or chip-button group.
   - Large or dynamic list -> `p-select` (single) / `p-multiselect` (multi).
   - Boolean -> `p-checkbox` / `p-toggleSwitch` per context.
   - Native `<button>` permitted **only** for navigation/icon chrome (icon rail, header
     dropdown triggers); every data/form action uses `p-button`. Hand-rolled `<button>`
     dropdowns for selection are disallowed -- use `p-select`.
   - References the existing `feedback_filter_idiom_per_page` rule (share visual surface
     across filters, but pick the control idiom by enum size/dynamism).

6. **Button hierarchy & severity.** The one primary commit action per surface is explicit
   (filled primary). Secondary/cancel = `secondary` + outlined (the `form-actions`
   pattern). Destructive = `danger` with one consistent treatment (outlined + icon, fixed
   by the doc). Clarifies `error` is a `p-message` severity, not a button severity.

7. **Labels & copy.** Domain-vocabulary imperative labels ("Publish intelligence",
   "Register material", "Restore"); banned generic CTAs ("Submit", "Save", "Add", "OK",
   "Done", "Click here") except where the object is implied and domain-correct. Casing
   convention. Aligns with `src/client/CLAUDE.md` section 13 (empty-state audit).

8. **Form & dialog structure.** `app-form-field` is mandatory for labeled fields (no raw
   `<label>`); required-field marking; error/help text placement; dialog body spacing and
   footer padding model (resolves the footer `pt-4`/no-`pb` drift).

9. **Do / Don't tables.** One compact table per relevant section, written to be
   machine-readable for AI design tools.

10. **Downstream.** Names the two follow-on phases as separate specs:
    - Phase 2 -- Audit: a violation inventory mapping offending `file:line` to the rule
      broken (read-only).
    - Phase 3 -- Normalize: batched fix PRs by axis, form-fields first (adopt existing
      component), then buttons/labels, then controls.
    - Phase 4 (stretch) -- Guardrails: mechanizable rules become lint/template checks plus
      a `src/client/CLAUDE.md` rule.

## Wiring (part of this spec)

1. Add a one-line reference to `docs/design-system.md` in the root `CLAUDE.md`
   "Design Context" section, so it auto-loads into agent context each session, alongside
   the existing `brand.md` pointer.
2. Add reciprocal cross-links: `brand.md` -> `design-system.md` (for the engineering
   layer) and `design-system.md` -> `brand.md` (for philosophy).
3. After the doc lands, **offer** to run `impeccable:teach-impeccable` to register the
   design context with the `impeccable` design skills (`frontend-design`, `normalize`,
   `extract`). This is an offer, not an automatic step.

## Out of scope (Spec 1)

- The audit violation inventory (Phase 2, downstream spec).
- Any code changes / normalization (Phase 3, downstream spec).
- Lint/template guardrails and any `src/client/CLAUDE.md` enforcement rules (Phase 4).
- A live in-app `/styleguide` route (separate, larger decision -- noted as a possible
  future vehicle if zero-drift rendered swatches are wanted).
- Rewriting or retiring `brand.md`.

## Success criteria

- `docs/design-system.md` exists and covers all ten sections above.
- The doc contains **no duplicated hex/token tables**; every concrete value is a link to
  its canonical source file.
- Control-selection rules, button hierarchy/severity rules, label/copy rules, and
  form/dialog structure rules are each stated unambiguously (one right answer per
  decision) with a Do/Don't table.
- Root `CLAUDE.md` references the new doc; `brand.md` and `design-system.md` cross-link.
- The doc reads as a prescriptive contract an engineer or AI tool can follow without
  consulting the source files for *rules* (only for *values*).

## Risks / open considerations

- **Rule choices encode opinions.** Where the recon found two coexisting patterns (e.g.
  native vs `p-button` boundary, destructive-button treatment, dialog spacing), the doc
  must pick one. Those picks should match the dominant/cleaner existing pattern to
  minimize downstream churn, and are reviewable when the doc is drafted.
- **Doc-vs-CLAUDE.md overlap.** `src/client/CLAUDE.md` already encodes some rules
  (sections 8/9/13). The doc should reference, not re-litigate, those; where it adds new
  decision-layer rules, section 13's spirit (domain vocabulary, tooltips, role-appropriate
  affordances) is the precedent to extend.
