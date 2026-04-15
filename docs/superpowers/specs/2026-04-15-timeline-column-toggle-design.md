# Timeline Column Toggle

## Summary

Add a gear icon to the far left of the timeline grid header that opens a popover with checkboxes to show/hide the MOA, ROA, and Notes columns. Column visibility persists via `sessionStorage`.

## Motivation

The timeline's left-side data columns (MOA, ROA) and right-side Notes column add useful context but consume horizontal space. Users scanning competitive landscapes may want to collapse columns they don't need to maximize timeline area. The codebase already has `showMoaColumn` and `showRoaColumn` signals with conditional rendering -- this feature adds the missing UI and extends the pattern to Notes.

## Design

### Toggleable Columns

| Column | Signal | Default | Location |
|--------|--------|---------|----------|
| MOA | `showMoaColumn` (existing) | `true` | Left frozen pane |
| ROA | `showRoaColumn` (existing) | `true` | Left frozen pane |
| Notes | `showNotesColumn` (new) | `true` | Right frozen pane |

Company, Product, and Trial are structural columns and are not toggleable.

### UI: Gear Icon

- Position: First element in the slate-800 header row, before the Company label
- Icon: PrimeNG `pi pi-cog`
- Size: 32px wide cell, icon vertically centered
- Color: `text-slate-500`, hover `text-slate-300`
- Separator: `border-right: 1px solid` using `border-slate-700` (matches existing column separators)
- Click action: Toggles a PrimeNG `p-popover` anchored below the icon

### UI: Popover

- Header: "Columns" label -- `text-[10px] uppercase tracking-widest text-slate-400` (matches header typography)
- Body: Three rows, each with a PrimeNG `p-checkbox` and text label (MOA, ROA, Notes)
- All checkboxes checked by default
- Toggling a checkbox immediately shows/hides the column (no apply/confirm button)
- Dismisses on outside click (default PrimeNG popover behavior)

### State Management

- Reuse existing `showMoaColumn = signal(true)` and `showRoaColumn = signal(true)` in `DashboardGridComponent`
- Add new `showNotesColumn = signal(true)`
- Wire checkbox `ngModel` bindings to these signals
- The Notes column template already uses responsive visibility (`hidden lg:block`); add an `@if (showNotesColumn())` guard at the same locations where MOA/ROA use `@if (showMoaColumn())` / `@if (showRoaColumn())`

### Persistence

- Storage key: `timeline-column-visibility`
- Format: `{ moa: boolean, roa: boolean, notes: boolean }`
- Write to `sessionStorage` on any toggle change
- Read from `sessionStorage` on component init; if absent, default all to `true`
- Same persistence pattern used by `LandscapeFilterBarComponent` for filter state

### Accessibility

- Gear button: `aria-label="Column settings"`, `aria-expanded` bound to popover open state
- Checkboxes: PrimeNG `p-checkbox` with `label` property provides associated labels
- Popover: Keyboard navigable by default (PrimeNG)
- No `aria-live` needed -- column visibility changes are user-initiated and visually immediate

## Scope

### In Scope

- Gear icon in grid header
- Popover with three column checkboxes
- Wiring existing MOA/ROA signals + new Notes signal
- `sessionStorage` persistence
- Accessibility attributes

### Out of Scope

- Toggling Company, Product, or Trial columns
- Column reordering or resizing
- Dedicated settings component (not justified for three checkboxes)
- Filter bar integration (user chose gear popover over filter bar placement)

## Files to Modify

- `src/client/src/app/features/dashboard/grid/dashboard-grid.component.ts` -- add `showNotesColumn` signal, persistence logic, popover state
- `src/client/src/app/features/dashboard/grid/dashboard-grid.component.html` -- add gear icon + popover in header, add `@if` guards for Notes column
