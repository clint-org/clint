# Control Styles Redesign -- Confident Presence

## Summary

Redesign all interactive controls (buttons, selects, select buttons, filter chips, inputs, checkboxes, search fields) to bring more primary color (teal) into the application. The current controls are heavily neutral (slate borders, white backgrounds, outlined buttons) and lack brand expression. The new direction -- "Confident Presence" -- makes the brand visible in every interaction state while keeping controls subordinate to the data.

## Design Decisions

| Control | Current | New |
|---|---|---|
| Primary button | Outlined, teal border, teal text | **Solid teal-600 fill, white text** |
| Primary button (hover) | Teal-50 background | **Teal-700 fill** |
| Primary button (disabled) | Faded teal | **Slate wash: slate-200 bg, slate-400 text** |
| Primary button (loading) | -- | **Teal-600 fill, white spinner** |
| Secondary button | Outlined, slate-200 border | **Slate-300 border** (slightly heavier) |
| Text button | Teal-600 text | **Teal-600 text, font-weight 600** |
| Text button (hover) | -- | **Teal-50 background** |
| Text button (disabled) | Slate-400 text | **Slate-300 text** |
| Danger button | -- | **White bg, red-300 border, red-700 text** |
| Select (idle) | Slate-200 border | **Slate-300 border, slate-400 chevron** |
| Select (hover) | Slate-400 border | **Slate-500 border** |
| Select (active/has value) | No change | **Teal-600 border, teal-50 bg, teal-700 text, teal-600 chevron** |
| Multi-select (multiple values) | Comma-separated text | **Show placeholder label + solid teal badge with count** |
| Select button (inactive) | White bg, slate-500 text | No change |
| Select button (active) | Teal-50 bg, teal-700 text | **Solid teal-600 fill, white text** |
| Select button (hover, inactive) | Slate-50 bg | **Slate-50 bg, slate-900 text** |
| Filter chip | Slate-100 bg, slate-700 text | **Slate-100 bg, slate-800 text, slate-200 border, 3px teal-600 left border** |
| Text input (idle) | Slate-200 border | **Slate-300 border** |
| Text input (focus) | 1px teal-600 ring | **2px teal-600 ring (box-shadow)** |
| Text input (error) | -- | **Red-500 border, red-500 2px ring** |
| Search field (idle) | White bg, slate-200 border | **Teal-50 bg, teal-200 border, teal-600 icon** |
| Search field (focus) | -- | **White bg, teal-600 border, teal ring** |
| Checkbox (checked) | Default PrimeNG | **Solid teal-600 fill, white checkmark** |
| Checkbox (hover, unchecked) | -- | **Teal-600 border preview** |

## Unchanged Controls

- **Dialogs**: Already branded (2px teal accent strip, uppercase title, slate-50 footer)
- **Messages**: Already use asymmetric teal/red/amber left borders
- **Progress spinner**: Already teal-600 stroke
- **Tabs**: Already use teal-600 active bar

## Consistent Control Height

All filter bar controls must share the same rendered height (28px at `size="small"`). This applies to:
- Select buttons (segmented groups)
- Select / multi-select dropdowns  
- Text buttons (clear)

Achieved through consistent `height` or matching `padding` + `line-height` values rather than relying on content-driven sizing.

## Implementation Scope

### Theme Preset Changes (`primeng-theme.ts`)

Update the `button` component tokens:
- Add `primary` color scheme with `background: '{teal.600}'`, `hoverBackground: '{teal.700}'`, `activeBackground: '{teal.800}'`, `color: '#ffffff'` for solid teal
- Keep `outlined.primary` tokens for any future outlined usage, but no current component uses outlined primary after this change
- Add `disabledBackground: '{slate.200}'`, `disabledColor: '{slate.400}'` for primary disabled

Update `formField` tokens:
- Change `borderColor` from `'{slate.200}'` to `'{slate.300}'`
- Update `focusRing.shadow` to `'0 0 0 2px rgba(13, 148, 136, 0.15)'`

Update `select` / `multiselect` tokens:
- `dropdown.color` stays `'{slate.400}'` for idle, override to `'{teal.600}'` when value is present (handled in CSS overrides)

### CSS Overrides (`primeng-overrides.css`)

**Select button overrides** -- update `.p-togglebutton-checked`:
```css
.p-selectbutton .p-togglebutton.p-togglebutton-checked {
  background: rgb(13 148 136);   /* teal-600 */
  color: #ffffff;
  font-weight: 600;
}
```

**Active select/multiselect** -- add overrides for selects with values:
```css
/* Applied via Angular class binding when value is present */
.p-select.has-value,
.p-multiselect.has-value {
  border-color: rgb(13 148 136);   /* teal-600 */
  background: rgb(240 253 250);    /* teal-50 */
}
.p-select.has-value .p-select-label,
.p-multiselect.has-value .p-multiselect-label {
  color: rgb(15 118 110);          /* teal-700 */
  font-weight: 500;
}
.p-select.has-value .p-select-dropdown,
.p-multiselect.has-value .p-multiselect-dropdown {
  color: rgb(13 148 136);          /* teal-600 */
}
```

**Multi-select badge** -- style the count badge:
```css
.p-multiselect.has-value .p-multiselect-label .count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  font-size: 10px;
  font-weight: 700;
  background: rgb(13 148 136);    /* teal-600 */
  color: #ffffff;
}
```

**Search field tint**:
```css
.search-tinted .p-inputtext {
  background: rgb(240 253 250);    /* teal-50 */
  border-color: rgb(153 246 228);  /* teal-200 */
}
.search-tinted .p-inputicon i {
  color: rgb(13 148 136);          /* teal-600 */
}
```

### Template Changes

**Filter chips** (landscape-filter-bar, grid-toolbar): Update chip markup classes:
```
bg-slate-100 → bg-slate-100 border border-slate-200 border-l-[3px] border-l-teal-600
text-slate-700 → text-slate-800
```

**Multi-select display**: Change from `display="comma"` to `display="chip"` or a custom `selectedItems` template (`pTemplate="selectedItems"`) that renders the placeholder label + a `<span class="count-badge">N</span>` when `selectedItems.length > 1`. When exactly one value is selected, show the value label directly (current behavior). The badge count replaces the comma-separated list for compactness.

**Search field**: Add a `search-tinted` class to the `p-iconfield` wrapper in grid-toolbar.

**Form actions** (`form-actions.component.ts`): Remove `[outlined]="true"` from the submit button so it renders as the solid primary.

**Active select binding**: Add conditional `styleClass` or `[class]` binding on `p-select` and `p-multiselect` to apply `has-value` when the model has a value.

### Consistent Height

Ensure the PrimeNG `size="small"` renders all filter bar controls at the same height. If PrimeNG's small variants differ across component types, normalize with:
```css
.p-selectbutton,
.p-select,
.p-multiselect {
  height: 28px;
}
```

## Files to Modify

1. `src/client/src/app/config/primeng-theme.ts` -- theme token updates
2. `src/client/src/app/shared/styles/primeng-overrides.css` -- CSS overrides for select active state, select button, search tint, badge, height normalization
3. `src/client/src/app/features/landscape/landscape-filter-bar.component.html` -- chip classes, active select bindings, multi-select template
4. `src/client/src/app/shared/components/grid-toolbar.component.ts` -- chip classes, search tint class
5. `src/client/src/app/shared/components/form-actions.component.ts` -- remove `[outlined]="true"` from submit button

## Out of Scope

- Dialog styling (already branded)
- Message styling (already branded)
- Tab styling (already branded)
- Sidebar / navigation styling
- Data table styling
- Color palette changes (using existing teal/slate tokens)
