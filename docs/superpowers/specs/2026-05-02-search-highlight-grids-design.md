# Search-term highlighting on grid-toolbar pages

Date: 2026-05-02
Status: approved

## Goal

Extend the search-term highlight that already runs on the intelligence feed to every list page that uses the shared `app-grid-toolbar`. When a user types into the toolbar's "Search..." input, the matched substring in each filtered row's text cells should render with a `<mark class="search-hit">` wrapper so the eye lands on the reason the row matched, not just the row itself.

## Non-goals

- Command palette result rows. Same primitive applies, but the row template is custom and the work is independent. Out of scope here.
- Linked-entities picker popover. Same reasoning.
- Materials browse. No free-text search input today; would require adding one first.
- Highlighting in non-text cells (logos, swatches, icons). Rows still match by their searched value; there is just no text to mark.
- Refactoring the intelligence feed to consume the new pipe. Its excerpt is rendered markdown HTML and uses `highlightHtml`, which the pipe does not cover by design.

## Background

The canonical highlight primitive lives at `src/client/src/app/shared/utils/highlight-search.ts` and exports two functions:

- `highlightPlain(text, query)`: HTML-escapes `text`, then wraps case-insensitive occurrences of `query` in `<mark class="search-hit">`. Returns a string suitable for `[innerHTML]`.
- `highlightHtml(html, query)`: tag-aware; only wraps matches inside text content of already-rendered HTML.

The visual style is owned by a single global rule in `src/client/src/styles.css`:

```css
mark.search-hit {
  background-color: #fef3c7;
  color: #78350f;
  padding: 0 1px;
  border-radius: 2px;
}
```

The grid toolbar (`src/client/src/app/shared/components/grid-toolbar.component.ts`) already exposes a `globalSearch` signal (immediate) on `GridState`. The `debouncedGlobalSearch` signal (200ms after the user stops typing) was internal to the factory and is now lifted onto the public `GridState<T>` interface so cell templates can bind to it. Row filtering reads `debouncedGlobalSearch`, so highlighting on the same value keeps the visible matches and the highlighted matches in lockstep.

## Architecture

A new pure pipe wraps `highlightPlain` and is the only new code surface besides the per-page cell rewrites. No new CSS, tokens, services, or modules.

```
src/client/src/app/shared/pipes/highlight.pipe.ts   (new)
  HighlightPipe { transform(text, query): string }   <-- delegates to highlightPlain
```

The pipe is `standalone: true`, `pure: true` (Angular default), and takes no constructor dependencies. Cell template usage:

```html
<span [innerHTML]="row.name | highlight: grid.debouncedGlobalSearch()"></span>
```

`highlightPlain` already escapes HTML before wrapping, so `[innerHTML]` is safe; `<mark>` survives Angular's default sanitizer with `class` intact.

## Component changes

Each affected page already exposes a `grid: GridState<Row>` field and renders rows through PrimeNG `<p-table>` body templates. The change per page is mechanical:

1. Add `HighlightPipe` to the component's standalone `imports` array.
2. For each cell column whose field appears in `globalSearchFields`, replace `{{ row.field }}` with `<span [innerHTML]="row.field | highlight: grid.debouncedGlobalSearch()"></span>`.

Cells to touch, by page:

| Page | Cells |
|---|---|
| `features/manage/companies/company-list.component.html` | `company.name` |
| `features/manage/therapeutic-areas/therapeutic-area-list.component.html` | `name`, `abbreviation` |
| `features/manage/marker-types/marker-type-list.component.html` | `name`, `shape`, `fill_style` (all three render as plain text in the table; the color swatch is a separate column not in `globalSearchFields`) |
| `features/manage/products/product-list.component.html` | `product.name`, `product.generic_name`, `companyName` |
| `features/manage/trials/trial-list.component.html` | `trial.name`, `trial.identifier`, `productName`, `companyName`, `trial.status` |
| `features/catalysts/catalysts-page.component.html` | `title`, `company_name`, `product_name`, `category_name` |
| `features/events/events-page.component.html` | `title`, `category_name`, `entity_name`, `company_name` |

Edge cases:

- **Cells inside `<button>` or `<a>`.** The companies list wraps the name cell in a button. Wrapping the text in a `<span [innerHTML]>` inside the button is fine: clicks still target the button, and the highlight markup is bounded to the text node.
- **Searched fields without a text cell.** Marker types lists `shape` and `fill_style` in `globalSearchFields` but renders them as visual swatches. Rows still match when the user types "diamond"; there is just no text to wrap. Same logic applies to any future page where a searched field has no dedicated text cell.
- **Cells that already use `[innerHTML]` for other reasons.** None of the listed cells do. If a future page does, the pipe still composes cleanly because `highlightPlain` escapes its input.

## Data flow

```
toolbar input
  -> state.onGlobalSearchInput(value)
       -> globalSearch.set(value)               (immediate; drives the input's value)
       -> setTimeout 200ms
            -> debouncedGlobalSearch.set(value) (drives both filtering and highlighting)
                 -> p-table re-renders filtered rows
                 -> each cell pipe re-evaluates -> <mark class="search-hit">
```

When the query is empty or whitespace, `highlightPlain` short-circuits and returns the escaped text unchanged. No `<mark>` is emitted, no DOM diff churn.

## Testing

- No new unit test for the pipe. It is a one-line wrapper around `highlightPlain`, which is the unit under test.
- Repo-wide gate: `cd src/client && ng lint && ng build` (per `CLAUDE.md`). Both must pass.
- Manual smoke per page: type a substring of a known row, confirm every searchable cell highlights it; clear the input, confirm `<mark>` is gone; confirm the row stays clickable where applicable.

## Accessibility

`<mark>` is the semantic element for "marked text" and is announced appropriately by screen readers without ARIA. The amber-on-brown tint (`#fef3c7` background, `#78350f` text) used by `mark.search-hit` passes WCAG 2.1 AA on the white table background. No focus, keyboard, or aria-live regression: the markup is text-only and lives inside cells that were already non-interactive (or wrapped a single button).

## Out-of-scope follow-ups

- Command palette result rows.
- Linked-entities picker popover.
- A free-text search input on materials browse, after which the same pipe slots in.
