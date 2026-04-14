# CSS Standardization: Hybrid Preset + Global Overrides

## Problem

Stylesheets are disorganized and duplicated:

- `manage-table.css` (655 lines) mixes table chrome, page layout, and global PrimeNG overrides
- `catalyst-table.css` (44 lines) duplicates manage-table's thead/tbody pattern
- 50+ hardcoded `rgb()` values repeated across files instead of referencing a single palette
- Global PrimeNG overrides use `!important` on every rule because they're fighting the preset
- Every new page risks writing its own stylesheet when the patterns already exist

## Approach

Hybrid: expand the PrimeNG preset to handle ~70% of overrides via design tokens, keep a small global CSS file for the ~30% that tokens can't express, and unify duplicated table/layout patterns.

## File Structure (after)

```
src/client/src/
  styles.css                              # Entry: tailwind, fontawesome, shared CSS, landscape
  app/
    config/
      primeng-theme.ts                    # Expanded: semantic + component tokens
    shared/
      styles/
        primeng-overrides.css             # ~80 lines: what tokens can't express
        data-table.css                    # Unified table chrome (was manage-table + catalyst-table)
        page-shell.css                    # Page layout shell (was manage-shell in manage-table.css)
    features/
      landscape/
        landscape.css                     # Stays as-is
```

**Files deleted:** `manage-table.css`, `catalyst-table.css`

**`styles.css` imports:**
```css
@import 'tailwindcss';
@import '@fortawesome/fontawesome-free/css/all.min.css';
@import './app/shared/styles/primeng-overrides.css';
@import './app/shared/styles/data-table.css';
@import './app/shared/styles/page-shell.css';
@import './app/features/landscape/landscape.css';
@plugin "tailwindcss-primeui";
```

## 1. Expanded PrimeNG Preset (`primeng-theme.ts`)

Grows from ~40 lines to ~150 lines. Uses PrimeNG token references (`'{slate.200}'`) rather than raw rgb values.

### Semantic tokens (cascade to all form inputs)

```ts
semantic: {
  primary: { /* teal 50-950, unchanged */ },
  colorScheme: {
    light: {
      surface: { /* slate 0-950, unchanged */ },
      formField: {
        borderColor: '{slate.200}',
        hoverBorderColor: '{slate.400}',
        focusBorderColor: '{teal.600}',
        borderRadius: '0',
        shadow: 'none',
        focusRing: {
          width: '1px',
          style: 'solid',
          color: '{teal.600}',
          offset: '0',
        },
        paddingX: '0.625rem',
        paddingY: '0.5rem',
        // sm/lg sizes: leave as Aura defaults
      },
    },
  },
},
```

### Component tokens

| Component | Tokens set | What it replaces |
|---|---|---|
| `dialog` | `borderRadius: '0'`, `shadow`, `headerPadding`, `titleFontSize: '11px'`, `titleFontWeight: '600'`, `contentPadding`, `footerPadding` | ~30 lines of CSS |
| `inputtext` | Inherits from `formField` -- no component overrides needed | ~30 lines of CSS |
| `select` | `borderRadius: '0'`, `overlay.borderRadius: '0'`, `overlay.borderColor`, `overlay.shadow`, `option.padding`, `option.selectedBackground`, `option.selectedColor`, `dropdown.width`, `dropdown.color` | ~45 lines of CSS |
| `multiselect` | Same structure as select | ~45 lines of CSS |
| `button` | `borderRadius: '0'`, `outlined.primary.borderColor`, `outlined.primary.color`, `outlined.primary.hoverBackground`, `outlined.secondary.borderColor`, `outlined.secondary.color`, `outlined.secondary.hoverBackground` | ~30 lines of CSS |
| `tabs` | `tab.color`, `tab.hoverColor`, `tab.activeColor`, `tab.activeBorderColor`, `tab.padding`, `tab.fontWeight`, `tablistBackground: 'transparent'`, `tabpanelBackground: 'transparent'`, `tabpanelPadding: '1rem 0 0'`, `activeBar.background` | ~15 lines of CSS |
| `message` | `borderRadius: '0'`, `contentPadding`, `textFontSize: '12px'`, severity-specific `background`/`borderColor`/`color` for info, success, warn, error | ~20 lines of CSS |

### Dark mode

```ts
options: {
  darkModeSelector: false,
}
```

## 2. `primeng-overrides.css` (~80 lines)

Only contains CSS that PrimeNG tokens cannot express. Organized by component.

### Dialog (~20 lines)
- `::before` teal accent strip (2px)
- Header `border-bottom: 1px solid slate-100`
- Footer `border-top: 1px solid slate-100`, `background: slate-50`
- Title `letter-spacing: 0.12em`, `text-transform: uppercase`
- Close button color and hover
- Confirm dialog icon color (red-700) and message styling

### Tabs (~5 lines)
- `font-size: 10px`, `letter-spacing: 0.08em`, `text-transform: uppercase`

### Message (~10 lines)
- `border-left-width: 3px` (asymmetric border -- tokens only set uniform width)
- Per-severity left-border colors (distinct from overall border color)

### SelectButton (~20 lines)
- All styling (no component tokens exist in PrimeNG for this component)

### ProgressSpinner (~3 lines)
- Stroke color override

### Icon field (~3 lines)
- `.p-iconfield .p-inputtext` left-padding restore

### Row actions (~15 lines)
- `.row-actions-trigger` button styling
- `.row-actions-danger` menu item color

## 3. `data-table.css` -- unified table chrome

Replaces both `manage-table` and `catalyst-table`. Class name: `.data-table`.

### Contents (carried over from manage-table.css):
- `.data-table` wrapper: white background, slate-200 border
- Thead: shaded (slate-50 @ 60%), 10px uppercase tracked headers, slate-500 text
- Tbody rows: 0.5rem 0.75rem padding, slate-100 bottom border, 13px text
- First column emphasis: slate-900, font-weight 500
- Row hover: teal-50 @ 55%
- Selected row: teal-50 @ 60% background, teal-500 left border on first cell
- Empty state: centered, muted
- Column modifiers: `.col-identifier`, `.col-num`, `.col-secondary`, `.col-date`, `.col-source`, `.col-priority`, `.col-actions`
- Sort/filter icon sizing
- **New**: `.data-table-group-header td` -- from catalyst-table.css, for row-group subheaders

### What changes from current manage-table:
- Class name: `manage-table` -> `data-table`
- Adds group-header row style (from catalyst-table.css)
- Everything else is identical content, just in a dedicated file

## 4. `page-shell.css` -- reusable page layout

Extracted from manage-table.css lines 208-274. Renamed `manage-shell` -> `page-shell`.

### Contents:
- `.page-shell`: full-width padding
- `.page-shell--narrow`: max-width 72rem, centered
- `.page-shell__eyebrow`: 10px uppercase tracked label
- `.page-shell__title-row`: flex row with bottom border
- `.page-shell__title`: 20px semibold with icon gap
- `.page-shell__count`: pill badge
- `.page-shell__subtitle`: 12px muted text
- `.page-shell__actions`: right-aligned action slot

## 5. Template Changes

### `styleClass` renames (10 files):

| File | Change |
|---|---|
| `tenant-settings.component.ts` (2 tables) | `manage-table` -> `data-table` |
| `events-page.component.html` | `manage-table` -> `data-table` |
| `company-list.component.html` | `manage-table` -> `data-table` |
| `route-of-administration-list.component.html` | `manage-table` -> `data-table` |
| `trial-list.component.html` | `manage-table` -> `data-table` |
| `therapeutic-area-list.component.html` | `manage-table` -> `data-table` |
| `marker-type-list.component.html` | `manage-table` -> `data-table` |
| `product-list.component.html` | `manage-table` -> `data-table` |
| `trial-detail.component.html` | `manage-table` -> `data-table` |
| `catalyst-table.component.ts` | `catalyst-table` -> `data-table` |

### Shell component rename (1 file):

`manage-page-shell.component.ts`: update template to use `.page-shell*` classes instead of `.manage-shell*`. Component selector and file name stay the same (renaming the file is churn with no benefit -- the class names are what matter).

Also update the doc comment reference from `manage-table.css` to `page-shell.css`.

### Catalyst group header class:

In `catalyst-table.component.ts`, change `catalyst-group-header` to `data-table-group-header` in the template.

## 6. No Changes

- `landscape.css` -- stays as-is (genuinely feature-specific: SVG chart, detail panel, sidebar)
- Inline component styles in `status-tag.component.ts`, `positioning-chart.component.ts`, `header.component.ts` -- stay (component-scoped, appropriate)

## 7. Verification

- `ng lint && ng build` must pass
- Visual spot-check: manage pages (companies, products, etc.), catalysts page, tenant settings, dialogs, form inputs
- No `!important` in preset-covered rules (dialog radius, input borders, button radius, etc.)
- Grep for orphaned class references: no remaining `manage-table`, `catalyst-table`, or `manage-shell` in templates
