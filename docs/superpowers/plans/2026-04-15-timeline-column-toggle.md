# Timeline Column Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a gear icon to the timeline grid header that opens a popover with checkboxes to show/hide MOA, ROA, and Notes columns, with sessionStorage persistence.

**Architecture:** Extend `DashboardGridComponent` with a `showNotesColumn` signal (MOA/ROA signals already exist), a gear icon + PrimeNG popover in the header, and an `effect()` for sessionStorage persistence. No new components or services needed.

**Tech Stack:** Angular 19 signals, PrimeNG Popover + Checkbox, sessionStorage

---

### Task 1: Add showNotesColumn signal and sessionStorage persistence

**Files:**
- Modify: `src/client/src/app/features/dashboard/grid/dashboard-grid.component.ts`

- [ ] **Step 1: Add imports for FormsModule, Popover, Checkbox, and Angular effect**

Add these imports to the top of `dashboard-grid.component.ts`:

```typescript
import { FormsModule } from '@angular/forms';
import { Popover } from 'primeng/popover';
import { Checkbox } from 'primeng/checkbox';
```

Update the `effect` import from `@angular/core`:

```typescript
import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  AfterViewInit,
  OnDestroy,
} from '@angular/core';
```

Add to the `imports` array in `@Component`:

```typescript
imports: [
  ButtonModule,
  FormsModule,
  GridHeaderComponent,
  PhaseBarComponent,
  MarkerComponent,
  RowNotesComponent,
  Popover,
  Checkbox,
],
```

- [ ] **Step 2: Add showNotesColumn signal and persistence constants**

Add after line 70 (`showRoaColumn = signal(true);`):

```typescript
showNotesColumn = signal(true);
```

Add a private constant and persistence logic. After the `scrollRafId` declaration (line 55), add:

```typescript
private static readonly STORAGE_KEY = 'timeline-column-visibility';
```

Add a constructor that restores persisted state and sets up the persistence effect:

```typescript
constructor() {
  // Restore persisted column visibility
  try {
    const raw = sessionStorage.getItem(DashboardGridComponent.STORAGE_KEY);
    if (raw) {
      const saved: { moa?: boolean; roa?: boolean; notes?: boolean } = JSON.parse(raw);
      if (saved.moa !== undefined) this.showMoaColumn.set(saved.moa);
      if (saved.roa !== undefined) this.showRoaColumn.set(saved.roa);
      if (saved.notes !== undefined) this.showNotesColumn.set(saved.notes);
    }
  } catch {
    // Corrupt data -- ignore and start fresh.
  }

  // Auto-persist on any change
  effect(() => {
    const state = {
      moa: this.showMoaColumn(),
      roa: this.showRoaColumn(),
      notes: this.showNotesColumn(),
    };
    try {
      sessionStorage.setItem(DashboardGridComponent.STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage full or unavailable -- silently ignore.
    }
  });
}
```

- [ ] **Step 3: Remove the old toggleMoaColumn and toggleRoaColumn methods**

Delete these methods (lines 162-168) since the checkboxes will bind directly to the signals:

```typescript
// DELETE these:
toggleMoaColumn(value: boolean): void {
  this.showMoaColumn.set(value);
}

toggleRoaColumn(value: boolean): void {
  this.showRoaColumn.set(value);
}
```

- [ ] **Step 4: Verify no callers of the deleted toggle methods**

Run: `cd src/client && grep -r "toggleMoaColumn\|toggleRoaColumn" src/`

Expected: No matches (these methods were never wired to UI).

- [ ] **Step 5: Build to verify TypeScript compiles**

Run: `cd src/client && npx ng build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/dashboard/grid/dashboard-grid.component.ts
git commit -m "feat: add showNotesColumn signal and sessionStorage persistence for column visibility"
```

---

### Task 2: Add gear icon and popover to the grid header template

**Files:**
- Modify: `src/client/src/app/features/dashboard/grid/dashboard-grid.component.html`

- [ ] **Step 1: Add gear icon as first element in the header row**

In `dashboard-grid.component.html`, inside the header row `<div class="flex border-b border-slate-300 bg-slate-800 h-8 items-center">` (line 17), add the gear icon as the first child, before the Company div:

```html
        <!-- Column settings toggle -->
        <button
          type="button"
          class="flex-none w-8 h-8 flex items-center justify-center text-slate-500 hover:text-slate-300 border-r border-slate-700 transition-colors"
          aria-label="Column settings"
          [attr.aria-expanded]="columnSettingsOpen"
          (click)="columnSettingsPanel.toggle($event)"
        >
          <i class="pi pi-cog text-xs"></i>
        </button>
```

- [ ] **Step 2: Add the popover panel after the header row closing div**

Add the popover right after the header row's closing `</div>` (after line 50, before the `@if (hasSubColumns())` block):

```html
        <p-popover #columnSettingsPanel ariaLabel="Column visibility settings" (onShow)="columnSettingsOpen = true" (onHide)="columnSettingsOpen = false">
          <div class="flex flex-col gap-2 p-1">
            <span class="text-[10px] font-bold uppercase tracking-widest text-slate-400">Columns</span>
            <div class="flex items-center gap-2">
              <p-checkbox
                [(ngModel)]="showMoaColumn"
                [binary]="true"
                inputId="col-moa"
                size="small"
              />
              <label for="col-moa" class="text-sm text-slate-700 cursor-pointer">MOA</label>
            </div>
            <div class="flex items-center gap-2">
              <p-checkbox
                [(ngModel)]="showRoaColumn"
                [binary]="true"
                inputId="col-roa"
                size="small"
              />
              <label for="col-roa" class="text-sm text-slate-700 cursor-pointer">ROA</label>
            </div>
            <div class="flex items-center gap-2">
              <p-checkbox
                [(ngModel)]="showNotesColumn"
                [binary]="true"
                inputId="col-notes"
                size="small"
              />
              <label for="col-notes" class="text-sm text-slate-700 cursor-pointer">Notes</label>
            </div>
          </div>
        </p-popover>
```

- [ ] **Step 3: Add the columnSettingsOpen tracking property to the component class**

In `dashboard-grid.component.ts`, add after the `showNotesColumn` signal:

```typescript
columnSettingsOpen = false;
```

- [ ] **Step 4: Build to verify template compiles**

Run: `cd src/client && npx ng build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/dashboard/grid/dashboard-grid.component.ts src/client/src/app/features/dashboard/grid/dashboard-grid.component.html
git commit -m "feat: add gear icon and column settings popover to timeline header"
```

---

### Task 3: Add @if guards for the Notes column

**Files:**
- Modify: `src/client/src/app/features/dashboard/grid/dashboard-grid.component.html`

- [ ] **Step 1: Wrap the entire Notes column block with @if guard**

The Notes column starts at line 294 with the comment `<!-- Notes column (hidden below lg) -->`. Wrap the existing `@if (flattenedTrials().length > 0)` block so it also checks `showNotesColumn()`:

Replace:
```html
    <!-- Notes column (hidden below lg) -->
    @if (flattenedTrials().length > 0) {
      <div class="hidden lg:block flex-none w-48 bg-white border-l border-slate-200">
```

With:
```html
    <!-- Notes column (hidden below lg) -->
    @if (showNotesColumn() && flattenedTrials().length > 0) {
      <div class="hidden lg:block flex-none w-48 bg-white border-l border-slate-200">
```

No other template changes needed -- the Notes column is a single contiguous block.

- [ ] **Step 2: Add gear icon spacer to the sub-columns row**

The sub-columns row (the `@if (hasSubColumns())` block) needs a spacer div for the gear icon column to keep alignment. Add as the first child inside the sub-columns flex div:

After `<div class="flex border-b border-slate-200 bg-slate-100">`, add:
```html
            <div class="w-8 flex-none">&nbsp;</div>
```

- [ ] **Step 3: Add gear icon spacer to each data row**

Each data row in the left frozen pane also needs a spacer. Inside the `@for (row of flattenedTrials()...)` loop for the left pane (line 83), add as the first child inside the flex row div:

After the opening `<div class="flex border-slate-200" ...>` (around line 85-93), add:
```html
            <div class="w-8 flex-none" aria-hidden="true"></div>
```

- [ ] **Step 4: Build and verify**

Run: `cd src/client && npx ng build 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 5: Lint**

Run: `cd src/client && npx ng lint 2>&1 | tail -5`

Expected: Lint passes.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/dashboard/grid/dashboard-grid.component.html
git commit -m "feat: add Notes column toggle guard and gear icon alignment spacers"
```

---

### Task 4: Visual verification

- [ ] **Step 1: Start the dev server**

Run: `cd src/client && npx ng serve`

- [ ] **Step 2: Verify gear icon appearance**

Open the timeline view in a browser. Confirm:
- Gear icon appears as the first element in the slate-800 header bar
- Icon is `text-slate-500` and changes to `text-slate-300` on hover
- It has a right border separator matching the column dividers

- [ ] **Step 3: Verify popover behavior**

Click the gear icon. Confirm:
- Popover opens below the icon
- Shows "COLUMNS" label with MOA, ROA, Notes checkboxes
- All three are checked by default
- Popover dismisses on outside click

- [ ] **Step 4: Verify column toggling**

Uncheck MOA. Confirm:
- MOA column disappears from header and all data rows
- Other columns shift to fill the space
- No layout breakage

Repeat for ROA and Notes.

- [ ] **Step 5: Verify sessionStorage persistence**

Uncheck MOA and ROA. Refresh the page. Confirm:
- MOA and ROA columns remain hidden after refresh
- The gear popover shows MOA and ROA unchecked

- [ ] **Step 6: Verify alignment**

With sub-columns visible (quarterly or monthly zoom), confirm:
- The gear icon spacer in the sub-column row keeps alignment correct
- Data row spacers keep all columns aligned with headers
