# Design System Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write `docs/design-system.md` -- a prescriptive, AI-consumable engineering contract for Clint's visual system -- and wire it into `CLAUDE.md` and `brand.md` so it steers both engineers and AI design tooling.

**Architecture:** A single hand-written markdown doc that owns *rules and rationale* and links to code (`primeng-theme.ts`, `phase-colors.ts`, `styles.css`) for *exact values* -- never duplicating hex/token tables. It complements (does not replace) `docs/brand.md`. Two small wiring edits make it discoverable. No code changes; the downstream audit/fix phases are separate plans.

**Tech Stack:** Markdown. Source-of-truth files are TypeScript (Angular 19 / PrimeNG 21 Aura preset) and CSS. Verification is grep-based (no duplicated hex, links resolve).

---

## Spec

Source spec: `docs/superpowers/specs/2026-06-07-design-system-doc-design.md`

## Decided defaults (the "picked winners")

The spec flagged three spots where the doc must pick one pattern. These are the chosen defaults; write them as the rule. They match the dominant/cleaner existing pattern to minimize downstream churn.

1. **Native `<button>` vs `p-button` boundary.** Native `<button>` is permitted **only** for navigation and icon chrome: the icon rail, header/topbar dropdown *triggers*, and inline link-style affordances. Every data or form mutation action uses `p-button`. Hand-rolled `<button>` selection dropdowns are disallowed -- use `p-select`.
2. **Destructive-action treatment.** `p-button severity="danger" [outlined]="true"` with a leading `pi pi-trash` (or action-appropriate) icon, everywhere, with no filled-red variant. Confirmation flows through the existing `confirm-delete-dialog` shared component.
3. **Primary commit + dialog spacing.** Exactly one filled primary `p-button` per form/dialog; secondary/cancel = `severity="secondary" [outlined]="true"` via the `form-actions` component. Form body spacing is `space-y-4` (resolve any `space-y-5`); dialog footers use `form-actions` (`flex justify-end gap-2 border-t border-slate-100 pt-4`).

## File Structure

- **Create:** `docs/design-system.md` -- the entire deliverable, one focused doc.
- **Modify:** `CLAUDE.md` (root) -- add one reference line in the Design Context section (~line 11-12).
- **Modify:** `docs/brand.md` -- add one cross-link line near the top (after the positioning blockquote, ~line 4).

## Canonical source files the doc links to (verify each exists; never copy values from them)

- `src/client/src/app/config/primeng-theme.ts` -- `TEAL_SCALE`, `buildBrandPreset()`, all component token overrides.
- `src/client/src/app/core/models/phase-colors.ts` -- `PHASE_DESCRIPTORS`, `DEVELOPMENT_STATUS_COLORS`, labels, preclinical-visibility helpers.
- `src/client/src/styles.css` -- `--brand-*` / `--color-brand-*` CSS variable layer.
- `src/client/CLAUDE.md` -- enforced Angular/PrimeNG/Tailwind/a11y rules (sections 8, 9, 13).
- `docs/brand.md` -- brand philosophy (complement, cross-link).
- Shared wrappers to name as mandatory/canonical: `src/client/src/app/shared/components/form-field.component.ts`, `form-actions.component.ts`, `confirm-delete-dialog/`, `section-card.component.ts`, `status-tag.component.ts`, `color-swatch.component.ts`, `grid-toolbar.component.ts`, `row-actions.component.ts`.

---

### Task 1: Scaffold doc + Sections 1-2 (Purpose, Foundations)

**Files:**
- Create: `docs/design-system.md`

- [ ] **Step 1: Create the file with title, intro, and the two opening sections**

Write `docs/design-system.md` starting with:

````markdown
# Clint -- Design System

> Engineering contract for the Clint visual system. Prescriptive and AI-consumable.
> For the brand philosophy (the *why*), see [`brand.md`](./brand.md). This doc is the
> *how*: tokens, primitives, controls, and the rules that govern them.

## 1. Purpose & how to use this doc

This is the single canonical reference for *how* to build UI in Clint. Its readers are
engineers and AI design tooling (the `impeccable` skills). It is loaded into agent
context via the root `CLAUDE.md` Design Context section.

**Non-drift principle.** This doc owns **rules and rationale**. It **points to code** for
**exact values** and never duplicates hex codes or token values. If you need a precise
color or token, follow the link to its source file -- do not copy it here, or the two
will drift. (Same reason the runbook uses auto-gen blocks and the help pages live-render.)

## 2. Foundations

Exact values live in code. These are the global, named decisions -- stated as rules:

- **Border radius = 0** on data and control surfaces. Enforced globally by the Aura preset
  (`formField.borderRadius`, per-component `borderRadius`) in
  [`primeng-theme.ts`](../src/client/src/app/config/primeng-theme.ts). Do not round
  data elements.
- **Light mode only.** Dark mode is disabled in the preset (`darkModeSelector` off). Never
  add a dark variant.
- **Slate is the neutral family.** Never `gray-*`. Surface tokens map to `{slate.*}` in the
  preset.
- **Brand utilities, not raw teal.** Use `bg-brand-*` / `text-brand-*` / `border-brand-*` /
  `ring-brand-*`. Never `bg-teal-*` or `indigo-*`. The brand scale is host-aware (whitelabel)
  and defined in [`styles.css`](../src/client/src/styles.css) as `--color-brand-*`. Data
  colors (slate, red, amber, green, cyan, violet) stay hard-coded -- they are not brand.
- **Spacing & density.** Form body spacing is `space-y-4`. Dialog/toolbar/card padding follows
  the rhythm in Section 8. Resolve ad-hoc `space-y-5` to `space-y-4`.
- **Typography.** Mono/tabular for timeline headers; company names uppercase + tracked as
  structural labels; form-field labels are 10px uppercase tracked (see
  `form-field.component.ts`). Full type intent in [`brand.md`](./brand.md#typography).

See also `src/client/CLAUDE.md` sections 8 (PrimeNG), 9 (Tailwind/brand), 13 (empty-state
audit) -- those are enforced lint/review rules this doc does not re-litigate.
````

- [ ] **Step 2: Verify every linked source path resolves**

Run:
```bash
cd /Users/aadityamadala/Documents/code/clint-v2
for f in src/client/src/app/config/primeng-theme.ts src/client/src/app/core/models/phase-colors.ts src/client/src/styles.css src/client/CLAUDE.md docs/brand.md; do test -f "$f" && echo "OK $f" || echo "MISSING $f"; done
```
Expected: five `OK` lines, no `MISSING`.

- [ ] **Step 3: Verify no duplicated hex codes were introduced**

Run:
```bash
grep -nE "#[0-9a-fA-F]{6}" docs/design-system.md || echo "CLEAN: no raw hex"
```
Expected: `CLEAN: no raw hex`.

- [ ] **Step 4: Commit**

```bash
git add docs/design-system.md
git commit -m "Add design-system doc: purpose + foundations"
```

---

### Task 2: Sections 3-4 (Data-viz colors, Primitives inventory)

**Files:**
- Modify: `docs/design-system.md`

- [ ] **Step 1: Append Section 3 (data-viz color system)**

```markdown
## 3. Data-viz color system

Colors that carry meaning in charts, markers, and badges. These are a *system*, not
decoration: markers pop, phase bars recede, structure guides the eye.

- **Phase + development-status colors** are defined in
  [`phase-colors.ts`](../src/client/src/app/core/models/phase-colors.ts)
  (`PHASE_DESCRIPTORS`, `DEVELOPMENT_STATUS_COLORS`). PRECLIN and P1 are muted slate so the
  eye lands on later phases; P3 is the hero teal; P4 violet marks the regulatory transition;
  OBS amber sits caution-adjacent. Do not invent phase colors -- read them from this file.
- **Marker colors** (data=green, trial milestone=slate, regulatory=orange, approval=blue,
  launch=violet, LOE=amber) are seeded data; the authoritative role-to-color mapping is in
  [`brand.md`](./brand.md#marker-colors-from-seed-data).
- **Live references** that render the real tokens: the in-app `help/phases` and
  `help/markers` pages (they import the same descriptors, so they cannot drift).

Rule: any new data-viz color is added to `phase-colors.ts` (or the marker seed), never
hard-coded at a call site.
```

- [ ] **Step 2: Append Section 4 (primitives inventory)**

```markdown
## 4. Primitives inventory

Use PrimeNG primitives; never reinvent. Each primitive's look is set globally by the Aura
preset in [`primeng-theme.ts`](../src/client/src/app/config/primeng-theme.ts) -- do not
inline-override colors with Tailwind utilities.

| Primitive | Component | Canonical wrapper / notes |
|-----------|-----------|---------------------------|
| Button | `p-button` | See Section 6 for hierarchy. Native `<button>` only per Section 5. |
| Text input | `pInputText` | Wrap in `app-form-field` (Section 8). |
| Single select | `p-select` | Section 5 decides when. |
| Multi select | `p-multiselect` | `display="chip"` for read-back of fixed sets. |
| Segmented enum | `p-selectButton` | Small fixed enums (Section 5). |
| Boolean | `p-checkbox` / `p-toggleSwitch` | Per context. |
| Dialog | `p-dialog` | Footer via `form-actions`; spacing in Section 8. |
| Inline message | `p-message` | `severity` = info/success/warn/error (NOT a button severity). |
| Transient feedback | `p-toast` | Styled flat in preset; success=brand, error=red, warn=amber. |
| Tooltip | `pTooltip` | Never native `title=`. Position: right (nav rails), top (inline badges), bottom (editor toolbars). |
| Status / tag | `app-status-tag` (`status-tag.component.ts`) | Canonical status pill. |
| Card / section | `app-section-card` (`section-card.component.ts`) | Canonical bordered section. |
| Color swatch | `app-color-swatch` (`color-swatch.component.ts`) | For legends/branding UI. |
| Toolbar | `app-grid-toolbar` (`grid-toolbar.component.ts`) | Canonical table/grid toolbar. |
| Row actions | `app-row-actions` (`row-actions.component.ts`) | Canonical per-row action cluster. |
| Destructive confirm | `confirm-delete-dialog` | Always use for delete/permanent actions. |

Mandatory shared wrappers: `app-form-field` (labeled fields), `form-actions` (form/dialog
footers), `confirm-delete-dialog` (destructive confirmation). Reaching past these into raw
markup is the drift this doc exists to stop.
```

- [ ] **Step 2b: Verify the referenced shared components exist**

Run:
```bash
cd /Users/aadityamadala/Documents/code/clint-v2/src/client/src/app/shared/components
for c in form-field.component.ts form-actions.component.ts status-tag.component.ts section-card.component.ts color-swatch.component.ts grid-toolbar.component.ts row-actions.component.ts; do test -e "$c" && echo "OK $c" || echo "MISSING $c"; done
test -d confirm-delete-dialog && echo "OK confirm-delete-dialog/" || echo "MISSING confirm-delete-dialog/"
```
Expected: all `OK`, no `MISSING`.

- [ ] **Step 3: Verify no duplicated hex**

Run: `grep -nE "#[0-9a-fA-F]{6}" docs/design-system.md || echo "CLEAN"`
Expected: `CLEAN`.

- [ ] **Step 4: Commit**

```bash
git add docs/design-system.md
git commit -m "Add design-system doc: data-viz colors + primitives inventory"
```

---

### Task 3: Section 5 (Control-selection rules)

**Files:**
- Modify: `docs/design-system.md`

- [ ] **Step 1: Append Section 5**

```markdown
## 5. Control-selection rules

The single answer to "which control for this job." The recon found the same job rendered
four ways (`p-select`, `p-selectButton`, `p-multiselect`, hand-rolled `<button>` dropdowns);
this table ends that.

| Situation | Use | Do not |
|-----------|-----|--------|
| Small fixed enum, 2-5 stable options, one choice | `p-selectButton` or chip-button group | a `p-select` dropdown for 3 options |
| Small fixed enum, multiple choices | chip-button group / `p-multiselect display="chip"` | checkboxes scattered without grouping |
| Large or dynamic list, one choice | `p-select` | hand-rolled `<button>` dropdown |
| Large or dynamic list, multiple choices | `p-multiselect` | repeated single selects |
| Boolean | `p-checkbox` (in a form) / `p-toggleSwitch` (instant setting) | a 2-option select |
| Navigation / command trigger | native `<button>` (chrome only) or `p-button` | a select used as a menu |

**Native `<button>` boundary.** Native `<button>` is permitted **only** for navigation and
icon chrome: the icon rail, header/topbar dropdown *triggers*, and inline link-style
affordances. Every data or form mutation action uses `p-button`. Hand-rolled `<button>`
selection dropdowns are disallowed -- use `p-select`.

**Filter idiom.** Browse-page filters share one visual surface (wash, border, typography)
but pick the control *idiom* by the data: chip-buttons for small fixed enums, multiselects
only when the list is large or dynamic. (See the established per-page filter convention.)
```

- [ ] **Step 2: Verify no duplicated hex**

Run: `grep -nE "#[0-9a-fA-F]{6}" docs/design-system.md || echo "CLEAN"`
Expected: `CLEAN`.

- [ ] **Step 3: Commit**

```bash
git add docs/design-system.md
git commit -m "Add design-system doc: control-selection rules"
```

---

### Task 4: Sections 6-7 (Button hierarchy/severity, Labels & copy)

**Files:**
- Modify: `docs/design-system.md`

- [ ] **Step 1: Append Section 6 (button hierarchy & severity)**

```markdown
## 6. Button hierarchy & severity

Button colors/states are set globally in the preset; this section governs *which* variant
to use, not how it looks.

- **One primary commit per surface.** The single most important action (Save, Publish,
  Create) is a filled primary `p-button`. Everything else on that surface steps down.
- **Secondary / cancel.** `severity="secondary" [outlined]="true"`, via the `form-actions`
  component -- do not hand-roll cancel buttons.
- **Destructive.** `severity="danger" [outlined]="true"` with a leading icon
  (`pi pi-trash` or action-appropriate), consistently. No filled-red buttons. Route
  delete/permanent actions through `confirm-delete-dialog`.
- **`error` is not a button severity.** `severity="error"` belongs to `p-message`;
  `severity="danger"` belongs to buttons. Do not cross them.

| Action | Variant |
|--------|---------|
| Primary commit | filled primary `p-button` |
| Secondary / cancel | `secondary` + `[outlined]` (via `form-actions`) |
| Destructive | `danger` + `[outlined]` + icon (via `confirm-delete-dialog`) |
| Tertiary / inline | `[text]` `p-button` |
| Nav / icon chrome | native `<button>` (Section 5) |
```

- [ ] **Step 2: Append Section 7 (labels & copy)**

```markdown
## 7. Labels & copy

- **Domain-vocabulary imperative.** Action labels name the domain object in imperative
  form: "Publish intelligence", "Register material", "Restore", "Permanently delete".
- **Banned generic CTAs:** "Submit", "Save" (bare), "Add" (bare), "OK", "Done",
  "Click here". Allowed only when the object is implied and domain-correct (e.g. a
  single-field dialog where "Save limits" names its object).
- **Casing.** Sentence case for buttons and labels (first word capitalized, not Title Case),
  except proper nouns. Form-field labels render 10px uppercase via `app-form-field` -- that
  is a presentation transform, not the source string's casing.
- This extends `src/client/CLAUDE.md` section 13 (empty-state audit): column headers and
  empty states use domain vocabulary, never generic ("Item", "Record").
```

- [ ] **Step 3: Verify no duplicated hex**

Run: `grep -nE "#[0-9a-fA-F]{6}" docs/design-system.md || echo "CLEAN"`
Expected: `CLEAN`.

- [ ] **Step 4: Commit**

```bash
git add docs/design-system.md
git commit -m "Add design-system doc: button hierarchy + labels/copy"
```

---

### Task 5: Sections 8-10 (Form/dialog structure, Do/Don't, Downstream)

**Files:**
- Modify: `docs/design-system.md`

- [ ] **Step 1: Append Section 8 (form & dialog structure)**

```markdown
## 8. Form & dialog structure

- **`app-form-field` is mandatory** for every labeled field. It supplies the 10px uppercase
  label, optional required `*` marker, and error-text slot. Never hand-roll
  `<label class="text-sm font-medium">` -- that is the exact dialog drift the recon found.
- **Required marking.** Use the `app-form-field` required input; do not scatter manual
  `<span class="text-red-600">*</span>`.
- **Form body spacing:** `space-y-4`. Resolve any `space-y-5` to `space-y-4`.
- **Dialog footer:** the `form-actions` component
  (`flex justify-end gap-2 border-t border-slate-100 pt-4`). Buttons right-aligned, primary
  last. Do not place bare buttons in a dialog footer.
- **Dialog body padding** is provided by the preset (`dialog.content` padding); do not add
  competing outer padding.
```

- [ ] **Step 2: Append Section 9 (Do / Don't quick reference)**

```markdown
## 9. Do / Don't quick reference

| Do | Don't |
|----|-------|
| `bg-brand-*` / `text-brand-*` | `bg-teal-*`, `indigo-*`, `gray-*` |
| `p-button` for data/form actions | raw `<button>` for mutations |
| native `<button>` for nav/icon chrome only | hand-rolled `<button>` selection dropdowns |
| `p-selectButton` / chips for small enums | `p-select` for 3 fixed options |
| one filled primary per surface | multiple primaries competing |
| `danger` + outlined + icon for destructive | filled-red or icon-less delete buttons |
| domain imperative labels | "Submit", "Add", "OK", "Done" |
| `app-form-field` for labeled fields | raw `<label>` markup in dialogs |
| `space-y-4` form bodies | `space-y-5` / ad-hoc spacing |
| `pTooltip` on icon-only buttons | native `title=` |
| read values from `phase-colors.ts` | hard-coded phase/marker hex at call sites |
```

- [ ] **Step 3: Append Section 10 (Downstream)**

```markdown
## 10. Downstream phases

This doc is the rulebook (Spec 1). It sets up, but does not perform, the cleanup:

- **Phase 2 -- Audit.** A read-only violation inventory mapping each offending `file:line`
  to the rule it breaks. (Separate spec.)
- **Phase 3 -- Normalize.** Batched fix PRs by axis: form-fields first (adopt
  `app-form-field`), then buttons/labels, then controls. (Separate spec.)
- **Phase 4 -- Guardrails (stretch).** Mechanizable rules become lint/template checks plus a
  `src/client/CLAUDE.md` rule, so consistency cannot regress.
```

- [ ] **Step 4: Verify no duplicated hex and final structure**

Run:
```bash
cd /Users/aadityamadala/Documents/code/clint-v2
grep -nE "#[0-9a-fA-F]{6}" docs/design-system.md || echo "CLEAN"
grep -c "^## " docs/design-system.md
```
Expected: `CLEAN`, then `10` (ten top-level sections).

- [ ] **Step 5: Commit**

```bash
git add docs/design-system.md
git commit -m "Add design-system doc: form/dialog structure, do-dont, downstream"
```

---

### Task 6: Wire the doc into CLAUDE.md and brand.md

**Files:**
- Modify: `CLAUDE.md` (root, ~line 11)
- Modify: `docs/brand.md` (~line 4)

- [ ] **Step 1: Add the reference line to root `CLAUDE.md` Design Context**

In `CLAUDE.md`, immediately after the line:
`` `docs/brand.md` is the authoritative brand guide. This section is the short form that should shape every design decision. ``

insert a new paragraph:

```markdown
`docs/design-system.md` is the engineering contract beneath the brand guide -- the concrete *how* (tokens, primitives, controls, label/copy and form/dialog rules). Consult it for any UI implementation decision.
```

- [ ] **Step 2: Add the cross-link to `docs/brand.md`**

In `docs/brand.md`, immediately after the positioning blockquote (line 3, the
`> Positioning: ...` line), insert:

```markdown

> Engineering contract (tokens, primitives, controls, rules): see [`design-system.md`](./design-system.md).
```

- [ ] **Step 3: Verify both links resolve and the references landed**

Run:
```bash
cd /Users/aadityamadala/Documents/code/clint-v2
grep -n "design-system.md" CLAUDE.md docs/brand.md
test -f docs/design-system.md && echo "OK target exists"
```
Expected: a hit in `CLAUDE.md`, a hit in `docs/brand.md`, and `OK target exists`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/brand.md
git commit -m "Wire design-system doc into CLAUDE.md and brand.md"
```

---

### Task 7: Final verification + execution wrap

**Files:** none (verification only)

- [ ] **Step 1: Full-doc sanity checks**

Run:
```bash
cd /Users/aadityamadala/Documents/code/clint-v2
echo "-- no raw hex (values must be links, not copies):"
grep -nE "#[0-9a-fA-F]{6}" docs/design-system.md || echo "CLEAN"
echo "-- section count (expect 10):"
grep -c "^## " docs/design-system.md
echo "-- no placeholder markers:"
grep -niE "TBD|TODO|FIXME|fill in|implement later" docs/design-system.md || echo "CLEAN"
echo "-- relative links point at real files:"
grep -oE "\]\(\.\.?/[^)]+\)" docs/design-system.md | sed -E 's/^\]\(//; s/\)$//' | while read -r p; do real="docs/${p#./}"; real="${real/docs\/..\//}"; done; echo "(manually confirm the 5 source links resolve)"
```
Expected: `CLEAN` for hex and placeholders; `10` sections.

- [ ] **Step 2: Confirm the linked anchors/paths by spot check**

Run:
```bash
cd /Users/aadityamadala/Documents/code/clint-v2
for f in src/client/src/app/config/primeng-theme.ts src/client/src/app/core/models/phase-colors.ts src/client/src/styles.css; do test -f "$f" && echo "OK $f" || echo "MISSING $f"; done
```
Expected: three `OK` lines.

- [ ] **Step 3: Offer `teach-impeccable`**

The doc is now AI-consumable and referenced from `CLAUDE.md`. Offer to run
`impeccable:teach-impeccable` to register the design context with the `impeccable` design
skills (`frontend-design`, `normalize`, `extract`). This is an offer; do not run it
automatically.

- [ ] **Step 4: Push (per repo convention)**

```bash
git push
```

---

## Self-Review

**Spec coverage:** Every spec section maps to a task -- Purpose/Foundations (T1), data-viz + primitives (T2), control-selection (T3), button hierarchy + labels (T4), form/dialog + do-dont + downstream (T5), wiring (T6), success-criteria verification + teach-impeccable offer (T7). Non-drift principle is enforced by the repeated `grep` hex check in every doc task. brand.md is complemented and cross-linked, not superseded (T6). Out-of-scope items (audit, fixes, guardrails, /styleguide) are named as downstream in Section 10, not built.

**Placeholder scan:** No TBD/TODO in plan content; the only "downstream/later" references are deliberate Section 10 forward-pointers to separate specs. T7 greps the *doc* for placeholder markers to ensure none leak into the deliverable.

**Type/name consistency:** Component and file names used across tasks match the verified paths (`form-field.component.ts`, `form-actions.component.ts`, `status-tag.component.ts`, `section-card.component.ts`, `color-swatch.component.ts`, `grid-toolbar.component.ts`, `row-actions.component.ts`, `confirm-delete-dialog/`). Section numbering is consistent (1-10) and cross-references (Section 5/6/8) point to the right sections.
