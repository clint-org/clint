# Plan: search-term highlighting on grid-toolbar pages

Spec: `docs/superpowers/specs/2026-05-02-search-highlight-grids-design.md`
Date: 2026-05-02
Branch: `feat/search-highlight` (worktree at `.worktrees/search-highlight/`)

## Step 1: HighlightPipe

Create `src/client/src/app/shared/pipes/highlight.pipe.ts`:

- Standalone, pure Angular pipe with name `highlight`.
- `transform(text: string | null | undefined, query: string | null | undefined): string` returns `highlightPlain(text ?? '', query)`.
- Imports `highlightPlain` from `../utils/highlight-search`.

No tests. No barrel re-export (existing `shared/pipes/` directory has none either; pages import pipes by file path).

## Step 2: Wire into 7 grid pages

For each `.html` listed below, the corresponding `.ts` adds `HighlightPipe` to the `imports` array; the `.html` rewrites each searchable cell from `{{ row.field }}` to `<span [innerHTML]="row.field | highlight: grid.debouncedGlobalSearch()"></span>`.

Order (alphabetical, no dependencies between pages):

1. `features/catalysts/catalysts-page` -- title, company_name, product_name, category_name. The cells live in a child component (`catalyst-table.component.ts`), so the page passes `[query]="grid.debouncedGlobalSearch()"` and the child takes a `query = input<string>('')`.
2. `features/events/events-page` -- title, category_name, entity_name, company_name
3. `features/manage/companies/company-list` -- company.name (cell wrapped in a button; place the span inside the button)
4. `features/manage/marker-types/marker-type-list` -- name only (skip shape / fill_style: rendered as swatches, no text)
5. `features/manage/products/product-list` -- product.name, product.generic_name, companyName
6. `features/manage/therapeutic-areas/therapeutic-area-list` -- name, abbreviation
7. `features/manage/trials/trial-list` -- trial.name, trial.identifier, productName, companyName, trial.status

For each page, before editing: read the current body template once to confirm the cell expression and pick the smallest replacement.

## Step 3: Verification

From `src/client/`:

```bash
ng lint
ng build
```

Both must pass clean. Lint for new HTML attribute usage (`[innerHTML]` is allowed; some projects flag it via `@angular-eslint/no-inner-html`, confirm not in this rule set).

## Step 4: Manual smoke (one page is enough)

Run `ng serve` once, visit `/t/<tenant>/s/<space>/manage/companies`, type two characters from a known company, confirm the matched substring highlights in amber and the row stays clickable. Spot-check one other page (events) to catch any per-page surprise. Skip per-page exhaustive smoke -- the pipe is one primitive, behavior is identical across pages.

## Step 5: Commit and push

In the worktree:

- Single commit: `feat(ui): highlight search matches in grid-toolbar cells`
- `git push` (sets up tracking against origin/feat/search-highlight, or pushes onto origin/main if that is what the branch tracks; verify before pushing).

Cloudflare auto-deploys on push.

## Risks / things to double-check at implementation time

- `marker-type-list` may render `name` inside something other than a `<td>{{ name }}</td>` (e.g. inside a swatch grouping). Read first.
- `trial-list` is the largest table; the trial.name cell may have its own click handler or routerLink. Place the highlighted span inside the existing element so interaction is unchanged.
- If any page uses a custom cell wrapper component (e.g., `<app-link-cell>`), do not rewrite -- those need their own input and are out of scope here. Note and defer.
