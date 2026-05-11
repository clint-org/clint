# Home redesign: intelligence-led two-column body

**Date:** 2026-05-10
**Scope:** `src/client/src/app/features/engagement-landing/`
**Related:** The component currently references a `2026-05-08-home-redesign` spec that no longer exists on disk. This document supersedes it.

## Why

The current engagement landing shows three equally-weighted panels above the intelligence feed: *What changed*, *Next 14 days*, and *Your drafts*. In practice the analyst comes to the home page for primary intelligence (the agency's published reads), then for a glance at upcoming catalysts. *What changed* is supporting context, not a peer. *Your drafts* is an agency-side production view that does not belong on the analyst's first surface.

The redesign promotes intelligence to a two-thirds horizontal column, demotes catalysts and *what changed* to a one-third side rail (catalysts on top, *what changed* under it), and removes the drafts widget from this page.

## Layout

Existing top-to-bottom block sequence is preserved. Only the middle band changes.

1. **Pulse header** (5-stat strip): unchanged.
2. **Today brief** (teal one-liner): same placement, simplified content (see Brief logic).
3. **Two-column body** (new): CSS grid, intelligence spans two columns, side rail spans one.
4. **Recent materials**: unchanged below the fold.

### Grid

The body uses `grid grid-cols-3 gap-3.5`. The intelligence section gets `col-span-2`; the side rail gets `col-span-1`. Below the `max-[1100px]` breakpoint the grid collapses to a single column (`grid-cols-1`), with intelligence stacking first, side rail beneath. There is no `position: sticky` on the side rail; both columns flow with the page.

## Left column (2/3): Latest from Stout

The existing intelligence feed section stays in place with one structural change: the non-featured posts become a single-column list rather than a 2-col grid, because the column itself is now narrower.

- **Section header:** unchanged. `h2` "Latest from Stout", count tag, entity-type filter chips.
- **Featured post (first item in `visibleFeed()`):** unchanged. `grid-cols-[160px_1fr]`, kind chip + date stack on the left, headline + 3-line excerpt + "Read brief →" on the right.
- **Rest posts:** rendered as a vertical list (`flex flex-col`). Each row keeps the `grid-cols-[140px_1fr]` shape (kind chip + date | headline + 2-line excerpt + "Read brief →"). Rows separated by `border-b border-slate-100`. The existing odd-row right border (used for the 2-col grid) is removed.
- **"View all intelligence" button:** unchanged at the bottom of the section.
- **Empty and loading states:** unchanged.

## Right column (1/3): catalysts, then what changed

Two cards stacked vertically with `gap-3.5`.

### Card 1: Next 90 days

Replaces the existing "Next 14 days" card. Visual chrome (slate-50 header bar, `border border-slate-200`) is unchanged.

- **Header row:** "NEXT 90 DAYS" tracked mono label, catalyst count (`N catalysts`), `Calendar →` link to the catalysts page.
- **Body:** catalysts grouped by month. Each month renders a sticky sub-header:
  - Sub-header markup: `<li class="sticky top-0 bg-white border-b border-slate-100 px-3.5 py-1.5">` with a mono uppercase month-year label (e.g. `MAY 2026`) at `text-[10px] tracking-[0.12em] text-slate-500`.
  - Under each month, catalyst rows use the existing template: `grid-cols-[48px_1fr_auto]` for date+weekday | title+who | marker icon. The row template is preserved verbatim from the current Next 14 days card.
- **Internal scroll:** body wrapper has `max-h-[520px] overflow-y-auto`. The page itself does not grow because of catalysts. Inner scroll only.
- **Loading state:** 5 skeleton rows under the header (one extra over the current 3 because the panel is taller).
- **Empty state:** "No catalysts in the next 90 days."
- **Click behavior:** unchanged. `onCalendarClick(markerId)` navigates to `/t/:tid/s/:sid/catalysts?markerId=...`.

### Card 2: What changed

The existing `app-what-changed-widget` slots into the side rail directly below the catalyst card. The widget is self-contained, so no API changes are needed.

If at narrow widths any internal row wraps awkwardly (entity name truncation, marker icon overflow), tighten that widget's typography or truncation in the same change. Acceptance criterion: at 1/3 of a 1480px max-width page (~470px), every row renders on its intended line count with no horizontal scroll.

## Removed

- `app-drafts-widget` import and render in `engagement-landing.component.html`.
- `DraftsWidgetComponent` import in `engagement-landing.component.ts`.
- `drafts` signal, `listDraftsForSpace(sid, 5)` call in `loadAll()`, and the drafts results handler.
- `drafts-widget/` folder is deleted from disk. The drafts inventory page (if reachable elsewhere) is unaffected. If a future surface needs to re-introduce drafts on this page, restore from git history.
- The drafts clause from `briefHtml` (see Brief logic).

`isAgency()` remains because the brief and other surfaces may still gate on it; it just no longer drives the drafts widget.

## Data and service changes

### Catalyst window

`extractUpcoming(companies, windowDays)` is called with `90` instead of `14`. The helper itself is unchanged.

### Computed signals

- `nextFortnightDays` is renamed to `nextNinetyDayItems` and drops the `.slice(0, 7)` cap. The row-shape mapping (date, weekday, title, who, marker icon) is preserved.
- A new computed `monthGroupedCatalysts` derives `[{ monthLabel: 'MAY 2026', items: [...] }]` from `nextNinetyDayItems`. Items keep their iso-date sort order; months follow naturally because items are already sorted.
- `catalystsThisWeek` is unchanged. It still filters `upcoming()` to the next 7 days for the brief.

### Brief logic

`briefHtml` keeps the catalysts-this-week clause and drops the drafts clause. The lead-catalyst detail (first catalyst title + company) is preserved. `briefVisible` simplifies to `!statsLoading() && catalystsThisWeek().length > 0`.

### Loaders

`loadAll()` drops the `intelligenceService.listDraftsForSpace(sid, 5)` Promise from its `Promise.allSettled` array and the corresponding result handler. All other loaders are unchanged.

## Component conventions

The redesign keeps every Angular guardrail from `src/client/CLAUDE.md`:

- Standalone, `ChangeDetectionStrategy.OnPush`, `inject()`, `input()`/`output()`, native control flow (`@if`/`@for`), `class` bindings (no `ngClass` on new code where a class binding suffices), signals + computed for state.
- Tailwind brand utilities (`bg-brand-*` etc.) where applicable; slate/red/amber/green/cyan/violet for data colors.
- PrimeNG `p-message` for the error banner (already in place).
- AXE-clean: `aria-labelledby` on the catalyst card, button rows keep `[attr.aria-label]`, sticky month headers do not break the existing `role="list"` semantics (use `<li>` with `aria-hidden="true"` for the month label or a `role="presentation"` separator; pick whichever screen-reader-tests cleanest).

## Verification

- `cd src/client && ng lint && ng build` clean.
- Manual smoke against a seeded space with 30+ catalysts in the next 90 days:
  - Month grouping renders, sticky headers stick during inner scroll, page height is not driven by catalyst count.
  - Featured post + single-column list render correctly in the 2/3 column.
  - Side rail catalyst card and *what changed* card stack with `gap-3.5` and no clipping.
- Manual against a space with 0 catalysts in 90 days: empty state shows, brief is hidden.
- Manual as an agency user: drafts widget is gone, no console errors, brief shows only the catalysts clause when applicable.
- Manual responsive: at 1100px the body collapses to a single column with intelligence first, side rail second.
- AXE pass on the redesigned section, including the sticky month headers and the catalyst row buttons.

## Out of scope

- Drafts surfacing on a different page. The drafts widget code is deleted; if drafts re-surface elsewhere later, that is its own design.
- Changes to the `app-what-changed-widget` internals beyond minor typography or truncation fixes needed for the narrower column.
- Changes to the recent-materials widget below the fold.
- Changes to the pulse header stats or the today brief beyond removing the drafts clause.
