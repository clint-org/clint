---
id: spec-2026-002
title: PrimeNG UI Migration
slug: primeng-migration
status: completed
created: 2026-03-15
updated: 2026-03-15
---

# PrimeNG UI Migration

## Summary

Migrate the Clinical Trial Dashboard from hand-built Tailwind-only UI primitives to PrimeNG as the baseline component library. PrimeNG handles interactive components (dialogs, dropdowns, tables, form inputs, buttons) while Tailwind CSS v4 remains for layout, spacing, and custom styling on top. Domain-specific components (SVG timeline grid, phase bars, markers, legend) stay custom.

## Goals

- Eliminate maintenance burden of hand-built modal, multi-select, table, and form components
- Gain built-in accessibility (ARIA, keyboard navigation, focus management) from PrimeNG
- Establish a consistent component foundation that handles edge cases (overflow, z-index, focus trapping) correctly out of the box
- Maintain the teal/slate brand identity through a custom PrimeNG theme preset
- Keep Tailwind for layout and any styling that sits outside PrimeNG components

## Non-Goals

- Replacing domain-specific visualization components (SVG timeline grid, phase bars, markers, legend, SVG icons)
- Dark mode support (explicitly excluded per brand guide)
- Switching from template-driven forms (FormsModule/ngModel) to reactive forms
- Adding new features -- this is a 1:1 migration of existing UI

---

## Architecture Overview

```
Before:
  Angular 19 + Tailwind CSS v4 (pure utilities, no component library)
  Hand-built: Modal, MultiSelect, Tables, Buttons, Form Inputs, Tooltips, Spinners

After:
  Angular 19 + PrimeNG (component library) + Tailwind CSS v4 (layout & custom styling)
  PrimeNG: Dialog, MultiSelect, Table, Button, InputText, InputNumber, DatePicker,
           Dropdown, Checkbox, Textarea, ColorPicker, SelectButton, Tooltip,
           ProgressSpinner, Message
  Custom (unchanged): SVG icons, DashboardGrid, PhaseBar, Marker, MarkerTooltip,
                       GridHeader, RowLabel, RowNotes, Legend
```

### Theming Strategy

PrimeNG uses a design token architecture with three tiers (primitive, semantic, component). A custom preset based on Aura maps:

- **Primary palette**: Teal (50-950) -- matches brand hero accent
- **Surface palette**: Slate (50-950) -- matches brand neutrals
- **Dark mode**: Disabled (`darkModeSelector: false`)
- **CSS layers**: PrimeNG wraps styles in a `primeng` layer; Tailwind v4 handles layer ordering natively

The `tailwindcss-primeui` plugin exposes PrimeNG semantic colors as Tailwind utilities (`bg-primary`, `text-surface-500`) for use alongside standard Tailwind classes.

### Coexistence Model

- **PrimeNG owns**: Interactive behavior, ARIA, keyboard nav, focus management, overlay positioning
- **Tailwind owns**: Layout (`flex`, `grid`, `gap`, `p-*`, `m-*`), responsive breakpoints, spacing, custom one-off styling
- **Both**: Colors (PrimeNG tokens for component internals, Tailwind utilities for layout elements)

---

## Component Migration Map

| Current Component | PrimeNG Replacement | Notes |
|---|---|---|
| `shared/modal` (native `<dialog>`) | `p-dialog` | Header/footer templates, focus trapping built-in |
| `shared/multi-select` (custom dropdown) | `p-multiselect` | Built-in filtering, keyboard nav, virtual scroll |
| HTML `<table>` in all list components | `p-table` | Sortable columns, empty state template |
| Native `<select>` dropdowns | `p-select` | Searchable, templatable options |
| Native `<input type="text">` | `pInputText` directive | Inherits theme styling |
| Native `<input type="number">` | `p-inputnumber` | Min/max/step built-in |
| Native `<input type="date">` | `p-datepicker` | Consistent cross-browser date picking |
| Native `<input type="color">` | `p-colorpicker` | Full color picker UI |
| Native `<textarea>` | `pTextarea` directive | Auto-resize option |
| Native `<input type="checkbox">` | `p-checkbox` | Themed, accessible |
| Styled `<button>` elements | `p-button` | Severity variants, icon support |
| Custom spinner div | `p-progressspinner` | Consistent loading indicator |
| Custom error alert divs | `p-message` | Severity-based messaging |
| Zoom control button group | `p-selectbutton` | Built-in toggle state management |
| Custom marker tooltip | Stays custom | Domain-specific positioning on SVG timeline |
| Row notes (truncated text) | `pTooltip` + `p-popover` | Hover for preview, click for full content |

### Components NOT Migrated

These are domain-specific visualization components that have no PrimeNG equivalent:

- `shared/svg-icons/*` (circle, diamond, flag, arrow, x, bar icon components)
- `dashboard/grid/dashboard-grid.component` (frozen pane timeline with SVG overlay)
- `dashboard/grid/grid-header.component` (multi-level timeline column headers)
- `dashboard/grid/phase-bar.component` (SVG phase visualization)
- `dashboard/grid/marker.component` (SVG marker positioning)
- `dashboard/grid/marker-tooltip.component` (positioned tooltip on SVG elements)
- `dashboard/grid/row-label.component` (company/product/trial label cells)
- `dashboard/grid/row-notes.component` (right-side annotations)
- `dashboard/legend/legend.component` (marker type key)

---

## Frontend Design

### Package Changes

**New dependencies:**
- `primeng` -- component library
- `@primeng/themes` -- theming system with presets
- `tailwindcss-primeui` -- Tailwind plugin for PrimeNG semantic colors

**Removed dependencies:**
- `@fortawesome/fontawesome-free` -- replaced by PrimeNG's built-in `pi pi-*` icon set

### New Files

- `src/client/src/app/config/primeng-theme.ts` -- custom Aura preset with teal/slate palette

### Modified Files

- `src/client/src/app/app.config.ts` -- add `provideAnimationsAsync()`, `providePrimeNG()` with custom theme
- `src/client/src/styles.css` -- add `@plugin "tailwindcss-primeui"`, remove FontAwesome import
- `src/client/package.json` -- add PrimeNG deps, remove FontAwesome

### Component Migration Details

**Shared components (remove after migration):**
- `shared/components/modal/` -- replaced by `p-dialog` in each consumer
- `shared/components/multi-select/` -- replaced by `p-multiselect` in filter-panel

**Manage feature (heaviest changes):**
- All `*-list.component` files: Replace HTML tables with `p-table`, native buttons with `p-button`
- All `*-form.component` files: Replace native inputs with PrimeNG form components, native selects with `p-select`
- `trial-detail.component`: Replace section tables, forms, and action buttons

**Dashboard feature:**
- `filter-panel.component`: Replace `MultiSelectComponent` with PrimeNG `p-multiselect`, year inputs with `p-inputnumber`
- `zoom-control.component`: Replace button group with `p-selectbutton`
- `dashboard.component`: Replace custom spinner with `p-progressspinner`, error divs with `p-message`
- `row-notes.component`: Add `pTooltip` for hover preview and `p-popover` for click-to-expand full notes

**Core layout:**
- `header.component`: Replace FontAwesome icons with PrimeIcons (`pi pi-*`), minimal changes otherwise

---

## Tasks

```yaml
tasks:
  - id: T1
    title: "Install PrimeNG and configure theme preset"
    description: |
      Set up PrimeNG as a project dependency and configure the custom theme:
      1. Install primeng, @primeng/themes, tailwindcss-primeui
      2. Remove @fortawesome/fontawesome-free
      3. Create src/client/src/app/config/primeng-theme.ts with custom Aura preset:
         - Primary palette mapped to teal (50-950)
         - Surface palette mapped to slate (50-950)
         - Dark mode disabled (darkModeSelector: false)
      4. Update src/client/src/app/app.config.ts:
         - Add provideAnimationsAsync() from @angular/platform-browser/animations/async
         - Add providePrimeNG() with custom theme preset, ripple: false, cssLayer: false
      5. Update src/client/src/styles.css:
         - Add @plugin "tailwindcss-primeui"
         - Remove @import "@fortawesome/fontawesome-free/css/all.min.css"
      6. Verify the app still builds cleanly
    files:
      - modify: src/client/package.json
      - create: src/client/src/app/config/primeng-theme.ts
      - modify: src/client/src/app/app.config.ts
      - modify: src/client/src/styles.css
    dependencies: []
    verification: "cd src/client && npm install && npx ng build"

  - id: T2
    title: "Migrate header component to PrimeIcons"
    description: |
      Update the HeaderComponent to use PrimeIcons instead of FontAwesome:
      - Replace any fa-* icon classes with pi pi-* equivalents
      - Keep the existing Tailwind layout and teal/slate styling
      - Ensure the teal accent stripe and nav link styling remain unchanged
      - Verify all navigation links and sign-out button still work
    files:
      - modify: src/client/src/app/core/layout/header.component.ts
    dependencies: [T1]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T3
    title: "Migrate dashboard shell - spinner, messages, zoom control"
    description: |
      Update the DashboardComponent and ZoomControlComponent:
      1. DashboardComponent:
         - Replace custom spinner div with p-progressspinner
         - Replace error alert div with p-message severity="error"
         - Replace empty state div with p-message severity="info"
         - Keep @defer for DashboardGrid, keep all signal/resource patterns
      2. ZoomControlComponent:
         - Replace hand-built button group with p-selectbutton
         - Map zoom levels (Year, Quarter, Month, Day) as SelectButton options
         - Maintain existing output() pattern for zoom changes
      Import ButtonModule, ProgressSpinnerModule, MessageModule, SelectButtonModule.
      Use Tailwind for layout around PrimeNG components.
    files:
      - modify: src/client/src/app/features/dashboard/dashboard.component.ts
      - modify: src/client/src/app/features/dashboard/dashboard.component.html
      - modify: src/client/src/app/features/dashboard/zoom-control/zoom-control.component.ts
    dependencies: [T1]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T4
    title: "Enhance row notes with tooltip and popover"
    description: |
      Notes in dashboard grid rows can be short or very long. Currently they
      truncate with no way to see full content. Add a two-tier reveal pattern
      using PrimeNG components:

      1. Update row-notes.component:
         - Keep the truncated single-line display in the 36px row cell
         - Add pTooltip directive showing the first ~200 characters of the
           combined notes on hover (quick scan for executives)
         - Add a click handler that opens a p-popover (Popover component)
           anchored to the notes cell
         - The popover content shows:
           - Trial notes (the free-text field) at the top if present
           - Individual trial_notes entries below, each with a timestamp
           - Max-height of 300px with overflow-y-auto for very long notes
           - Max-width of 320px for comfortable reading
           - Styled with Tailwind: text-sm text-slate-700, slate borders
         - Only show the click affordance (cursor-pointer, subtle icon) when
           notes actually exist
         - Import TooltipModule and PopoverModule

      2. Update dashboard-grid.component to import the Popover module if needed
         at the grid level

      This does not change the grid layout or row height -- just adds
      interactivity to the existing notes cells.
    files:
      - modify: src/client/src/app/features/dashboard/grid/row-notes.component.ts
      - modify: src/client/src/app/features/dashboard/grid/dashboard-grid.component.ts
    dependencies: [T1]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T5
    title: "Migrate filter panel to PrimeNG MultiSelect"
    description: |
      Replace the custom MultiSelectComponent usage in FilterPanelComponent
      with PrimeNG's p-multiselect:
      1. Update filter-panel.component to import MultiSelectModule
      2. Replace each <app-multi-select> with <p-multiselect>:
         - Map options to PrimeNG's [{label, value}] format
         - Use [(ngModel)] for selected values
         - Configure placeholder, display="chip" or display="comma"
         - Set filter="true" for searchable dropdowns
         - Apply Tailwind width classes (w-44) via styleClass
      3. Replace year text inputs with p-inputnumber:
         - Use [useGrouping]="false", [min]="1990", [max]="2040"
         - Bind with [(ngModel)]
      4. Keep the flex layout with Tailwind gap/wrap utilities
      5. Maintain all existing filter signal logic and output emissions
    files:
      - modify: src/client/src/app/features/dashboard/filter-panel/filter-panel.component.ts
      - modify: src/client/src/app/features/dashboard/filter-panel/filter-panel.component.html
    dependencies: [T1]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T6
    title: "Migrate company management to PrimeNG"
    description: |
      Rewrite company-list and company-form using PrimeNG components:
      1. company-list.component:
         - Replace HTML table with p-table [value]="companies()" [tableStyle]
         - Use ng-template pTemplate="header" for thead
         - Use ng-template pTemplate="body" let-company for rows
         - Use ng-template pTemplate="emptymessage" for empty state
         - Replace action buttons with p-button [text]="true" for Edit/Delete
         - Replace "Add Company" button with p-button
         - Replace <app-modal> with p-dialog [(visible)]="modalOpen()"
         - Replace error alert with p-message
      2. company-form.component:
         - Replace text inputs with pInputText
         - Replace number input with p-inputnumber
         - Replace URL input with pInputText
         - Replace buttons with p-button
         - Replace error div with p-message
         - Keep FormsModule ngModel bindings
         - Keep signal-based state management
      3. Delete shared/components/modal/ directory (no longer needed after
         all consumers are migrated -- defer deletion to T11)
    files:
      - modify: src/client/src/app/features/manage/companies/company-list.component.ts
      - modify: src/client/src/app/features/manage/companies/company-list.component.html
      - modify: src/client/src/app/features/manage/companies/company-form.component.ts
      - modify: src/client/src/app/features/manage/companies/company-form.component.html
    dependencies: [T1]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T7
    title: "Migrate product management to PrimeNG"
    description: |
      Rewrite product-list and product-form using PrimeNG components:
      1. product-list.component:
         - Replace HTML table with p-table
         - Replace modal with p-dialog
         - Replace buttons with p-button
         - Replace error alerts with p-message
      2. product-form.component:
         - Replace text/URL inputs with pInputText
         - Replace number input with p-inputnumber
         - Replace company select dropdown with p-select
         - Replace buttons with p-button
         - Replace error div with p-message
         - Keep ngModel bindings and signal state
      Follow the same patterns established in T6 for consistency.
    files:
      - modify: src/client/src/app/features/manage/products/product-list.component.ts
      - modify: src/client/src/app/features/manage/products/product-list.component.html
      - modify: src/client/src/app/features/manage/products/product-form.component.ts
      - modify: src/client/src/app/features/manage/products/product-form.component.html
    dependencies: [T6]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T8
    title: "Migrate therapeutic area management to PrimeNG"
    description: |
      Rewrite therapeutic-area-list and therapeutic-area-form using PrimeNG:
      1. therapeutic-area-list.component:
         - Replace HTML table with p-table
         - Replace modal with p-dialog
         - Replace buttons with p-button
      2. therapeutic-area-form.component:
         - Replace text inputs with pInputText
         - Replace buttons with p-button
         - Replace error div with p-message
      Follow the same patterns established in T6/T7.
    files:
      - modify: src/client/src/app/features/manage/therapeutic-areas/therapeutic-area-list.component.ts
      - modify: src/client/src/app/features/manage/therapeutic-areas/therapeutic-area-list.component.html
      - modify: src/client/src/app/features/manage/therapeutic-areas/therapeutic-area-form.component.ts
      - modify: src/client/src/app/features/manage/therapeutic-areas/therapeutic-area-form.component.html
    dependencies: [T6]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T9
    title: "Migrate marker type management to PrimeNG"
    description: |
      Rewrite marker-type-list and marker-type-form using PrimeNG:
      1. marker-type-list.component:
         - Replace HTML table with p-table
         - Replace inline form section with p-dialog or keep inline with PrimeNG inputs
         - Replace buttons with p-button
         - Keep the color swatch preview (custom inline style)
         - Keep system marker row dimming logic
      2. marker-type-form.component:
         - Replace shape select with p-select
         - Replace fill style select with p-select
         - Replace color input with p-colorpicker
         - Replace text inputs with pInputText
         - Replace number input with p-inputnumber
         - Keep the inline SVG preview (custom, domain-specific)
         - Replace buttons with p-button
    files:
      - modify: src/client/src/app/features/manage/marker-types/marker-type-list.component.ts
      - modify: src/client/src/app/features/manage/marker-types/marker-type-list.component.html
      - modify: src/client/src/app/features/manage/marker-types/marker-type-form.component.ts
      - modify: src/client/src/app/features/manage/marker-types/marker-type-form.component.html
    dependencies: [T6]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T10
    title: "Migrate trial detail and sub-forms to PrimeNG"
    description: |
      Rewrite trial-detail, trial-form, phase-form, marker-form, note-form:
      1. trial-detail.component:
         - Replace section tables (phases, markers) with p-table
         - Replace action buttons with p-button
         - Replace inline form containers styling (keep conditional rendering)
         - Replace "Add" buttons with p-button severity="success"
         - Keep the description list (dl/dt/dd) layout for basic info display
      2. trial-form.component:
         - Replace text inputs with pInputText
         - Replace selects with p-select
         - Replace number input with p-inputnumber
         - Replace textarea with pTextarea
         - Replace buttons with p-button
      3. phase-form.component (inline template):
         - Replace select with p-select for phase type
         - Replace text input with pInputText for label
         - Replace date inputs with p-datepicker
         - Replace color input with p-colorpicker
         - Replace buttons with p-button
      4. marker-form.component (inline template):
         - Replace select with p-select for marker type
         - Replace date inputs with p-datepicker
         - Replace text/URL inputs with pInputText
         - Replace checkbox with p-checkbox
         - Replace buttons with p-button
      5. note-form.component (inline template):
         - Replace textarea with pTextarea
         - Replace buttons with p-button
    files:
      - modify: src/client/src/app/features/manage/trials/trial-detail.component.ts
      - modify: src/client/src/app/features/manage/trials/trial-detail.component.html
      - modify: src/client/src/app/features/manage/trials/trial-form.component.ts
      - modify: src/client/src/app/features/manage/trials/trial-form.component.html
      - modify: src/client/src/app/features/manage/trials/phase-form.component.ts
      - modify: src/client/src/app/features/manage/trials/marker-form.component.ts
      - modify: src/client/src/app/features/manage/trials/note-form.component.ts
    dependencies: [T6]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T11
    title: "Remove deprecated shared components and update legend icons"
    description: |
      Clean up after migration:
      1. Delete src/client/src/app/shared/components/modal/ directory
         (all consumers now use p-dialog)
      2. Delete src/client/src/app/shared/components/multi-select/ directory
         (all consumers now use p-multiselect)
      3. Update legend.component to use PrimeIcons (pi pi-*) instead of
         FontAwesome (fa-*) for any non-SVG icons in the legend display
      4. Search entire codebase for any remaining:
         - References to ModalComponent or MultiSelectComponent imports
         - FontAwesome class usage (fa-, fas-, far-, fab-)
         - Remove any orphaned imports
      5. Verify no component references the deleted shared components
    files:
      - delete: src/client/src/app/shared/components/modal/modal.component.ts
      - delete: src/client/src/app/shared/components/modal/modal.component.html
      - delete: src/client/src/app/shared/components/multi-select/multi-select.component.ts
      - delete: src/client/src/app/shared/components/multi-select/multi-select.component.html
      - modify: src/client/src/app/features/dashboard/legend/legend.component.ts
      - modify: src/client/src/app/features/dashboard/legend/legend.component.html
    dependencies: [T5, T6, T7, T8, T9, T10]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T12
    title: "Update CLAUDE.md and brand.md documentation"
    description: |
      Update project documentation to reflect PrimeNG as the component library:
      1. CLAUDE.md:
         - Update Tech Stack to mention PrimeNG
         - Update Tailwind CSS Conventions section:
           Remove "No component library" line
           Add PrimeNG conventions (use PrimeNG for interactive components,
           Tailwind for layout and custom styling)
         - Add a PrimeNG Conventions section covering:
           - Import component modules in standalone component imports array
           - Use design tokens for theming, not inline color overrides
           - Use p-button for all buttons, p-table for all data tables
           - Use p-dialog instead of custom modals
           - Prefer PrimeNG form components over native HTML inputs
         - Update Project Structure to note config/ directory
      2. brand.md:
         - Add a section noting that PrimeNG Aura preset is customized
           with teal primary and slate surface palettes
         - Note that PrimeIcons replace FontAwesome
      3. Update the existing spec (docs/specs/clinical-trial-dashboard/spec.md)
         architecture diagram to reflect PrimeNG usage
    files:
      - modify: CLAUDE.md
      - modify: docs/brand.md
    dependencies: [T11]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T13
    title: "Playwright end-to-end verification of all migrated screens"
    description: |
      Use the Playwright MCP browser tools to verify every migrated screen
      renders correctly and all interactions work after the PrimeNG migration.
      Serve the app locally (ng serve) and run through each screen:

      1. Login page:
         - Navigate to /login, verify Google sign-in button renders
      2. Dashboard:
         - Navigate to / (with auth bypass or seeded session)
         - Verify filter panel renders with 3 PrimeNG multi-selects
         - Open a multi-select, verify options appear and can be selected
         - Verify zoom control renders as PrimeNG SelectButton with 4 options
         - Click each zoom level, verify grid re-renders
         - Verify loading spinner (p-progressspinner) shows during data fetch
         - Verify timeline grid renders with phase bars and markers
         - Hover a marker, verify tooltip appears
         - Hover a notes cell, verify pTooltip shows preview text
         - Click a notes cell, verify p-popover opens with full note content
         - Verify legend renders at bottom
      3. Company management (/manage/companies):
         - Verify p-table renders with company rows
         - Click "Add Company", verify p-dialog opens
         - Fill form fields (pInputText, p-inputnumber), verify they accept input
         - Close dialog, verify it dismisses
         - Verify Edit/Delete buttons are p-button components
      4. Product management (/manage/products):
         - Verify p-table renders
         - Open add form, verify p-select for company dropdown works
         - Verify form submission flow
      5. Therapeutic area management (/manage/therapeutic-areas):
         - Verify p-table and p-dialog form flow
      6. Marker type management (/manage/marker-types):
         - Verify p-table renders with color swatches
         - Open form, verify p-select for shape/fill, p-colorpicker works
         - Verify SVG preview still renders
      7. Trial detail (/manage/trials/:id):
         - Verify basic info section renders
         - Verify phases p-table with Add/Edit/Delete
         - Open phase form, verify p-datepicker and p-colorpicker
         - Verify markers p-table
         - Open marker form, verify p-checkbox for "is projected"
         - Verify notes section with pTextarea
      8. Cross-cutting checks:
         - Verify no FontAwesome icons remain (no fa- classes in DOM)
         - Verify teal/slate theme applied (primary buttons are teal, surfaces are slate)
         - Verify keyboard navigation works on p-dialog (Escape closes)
         - Verify keyboard navigation works on p-multiselect (arrow keys, Enter)
         - Take screenshots of each major screen for visual review

      For each screen: navigate, take a snapshot, verify key elements exist,
      interact with primary controls, and report any failures.
    files: []
    dependencies: [T11]
    verification: "All Playwright browser checks pass with no console errors"
```

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| PrimeNG theme doesn't match teal/slate brand precisely | Custom Aura preset with explicit token mappings; verify visually after T1 |
| Bundle size increase from PrimeNG | PrimeNG supports tree-shaking with standalone imports; monitor build size in T1 |
| Tailwind utility conflicts with PrimeNG styles | CSS layer ordering handled natively by Tailwind v4; `tailwindcss-primeui` plugin ensures compatibility |
| p-table behavior differs from plain HTML tables | Test all list views (T6-T10) for correct rendering, empty states, and action button behavior |
| p-multiselect API differs from custom multi-select | Map existing options/selected/selectionChange pattern to PrimeNG's options/ngModel/onChange in T5 |
| FormsModule ngModel compatibility with PrimeNG | PrimeNG components support ngModel natively; no migration to reactive forms needed |
| Date picker behavior differs from native date input | Verify date format handling in phase-form and marker-form (T10); PrimeNG uses Date objects |

---

## Open Questions

None -- scope is clearly defined as a 1:1 UI component migration with no new features.
