# Profiles header standardization: pure-wayfinding topbar + content-area headers

**Date:** 2026-06-28
**Status:** Design (approved, pending spec review)
**Scope:** Profiles area only -- companies / assets / trials, list + detail pages.

## Problem

The contextual topbar is doing two unrelated jobs at once, and it does them
inconsistently across the Profiles area.

1. **Mixed responsibilities.** The topbar is meant for wayfinding -- "where am I"
   plus quick jumps within the current category (`Companies / Assets / Trials`).
   But Profiles pages also push entity-scoped *mutations* into it via
   `TopbarStateService` (`Add asset`, the `...` kebab with Edit/Delete/links).
   These act on the single entity being viewed, yet they sit in the global chrome
   far from the thing they mutate. The reader has to infer scope ("`+ Add asset`
   adds an asset *to Novo Nordisk*") from context rather than from proximity.

2. **Inconsistent wayfinding between detail pages.** Trial detail is
   special-cased in `app-shell.component.ts` to the `detail` topbar layout (a
   `<- Trials` back button + entity eyebrow/title, no category tabs). Company
   detail and asset detail fall through to the `landscape` (tabbed) layout
   (category tabs, no back button, no entity name in the topbar). Three sibling
   detail pages, two different topbars:

   ```js
   // app-shell.component.ts -- the snowflake
   if (route.match(/^profiles\/trials\/[^/]+$/)) {
     return 'detail';
   }
   ```

These are one problem with two symptoms. The fix standardizes both at once.

## Goals

- One topbar layout for every Profiles page (list and all three detail types):
  pure wayfinding.
- One content-area header skeleton for every Profiles page, carrying the page/
  entity title, count, and actions.
- Remove the trial-detail `detail`-pageType special case.

## Non-goals

- No change to the other action-bearing pages: mechanisms of action, space /
  tenant admin lists, settings, and the landscape / intelligence viz pages stay
  as they are. They keep pushing to `TopbarStateService` for now and can adopt
  the same content header whenever someone next touches them. (Note: the trials
  list and trial detail ARE in scope -- they are part of the Profiles area.)
- No removal of `TopbarStateService` or its fields in this pass -- out-of-scope
  pages still depend on them. We only stop the Profiles pages from using the
  action/title/entity fields.
- No change to row-level actions inside the grids (the per-row `...` kebab
  stays).

## The standard

### Topbar (all Profiles pages)

Pure wayfinding, identical on list and detail:

```
D / Pipeline Demo  |  Profiles  Companies  Assets  Trials      [Cmd]K   INTELLIGENCE BY STOUT
```

- Breadcrumb (tenant / space) -- unchanged.
- `Profiles` section label + `Companies / Assets / Trials` category tabs. The
  active tab reflects the entity type currently in view (on a company detail,
  `Companies` is active).
- Command palette hint + agency colophon -- unchanged.
- No page title, no record count, no action buttons, no kebab, no back button.

### Content header (all Profiles pages)

A shared header at the top of the content area. Two shapes from one component:

**List pages** -- label + count + actions:

```
COMPANIES   42                                   [+ Add company]  [...]
-------------------------------------------------------------------------
(table)
```

**Detail pages** -- hierarchy-crumb eyebrow + title + count + actions:

```
COMPANY  .  5 assets                             [+ Add asset]   [...]
Eli Lilly
-------------------------------------------------------------------------

Eli Lilly / Tirzepatide / TRIAL  .  NCT06081894                 [...]
ACACIA-HCM
```

All three detail pages now share one topbar and one header skeleton. The
eyebrow row IS the existing parent-hierarchy crumb (see next section).

### Navigation affordances: hierarchy crumb (up the tree) + topbar tab (to the grid)

There are two distinct "up" axes, and both are already solved -- no new back
link is added:

- **Up the entity tree** is the existing parent-hierarchy crumb that the detail
  pages already render in their eyebrow, and which becomes the eyebrow of the
  standardized header:
  - Company detail: `Company` (top of the tree, no parent).
  - Asset detail: `{Company} / Asset` -- company links to the company record
    (`asset-detail.component.html:13-31`).
  - Trial detail: `{Company} / {Asset} / Trial` -- both link up
    (`trial-detail.component.html:46-81`).
- **To the type's grid** is the topbar category tab. On a trial detail the
  active `Trials` tab navigates to the trials grid; this is already how company
  and asset detail reach their grids today.

A separate `<- {List}` back link is therefore deliberately NOT added: it would
duplicate the topbar tab and clutter a header that already carries the
hierarchy crumb. Trial detail's old topbar `<- Trials` is subsumed by the
restored `Trials` tab and its richer crumb; it loses nothing real. List pages
have no eyebrow crumb (they are top-level); their header is just label + count
+ actions.

## Component changes

### 1. `app-section-header` (extend, do not fork)

`src/app/shared/components/section-header/section-header.component.ts` already
provides: `label`, `detail`, `bordered`, and an `[actions]` projection slot. It
backs the Intelligence tabs. Extend it to also serve detail pages without
breaking existing consumers:

- **List shape (unchanged):** `label` + `detail` inputs, `[actions]` slot.
  Existing Intelligence usages pass only `label`/`detail` and are untouched.
- **Detail shape (new):** the eyebrow crumb and the title carry per-page markup
  (links, brand logos, the asset MoA/route chips, the trial identifier), so they
  are PROJECTION SLOTS, not string inputs. Add an `[eyebrow]` slot (the page
  supplies its existing hierarchy-crumb markup) and a `[title]` slot (the large
  `h1` + any inline adornments). The shared `[actions]` slot stays on the right.
- A `variant` input (`'list' | 'detail'`, default `'list'`) or simply the
  presence of projected `[title]` content selects the layout: list = single
  baseline row; detail = eyebrow row on top, title row below, actions
  right-aligned and bottom-anchored. No back-link input -- see the navigation
  section above.

Because the detail shape is mostly projection, this stays a thin layout shell
rather than a component that branches heavily on inputs; if it still grows
awkward, fall back to a sibling `entity-detail-header` shell instead. (Decision:
extend first.)

Confirm the two current consumers (`materials-browse-page`,
`intelligence-browse`) still render identically after the change.

### 2. `app-shell.component.ts`

- Delete the trial-detail special case (the `route.match(/^profiles\/trials\/...`
  branch) so Profiles detail routes resolve to the tabbed (`landscape`) topbar
  like company/asset detail already do.
- Profiles pages no longer feed `title` / `recordCount` / `entityContext` /
  `entityTitle` / `actions` / `overflowActions` into the topbar. Verify the
  topbar bindings degrade cleanly to empty for these routes (they already handle
  empty state for non-action pages).

### 3. Profiles pages (6 files)

Each stops pushing to `TopbarStateService` and instead renders
`app-section-header` at the top of its content with the actions projected into
`[actions]`:

- `companies/company-list` -- header `COMPANIES` + count + `[+ Add company]` +
  list kebab (if any).
- `companies/company-detail` -- the existing `<header>` card already shows the
  `Company` eyebrow + `{name}` + `{n} assets`; fold it into the shared header's
  `[eyebrow]` / `[title]` slots and project `[+ Add asset]` + the entity kebab
  into `[actions]`.
- `assets/asset-list`, `assets/asset-detail` -- same pattern; asset detail's
  existing `{Company} / Asset` crumb and inline MoA/route chips move verbatim
  into the `[eyebrow]` / `[title]` slots.
- `trials/trial-list`, `trials/trial-detail` -- same pattern; trial detail's
  existing `{Company} / {Asset} / Trial` crumb moves into `[eyebrow]`, and it
  drops its reliance on the `detail` topbar (the restored `Trials` tab covers
  grid navigation).

Reuse the existing action builders (`buildEntityActionMenu`,
`runEntityDelete`) -- only the *render location* of the resulting menu changes,
not how it is built. Keep `OnDestroy` cleanup minimal: these pages no longer set
topbar state, so they no longer need to clear it (remove the now-dead
`topbarState.*.set([])` / `clear()` calls for the fields they stop using).

## Edge cases

- **Viewer role.** Actions are already gated (`spaceRole.canEdit()`); the header
  shows only the eyebrow crumb / title / count for viewers, no action buttons.
  Keep the same guard, just at the new render site.
- **Loading / empty.** Detail pages render the header only once the entity
  resolves (today's pattern: header lives inside the `@if (entity())` block).
  List pages render the header above the table regardless, with count blank
  until loaded.
- **Long detail records / scroll (decision 1a).** The content header scrolls
  away with the page; we deliberately do NOT pin it. The active topbar category
  tab still indicates the entity type while scrolled. (A sticky header was
  considered and declined for simplicity.)
- **Grid navigation from a detail page.** Handled by the topbar category tab
  (e.g. `Trials` on a trial detail), not a per-page back link.
- **Other pages during transition.** Space/tenant admin and viz pages still use
  the topbar action slot. Because we are not removing `TopbarStateService`,
  those are unaffected.

## Testing

Per project convention, pair tests with each change (no deferred test phase):

- `section-header.component.spec.ts` -- extend to cover the new detail shape:
  renders the projected `[eyebrow]` + `[title]` + `[actions]` content in the
  detail layout; renders the original list shape (`label` + `detail`) when no
  `[title]` is projected (guards the existing consumers).
- Each of the 6 Profiles components -- update/extend its spec to assert the
  action menu and title now render in the content header (not via
  `TopbarStateService`), and that `canEdit()` still gates the actions.
- `app-shell` -- a test asserting Profiles detail routes resolve to the tabbed
  topbar (no `detail` pageType) and that the topbar exposes no action buttons for
  Profiles routes.
- Manual: exercise all three detail pages + three list pages in the browser;
  confirm identical topbar, working hierarchy-crumb links, grid navigation via
  the active topbar tab, and actions in the header.

## Verification

```bash
cd src/client && ng lint && ng build
```

Exercise the six Profiles surfaces in a browser (type checks don't verify
layout).

## Out of scope (future, opt-in per page)

- Migrating space/tenant admin lists, settings, and viz pages to the content
  header.
- Eventually retiring the `title` / `entityContext` / `entityTitle` /
  `recordCount` / `actions` / `overflowActions` fields and the `detail`/`list`
  pageTypes from `TopbarStateService` and `ContextualTopbarComponent` once no
  page uses them.
