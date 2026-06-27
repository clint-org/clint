# Inline Type-to-Create for Taxonomy Multiselects

**Date:** 2026-06-26
**Status:** Design (awaiting review)

## Problem

When an analyst adds a new asset or trial, they pick taxonomy values from
multiselect dropdowns. In a freshly provisioned space those dropdowns are often
empty or incomplete, so the analyst has to break flow, leave the create dialog,
go to a management page, add the missing value, return, and re-open the form.
That round-trip is the friction this feature removes: let an editor mint a new
taxonomy value from inside the asset/trial form, in the moment they need it.

## Scope

In scope (three per-space, name-keyed lookup fields):

- **Indication** on the trial form (`indications` table)
- **Mechanism of Action** on the asset form (`mechanisms_of_action` table)
- **Route of Administration** on the asset form (`routes_of_administration` table)

Out of scope:

- **Company** (asset form) — deferred by product decision; richer entity with
  logo/website, better served by a dedicated quick-add later.
- **Phase** (trial) and **development status** (asset indication) — fixed enums
  / check constraints; there is nothing to create.
- **Abbreviation / description / parent** at create time — these stay `null` on
  inline creation and are edited later on the existing management pages. They
  are deliberately not collected in the create flow.
- **Reactive-forms migration** of the two host forms — both currently drive
  their multiselects with `[ngModel]`/`(ngModelChange)`. We keep that pattern to
  avoid ballooning the diff (per `src/client/CLAUDE.md` section 11); the new
  wrapper exposes the same `string[]` model contract.
- **Unicode / accent folding** — `normalize` lowercases and strips ASCII
  punctuation/whitespace only. It does NOT fold accents or Greek letters, so
  `GLP-1α` and `GLP-1a` are treated as distinct. Conscious omission: pharma
  vocabulary is intentionally precise about such characters, and accent-folding
  risks collapsing genuinely different terms. Revisit only if it causes real
  duplication in practice.

## Why this is mostly a frontend problem

The backend already supports everything:

- `IndicationService.create(spaceId, { name })`,
  `MechanismOfActionService.create(spaceId, { name })`,
  `RouteOfAdministrationService.create(spaceId, { name })` each insert
  `{ ...partial, space_id }`, return the row, and invalidate the correct RPC
  cache tags.
- RLS already lets space editors insert into all three tables.
- Creating an asset or trial is itself an editor action, so anyone who can open
  these forms can already create taxonomy values.

No new RPCs, no migrations, no RLS changes.

## Component design

### `TaxonomyMultiselect` (reusable wrapper)

A single standalone component wrapping PrimeNG `p-multiselect`, service-agnostic
so the same component serves all three fields.

Location: `src/client/src/app/features/manage/shared/taxonomy-multiselect/`
Following the repo's testing convention (unit tests never mount templates; the
testable logic is extracted and tested in the node env), the create/footer state
machine lives in a framework-light controller (`taxonomy-create-controller.ts`,
plain `@angular/core` signals, no `inject()`), and the component only binds
PrimeNG events/templates to it. Matching logic lives in `taxonomy-match.ts`.

Contract:

- `options = input.required<{ id: string; name: string }[]>()` — current list,
  owned by the parent.
- `value = model<string[]>([])` — selected ids; same shape the forms bind today.
- `createFn = input<((name: string) => Promise<{ id: string; name: string }>)
  | null>(null)` — supplied by the parent. It is responsible for BOTH persisting
  the value and registering the saved row in the parent's `options` signal (so
  it renders as selected), then returning the row. When `null`, the component
  degrades to a plain multiselect (no Create affordance) — this is also the
  read-only / non-editor fallback. Folding the option-append into `createFn`
  avoids threading an output back up through the presentational form bodies.
- `entityLabel = input.required<string>()` — singular noun for copy
  (`"mechanism"`, `"route"`, `"indication"`).
- Pass-through inputs to preserve current behaviour: `inputId`, `placeholder`,
  `selectedItemsLabel`, `maxSelectedLabels`, `styleClass`, `disabled`, and
  `appendTo` (`'body'` when hosted inside a dialog so the panel is not clipped).

Controller internals:

- A `filterText` signal updated from `p-multiselect`'s `(onFilter)` event.
- A `footer` computed that classifies `filterText` against `options` via the
  matching helper into `{ near, showCreate, createLabel }`.
- A `creating` signal to disable the Create row while the insert is in flight.
- `create()` resolves `true`/`false` so the component knows whether to close the
  panel (success → `hide()` clears the filter via `resetFilterOnHide`).

### Footer template behaviour

Rendered in the `p-multiselect` footer based on `footerState`:

- **`exact`** (typed text normalizes to an existing option): no Create row. The
  matching option is already visible in the filtered list to select normally.
- **`near`** (no exact match, but lookalikes exist): a muted `Similar: <name>`
  line listing the top 1–2 closest options, each clickable to select that
  existing option instead. The Create row still shows below it.
- **`none`**: a `+ Create "<typed text>"` row.

Create-row click flow:

1. Trim `filterText`, then truncate to `TAXONOMY_NAME_MAXLEN` (255, the tightest
   column `indications.name`) so the created name cannot exceed any target
   column; set `creating`, call `createFn(name)`.
2. On success: append the new id to `value` (existing selections preserved),
   clear the filter, unset `creating`, and the component closes the panel.
3. On failure (e.g. a race-condition unique violation if two tabs create the
   same name): the host `createFn` surfaces the error (the asset form's error
   banner, the trial dialogs' toast) and re-throws; the controller clears
   `creating`, returns `false`, and leaves the filter so the user can retry or
   pick the now-existing value. Selection is untouched.

While `creating` is set the Create row is disabled, so a double-click cannot
fire two inserts.

### Matching helper — `taxonomy-match.ts`

A small pure module, unit-tested in isolation, no third-party dependency:

- `normalize(s)`: lowercase and strip every non-alphanumeric character
  (whitespace, hyphens, punctuation all removed) so `GLP-1`, `GLP 1`, and `GLP1`
  converge to `glp1`.
- `levenshtein(a, b)`: standard edit distance (~15 lines).
- `classify(text, options)`: returns `{ kind: 'exact' | 'near' | 'none';
  near: Option[] }`.
  - `exact` when some option's normalized name equals the normalized text.
  - `near` when, for a non-empty text with no exact match, an option is a
    normalized substring (either direction) or within a length-relative
    Levenshtein threshold (e.g. `<= 2` for short strings, otherwise
    `<= ceil(len * 0.15)`); near list capped at 2, ordered by closeness.
  - `none` otherwise.

Thresholds are conservative so the "Similar" hint only fires on genuine
lookalikes, not on every option sharing a letter.

## Wiring in the host forms

The presentational form bodies (`asset-edit-form`, `trial-edit-form`) gain a
`createFn` input per taxonomy field and pass it straight through to
`app-taxonomy-multiselect`; the owning host components supply the closures. Each
host closure persists via the service, appends the saved row to its own typed
`options` signal, surfaces failures (asset form error banner / trial dialog
toast), and re-throws on failure.

### Asset (`asset-edit-form` + host `asset-form`)

MOA and ROA `p-multiselect` blocks become `app-taxonomy-multiselect`
(`entityLabel` `"mechanism"` / `"route"`, `[(value)]` on the existing
`moaIds` / `roaIds` models). `asset-edit-form` exposes `moaCreateFn` /
`roaCreateFn` inputs; `asset-form` passes `createMoa` / `createRoa`, both built
from a shared `createTaxonomy<T>()` helper over the MOA/ROA services.

### Trial (three surfaces)

- `trial-create-dialog` (the Add-trial surface): its own Indication
  `p-multiselect` becomes `app-taxonomy-multiselect` with `[createFn]="createIndication"`.
- `trial-edit-form` + host `trial-edit-dialog` (Manage edit): `indicationCreateFn`
  input, host passes `createIndication`.
- `review-edit-dialog` (import review): passes no `createFn` — its option ids are
  indication NAMES, not UUIDs, so it stays a plain multiselect.

## Permissions

Create is editor-only by table RLS. The affordance is bound to the presence of
`createFn`: editor-reachable forms pass a real `createFn`; any read-only context
passes `null` and gets a plain multiselect. No greyed-out buttons, no
post-click permission toasts (per `src/client/CLAUDE.md` section 13.5).

## Testing

`taxonomy-match.spec.ts` (pure helper):

- `normalize` — case-folding, full whitespace/hyphen/punctuation stripping;
  whitespace/punctuation-only input normalizes to empty.
- `levenshtein` — known distances incl. zero, insert/delete/substitute.
- `classify` — exact (incl. whitespace/case/hyphen variants on either side),
  near via substring (both directions), near via typo just inside the threshold,
  correctly NOT near just outside the threshold (boundary cases pinned), none,
  short (single-char) query → none, empty/whitespace-only text → none, near-list
  cap of 2 and closeness ordering.

`taxonomy-create-controller.spec.ts` (the create/footer state machine — the
component itself is thin view-binding, exercised by build + manual, consistent
with the repo's `heatmap-view` / `engagement-landing` signal specs):

- Footer state: hidden for empty/whitespace filter; hidden when `createFn` is
  null; create offered with trimmed label for a novel value; suppressed on exact
  match; near suggestion shown alongside the create row.
- Happy path: create appends the new id, preserves existing selections, clears
  the filter.
- Input hygiene: trimmed text passed to `createFn`; over-length input truncated
  to `TAXONOMY_NAME_MAXLEN`.
- `create()` returns `true` on success, `false` on failure / no-op.
- In-flight guard: a second `create()` while one is pending does not call
  `createFn` twice.
- Failure path: a rejected `createFn` leaves `value` and the filter untouched
  and clears `creating`.
- `selectExisting` adds the option and clears the filter without creating, and
  does not duplicate an already-selected option.

Accessibility: the Create row and Similar suggestions are real `<button>`
elements with `aria-label`, keyboard-operable by default; verified during manual
browser exercise (per `src/client/CLAUDE.md` section 7).

Each test ships with its task, not deferred to a separate phase.

## Verification

```bash
cd src/client && ng lint && ng build && npm run test:units
```

Plus manual exercise in the browser: open the asset create dialog in a space,
type a new mechanism, create it inline, confirm it is selected and persists on
save; repeat for ROA and for Indication on the trial dialog.

## Related capabilities

The three management pages remain the canonical place to edit the richer fields
(abbreviation, description, display order, indication parent). Inline creation is
additive: it seeds a name-only row that those pages then enrich. No behaviour on
the management pages changes.
