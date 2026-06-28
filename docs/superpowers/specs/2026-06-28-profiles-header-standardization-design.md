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

**Detail pages** -- back link + eyebrow + title + count + actions:

```
<- Companies
COMPANY  .  5 assets                             [+ Add asset]   [...]
Eli Lilly
-------------------------------------------------------------------------

<- Trials
TRIAL  .  NCT06081894                                            [...]
ACACIA-HCM
```

All three detail pages now share one topbar and one header skeleton. The only
thing the old trial layout loses is the topbar back button -- it moves into the
content header as `<- Trials` (a fixed link to the list, exactly its current
behavior; not browser-back).

### Back affordance: explicit link in the content header

Detail pages render an explicit `<- {ListName}` link as part of the content
header, left of / above the eyebrow. Rationale:

- Detail pages are reached from many places (the list, a company timeline,
  search, the command palette, an intelligence link). "Click the active tab to
  go back" would always send the user to the type's list regardless of origin,
  and an active tab reads as "you are here," not "click to go up" -- poor
  discoverability.
- It preserves trial detail's current behavior verbatim (`<- Trials` already
  means "go to the list," a fixed destination), only relocated.

List pages omit the back link (they are top-level within the category).

## Component changes

### 1. `app-section-header` (extend, do not fork)

`src/app/shared/components/section-header/section-header.component.ts` already
provides: `label`, `detail`, `bordered`, and an `[actions]` projection slot. It
backs the Intelligence tabs. Extend it to also serve detail pages without
breaking existing consumers:

- Add optional inputs: `eyebrow` (uppercase structural eyebrow, e.g. `COMPANY`),
  `titleText` (the large entity name, e.g. `Eli Lilly`), `backLabel` +
  `backLink` (or a `backClick` output) for the `<- {List}` affordance.
- When `titleText` is set, render the detail shape (back link, eyebrow on top,
  large title below); otherwise render today's list shape (mono uppercase
  `label` + muted `detail`). Existing Intelligence usages pass only
  `label`/`detail` and are unchanged.
- Keep `[actions]` as the single right-aligned slot for both shapes.

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
- `companies/company-detail` -- the existing `<header>` card already shows
  `Company / {name} / {n} assets`; fold it into the shared header and add
  `[+ Add asset]` + the entity kebab + `<- Companies`.
- `assets/asset-list`, `assets/asset-detail` -- same pattern.
- `trials/trial-list`, `trials/trial-detail` -- same pattern; trial detail gains
  `<- Trials` in the header and drops its reliance on the `detail` topbar.

Reuse the existing action builders (`buildEntityActionMenu`,
`runEntityDelete`) -- only the *render location* of the resulting menu changes,
not how it is built. Keep `OnDestroy` cleanup minimal: these pages no longer set
topbar state, so they no longer need to clear it (remove the now-dead
`topbarState.*.set([])` / `clear()` calls for the fields they stop using).

## Edge cases

- **Viewer role.** Actions are already gated (`spaceRole.canEdit()`); the header
  shows only the back link / title / count for viewers, no action buttons. Keep
  the same guard, just at the new render site.
- **Loading / empty.** Detail pages render the header only once the entity
  resolves (today's pattern: header lives inside the `@if (entity())` block).
  List pages render the header above the table regardless, with count blank
  until loaded.
- **Deep-link to a detail page.** The `<- {List}` link is a fixed
  `routerLink` to the category list, so it works even with no navigation
  history.
- **Other pages during transition.** Space/tenant admin and viz pages still use
  the topbar action slot. Because we are not removing `TopbarStateService`,
  those are unaffected.

## Testing

Per project convention, pair tests with each change (no deferred test phase):

- `section-header.component.spec.ts` -- extend to cover the new detail shape:
  renders eyebrow + title + back link when `titleText`/`backLabel` set; renders
  the original list shape when they are absent (guards the existing consumers).
- Each of the 6 Profiles components -- update/extend its spec to assert the
  action menu and title now render in the content header (not via
  `TopbarStateService`), and that `canEdit()` still gates the actions.
- `app-shell` -- a test asserting Profiles detail routes resolve to the tabbed
  topbar (no `detail` pageType) and that the topbar exposes no action buttons for
  Profiles routes.
- Manual: exercise all three detail pages + three list pages in the browser;
  confirm identical topbar, working back links, and actions in the header.

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
