# CSS Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate duplicated stylesheets into an expanded PrimeNG preset + three focused global CSS files, eliminating per-page CSS and `!important` overrides.

**Architecture:** Expand `primeng-theme.ts` with `formField` semantic tokens and component-level tokens to handle ~70% of PrimeNG overrides. Split the remaining CSS into `primeng-overrides.css` (token gaps), `data-table.css` (unified table chrome), and `page-shell.css` (reusable page layout). Delete `manage-table.css` and `catalyst-table.css`.

**Tech Stack:** Angular 19, PrimeNG 19 (Aura preset, `definePreset`), Tailwind CSS v4

**Spec:** `docs/superpowers/specs/2026-04-14-css-standardization-design.md`

---

### Task 1: Expand the PrimeNG preset with semantic and component tokens

**Files:**
- Modify: `src/client/src/app/config/primeng-theme.ts`

- [ ] **Step 1: Replace `primeng-theme.ts` with the expanded preset**

```ts
import { definePreset } from '@primeng/themes';
import Aura from '@primeng/themes/aura';

const ClinicalTheme = definePreset(Aura, {
  semantic: {
    primary: {
      50: '{teal.50}',
      100: '{teal.100}',
      200: '{teal.200}',
      300: '{teal.300}',
      400: '{teal.400}',
      500: '{teal.500}',
      600: '{teal.600}',
      700: '{teal.700}',
      800: '{teal.800}',
      900: '{teal.900}',
      950: '{teal.950}',
    },
    formField: {
      paddingX: '0.625rem',
      paddingY: '0.5rem',
      borderRadius: '0',
      focusRing: {
        width: '0',
        style: 'none',
        color: 'transparent',
        offset: '0',
        shadow: '0 0 0 1px {teal.600}',
      },
    },
    colorScheme: {
      light: {
        surface: {
          0: '#ffffff',
          50: '{slate.50}',
          100: '{slate.100}',
          200: '{slate.200}',
          300: '{slate.300}',
          400: '{slate.400}',
          500: '{slate.500}',
          600: '{slate.600}',
          700: '{slate.700}',
          800: '{slate.800}',
          900: '{slate.900}',
          950: '{slate.950}',
        },
        formField: {
          background: '#ffffff',
          borderColor: '{slate.200}',
          hoverBorderColor: '{slate.400}',
          focusBorderColor: '{teal.600}',
          color: '{slate.900}',
          placeholderColor: '{slate.400}',
          shadow: 'none',
        },
        overlay: {
          select: {
            borderColor: '{slate.200}',
            shadow: '0 10px 24px -12px rgba(15, 23, 42, 0.18)',
          },
          modal: {
            borderColor: '{slate.200}',
            shadow: '0 10px 24px -12px rgba(15, 23, 42, 0.18)',
          },
        },
        list: {
          option: {
            focusBackground: '{teal.50}',
            selectedBackground: '{teal.50}',
            selectedFocusBackground: '{teal.50}',
            selectedColor: '{teal.700}',
            selectedFocusColor: '{teal.700}',
          },
        },
      },
    },
  },
  components: {
    dialog: {
      root: {
        borderRadius: '0',
      },
      header: {
        padding: '0.75rem 1.25rem',
      },
      title: {
        fontSize: '11px',
        fontWeight: '600',
      },
      content: {
        padding: '1.25rem 1.25rem 1.5rem 1.25rem',
      },
      footer: {
        padding: '0.75rem 1.25rem',
      },
    },
    button: {
      root: {
        borderRadius: '0',
      },
      colorScheme: {
        light: {
          outlined: {
            primary: {
              hoverBackground: '{teal.50}',
              activeBackground: '{teal.100}',
              borderColor: '{teal.200}',
              color: '{teal.700}',
            },
            secondary: {
              hoverBackground: '{slate.50}',
              activeBackground: '{slate.100}',
              borderColor: '{slate.200}',
              color: '{slate.700}',
            },
          },
        },
      },
    },
    select: {
      dropdown: {
        width: '2rem',
        color: '{slate.400}',
      },
      option: {
        padding: '0.375rem 0.625rem',
        borderRadius: '0',
      },
    },
    multiselect: {
      dropdown: {
        width: '2rem',
        color: '{slate.400}',
      },
      option: {
        padding: '0.375rem 0.625rem',
        borderRadius: '0',
      },
    },
    tabs: {
      tablist: {
        background: 'transparent',
      },
      tab: {
        color: '{slate.500}',
        hoverColor: '{slate.900}',
        activeColor: '{slate.900}',
        activeBorderColor: '{teal.600}',
        padding: '0.625rem 0.875rem',
        fontWeight: '500',
      },
      tabpanel: {
        background: 'transparent',
        padding: '1rem 0 0',
      },
      activeBar: {
        background: '{teal.600}',
      },
    },
    message: {
      root: {
        borderRadius: '0',
      },
      text: {
        fontSize: '12px',
      },
      content: {
        padding: '0.5rem 0.75rem',
      },
      colorScheme: {
        light: {
          info: {
            background: '{slate.50}',
            borderColor: '{slate.200}',
            color: '{slate.700}',
            shadow: 'none',
          },
          success: {
            background: '{teal.50}',
            borderColor: '{teal.200}',
            color: '{teal.700}',
            shadow: 'none',
          },
          warn: {
            background: '{amber.50}',
            borderColor: '{amber.200}',
            color: '{amber.800}',
            shadow: 'none',
          },
          error: {
            background: '{red.50}',
            borderColor: '{red.200}',
            color: '{red.900}',
            shadow: 'none',
          },
        },
      },
    },
  },
});

export default ClinicalTheme;
```

- [ ] **Step 2: Verify the build still compiles**

Run: `cd src/client && npx ng build 2>&1 | tail -5`
Expected: Build succeeds (CSS will look different since we haven't updated stylesheets yet -- that's expected)

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/config/primeng-theme.ts
git commit -m "refactor(theme): expand PrimeNG preset with formField, dialog, button, select, tabs, message tokens"
```

---

### Task 2: Create `primeng-overrides.css` with token-gap CSS

**Files:**
- Create: `src/client/src/app/shared/styles/primeng-overrides.css`

- [ ] **Step 1: Create the overrides file**

```css
/*
 * PrimeNG overrides for styling that design tokens cannot express.
 * The preset (primeng-theme.ts) handles colors, radii, padding, shadows.
 * This file handles: typography details, custom decorations, asymmetric
 * borders, and components with no token API.
 */

/* -- Dialog ------------------------------------------------------------ */

/* Thin teal accent strip at the top of every dialog. */
.p-dialog::before {
  content: '';
  display: block;
  height: 2px;
  background: rgb(20 184 166); /* teal-500 */
}

.p-dialog-header {
  border-bottom: 1px solid rgb(241 245 249); /* slate-100 */
}

.p-dialog-title {
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.p-dialog-close-button {
  color: rgb(148 163 184); /* slate-400 */
  border-radius: 0;
}
.p-dialog-close-button:hover {
  color: rgb(15 23 42);
  background: rgb(241 245 249);
}

.p-dialog-footer {
  border-top: 1px solid rgb(241 245 249);
  background: rgb(248 250 252); /* slate-50 */
}

/* Confirm dialog icon and message. */
.p-confirmdialog .p-confirm-dialog-icon {
  color: rgb(185 28 28); /* red-700 */
  font-size: 18px;
}
.p-confirmdialog .p-confirm-dialog-message {
  font-size: 13px;
  color: rgb(51 65 85); /* slate-700 */
  line-height: 1.5;
}

/* -- Inputs ------------------------------------------------------------ */

/* Restore left padding inside icon fields. */
.p-iconfield .p-inputtext {
  padding-left: 2rem;
}

/* Input/select/multiselect font size (no token for default font size). */
.p-inputtext,
.p-textarea,
.p-inputnumber-input,
.p-select-label,
.p-multiselect-label {
  font-size: 13px;
}

/* -- Tabs -------------------------------------------------------------- */

.p-tab {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border-radius: 0;
}

/* -- Message ----------------------------------------------------------- */

/* Asymmetric left-border accent per severity. */
.p-message {
  border-left-width: 3px;
}
.p-message.p-message-error {
  border-left-color: rgb(185 28 28); /* red-700 */
}
.p-message.p-message-success {
  border-left-color: rgb(13 148 136); /* teal-600 */
}
.p-message.p-message-warn {
  border-left-color: rgb(180 83 9); /* amber-700 */
}
.p-message.p-message-info {
  border-left-color: rgb(71 85 105); /* slate-600 */
}

/* -- SelectButton ------------------------------------------------------ */

.p-selectbutton {
  border: 1px solid rgb(226 232 240);
  border-radius: 0;
  display: inline-flex;
}
.p-selectbutton .p-togglebutton {
  border: none;
  border-right: 1px solid rgb(241 245 249);
  border-radius: 0;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.375rem 0.75rem;
  color: rgb(100 116 139);
  background: #ffffff;
}
.p-selectbutton .p-togglebutton:last-child {
  border-right: none;
}
.p-selectbutton .p-togglebutton:not(.p-togglebutton-checked):hover {
  background: rgb(248 250 252);
  color: rgb(15 23 42);
}
.p-selectbutton .p-togglebutton.p-togglebutton-checked {
  background: rgb(240 253 250);
  color: rgb(15 118 110);
  font-weight: 500;
}

/* -- ProgressSpinner --------------------------------------------------- */

.p-progressspinner-circle {
  stroke: rgb(13 148 136); /* teal-600 */
}

/* -- Row action menu --------------------------------------------------- */

.row-actions-trigger.p-button.p-button-text {
  color: rgb(148 163 184); /* slate-400 */
  padding: 0.125rem 0.375rem;
  min-width: 0;
}
.row-actions-trigger.p-button.p-button-text:enabled:hover {
  background: rgb(241 245 249);
  color: rgb(15 23 42);
}

.p-menu .row-actions-danger .p-menu-item-link,
.p-menu .row-actions-danger .p-menu-item-link .p-menu-item-label,
.p-menu .row-actions-danger .p-menu-item-link .p-menu-item-icon {
  color: rgb(185 28 28);
}
.p-menu .row-actions-danger .p-menu-item-link:hover {
  background: rgb(254 242 242);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/src/app/shared/styles/primeng-overrides.css
git commit -m "refactor(styles): create primeng-overrides.css for token-gap CSS"
```

---

### Task 3: Create `data-table.css` (unified table chrome)

**Files:**
- Create: `src/client/src/app/shared/styles/data-table.css`

- [ ] **Step 1: Create the unified table file**

This is the content from `manage-table.css` lines 1-178 with class names changed from `manage-table` to `data-table`, plus the catalyst group-header style appended.

```css
/*
 * Unified data table chrome for all p-table instances.
 * Applied via `styleClass="data-table"` on any p-table.
 *
 * Bloomberg/Linear density: borderless feel, uppercase tracked thead,
 * mono tabular identifier columns, teal-tinted row hover.
 */

/* --------------------------------------------------------------------- */
/* p-table chrome                                                         */
/* --------------------------------------------------------------------- */

.data-table.p-datatable,
.data-table .p-datatable {
  background: #ffffff;
  border: 1px solid rgb(226 232 240); /* slate-200 */
}

.data-table .p-datatable-table-container,
.data-table .p-datatable-wrapper {
  background: #ffffff;
  border: none;
}

.data-table .p-datatable-thead {
  background: rgb(248 250 252 / 0.6); /* slate-50 @ 60% */
}

.data-table .p-datatable-thead > tr > th {
  background: transparent;
  border-top: none;
  border-bottom: 1px solid rgb(226 232 240); /* slate-200 */
  padding: 0.5rem 0.75rem;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgb(100 116 139); /* slate-500 */
}

.data-table .p-datatable-tbody > tr {
  background: transparent;
  transition: background-color 120ms ease-out;
}

.data-table .p-datatable-tbody > tr > td {
  padding: 0.5rem 0.75rem;
  border-top: none;
  border-bottom: 1px solid rgb(241 245 249); /* slate-100 */
  font-size: 13px;
  line-height: 1.3;
  color: rgb(71 85 105); /* slate-600 */
  background: transparent;
}

/* First data column: primary identifier, darker, medium weight. */
.data-table .p-datatable-tbody > tr > td:first-child {
  color: rgb(15 23 42); /* slate-900 */
  font-weight: 500;
}

/* Near-imperceptible teal row hover. */
.data-table .p-datatable-tbody > tr:hover {
  background: rgb(240 253 250 / 0.55); /* teal-50 @ 55% */
}

/* Selected row: teal left border + subtle teal wash. */
.data-table .p-datatable-tbody > tr.selected-row > td {
  background: rgb(240 253 250 / 0.6); /* teal-50 @ 60% */
}
.data-table .p-datatable-tbody > tr.selected-row > td:first-child {
  border-left: 2px solid rgb(20 184 166); /* teal-500 */
  padding-left: calc(0.75rem - 2px);
}

/* Empty state row. */
.data-table .p-datatable-emptymessage td {
  text-align: center;
  padding: 3rem 0;
  color: rgb(148 163 184); /* slate-400 */
  font-size: 12px;
  letter-spacing: 0.02em;
}

/* --------------------------------------------------------------------- */
/* Row group headers (catalyst-style time-bucket subheaders)              */
/* --------------------------------------------------------------------- */

.data-table .data-table-group-header td {
  background: rgb(248 250 252); /* slate-50 */
  border-bottom: 1px solid rgb(226 232 240); /* slate-200 */
  padding: 0.25rem 0.75rem;
}

/* --------------------------------------------------------------------- */
/* Column role modifiers                                                  */
/* --------------------------------------------------------------------- */

.data-table .col-identifier {
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  color: rgb(100 116 139); /* slate-500 */
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
}

.data-table .col-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.data-table .col-secondary {
  color: rgb(100 116 139); /* slate-500 */
}

.data-table th.col-date,
.data-table td.col-date {
  width: 7.5rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.data-table th.col-source,
.data-table td.col-source {
  width: 5.5rem;
  white-space: nowrap;
}

.data-table th.col-priority,
.data-table td.col-priority {
  width: 4rem;
  text-align: center;
}

.data-table th.col-actions,
.data-table td.col-actions {
  width: 2.5rem;
  text-align: right;
  padding-left: 0.25rem;
  padding-right: 0.25rem;
}

.data-table th.col-num,
.data-table th.col-actions {
  text-align: right;
}

/* --------------------------------------------------------------------- */
/* Sort/filter icon sizing                                                */
/* --------------------------------------------------------------------- */

.data-table .p-datatable-thead > tr > th > * {
  vertical-align: middle;
}

.data-table svg.p-sortable-column-icon {
  width: 10px !important;
  height: 10px !important;
  vertical-align: middle;
  margin-top: -1px;
}

.data-table .p-datatable-column-filter-button {
  width: 1.25rem !important;
  height: 1.25rem !important;
  padding: 0 !important;
  vertical-align: middle;
}

.data-table .p-datatable-column-filter-button svg.p-icon {
  width: 0.65rem !important;
  height: 0.65rem !important;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/src/app/shared/styles/data-table.css
git commit -m "refactor(styles): create unified data-table.css from manage-table + catalyst-table chrome"
```

---

### Task 4: Create `page-shell.css` (reusable page layout)

**Files:**
- Create: `src/client/src/app/shared/styles/page-shell.css`

- [ ] **Step 1: Create the page shell file**

This is `manage-table.css` lines 208-274 with `manage-shell` renamed to `page-shell`.

```css
/*
 * Reusable page layout shell: eyebrow, title row with count badge,
 * optional subtitle, and right-aligned action slot. Used by
 * ManagePageShellComponent and any page that needs the standard
 * full-bleed list-page layout.
 *
 * Styling is applied via `.page-shell*` classes in the component template.
 */

.page-shell {
  width: 100%;
  padding: 1.5rem 2rem 4rem;
}

.page-shell--narrow {
  max-width: 72rem;
  margin-left: auto;
  margin-right: auto;
}

.page-shell__eyebrow {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(148 163 184); /* slate-400 */
  margin-bottom: 0.375rem;
}

.page-shell__title-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid rgb(226 232 240); /* slate-200 */
  margin-bottom: 1rem;
}

.page-shell__title {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  font-size: 20px;
  font-weight: 600;
  color: rgb(15 23 42); /* slate-900 */
  letter-spacing: -0.01em;
  line-height: 1;
}

.page-shell__count {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.4;
  color: rgb(71 85 105); /* slate-600 */
  background: rgb(241 245 249); /* slate-100 */
  border: 1px solid rgb(226 232 240); /* slate-200 */
  border-radius: 2px;
  font-variant-numeric: tabular-nums;
}

.page-shell__subtitle {
  margin-top: 0.25rem;
  font-size: 12px;
  color: rgb(100 116 139); /* slate-500 */
}

.page-shell__actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/src/app/shared/styles/page-shell.css
git commit -m "refactor(styles): extract page-shell.css from manage-table.css layout classes"
```

---

### Task 5: Update `styles.css` imports and delete old files

**Files:**
- Modify: `src/client/src/styles.css`
- Delete: `src/client/src/app/shared/styles/manage-table.css`
- Delete: `src/client/src/app/features/catalysts/catalyst-table.css`

- [ ] **Step 1: Update `styles.css` to import the new files**

Replace the entire file with:

```css
@import 'tailwindcss';
@import '@fortawesome/fontawesome-free/css/all.min.css';
@import './app/shared/styles/primeng-overrides.css';
@import './app/shared/styles/data-table.css';
@import './app/shared/styles/page-shell.css';
@import './app/features/landscape/landscape.css';
@plugin "tailwindcss-primeui";
```

- [ ] **Step 2: Delete old CSS files**

```bash
git rm src/client/src/app/shared/styles/manage-table.css
git rm src/client/src/app/features/catalysts/catalyst-table.css
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd src/client && npx ng build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/client/src/styles.css
git commit -m "refactor(styles): update styles.css imports, delete manage-table.css and catalyst-table.css"
```

---

### Task 6: Update template class references

**Files:**
- Modify: `src/client/src/app/features/tenant-settings/tenant-settings.component.ts` (2 occurrences)
- Modify: `src/client/src/app/features/events/events-page.component.html`
- Modify: `src/client/src/app/features/manage/companies/company-list.component.html`
- Modify: `src/client/src/app/features/manage/routes-of-administration/route-of-administration-list.component.html`
- Modify: `src/client/src/app/features/manage/trials/trial-list.component.html`
- Modify: `src/client/src/app/features/manage/therapeutic-areas/therapeutic-area-list.component.html`
- Modify: `src/client/src/app/features/manage/marker-types/marker-type-list.component.html`
- Modify: `src/client/src/app/features/manage/products/product-list.component.html`
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.html`
- Modify: `src/client/src/app/features/catalysts/catalyst-table.component.ts`
- Modify: `src/client/src/app/shared/components/manage-page-shell.component.ts`

- [ ] **Step 1: Rename `manage-table` to `data-table` in all templates**

In each of the following files, find `styleClass="manage-table"` and replace with `styleClass="data-table"`:

- `src/client/src/app/features/tenant-settings/tenant-settings.component.ts` (2 occurrences)
- `src/client/src/app/features/events/events-page.component.html`
- `src/client/src/app/features/manage/companies/company-list.component.html`
- `src/client/src/app/features/manage/routes-of-administration/route-of-administration-list.component.html`
- `src/client/src/app/features/manage/trials/trial-list.component.html`
- `src/client/src/app/features/manage/therapeutic-areas/therapeutic-area-list.component.html`
- `src/client/src/app/features/manage/marker-types/marker-type-list.component.html`
- `src/client/src/app/features/manage/products/product-list.component.html`
- `src/client/src/app/features/manage/trials/trial-detail.component.html`

- [ ] **Step 2: Rename `catalyst-table` to `data-table` in catalyst component**

In `src/client/src/app/features/catalysts/catalyst-table.component.ts`, change:
```
styleClass="catalyst-table"
```
to:
```
styleClass="data-table"
```

- [ ] **Step 3: Rename `catalyst-group-header` to `data-table-group-header`**

In `src/client/src/app/features/catalysts/catalyst-table.component.ts`, change:
```html
<tr class="catalyst-group-header">
```
to:
```html
<tr class="data-table-group-header">
```

- [ ] **Step 4: Update `manage-page-shell.component.ts` template classes**

In `src/client/src/app/shared/components/manage-page-shell.component.ts`, update the template. Change every occurrence of `manage-shell` to `page-shell`:

- `class="manage-shell"` -> `class="page-shell"`
- `manage-shell--narrow` -> `page-shell--narrow`
- `class="manage-shell__eyebrow"` -> `class="page-shell__eyebrow"`
- `class="manage-shell__title-row"` -> `class="page-shell__title-row"`
- `class="manage-shell__title"` -> `class="page-shell__title"`
- `class="manage-shell__count"` -> `class="page-shell__count"`
- `class="manage-shell__subtitle"` -> `class="page-shell__subtitle"`
- `class="manage-shell__actions"` -> `class="page-shell__actions"`

Also update the doc comment: change `shared/styles/manage-table.css` to `shared/styles/page-shell.css` and change `manage-shell*` to `page-shell*`.

Also update the doc comment usage example: change `styleClass="manage-table"` to `styleClass="data-table"`.

- [ ] **Step 5: Verify no orphaned references remain**

Run: `cd src/client && grep -r "manage-table\|catalyst-table\|manage-shell\|catalyst-group-header" src/app/ --include="*.ts" --include="*.html" --include="*.css" | grep -v node_modules | grep -v ".css:" || echo "No orphaned references found"`

Expected: "No orphaned references found" (or only hits in comments/docs that don't affect functionality -- review any output)

- [ ] **Step 6: Build and lint**

Run: `cd src/client && npx ng lint && npx ng build 2>&1 | tail -5`
Expected: Both pass

- [ ] **Step 7: Commit**

```bash
cd src/client
git add -A src/app/
git commit -m "refactor(styles): rename manage-table -> data-table, manage-shell -> page-shell in all templates"
```

---

### Task 7: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Full build**

Run: `cd src/client && npx ng build 2>&1 | tail -10`
Expected: Build succeeds with no errors

- [ ] **Step 2: Verify no orphaned class references**

Run: `cd src/client && grep -rn "manage-table\|catalyst-table\|manage-shell\|catalyst-group-header" src/ --include="*.ts" --include="*.html" --include="*.css" | grep -v node_modules || echo "Clean"`
Expected: "Clean" or only hits in build output/dist that are stale

- [ ] **Step 3: Verify no `!important` in preset-covered rules**

Check that `primeng-overrides.css` does NOT use `!important` on properties that the preset now handles (border-radius, padding, background, color on dialog/input/select/button/tabs/message). The only `!important` should be in `data-table.css` for sort/filter icon sizing (PrimeNG inline styles require it).

- [ ] **Step 4: Spot-check file structure**

Run: `find src/client/src/app/shared/styles -name "*.css" && find src/client/src/app/features -name "*.css"`
Expected:
```
src/client/src/app/shared/styles/primeng-overrides.css
src/client/src/app/shared/styles/data-table.css
src/client/src/app/shared/styles/page-shell.css
src/client/src/app/features/landscape/landscape.css
```

No other CSS files in `shared/styles/` or `features/`.
