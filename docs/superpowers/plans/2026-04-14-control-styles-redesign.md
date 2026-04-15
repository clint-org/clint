# Control Styles Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle all interactive controls (buttons, selects, select buttons, filter chips, inputs, search, checkboxes) to the "Confident Presence" direction -- solid teal primary buttons, teal-tinted active selects with badge counts, solid teal select button segments, and slate chips with teal left accent.

**Architecture:** Most changes live in two files: the PrimeNG theme preset (`primeng-theme.ts`) for token-level changes and the CSS overrides file (`primeng-overrides.css`) for styling that tokens can't express. Template changes are limited to filter chip classes, multi-select display mode, active-state class bindings, and removing `[outlined]` from form submit buttons.

**Tech Stack:** Angular 19, PrimeNG 19 (Aura preset), Tailwind CSS v4

**Spec:** `docs/specs/2026-04-14-control-styles-redesign.md`

---

### Task 1: Update PrimeNG theme preset -- buttons and form fields

**Files:**
- Modify: `src/client/src/app/config/primeng-theme.ts`

- [ ] **Step 1: Update button tokens for solid primary and disabled states**

In `primeng-theme.ts`, update the `button` component section. Replace the existing `button` block with:

```ts
button: {
  root: {
    borderRadius: '0',
  },
  colorScheme: {
    light: {
      root: {
        primary: {
          background: '{teal.600}',
          hoverBackground: '{teal.700}',
          activeBackground: '{teal.800}',
          borderColor: '{teal.600}',
          hoverBorderColor: '{teal.700}',
          activeBorderColor: '{teal.800}',
          color: '#ffffff',
          hoverColor: '#ffffff',
          activeColor: '#ffffff',
          disabledBackground: '{slate.200}',
          disabledBorderColor: '{slate.200}',
          disabledColor: '{slate.400}',
        },
        secondary: {
          borderColor: '{slate.300}',
          hoverBackground: '{slate.50}',
          activeBackground: '{slate.100}',
          color: '{slate.700}',
        },
        text: {
          primary: {
            hoverBackground: '{teal.50}',
            activeBackground: '{teal.100}',
            color: '{teal.600}',
          },
        },
      },
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
          borderColor: '{slate.300}',
          color: '{slate.700}',
        },
      },
    },
  },
},
```

- [ ] **Step 2: Update form field border and focus ring tokens**

In the `semantic.formField` section, change `borderColor` and `focusRing.shadow`:

Replace:
```ts
focusRing: {
  width: '0',
  style: 'none',
  color: 'transparent',
  offset: '0',
  shadow: '0 0 0 1px {teal.600}',
},
```

With:
```ts
focusRing: {
  width: '0',
  style: 'none',
  color: 'transparent',
  offset: '0',
  shadow: '0 0 0 2px rgba(13, 148, 136, 0.15)',
},
```

In `semantic.colorScheme.light.formField`, change:
```ts
borderColor: '{slate.300}',
hoverBorderColor: '{slate.500}',
focusBorderColor: '{teal.600}',
invalidBorderColor: '{red.500}',
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd src/client && ng build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/config/primeng-theme.ts
git commit -m "feat(theme): solid teal primary buttons, slate-300 borders, wider focus ring"
```

---

### Task 2: Update CSS overrides -- select buttons, active selects, search tint, height normalization

**Files:**
- Modify: `src/client/src/app/shared/styles/primeng-overrides.css`

- [ ] **Step 1: Update select button checked state to solid teal**

In `primeng-overrides.css`, replace the `.p-togglebutton-checked` rule:

Replace:
```css
.p-selectbutton .p-togglebutton.p-togglebutton-checked {
  background: rgb(240 253 250);
  color: rgb(15 118 110);
  font-weight: 500;
}
```

With:
```css
.p-selectbutton .p-togglebutton.p-togglebutton-checked {
  background: rgb(13 148 136); /* teal-600 */
  color: #ffffff;
  font-weight: 600;
}
```

- [ ] **Step 2: Add active select/multiselect styles**

Add after the `/* -- SelectButton */` section a new section:

```css
/* -- Active Select / MultiSelect ---------------------------------------- */

/* Applied via [styleClass] binding when the control has a value. */
.p-select.has-value,
.p-multiselect.has-value {
  border-color: rgb(13 148 136); /* teal-600 */
  background: rgb(240 253 250); /* teal-50 */
}
.p-select.has-value .p-select-label,
.p-multiselect.has-value .p-multiselect-label {
  color: rgb(15 118 110); /* teal-700 */
  font-weight: 500;
}
.p-select.has-value .p-select-dropdown,
.p-multiselect.has-value .p-multiselect-dropdown {
  color: rgb(13 148 136); /* teal-600 */
}

/* Solid teal badge for multi-select count. */
.multiselect-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  font-size: 10px;
  font-weight: 700;
  background: rgb(13 148 136); /* teal-600 */
  color: #ffffff;
}
```

- [ ] **Step 3: Add search field tint styles**

Add a new section:

```css
/* -- Search field tint --------------------------------------------------- */

.search-tinted .p-inputtext {
  background: rgb(240 253 250); /* teal-50 */
  border-color: rgb(153 246 228); /* teal-200 */
}
.search-tinted .p-inputtext:focus {
  background: #ffffff;
}
.search-tinted .p-inputicon i {
  color: rgb(13 148 136); /* teal-600 */
}
```

- [ ] **Step 4: Add text button disabled style and input error ring**

Add under the text button section or a new section:

```css
/* -- Text button disabled ------------------------------------------------ */

.p-button-text:disabled .p-button-label {
  color: rgb(203 213 225); /* slate-300 */
}

/* -- Input error state --------------------------------------------------- */

.p-inputtext.p-invalid,
.p-select.p-invalid,
.p-multiselect.p-invalid {
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.1);
}
```

- [ ] **Step 5: Add filter bar height normalization**

Add a new section:

```css
/* -- Filter bar control height ------------------------------------------- */

/* Normalize all filter bar controls to 28px at size="small". */
.p-selectbutton[data-p-size="small"],
.p-select[data-p-size="small"],
.p-multiselect[data-p-size="small"] {
  height: 28px;
}
```

- [ ] **Step 6: Verify the build compiles**

Run: `cd src/client && ng build`
Expected: Build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/client/src/app/shared/styles/primeng-overrides.css
git commit -m "feat(styles): active select tint, solid select buttons, search tint, height normalization"
```

---

### Task 3: Update filter chip styles in landscape filter bar and grid toolbar

**Files:**
- Modify: `src/client/src/app/features/landscape/landscape-filter-bar.component.html`
- Modify: `src/client/src/app/shared/components/grid-toolbar.component.ts`

- [ ] **Step 1: Update landscape filter bar chip classes**

In `landscape-filter-bar.component.html`, find the chip `<span>` (around line 190):

Replace:
```html
<span
  role="listitem"
  class="inline-flex items-center gap-1.5 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700"
>
```

With:
```html
<span
  role="listitem"
  class="inline-flex items-center gap-1.5 border border-slate-200 border-l-[3px] border-l-teal-600 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-800"
>
```

- [ ] **Step 2: Update grid toolbar chip classes**

In `grid-toolbar.component.ts`, find the chip `<span>` in the template (around line 52):

Replace:
```html
<span
  role="listitem"
  class="inline-flex items-center gap-1.5 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700"
>
```

With:
```html
<span
  role="listitem"
  class="inline-flex items-center gap-1.5 border border-slate-200 border-l-[3px] border-l-teal-600 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-800"
>
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd src/client && ng build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/landscape/landscape-filter-bar.component.html src/client/src/app/shared/components/grid-toolbar.component.ts
git commit -m "feat(chips): teal left accent on filter chips"
```

---

### Task 4: Add active-state class bindings to multiselects and update display mode

**Files:**
- Modify: `src/client/src/app/features/landscape/landscape-filter-bar.component.html`
- Modify: `src/client/src/app/features/landscape/landscape-filter-bar.component.ts`

- [ ] **Step 1: Add `has-value` styleClass binding to all multiselects in the landscape filter bar**

For each `<p-multiselect>` in `landscape-filter-bar.component.html`, add a conditional `[styleClass]` binding that appends `has-value` when the model array has items. Each multiselect already has a `styleClass` like `styleClass="w-32"`.

Replace each `styleClass="w-XX"` with a dynamic binding. For example, the Company multiselect (line ~59):

Replace:
```html
styleClass="w-32"
```

With:
```html
[styleClass]="'w-32' + (state.filters().companyIds.length ? ' has-value' : '')"
```

Apply the same pattern to all seven multiselects, using the correct filter key and width for each:

| Filter | Width | Filter key |
|---|---|---|
| Company | w-32 | companyIds |
| Product | w-32 | productIds |
| Therapy Area | w-36 | therapeuticAreaIds |
| MOA | w-32 | mechanismOfActionIds |
| ROA | w-32 | routeOfAdministrationIds |
| Status | w-28 | recruitmentStatuses |
| Study type | w-28 | studyTypes |

- [ ] **Step 2: Change multi-select display from comma to count badge**

For each `<p-multiselect>`, replace `display="comma"` with a `selectedItemsLabel` that shows the placeholder + count pattern. PrimeNG's `selectedItemsLabel` prop accepts `{0}` as a placeholder for the count.

On each multiselect, replace:
```html
display="comma"
```

With:
```html
[maxSelectedLabels]="1"
[selectedItemsLabel]="'{0} selected'"
```

This tells PrimeNG: show the label when 1 item is selected, show "{N} selected" when more than 1 are selected. The actual badge styling will be handled by wrapping the count via CSS.

- [ ] **Step 3: Style the "N selected" label as a badge via CSS**

In `primeng-overrides.css`, add a rule to style the multi-select label when it contains the "selected" text. Since PrimeNG renders the selectedItemsLabel into `.p-multiselect-label`, the `has-value` class on the parent handles the teal tint. The badge count itself needs a custom approach.

Instead of trying to style the generated text, use PrimeNG's `pTemplate="selectedItems"` for full control. Update the component to import `SharedModule` or use `ng-template`.

In `landscape-filter-bar.component.ts`, add `SharedModule` to imports:

```ts
import { SharedModule } from 'primeng/api';
```

Add `SharedModule` to the `imports` array:
```ts
imports: [FormsModule, MultiSelect, ButtonModule, SelectButton, ProgressSpinner, SharedModule],
```

- [ ] **Step 4: Add selectedItems template to each multiselect**

For each multiselect, replace the `[maxSelectedLabels]` / `[selectedItemsLabel]` approach from Step 2 with a custom template. Keep `display="comma"` removed.

For the Company multiselect, the full block becomes:

```html
<p-multiselect
  [options]="companyOptions()"
  [ngModel]="state.filters().companyIds"
  (ngModelChange)="update('companyIds', $event ?? [])"
  placeholder="Company"
  ariaLabel="Filter by company"
  optionLabel="label"
  optionValue="value"
  [filter]="true"
  [showClear]="true"
  appendTo="body"
  [styleClass]="'w-32' + (state.filters().companyIds.length ? ' has-value' : '')"
  size="small"
  [maxSelectedLabels]="1"
  selectedItemsLabel="Company"
>
  <ng-template pTemplate="selectedItems" let-items>
    @if (items && items.length === 1) {
      <span>{{ items[0].label }}</span>
    } @else if (items && items.length > 1) {
      <span>Company</span>
      <span class="multiselect-badge ml-1">{{ items.length }}</span>
    }
  </ng-template>
</p-multiselect>
```

Apply the same pattern to all seven multiselects, changing the placeholder text and filter key accordingly:

**Product:**
```html
selectedItemsLabel="Product"
```
Template: `<span>Product</span><span class="multiselect-badge ml-1">{{ items.length }}</span>`

**Therapy Area:**
```html
[styleClass]="'w-36' + (state.filters().therapeuticAreaIds.length ? ' has-value' : '')"
selectedItemsLabel="Therapy Area"
```
Template: `<span>Therapy Area</span><span class="multiselect-badge ml-1">{{ items.length }}</span>`

**MOA:**
```html
selectedItemsLabel="MOA"
```
Template: `<span>MOA</span><span class="multiselect-badge ml-1">{{ items.length }}</span>`

**ROA:**
```html
selectedItemsLabel="ROA"
```
Template: `<span>ROA</span><span class="multiselect-badge ml-1">{{ items.length }}</span>`

**Status:**
```html
[styleClass]="'w-28' + (state.filters().recruitmentStatuses.length ? ' has-value' : '')"
selectedItemsLabel="Status"
```
Template: `<span>Status</span><span class="multiselect-badge ml-1">{{ items.length }}</span>`

**Study type:**
```html
[styleClass]="'w-28' + (state.filters().studyTypes.length ? ' has-value' : '')"
selectedItemsLabel="Study type"
```
Template: `<span>Study type</span><span class="multiselect-badge ml-1">{{ items.length }}</span>`

- [ ] **Step 5: Verify the build compiles**

Run: `cd src/client && ng build`
Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/landscape/landscape-filter-bar.component.html src/client/src/app/features/landscape/landscape-filter-bar.component.ts
git commit -m "feat(filters): active teal tint on selects, badge count on multiselects"
```

---

### Task 5: Update form actions and grid toolbar search

**Files:**
- Modify: `src/client/src/app/shared/components/form-actions.component.ts`
- Modify: `src/client/src/app/shared/components/grid-toolbar.component.ts`

- [ ] **Step 1: Make form submit button solid primary (remove outlined)**

In `form-actions.component.ts`, in the template, the submit button currently has `[outlined]="true"`. Remove it:

Replace:
```html
<p-button
  [label]="submitLabel()"
  type="submit"
  [outlined]="true"
  size="small"
  [loading]="loading()"
/>
```

With:
```html
<p-button
  [label]="submitLabel()"
  type="submit"
  size="small"
  [loading]="loading()"
/>
```

- [ ] **Step 2: Add teal tint to grid toolbar search field**

In `grid-toolbar.component.ts`, add `styleClass="search-tinted"` to the `<p-iconfield>`:

Replace:
```html
<p-iconfield iconPosition="left">
```

With:
```html
<p-iconfield iconPosition="left" styleClass="search-tinted">
```

- [ ] **Step 3: Verify the build compiles and lint passes**

Run: `cd src/client && ng lint && ng build`
Expected: Both lint and build pass with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/shared/components/form-actions.component.ts src/client/src/app/shared/components/grid-toolbar.component.ts
git commit -m "feat(controls): solid primary submit button, tinted search field"
```

---

### Task 6: Update product form multiselects with active-state bindings

**Files:**
- Modify: `src/client/src/app/features/manage/products/product-form.component.html`

- [ ] **Step 1: Add has-value bindings to MOA and ROA multiselects**

The product form has two multiselects for MOAs and ROAs that also use `display="comma"`. Apply the same pattern.

For the MOA multiselect, find it (around line 60) and update:

Replace `display="comma"` and the static `styleClass` with dynamic bindings. The product form uses `[(ngModel)]="moas"` (a local signal or property). Add `has-value` when the array has items.

Since the product form uses two-way binding with local properties, use the property name directly in the class binding. For example:

```html
[styleClass]="moas.length ? 'has-value' : ''"
[maxSelectedLabels]="1"
selectedItemsLabel="MOAs"
```

Apply the same for ROAs:

```html
[styleClass]="roas.length ? 'has-value' : ''"
[maxSelectedLabels]="1"
selectedItemsLabel="ROAs"
```

Remove `display="comma"` from both.

- [ ] **Step 2: Verify the build compiles**

Run: `cd src/client && ng build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/manage/products/product-form.component.html
git commit -m "feat(product-form): active tint on MOA/ROA multiselects"
```

---

### Task 7: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: Both pass with zero errors.

- [ ] **Step 2: Verify all changes are committed**

Run: `git status`
Expected: Clean working tree, nothing untracked or unstaged.
