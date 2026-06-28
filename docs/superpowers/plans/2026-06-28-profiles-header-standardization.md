# Profiles Header Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize the Profiles area (companies / assets / trials, list + detail) on a pure-wayfinding topbar plus a content-area section header that carries the title/eyebrow/count/actions.

**Architecture:** Extend the existing `app-section-header` shared component to support a `detail` variant via projection slots (`[eyebrow]`, `[title]`, `[actions]`). Each of the six Profiles pages renders that header at the top of its content and stops pushing title/count/actions into `TopbarStateService`. The trial-detail special case in `app-shell` is removed so all three detail pages resolve to the same tabbed topbar.

**Tech Stack:** Angular 19 (standalone, signals, OnPush, zoneless), PrimeNG 21, Tailwind v4, Vitest (`npm run test:units`).

**Spec:** `docs/superpowers/specs/2026-06-28-profiles-header-standardization-design.md`

## Global Constraints

- Standalone components only; `ChangeDetectionStrategy.OnPush`; `inject()` DI; `input()`/`output()` (no decorators); template members `protected`; mark inputs `readonly`.
- Native control flow only (`@if`/`@for`/`@switch`); `class`/`style` bindings (never `ngClass`/`ngStyle`).
- Theme: `text-brand-*` / `bg-brand-*` only; slate/amber/etc. are data colors and stay hard-coded. Light mode only.
- No emojis, no em dashes anywhere (UI, code comments, commits).
- Tests pair with each task (no deferred test phase). Run units with `npm run test:units`.
- **ng-content projection gotcha:** a named slot attribute (`actions`, `eyebrow`, `title`) on an element placed *directly* inside an `@if` is NOT matched by `<ng-content select="[x]">`. Always wrap the `@if` inside a static slotted element (e.g. `<div actions>@if (...) { ... }</div>`). See memory `reference_ng_projection_through_if`.
- Do not remove `TopbarStateService` or its fields; out-of-scope pages still use them. Profiles pages just stop using the title/count/entity/action fields.
- Commit per task. Do not push. Do not use `--no-verify`. Do not fix unrelated issues.
- Verify with `cd src/client && ng lint && ng build`. Run `npm run test:units` for specs.

---

### Task 1: Extend `app-section-header` with a detail variant

**Files:**
- Modify: `src/client/src/app/shared/components/section-header/section-header.component.ts`
- Test (create): `src/client/src/app/shared/components/section-header/section-header.component.spec.ts`

**Interfaces:**
- Consumes: nothing (keystone task).
- Produces: `app-section-header` now accepts `variant: 'list' | 'detail'` (default `'list'`) and three projection slots: `[eyebrow]`, `[title]`, `[actions]`. List variant keeps `label`/`detail` string inputs + `[actions]`. Detail variant renders `[eyebrow]` on top, `[title]` below, `[actions]` bottom-anchored right.

- [ ] **Step 1: Write the failing test**

Create `section-header.component.spec.ts` (source-contract style, matching `public-footer.spec.ts`):

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('section-header component contract', () => {
  const src = readFileSync(join(__dirname, 'section-header.component.ts'), 'utf8');

  it('keeps the list shape: label + detail string inputs and an actions slot', () => {
    expect(src).toContain('{{ label() }}');
    expect(src).toContain('ng-content select="[actions]"');
    expect(src).toContain("readonly label = input");
  });

  it('adds a variant input defaulting to list', () => {
    expect(src).toContain("readonly variant = input<'list' | 'detail'>('list')");
  });

  it('detail variant projects an eyebrow slot and a title slot', () => {
    expect(src).toContain('ng-content select="[eyebrow]"');
    expect(src).toContain('ng-content select="[title]"');
  });

  it("switches layout on variant === 'detail'", () => {
    expect(src).toContain("variant() === 'detail'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run src/app/shared/components/section-header/section-header.component.spec.ts`
Expected: FAIL (no `variant` input, no `[eyebrow]`/`[title]` slots yet).

- [ ] **Step 3: Replace the component with the variant-aware version**

Replace the entire file `section-header.component.ts` with:

```ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Compact, consistent page-section header shared across the Intelligence-area
 * tabs and the Profiles area (companies / assets / trials).
 *
 * Two shapes from one shell:
 *  - list (default): an uppercase tracked structural label, an optional muted
 *    detail/count on the same baseline, and a right-aligned action slot.
 *  - detail: a projected eyebrow row (the parent-hierarchy crumb) on top, a
 *    projected title row (the large entity name + any inline adornments) below,
 *    and the same right-aligned action slot, bottom-anchored.
 *
 * The eyebrow and title are PROJECTION SLOTS, not string inputs, because each
 * page supplies per-page markup there (links, brand logos, MoA/route chips,
 * trial identifiers).
 *
 * List usage:
 *   <app-section-header label="Companies" detail="42">
 *     <p-button actions label="Add company" ... />
 *   </app-section-header>
 *
 * Detail usage (note: wrap any @if inside a static slotted element):
 *   <app-section-header variant="detail">
 *     <div eyebrow> ...crumb markup... </div>
 *     <div title> <h1>Eli Lilly</h1> </div>
 *     <div actions> @if (canEdit) { <p-button ... /> } </div>
 *   </app-section-header>
 */
@Component({
  selector: 'app-section-header',
  standalone: true,
  host: { class: 'block' },
  template: `
    <header
      class="flex justify-between gap-3"
      [class.items-center]="variant() === 'list'"
      [class.items-end]="variant() === 'detail'"
      [class.mb-4]="bordered()"
      [class.border-b]="bordered()"
      [class.border-slate-200]="bordered()"
      [class.pb-2.5]="bordered()"
    >
      <div class="min-w-0">
        @if (variant() === 'detail') {
          <div class="mb-1.5 flex min-w-0 items-center gap-2">
            <ng-content select="[eyebrow]" />
          </div>
          <div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <ng-content select="[title]" />
          </div>
        } @else {
          <div class="flex min-w-0 items-baseline gap-2.5">
            <h1
              class="shrink-0 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-slate-700"
            >
              {{ label() }}
            </h1>
            @if (detail()) {
              <span class="truncate text-xs text-slate-500">{{ detail() }}</span>
            }
          </div>
        }
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <ng-content select="[actions]" />
      </div>
    </header>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SectionHeaderComponent {
  /** List-shape structural label (e.g. "Companies"). Ignored in detail variant. */
  readonly label = input<string>('');
  /** List-shape muted detail/count beside the label. Ignored in detail variant. */
  readonly detail = input<string>('');
  /** Layout selector. 'list' = single baseline row; 'detail' = eyebrow + title. */
  readonly variant = input<'list' | 'detail'>('list');
  /**
   * Whether the header draws its own bottom border + spacing. Default true.
   * Hosts that already sit inside a bordered stripe set this false.
   */
  readonly bordered = input<boolean>(true);
}
```

Note: `label` was `input.required<string>()` before but only had two consumers passing it; it is now optional so the detail variant can omit it. The existing consumers (`materials-browse-page`, `intelligence-browse`) still pass `label`, so they are unaffected.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npx vitest run src/app/shared/components/section-header/section-header.component.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify existing consumers still compile and lint**

Run: `cd src/client && npx eslint src/app/shared/components/section-header/section-header.component.ts src/app/features/materials-browse/materials-browse-page.component.ts src/app/shared/components/intelligence-browse/intelligence-browse.component.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/shared/components/section-header/section-header.component.ts src/client/src/app/shared/components/section-header/section-header.component.spec.ts
git commit -m "feat(section-header): add detail variant with eyebrow/title slots"
```

---

### Task 2: Remove the trial-detail topbar special case in `app-shell`

**Files:**
- Modify: `src/client/src/app/core/layout/app-shell.component.ts` (the `pageType` computed, around line 494-520)
- Test (create): `src/client/src/app/core/layout/app-shell.pagetype.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: Profiles detail routes (`profiles/trials/:id`, `profiles/companies/:id`, `profiles/assets/:id`) all resolve to the `landscape` (tabbed) topbar. The `detail` PageType is no longer produced by any Profiles route.

- [ ] **Step 1: Write the failing test**

Create `app-shell.pagetype.spec.ts` (source-contract; asserts the special-case branch is gone):

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('app-shell pageType: profiles detail uses the tabbed topbar', () => {
  const src = readFileSync(join(__dirname, 'app-shell.component.ts'), 'utf8');

  it('no longer special-cases trial detail to the detail pageType', () => {
    // The old snowflake matched profiles/trials/:id and returned 'detail'.
    expect(src).not.toContain("route.match(/^profiles\\/trials\\/[^/]+$/)");
  });

  it('still routes profiles/* through the landscape (tabbed) branch', () => {
    expect(src).toContain("route.startsWith('profiles/')");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run src/app/core/layout/app-shell.pagetype.spec.ts`
Expected: FAIL on the first assertion (the special case still exists).

- [ ] **Step 3: Delete the special-case branch**

In `app-shell.component.ts`, inside the `pageType` computed, remove these lines:

```ts
    // Trial detail (check before profiles)
    if (route.match(/^profiles\/trials\/[^/]+$/)) {
      return 'detail';
    }
```

Leave the rest of the computed intact (the `profiles/` route still falls through to the `landscape` branch).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npx vitest run src/app/core/layout/app-shell.pagetype.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Build to confirm no dangling references**

Run: `cd src/client && npx eslint src/app/core/layout/app-shell.component.ts`
Expected: no errors. (The `'detail'` PageType union member stays; settings/other routes may still use it. Do not remove it.)

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/core/layout/app-shell.component.ts src/client/src/app/core/layout/app-shell.pagetype.spec.ts
git commit -m "fix(app-shell): unify profiles detail topbar (remove trial-detail snowflake)"
```

---

### Task 3: Companies list — content header, drop topbar wiring

**Files:**
- Modify: `src/client/src/app/features/manage/companies/company-list.component.ts` (remove `topbarActionsEffect`, `countEffect`, `ngOnDestroy` topbar clear)
- Modify: `src/client/src/app/features/manage/companies/company-list.component.html` (add `app-section-header`)
- Test (create): `src/client/src/app/features/manage/companies/company-list.header.spec.ts`

**Interfaces:**
- Consumes: `app-section-header` (Task 1).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test**

Create `company-list.header.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('companies list: header moved into content', () => {
  const ts = readFileSync(join(__dirname, 'company-list.component.ts'), 'utf8');
  const html = readFileSync(join(__dirname, 'company-list.component.html'), 'utf8');

  it('renders a content section-header labelled Companies', () => {
    expect(html).toContain('app-section-header');
    expect(html).toContain('label="Companies"');
  });

  it('projects the Add company action into the header, gated by canEdit', () => {
    expect(html).toContain('actions');
    expect(html).toContain('Add company');
    expect(html).toContain('canEdit()');
  });

  it('no longer pushes actions or record count into the topbar', () => {
    expect(ts).not.toContain('topbarState.actions.set');
    expect(ts).not.toContain('topbarState.recordCount.set');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run src/app/features/manage/companies/company-list.header.spec.ts`
Expected: FAIL (header not added; topbar setters still present).

- [ ] **Step 3: Add the header to the template**

In `company-list.component.html`, add a section-header as the first child of `<app-manage-page-shell>`, above `<app-grid-toolbar>`:

```html
<app-manage-page-shell>
  <app-section-header label="Companies" [detail]="grid.totalRecords().toString()" class="mb-3 block">
    <div actions>
      @if (spaceRole.canEdit()) {
        <p-button
          label="Add company"
          icon="fa-solid fa-plus"
          size="small"
          [text]="true"
          (onClick)="openCreateModal()"
        />
      }
    </div>
  </app-section-header>
  <app-grid-toolbar [state]="grid" searchPlaceholder="Search companies...">
    <app-export-button gridToolbarEnd [actions]="exportActions" />
  </app-grid-toolbar>
  <!-- ...rest unchanged... -->
```

- [ ] **Step 4: Update the component class**

In `company-list.component.ts`:
1. Add imports: `SectionHeaderComponent` and PrimeNG `ButtonModule` if not already imported, and add both to the component `imports` array.
2. Delete the `topbarActionsEffect` field (the whole `private readonly topbarActionsEffect = effect(...)` block).
3. Delete the `countEffect` field (the whole `private readonly countEffect = effect(...)` block).
4. In `ngOnDestroy`, remove the `this.topbarState.clear();` line. If `ngOnDestroy` is now empty, remove the method and the `OnDestroy` interface from the class declaration and its import.
5. If `topbarState`/`TopbarStateService` is now unused, remove the `inject(TopbarStateService)` line and its import. (Keep it if anything else still references it.)

- [ ] **Step 5: Run test + lint**

Run: `cd src/client && npx vitest run src/app/features/manage/companies/company-list.header.spec.ts && npx eslint src/app/features/manage/companies/company-list.component.ts`
Expected: PASS (3 tests), no lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/manage/companies/company-list.component.ts src/client/src/app/features/manage/companies/company-list.component.html src/client/src/app/features/manage/companies/company-list.header.spec.ts
git commit -m "feat(companies): move list header + Add company into content"
```

---

### Task 4: Company detail — fold the card header into `app-section-header`

**Files:**
- Modify: `src/client/src/app/features/manage/companies/company-detail.component.ts` (replace `overflowEffect`, add entity menu signal, drop topbar wiring)
- Modify: `src/client/src/app/features/manage/companies/company-detail.component.html` (replace the `<header>` card with the section-header)
- Test (create): `src/client/src/app/features/manage/companies/company-detail.header.spec.ts`

**Interfaces:**
- Consumes: `app-section-header` (Task 1); existing `buildEntityActionMenu`, `RowActionsComponent`.
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test**

Create `company-detail.header.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('company detail: header + actions in content', () => {
  const ts = readFileSync(join(__dirname, 'company-detail.component.ts'), 'utf8');
  const html = readFileSync(join(__dirname, 'company-detail.component.html'), 'utf8');

  it('uses the detail-variant section-header', () => {
    expect(html).toContain('app-section-header');
    expect(html).toContain('variant="detail"');
  });

  it('renders Add asset and the entity kebab in the header actions slot', () => {
    expect(html).toContain('Add asset');
    expect(html).toContain('app-row-actions');
  });

  it('builds the entity menu locally instead of pushing to the topbar', () => {
    expect(ts).toContain('buildEntityActionMenu');
    expect(ts).not.toContain('topbarState.overflowActions.set');
    expect(ts).not.toContain('topbarState.actions.set');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run src/app/features/manage/companies/company-detail.header.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Replace the topbar effect with a local entity-menu computed**

In `company-detail.component.ts`:
1. Replace the `overflowEffect` (the `private readonly overflowEffect = effect(() => { ... })` block at lines ~134-173) with a computed that builds the same menu locally:

```ts
  // Entity overflow menu (Edit details / View assets / Delete), rendered in the
  // content section-header instead of the topbar. Empty for viewers.
  protected readonly entityMenu = computed<MenuItem[]>(() => {
    const company = this.company();
    if (!company || !this.spaceRole.canEdit()) return [];
    return buildEntityActionMenu({
      canEdit: true,
      editLabel: 'Edit details',
      onEdit: () => this.editingCompany.set(true),
      onDelete: () => void this.deleteCompany(company),
      extras: [
        {
          label: 'View assets',
          icon: 'fa-solid fa-box',
          command: () =>
            this.router.navigate(
              ['/t', this.tenantIdSig(), 's', this.spaceIdSig(), 'profiles', 'assets'],
              {
                queryParams: buildFilterQueryParams({
                  companyName: { kind: 'text', contains: company.name },
                }),
              }
            ),
        },
      ],
    });
  });
```

2. In `ngOnDestroy`, remove the two `this.topbarState.*.set([])` lines. If the method body is now empty, remove the method, the `OnDestroy` interface, and its import.
3. Remove the `inject(TopbarStateService)` line and import if `topbarState` is now otherwise unused.
4. Ensure `computed` and `MenuItem` (from `primeng/api`) are imported.

- [ ] **Step 4: Replace the card header in the template**

In `company-detail.component.html`, replace the existing `<header class="mb-4 border ...">...</header>` block (lines ~9-39) with a detail-variant section-header that preserves the eyebrow + title and adds actions:

```html
    <app-section-header variant="detail" class="mb-4 block">
      <div eyebrow class="font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-slate-500">
        <span class="text-slate-400">Company</span>
        @if ((c.assets?.length ?? 0) > 0) {
          <span class="tabular-nums text-slate-500">
            &middot; {{ c.assets?.length }} {{ c.assets?.length === 1 ? 'asset' : 'assets' }}
          </span>
        }
      </div>
      <div title class="flex items-center gap-3">
        @if (c.logo_url) {
          <app-brand-logo
            [url]="c.logo_url"
            [alt]="c.name + ' logo'"
            [width]="128"
            [height]="24"
            imgClass="h-6 w-auto max-w-[8rem] object-contain"
          />
        }
        <h1 class="text-lg font-bold tracking-[-0.01em] text-slate-900">{{ c.name }}</h1>
      </div>
      <div actions>
        @if (spaceRole.canEdit()) {
          <p-button
            label="Add asset"
            icon="fa-solid fa-plus"
            size="small"
            [text]="true"
            (onClick)="creatingAsset.set(true)"
          />
          <app-row-actions [items]="entityMenu()" ariaLabel="Company actions" />
        }
      </div>
    </app-section-header>
    <div class="mt-1.5 mb-4">
      <app-source-provenance-line [sourceDocId]="c.source_doc_id" [canView]="spaceRole.canEdit()" />
    </div>
```

(The `app-source-provenance-line` previously lived inside the card; keep it directly below the header.)

5. Add `SectionHeaderComponent`, `ButtonModule`, and `RowActionsComponent` to the component `imports` array if not already present (`RowActionsComponent` is already imported in the TS for the topbar; keep it).

- [ ] **Step 5: Run test + lint**

Run: `cd src/client && npx vitest run src/app/features/manage/companies/company-detail.header.spec.ts && npx eslint src/app/features/manage/companies/company-detail.component.ts`
Expected: PASS (3 tests), no lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/manage/companies/company-detail.component.ts src/client/src/app/features/manage/companies/company-detail.component.html src/client/src/app/features/manage/companies/company-detail.header.spec.ts
git commit -m "feat(companies): move detail header + entity actions into content"
```

---

### Task 5: Assets list — content header, drop topbar wiring

**Files:**
- Modify: `src/client/src/app/features/manage/assets/asset-list.component.ts`
- Modify: `src/client/src/app/features/manage/assets/asset-list.component.html`
- Test (create): `src/client/src/app/features/manage/assets/asset-list.header.spec.ts`

**Interfaces:**
- Consumes: `app-section-header` (Task 1).

- [ ] **Step 1: Write the failing test**

Create `asset-list.header.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('assets list: header moved into content', () => {
  const ts = readFileSync(join(__dirname, 'asset-list.component.ts'), 'utf8');
  const html = readFileSync(join(__dirname, 'asset-list.component.html'), 'utf8');

  it('renders a content section-header labelled Assets', () => {
    expect(html).toContain('app-section-header');
    expect(html).toContain('label="Assets"');
  });

  it('projects the Add asset action into the header, gated by canEdit', () => {
    expect(html).toContain('actions');
    expect(html).toContain('Add asset');
    expect(html).toContain('canEdit()');
  });

  it('no longer pushes actions or record count into the topbar', () => {
    expect(ts).not.toContain('topbarState.actions.set');
    expect(ts).not.toContain('topbarState.recordCount.set');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run src/app/features/manage/assets/asset-list.header.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Add the header to the template**

In `asset-list.component.html`, add as the first child of `<app-manage-page-shell>`, above the grid toolbar (mirror Task 3, using the asset grid's record count and the existing create handler). Use the same structure:

```html
  <app-section-header label="Assets" [detail]="grid.totalRecords().toString()" class="mb-3 block">
    <div actions>
      @if (spaceRole.canEdit()) {
        <p-button
          label="Add asset"
          icon="fa-solid fa-plus"
          size="small"
          [text]="true"
          (onClick)="openCreateModal()"
        />
      }
    </div>
  </app-section-header>
```

Check the actual create handler name in `asset-list.component.ts` (it mirrors company-list's `openCreateModal()`; if the asset page names it differently, use that name) and the actual grid total accessor (`grid.totalRecords()`).

- [ ] **Step 4: Update the component class**

In `asset-list.component.ts`, mirror Task 3 Step 4: add `SectionHeaderComponent` + `ButtonModule` to imports; delete the topbar `actions` effect and the `recordCount` effect; remove `topbarState.clear()` from `ngOnDestroy` (and the method/interface/inject if now unused).

- [ ] **Step 5: Run test + lint**

Run: `cd src/client && npx vitest run src/app/features/manage/assets/asset-list.header.spec.ts && npx eslint src/app/features/manage/assets/asset-list.component.ts`
Expected: PASS (3 tests), no lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/manage/assets/asset-list.component.ts src/client/src/app/features/manage/assets/asset-list.component.html src/client/src/app/features/manage/assets/asset-list.header.spec.ts
git commit -m "feat(assets): move list header + Add asset into content"
```

---

### Task 6: Asset detail — fold card header into `app-section-header`

**Files:**
- Modify: `src/client/src/app/features/manage/assets/asset-detail.component.ts`
- Modify: `src/client/src/app/features/manage/assets/asset-detail.component.html` (header block lines ~9-55)
- Test (create): `src/client/src/app/features/manage/assets/asset-detail.header.spec.ts`

**Interfaces:**
- Consumes: `app-section-header` (Task 1); existing `buildEntityActionMenu`, `RowActionsComponent`.

- [ ] **Step 1: Write the failing test**

Create `asset-detail.header.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('asset detail: header + actions in content', () => {
  const ts = readFileSync(join(__dirname, 'asset-detail.component.ts'), 'utf8');
  const html = readFileSync(join(__dirname, 'asset-detail.component.html'), 'utf8');

  it('uses the detail-variant section-header', () => {
    expect(html).toContain('app-section-header');
    expect(html).toContain('variant="detail"');
  });

  it('keeps the company crumb link in the eyebrow slot', () => {
    expect(html).toContain('eyebrow');
    expect(html).toContain("'companies'");
  });

  it('renders the entity kebab in the header and stops pushing to the topbar', () => {
    expect(html).toContain('app-row-actions');
    expect(ts).not.toContain('topbarState.overflowActions.set');
    expect(ts).not.toContain('topbarState.entityTitle.set');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run src/app/features/manage/assets/asset-detail.header.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Replace topbar effect with a local entity-menu computed**

In `asset-detail.component.ts`, mirror Task 4 Step 3: replace the topbar overflow/entity effect with a `protected readonly entityMenu = computed<MenuItem[]>(...)` built from `buildEntityActionMenu` (preserve whatever edit/delete/extras the asset page currently passes). Remove all `topbarState.*.set(...)` calls (`entityTitle`, `entityContext`, `overflowActions`, any `actions`). Remove `topbarState.clear()` from `ngOnDestroy` and the inject/import if now unused. Ensure `computed` and `MenuItem` are imported.

- [ ] **Step 4: Replace the card header in the template**

In `asset-detail.component.html`, replace the `<header class="mb-4 border ...">...</header>` block (lines ~9-55) with a detail-variant section-header. Move the EXISTING eyebrow markup (the `@if (p.companies; as co) { <a routerLink=...>{{ co.name }}</a> / } <span>Asset</span>` block, lines ~10-32) verbatim into a `<div eyebrow ...>` slot, and the EXISTING title markup (the logo + `<h1>{{ p.name }}</h1>` + generic_name + MoA chips + route chips block, lines ~33-55) verbatim into a `<div title ...>` slot. Add the actions slot:

```html
      <div actions>
        @if (spaceRole.canEdit()) {
          <app-row-actions [items]="entityMenu()" ariaLabel="Asset actions" />
        }
      </div>
```

If the asset detail had a primary "Add ..." button in the topbar previously (check the old `topbarState.actions.set`), add it before `app-row-actions` in the actions slot using the same handler. Add `SectionHeaderComponent`, `ButtonModule`, `RowActionsComponent` to imports.

- [ ] **Step 5: Run test + lint**

Run: `cd src/client && npx vitest run src/app/features/manage/assets/asset-detail.header.spec.ts && npx eslint src/app/features/manage/assets/asset-detail.component.ts`
Expected: PASS (3 tests), no lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/manage/assets/asset-detail.component.ts src/client/src/app/features/manage/assets/asset-detail.component.html src/client/src/app/features/manage/assets/asset-detail.header.spec.ts
git commit -m "feat(assets): move detail header + entity actions into content"
```

---

### Task 7: Trials list — content header, drop topbar wiring

**Files:**
- Modify: `src/client/src/app/features/manage/trials/trial-list.component.ts`
- Modify: `src/client/src/app/features/manage/trials/trial-list.component.html`
- Test (create): `src/client/src/app/features/manage/trials/trial-list.header.spec.ts`

**Interfaces:**
- Consumes: `app-section-header` (Task 1).

- [ ] **Step 1: Write the failing test**

Create `trial-list.header.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('trials list: header moved into content', () => {
  const ts = readFileSync(join(__dirname, 'trial-list.component.ts'), 'utf8');
  const html = readFileSync(join(__dirname, 'trial-list.component.html'), 'utf8');

  it('renders a content section-header labelled Trials', () => {
    expect(html).toContain('app-section-header');
    expect(html).toContain('label="Trials"');
  });

  it('projects the Add trial action into the header, gated by canEdit', () => {
    expect(html).toContain('actions');
    expect(html).toContain('Add trial');
    expect(html).toContain('canEdit()');
  });

  it('no longer pushes actions or record count into the topbar', () => {
    expect(ts).not.toContain('topbarState.actions.set');
    expect(ts).not.toContain('topbarState.recordCount.set');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run src/app/features/manage/trials/trial-list.header.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Add the header to the template**

In `trial-list.component.html`, add as the first child of `<app-manage-page-shell>`, above the grid toolbar (mirror Task 3). Use `label="Trials"`, `[detail]="grid.totalRecords().toString()"`, and the trial page's existing create handler for `Add trial` (check the name in `trial-list.component.ts`).

- [ ] **Step 4: Update the component class**

In `trial-list.component.ts`, mirror Task 3 Step 4: add `SectionHeaderComponent` + `ButtonModule` to imports; delete the topbar `actions` effect and the `recordCount` effect; remove `topbarState.clear()` from `ngOnDestroy` (and the method/interface/inject if now unused).

- [ ] **Step 5: Run test + lint**

Run: `cd src/client && npx vitest run src/app/features/manage/trials/trial-list.header.spec.ts && npx eslint src/app/features/manage/trials/trial-list.component.ts`
Expected: PASS (3 tests), no lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/manage/trials/trial-list.component.ts src/client/src/app/features/manage/trials/trial-list.component.html src/client/src/app/features/manage/trials/trial-list.header.spec.ts
git commit -m "feat(trials): move list header + Add trial into content"
```

---

### Task 8: Trial detail — fold card header into `app-section-header`

**Files:**
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.ts` (the `topbarState.*` effect around lines 143-156; `ngOnDestroy` line ~776)
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.html` (eyebrow/title header block lines ~9-120)
- Test (create): `src/client/src/app/features/manage/trials/trial-detail.header.spec.ts`

**Interfaces:**
- Consumes: `app-section-header` (Task 1); existing `buildEntityActionMenu`, `RowActionsComponent`.

- [ ] **Step 1: Write the failing test**

Create `trial-detail.header.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('trial detail: header + actions in content', () => {
  const ts = readFileSync(join(__dirname, 'trial-detail.component.ts'), 'utf8');
  const html = readFileSync(join(__dirname, 'trial-detail.component.html'), 'utf8');

  it('uses the detail-variant section-header', () => {
    expect(html).toContain('app-section-header');
    expect(html).toContain('variant="detail"');
  });

  it('keeps the company / asset hierarchy crumb in the eyebrow slot', () => {
    expect(html).toContain('eyebrow');
    expect(html).toContain("'companies'");
    expect(html).toContain("'assets'");
  });

  it('renders the entity kebab in the header and stops pushing to the topbar', () => {
    expect(html).toContain('app-row-actions');
    expect(ts).not.toContain('topbarState.overflowActions.set');
    expect(ts).not.toContain('topbarState.entityTitle.set');
    expect(ts).not.toContain('topbarState.entityContext.set');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run src/app/features/manage/trials/trial-detail.header.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Replace topbar effect with a local entity-menu computed**

In `trial-detail.component.ts`, replace the effect that sets `entityTitle`/`entityContext`/`overflowActions` (lines ~143-156) with a `protected readonly entityMenu = computed<MenuItem[]>(...)` built from `buildEntityActionMenu`, preserving the trial page's current edit/delete/extras. Remove every `topbarState.*.set(...)` call. Remove `topbarState.clear()` from `ngOnDestroy` (line ~776) and the inject/import if now unused. Ensure `computed` and `MenuItem` are imported.

- [ ] **Step 4: Replace the card header in the template**

In `trial-detail.component.html`, replace the entity header block (the eyebrow crumb `{Company} / {Asset} / Trial` at lines ~9-81 plus the title `<h1>` and identifier/status adornments below it, through ~line 120) with a detail-variant section-header. Move the EXISTING crumb markup (lines ~46-81, the `@if (t.assets ...) { ... companies ... assets ... } <span>Trial</span>` block) verbatim into `<div eyebrow ...>`, and the EXISTING title markup (the `<h1>` + NCT identifier link + status chips) verbatim into `<div title ...>`. Add the actions slot:

```html
      <div actions>
        @if (spaceRole.canEdit()) {
          <app-row-actions [items]="entityMenu()" ariaLabel="Trial actions" />
        }
      </div>
```

Add `SectionHeaderComponent`, `ButtonModule`, `RowActionsComponent` to imports. Preserve all the other detail-page sections below the header (markers, timeline, etc.) unchanged.

- [ ] **Step 5: Run test + lint**

Run: `cd src/client && npx vitest run src/app/features/manage/trials/trial-detail.header.spec.ts && npx eslint src/app/features/manage/trials/trial-detail.component.ts`
Expected: PASS (3 tests), no lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/manage/trials/trial-detail.component.ts src/client/src/app/features/manage/trials/trial-detail.component.html src/client/src/app/features/manage/trials/trial-detail.header.spec.ts
git commit -m "feat(trials): move detail header + entity actions into content"
```

---

### Task 9: Full verification + manual browser pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit suite**

Run: `cd src/client && npm run test:units`
Expected: PASS, including all 8 new spec files.

- [ ] **Step 2: Lint + build the whole client**

Run: `cd src/client && ng lint && ng build`
Expected: no lint errors; build succeeds.

- [ ] **Step 3: Manual browser verification**

Serve locally and inject a local-Supabase session (see memory `reference_playwright_local_auth_export_verify`; never Google-login locally). Visit all six Profiles surfaces and confirm:
- Identical topbar on every page: breadcrumb + `Profiles` + `Companies / Assets / Trials` tabs + palette hint + colophon. No action buttons, no kebab, no back button, no entity title in the topbar.
- Each list page shows the content header (label + count + `Add X`).
- Each detail page shows the content header (hierarchy crumb eyebrow + title + count + actions). Trial detail shows the same tabbed topbar as company/asset detail (no `detail` back-button layout).
- Hierarchy-crumb links navigate up the tree; clicking the active topbar tab returns to the grid.
- As a viewer role, no action buttons appear (only crumb/title/count).

- [ ] **Step 4: Final confirmation**

Report results with the actual command output. Do not push; the user merges per their workflow.

---

## Self-Review

**Spec coverage:**
- Pure-wayfinding topbar -> Task 2 (remove snowflake) + Tasks 3-8 (stop feeding topbar). Covered.
- Content section-header (list + detail shapes) -> Task 1 (component) + Tasks 3-8 (usage). Covered.
- Hierarchy crumb as eyebrow, no back link -> Tasks 6 + 8 move existing crumb into `[eyebrow]`; no back link added. Covered.
- Extend (not fork) `app-section-header` -> Task 1. Covered.
- Scroll non-sticky (1a) -> nothing to build (header is in normal flow); no task needed. Covered by omission.
- Viewer-role gating -> every usage gates the actions slot on `canEdit()`. Covered.
- Reuse `buildEntityActionMenu` -> Tasks 4, 6, 8. Covered.
- Tests paired per task -> each task has a spec. Covered.
- Out-of-scope pages untouched / `TopbarStateService` retained -> only Profiles pages modified; service kept. Covered.

**Placeholder scan:** Tasks 5-8 say "mirror Task 3/4" but each repeats the concrete header markup and the exact class-edit steps; line references and handler-name checks are explicit. No TBD/TODO. Acceptable.

**Type consistency:** `entityMenu` is `computed<MenuItem[]>` in Tasks 4/6/8; `variant` input is `'list' | 'detail'` consistently; slot attributes `eyebrow`/`title`/`actions` match the component's `ng-content select` in Task 1. Consistent.
