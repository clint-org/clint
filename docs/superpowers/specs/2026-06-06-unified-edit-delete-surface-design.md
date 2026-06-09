# Unified edit/delete surface for entities

**Date:** 2026-06-06
**Status:** Design approved, pending implementation plan

## Problem

Edit and delete are inconsistent across the manage entities (companies, assets,
trials, markers/notes, events). You can edit an entity from where you are looking
at it, but to delete it you usually have to navigate back to a list grid and find
its row. Three distinct patterns exist today:

| Entity | Edit today | Delete today |
|---|---|---|
| Company | grid row kebab only (the detail page has **no** actions at all) | grid row kebab only |
| Asset | detail header "Edit details" button **and** grid row kebab | grid row kebab only |
| Trial | detail header "Edit details" button **and** grid row kebab | grid row kebab only |
| Marker / Note (on trial detail) | row kebab (opens inline edit) | row kebab — already paired |
| Event | event-detail-panel pen icon (edit) | `onDeleteEvent()` exists in `events-page.component.ts` but is **wired to nothing** — no delete affordance is surfaced at all |

The result: to edit a trial you stay on the trial detail page; to delete it you
return to the trials grid. Company detail pages expose neither action. Events
cannot be deleted from the UI at all.

## Goal

One shared action idiom everywhere. The same overflow ("kebab") menu — the
existing `app-row-actions` component — carries Edit, Delete, and any
entity-specific actions, and appears identically in an entity's **grid row** and
its **detail-page / detail-panel header**. Pure kebab on detail headers (no
separate visible Edit button); editing becomes reachable wherever delete is, and
vice versa.

## Decisions (from brainstorming)

1. **One shared action menu everywhere** — the `app-row-actions` kebab idiom, in
   grid rows and detail headers alike.
2. **Detail header = pure kebab** — Edit, entity nav, a separator, then Delete
   (red) all live inside the `⋯` menu, identical to a grid row. No separate
   primary Edit button on detail pages.
3. **Post-delete from a detail page → navigate up to the parent list** — trial →
   trials list, asset → assets list, company → companies list, event → events
   list — with a success toast naming what was removed. Deleting from a grid row
   is unchanged (reload in place).

## Architecture

### Approach: per-entity action builder + shared delete orchestrator

A small pure function builds the `MenuItem[]` for each entity, and one shared
delete orchestrator runs the identical preview → confirm → delete → toast flow.
The two surfaces differ only in their after-success callback:

- **Grid row** passes `onSuccess` = reload the list in place (current behavior).
- **Detail page** passes `onSuccess` = navigate to the parent list.

This shares the risky part (the confirm/delete flow, where the cascade preview
and typed-confirmation live) while letting each surface decide its after-effect.
It matches the existing functional style of `shared/utils/confirm-delete.ts` and
avoids coupling a new injectable to Router/MessageService.

Rejected alternatives:

- **`EntityActionsService` (injectable)** — centralizes menu + delete in one
  service, but couples it to Router/MessageService and makes per-surface
  after-effects awkward to vary.
- **Smart kebab component that resolves the entity itself** — least call-site
  code, but bakes in navigation assumptions and is the hardest to test.

### Shared building blocks

1. **Action builders** (pure, per entity): given
   `{ canEdit, onEdit, onDelete, extras? }`, return the `MenuItem[]` (Edit,
   any entity nav such as "View assets", separator, Delete with
   `styleClass: 'row-actions-danger'`). When `canEdit` is false, Edit/Delete are
   omitted. Live alongside the existing shared delete utility (e.g.
   `shared/entity-actions/`), and are consumed by both the grid component and the
   detail component for each entity.

2. **Delete orchestrator** (shared): wraps the existing per-entity flow —
   `previewDelete` (where applicable) → `confirmDelete(...)` dialog →
   `service.delete(id)` → success toast / error surface → `onSuccess()` callback.
   Centralizing this removes the duplicated `confirmDelete` methods currently
   copy-pasted across the list components and guarantees the grid and detail
   delete flows are byte-for-byte identical.

### Topbar integration

The contextual topbar (`core/layout/contextual-topbar.component.ts`) currently
renders `TopbarStateService.actions` as individual `p-button`s, used by list
pages for visible "New X" create buttons.

- Add `overflowActions = signal<MenuItem[]>([])` to `TopbarStateService`.
- The topbar renders an `app-row-actions` kebab in its `.topbar-actions` area
  whenever `overflowActions` is non-empty — the same component grid rows use.
- The existing `actions` (visible buttons) stays, but is used **only** for
  create/primary actions. Entity **edit/delete** moves out of buttons and into
  `overflowActions`.

So a detail page header shows: back-link + eyebrow/title on the left, and a
single `⋯` kebab on the right containing Edit details, entity nav, separator,
Delete. List pages keep their visible "New X" button.

## Per-entity wiring

| Entity | Grid row | Detail surface |
|---|---|---|
| **Company** | keep kebab; refactor to the shared builder + orchestrator | detail page has no actions today → add an `app-company-form` edit dialog (mirroring asset/trial detail) and populate `overflowActions` with Edit + Delete; delete navigates to the companies list |
| **Asset** | keep kebab; refactor | replace the lone "Edit details" topbar button with `overflowActions` (Edit details, Delete); delete navigates to the assets list |
| **Trial** | keep kebab; refactor | the trial detail already has an edit dialog (`trial-edit-dialog`) and a topbar Edit action → move that Edit into `overflowActions`, add Delete; delete navigates to the trials list |
| **Marker / Note** (trial detail rows) | already a kebab with Edit + Delete | no detail page exists — already consistent; refactor to the shared builder for uniformity, no behavior change |
| **Event** | events-page is a feed/detail layout, not a row grid | `event-detail-panel`: replace the bare pen icon with the overflow kebab (Edit, Delete) and **wire the orphaned `onDeleteEvent()`**; delete navigates to / resets to the events list state |

## Delete behavior details

- **Confirm dialogs are unchanged** — only their reachability changes.
  Companies / assets / trials keep the cascade-count preview plus
  typed-confirmation dialog (`previewDelete` + `confirmDelete` with
  `requireTypedConfirmation: true`). Markers / notes / events keep their lighter
  typed-`delete` confirm. The orchestrator passes through each entity's existing
  config.
- **Post-delete navigation** — from a detail page, navigate to the parent list
  (`/t/:tenant/s/:space/manage/<entity-plural>`), then show the success toast.
  From a grid row, reload in place (current behavior).
- **Role gating** — Edit/Delete only appear when `spaceRole.canEdit()`. On a
  detail page where the user cannot edit, `overflowActions` is empty and **no
  kebab renders** (no greyed-out buttons, no permission-denied toast — satisfies
  the empty-state audit rule in `src/client/CLAUDE.md`).

## Accessibility

- The topbar kebab uses `app-row-actions` with a meaningful `ariaLabel`
  (e.g. "Actions for <entity name>").
- Keyboard navigable and focus-visible via the existing PrimeNG `p-menu` the
  `app-row-actions` component already wraps; Escape closes the popup.
- Destructive item styled red via the existing `row-actions-danger` class —
  contrast must hold (WCAG AA).

## Testing & verification

Per the repo convention, each unit ships with its Vitest spec inline (no deferred
"tests phase"):

- **Action builder spec** — correct items and ordering per role; Edit/Delete
  omitted when `canEdit` is false; danger style on Delete.
- **Delete orchestrator spec** — preview → confirm → delete → `onSuccess`
  happy path; aborts cleanly on cancel; surfaces the error and does not call
  `onSuccess` on failure.
- **Topbar spec** — kebab renders only when `overflowActions` is non-empty;
  create buttons still render from `actions`.
- **Per-detail-component specs** — kebab present for editors; Delete navigates to
  the correct parent list; viewer role sees no kebab. Event panel: pen icon
  replaced by kebab and `onDeleteEvent` is reachable.

Then:

```bash
cd src/client && ng lint && ng build
```

Plus one end-to-end browser pass: delete a trial from its detail page and confirm
it lands on the trials list with the success toast.

## Out of scope

- No change to the underlying delete RPCs, cascade rules, or confirm-dialog copy.
- No change to create flows beyond keeping "New X" as a visible topbar button.
- No new entity types; markers/notes already satisfy the unified idiom and only
  get a mechanical refactor to the shared builder.
