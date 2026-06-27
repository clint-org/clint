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
(matching `.ts` / `.html` / `.spec.ts`).

Contract:

- `options = input.required<{ id: string; name: string }[]>()` — current list,
  owned by the parent.
- `value = model<string[]>([])` — selected ids; same shape the forms bind today.
- `createFn = input<((name: string) => Promise<{ id: string; name: string }>)
  | null>(null)` — supplied by the parent, wired to the right service's
  `create()`. When `null`, the component degrades to a plain multiselect (no
  Create affordance) — this is also the read-only / non-editor fallback.
- `entityLabel = input.required<string>()` — singular noun for copy
  (`"mechanism"`, `"route"`, `"indication"`).
- `optionCreated = output<{ id: string; name: string }>()` — lets the parent
  append the new option to its own `options` signal so the list stays in sync.
- Pass-through inputs to preserve current behaviour: `inputId`, `placeholder`,
  `selectedItemsLabel`, `maxSelectedLabels`, `styleClass`, `disabled`.

Internals:

- A `filterText` signal updated from `p-multiselect`'s `(onFilter)` event.
- A `footerState` computed that classifies `filterText` against `options` using
  the matching helper into `exact | near | none` plus the near-match list.
- A `creating` signal to disable the Create row while the insert is in flight.

### Footer template behaviour

Rendered in the `p-multiselect` footer based on `footerState`:

- **`exact`** (typed text normalizes to an existing option): no Create row. The
  matching option is already visible in the filtered list to select normally.
- **`near`** (no exact match, but lookalikes exist): a muted `Similar: <name>`
  line listing the top 1–2 closest options, each clickable to select that
  existing option instead. The Create row still shows below it.
- **`none`**: a `+ Create "<typed text>"` row.

Create-row click flow:

1. Set `creating`, call `createFn(filterText)`.
2. On success: emit `optionCreated`, push the new id into `value`, clear the
   filter, unset `creating`.
3. On failure (e.g. a race-condition unique violation if two tabs create the
   same name): the error surfaces as a toast at the service origin per the
   client guardrails; the component clears `creating` and leaves the filter so
   the user can retry or pick the now-existing value.

### Matching helper — `taxonomy-match.ts`

A small pure module, unit-tested in isolation, no third-party dependency:

- `normalize(s)`: lowercase, trim, collapse internal whitespace, strip
  punctuation and hyphens.
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

### Asset form (`asset-edit-form.component.html`)

Replace the MOA and ROA `p-multiselect` blocks with `app-taxonomy-multiselect`:

- MOA: `[options]="moaOptions()"`, `[(value)]="moaIds"` (matching existing
  `moaIds` signal), `entityLabel="mechanism"`,
  `[createFn]="createMoa"`, `(optionCreated)="onMoaCreated($event)"`.
- ROA: same with `roaOptions` / `roaIds` / `entityLabel="route"` /
  `createRoa` / `onRoaCreated`.

The component owns the `space_id` indirectly: the parent's `createFn` closes over
the current `spaceId` and calls `service.create(spaceId, { name })`, then
`onXCreated` appends `{ id, name }` to the `xOptions` signal.

### Trial form (`trial-edit-form.component.html`)

Replace the Indication `p-multiselect` with `app-taxonomy-multiselect` wired to
`indicationOptions` / the indication selection model / `entityLabel="indication"`
/ `createIndication` / `onIndicationCreated`.

## Permissions

Create is editor-only by table RLS. The affordance is bound to the presence of
`createFn`: editor-reachable forms pass a real `createFn`; any read-only context
passes `null` and gets a plain multiselect. No greyed-out buttons, no
post-click permission toasts (per `src/client/CLAUDE.md` section 13.5).

## Testing

- `taxonomy-match.spec.ts` — `normalize`, `levenshtein`, and `classify`:
  exact (incl. whitespace/case/hyphen variants), near (substring + typo within
  threshold, and correctly NOT firing past threshold), none, empty text, near
  list cap and ordering.
- `taxonomy-multiselect.component.spec.ts` — type a novel value then click
  Create → option appears selected and `optionCreated` emitted; exact-match text
  suppresses the Create row; near-match text shows the Similar hint and clicking
  it selects the existing option; `createFn=null` hides the Create affordance.

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
