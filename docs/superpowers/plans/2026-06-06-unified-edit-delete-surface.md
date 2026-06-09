# Unified edit/delete surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Edit and Delete through one shared `app-row-actions` kebab, present identically in every entity's grid row and its detail-page/panel header, so an entity can be fully managed without leaving its detail view.

**Architecture:** A generic pure builder (`buildEntityActionMenu`) returns the `MenuItem[]` (extras + Edit + separator + Delete) consumed by both grid and detail surfaces. A shared `runEntityDelete` orchestrator runs the identical preview -> confirm -> delete -> toast -> onSuccess flow; grid passes onSuccess=reload, detail passes onSuccess=navigate-to-parent-list. The global topbar gains an `overflowActions` kebab so detail headers render the same idiom as grid rows.

**Tech Stack:** Angular 19 (standalone, signals, OnPush), PrimeNG 21 (`p-menu` via `app-row-actions`), Vitest, Supabase services.

**Spec:** `docs/superpowers/specs/2026-06-06-unified-edit-delete-surface-design.md`

---

## File structure

- Create `src/client/src/app/shared/entity-actions/entity-action-menu.ts` — `buildEntityActionMenu()` pure builder.
- Create `src/client/src/app/shared/entity-actions/entity-action-menu.spec.ts`.
- Create `src/client/src/app/shared/entity-actions/run-entity-delete.ts` — `runEntityDelete()` orchestrator.
- Create `src/client/src/app/shared/entity-actions/run-entity-delete.spec.ts`.
- Modify `src/client/src/app/core/services/topbar-state.service.ts` — add `overflowActions`.
- Modify `src/client/src/app/core/layout/contextual-topbar.component.ts` — render overflow kebab.
- Modify `src/client/src/app/core/layout/app-shell.component.ts` — bind `overflowActions`.
- Modify company / asset / trial list + detail components and the event detail panel + events page.

Reusable primitives already present: `app-row-actions` (`shared/components/row-actions.component.ts`), `confirmDelete()` + `DeleteCountBreakdown` (`shared/utils/confirm-delete.ts`), each service's `previewDelete()` / `delete()`, `SpaceRoleService.canEdit()`, `TopbarStateService`.

---

### Task 1: Shared action-menu builder

**Files:**
- Create: `src/client/src/app/shared/entity-actions/entity-action-menu.ts`
- Test: `src/client/src/app/shared/entity-actions/entity-action-menu.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { buildEntityActionMenu } from './entity-action-menu';

describe('buildEntityActionMenu', () => {
  it('returns only extras when canEdit is false', () => {
    const extra = { label: 'View assets', icon: 'fa-solid fa-box', command: vi.fn() };
    const items = buildEntityActionMenu({
      canEdit: false,
      editLabel: 'Edit',
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      extras: [extra],
    });
    expect(items).toEqual([extra]);
  });

  it('appends Edit, separator and danger Delete when canEdit is true', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const items = buildEntityActionMenu({ canEdit: true, editLabel: 'Edit details', onEdit, onDelete });

    expect(items.map((i) => i.label ?? (i.separator ? 'SEP' : ''))).toEqual([
      'Edit details',
      'SEP',
      'Delete',
    ]);
    const del = items[2];
    expect(del.styleClass).toBe('row-actions-danger');

    items[0].command?.({} as never);
    items[2].command?.({} as never);
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('places extras before the edit/delete block', () => {
    const extra = { label: 'View trials', icon: 'fa-solid fa-flask', command: vi.fn() };
    const items = buildEntityActionMenu({
      canEdit: true,
      editLabel: 'Edit',
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      extras: [extra],
    });
    expect(items[0]).toBe(extra);
    expect(items[1].label).toBe('Edit');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run src/app/shared/entity-actions/entity-action-menu.spec.ts`
Expected: FAIL — cannot find module `./entity-action-menu`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { MenuItem } from 'primeng/api';

export interface EntityActionMenuOptions {
  /** When false, Edit and Delete are omitted (viewer role). */
  readonly canEdit: boolean;
  /** Label for the edit item, e.g. 'Edit' (grid) or 'Edit details' (detail). */
  readonly editLabel: string;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  /** Entity-specific navigation items rendered before the edit/delete block. */
  readonly extras?: MenuItem[];
}

/**
 * Build the shared overflow-menu item list used by both an entity's grid row
 * and its detail-page header. Keeps the two surfaces byte-for-byte identical.
 * Destructive item carries `row-actions-danger` so the shared CSS colors it red.
 */
export function buildEntityActionMenu(opts: EntityActionMenuOptions): MenuItem[] {
  const items: MenuItem[] = [...(opts.extras ?? [])];
  if (!opts.canEdit) return items;
  items.push(
    { label: opts.editLabel, icon: 'fa-solid fa-pen', command: () => opts.onEdit() },
    { separator: true },
    {
      label: 'Delete',
      icon: 'fa-solid fa-trash',
      styleClass: 'row-actions-danger',
      command: () => opts.onDelete(),
    }
  );
  return items;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npx vitest run src/app/shared/entity-actions/entity-action-menu.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/shared/entity-actions/entity-action-menu.ts src/client/src/app/shared/entity-actions/entity-action-menu.spec.ts
git commit -m "Add shared entity action-menu builder"
```

---

### Task 2: Shared delete orchestrator

**Files:**
- Create: `src/client/src/app/shared/entity-actions/run-entity-delete.ts`
- Test: `src/client/src/app/shared/entity-actions/run-entity-delete.spec.ts`

Centralizes the preview -> confirm -> delete -> toast -> onSuccess/onError flow currently duplicated across list components. The caller supplies an optional `preview` (for cascade counts), the `confirm` options, the `delete` call, and `onSuccess`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { runEntityDelete } from './run-entity-delete';

vi.mock('../utils/confirm-delete', () => ({ confirmDelete: vi.fn() }));
import { confirmDelete } from '../utils/confirm-delete';

function deps() {
  return {
    confirmation: {} as never,
    messageService: { add: vi.fn() },
  };
}

describe('runEntityDelete', () => {
  it('previews, confirms, deletes, toasts and calls onSuccess', async () => {
    (confirmDelete as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const preview = vi.fn().mockResolvedValue({ trials: 2 });
    const del = vi.fn().mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    const d = deps();

    await runEntityDelete({
      ...d,
      confirm: { header: 'Delete company', entityLabel: 'Acme', requireTypedConfirmation: true },
      preview,
      delete: del,
      successSummary: 'Company deleted.',
      onSuccess,
    });

    expect(preview).toHaveBeenCalledOnce();
    expect((confirmDelete as never as ReturnType<typeof vi.fn>).mock.calls[0][1].counts).toEqual({ trials: 2 });
    expect(del).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(d.messageService.add).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', summary: 'Company deleted.' })
    );
  });

  it('aborts when the user cancels: no delete, no onSuccess', async () => {
    (confirmDelete as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const del = vi.fn();
    const onSuccess = vi.fn();
    await runEntityDelete({
      ...deps(),
      confirm: { header: 'Delete event', typedConfirmationValue: 'delete' },
      delete: del,
      successSummary: 'Event deleted.',
      onSuccess,
    });
    expect(del).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('surfaces an error toast and does not call onSuccess on delete failure', async () => {
    (confirmDelete as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const del = vi.fn().mockRejectedValue(new Error('boom'));
    const onSuccess = vi.fn();
    const d = deps();
    await runEntityDelete({
      ...d,
      confirm: { header: 'Delete trial', typedConfirmationValue: 'delete' },
      delete: del,
      successSummary: 'Trial deleted.',
      onSuccess,
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(d.messageService.add).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', detail: 'boom' })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run src/app/shared/entity-actions/run-entity-delete.spec.ts`
Expected: FAIL — cannot find module `./run-entity-delete`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { ConfirmationService, MessageService } from 'primeng/api';
import {
  ConfirmDeleteOptions,
  DeleteCountBreakdown,
  confirmDelete,
} from '../utils/confirm-delete';

export interface RunEntityDeleteOptions {
  readonly confirmation: ConfirmationService;
  readonly messageService: MessageService;
  /** Confirm dialog config minus `counts` (filled from `preview` when present). */
  readonly confirm: Omit<ConfirmDeleteOptions, 'counts'>;
  /** Optional cascade-count preview run before the dialog opens. */
  readonly preview?: () => Promise<DeleteCountBreakdown>;
  readonly delete: () => Promise<void>;
  readonly successSummary: string;
  /** Runs only after a successful delete (reload list, or navigate to parent). */
  readonly onSuccess: () => void | Promise<void>;
  /** Fallback error message when the thrown error has no message. */
  readonly errorFallback?: string;
}

/**
 * Shared destructive flow for every manage entity: optional cascade preview,
 * typed-confirmation dialog, delete, success toast, then `onSuccess`. On
 * failure it surfaces an error toast and leaves `onSuccess` uncalled. Used by
 * both grid rows (onSuccess = reload) and detail headers (onSuccess = navigate).
 */
export async function runEntityDelete(opts: RunEntityDeleteOptions): Promise<void> {
  let counts: DeleteCountBreakdown | undefined;
  if (opts.preview) {
    try {
      counts = await opts.preview();
    } catch (err) {
      opts.messageService.add({
        severity: 'error',
        summary: 'Delete preview failed',
        detail: err instanceof Error ? err.message : (opts.errorFallback ?? 'Try again.'),
        life: 4000,
      });
      return;
    }
  }

  const ok = await confirmDelete(opts.confirmation, { ...opts.confirm, counts });
  if (!ok) return;

  try {
    await opts.delete();
    opts.messageService.add({ severity: 'success', summary: opts.successSummary, life: 3000 });
    await opts.onSuccess();
  } catch (err) {
    opts.messageService.add({
      severity: 'error',
      summary: 'Delete failed',
      detail: err instanceof Error ? err.message : (opts.errorFallback ?? 'Try again.'),
      life: 4000,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npx vitest run src/app/shared/entity-actions/run-entity-delete.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/shared/entity-actions/run-entity-delete.ts src/client/src/app/shared/entity-actions/run-entity-delete.spec.ts
git commit -m "Add shared entity delete orchestrator"
```

---

### Task 3: Topbar overflow kebab

**Files:**
- Modify: `src/client/src/app/core/services/topbar-state.service.ts`
- Modify: `src/client/src/app/core/layout/contextual-topbar.component.ts`
- Modify: `src/client/src/app/core/layout/app-shell.component.ts`
- Test: `src/client/src/app/core/layout/contextual-topbar.component.spec.ts` (create if absent)

- [ ] **Step 1: Add `overflowActions` to the topbar state service**

In `topbar-state.service.ts`, add the import and signal, and clear it in `clear()`:

```ts
import { Injectable, signal } from '@angular/core';
import { MenuItem } from 'primeng/api';
```

```ts
  /** Entity edit/delete (+ nav) rendered as a shared overflow kebab on detail pages. */
  readonly overflowActions = signal<MenuItem[]>([]);
```

And inside `clear()` add:

```ts
    this.overflowActions.set([]);
```

- [ ] **Step 2: Write the failing component test**

```ts
import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ContextualTopbarComponent } from './contextual-topbar.component';

describe('ContextualTopbarComponent overflow kebab', () => {
  it('renders the kebab only when overflowActions is non-empty', () => {
    const fixture = TestBed.configureTestingModule({
      imports: [ContextualTopbarComponent],
    }).createComponent(ContextualTopbarComponent);
    fixture.componentRef.setInput('pageType', 'detail');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-row-actions')).toBeNull();

    fixture.componentRef.setInput('overflowActions', [
      { label: 'Edit details', command: () => {} },
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-row-actions')).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd src/client && npx vitest run src/app/core/layout/contextual-topbar.component.spec.ts`
Expected: FAIL — `overflowActions` is not a known input.

- [ ] **Step 4: Add the input + render the kebab**

In `contextual-topbar.component.ts`: add imports

```ts
import { MenuItem } from 'primeng/api';
import { RowActionsComponent } from '../../shared/components/row-actions.component';
```

Add `RowActionsComponent` to the component `imports` array. Add the input next to `actionButtons`:

```ts
  readonly overflowActions = input<MenuItem[]>([]);
```

In the template, inside `.topbar-actions`, render the kebab before the existing buttons loop:

```html
      <!-- Right-side actions -->
      <div class="topbar-actions">
        @for (action of actionButtons(); track action.label) {
          <p-button
            [label]="action.label"
            [icon]="action.icon"
            [severity]="action.severity ?? null"
            [outlined]="action.outlined ?? false"
            [text]="action.text ?? false"
            size="small"
            (click)="action.callback()"
          />
        }
        @if (overflowActions().length > 0) {
          <app-row-actions [items]="overflowActions()" ariaLabel="Entity actions" />
        }
        <ng-content select="[topbar-actions]" />
      </div>
```

- [ ] **Step 5: Bind it from the app shell**

In `app-shell.component.ts`, add the binding directly after `[actionButtons]`:

```html
          [actionButtons]="topbarState.actions()"
          [overflowActions]="topbarState.overflowActions()"
```

- [ ] **Step 6: Run test + build to verify**

Run: `cd src/client && npx vitest run src/app/core/layout/contextual-topbar.component.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/client/src/app/core/services/topbar-state.service.ts src/client/src/app/core/layout/contextual-topbar.component.ts src/client/src/app/core/layout/app-shell.component.ts src/client/src/app/core/layout/contextual-topbar.component.spec.ts
git commit -m "Topbar: render shared overflow kebab from topbar state"
```

---

### Task 4: Company — grid refactor + detail edit/delete

**Files:**
- Modify: `src/client/src/app/features/manage/companies/company-list.component.ts`
- Modify: `src/client/src/app/features/manage/companies/company-detail.component.ts`
- Modify: `src/client/src/app/features/manage/companies/company-detail.component.html`
- Test: `src/client/src/app/features/manage/companies/company-detail.component.spec.ts` (create if absent)

**Grid refactor** — in `company-list.component.ts`, replace the hand-built Edit/Delete block in `rowMenu()` with the shared builder, and replace the body of `confirmDelete()` with `runEntityDelete`:

- [ ] **Step 1: Refactor `rowMenu()` to the shared builder**

```ts
  rowMenu(company: Company): MenuItem[] {
    const cached = this.menuCache.get(company.id);
    if (cached) return cached;
    const items = buildEntityActionMenu({
      canEdit: this.spaceRole.canEdit(),
      editLabel: 'Edit',
      onEdit: () => this.openEditModal(company),
      onDelete: () => void this.confirmDelete(company),
      extras: [
        { label: 'View assets', icon: 'fa-solid fa-box', command: () => this.openAssets(company.id) },
      ],
    });
    this.menuCache.set(company.id, items);
    return items;
  }
```

Add the import:

```ts
import { buildEntityActionMenu } from '../../../shared/entity-actions/entity-action-menu';
```

- [ ] **Step 2: Refactor `confirmDelete()` to the orchestrator**

Replace the existing method body with a delegate (keep the method name; it is the `onDelete` callback). Add import:

```ts
import { runEntityDelete } from '../../../shared/entity-actions/run-entity-delete';
```

```ts
  async confirmDelete(company: Company): Promise<void> {
    await runEntityDelete({
      confirmation: this.confirmation,
      messageService: this.messageService,
      confirm: {
        header: 'Delete company',
        entityLabel: company.name,
        message: `Delete "${company.name}"? This will permanently remove:`,
        requireTypedConfirmation: true,
      },
      preview: () => this.companyService.previewDelete(company.id),
      delete: () => this.companyService.delete(company.id),
      successSummary: 'Company deleted.',
      onSuccess: () => this.loadCompanies(),
      errorFallback: 'Could not delete company. It may have associated assets.',
    });
  }
```

- [ ] **Step 3: Add edit dialog + overflow actions to the company detail page**

In `company-detail.component.ts`: add imports and members.

```ts
import { effect } from '@angular/core'; // already imported
import { MenuItem } from 'primeng/api';
import { Router } from '@angular/router';
import { DialogModule } from 'primeng/dialog';
import { CompanyFormComponent } from './company-form.component';
import { buildEntityActionMenu } from '../../../shared/entity-actions/entity-action-menu';
import { runEntityDelete } from '../../../shared/entity-actions/run-entity-delete';
import { TopbarStateService } from '../../../core/services/topbar-state.service';
```

Add `DialogModule` and `CompanyFormComponent` to the `imports` array. Inject the router and topbar state, add the editing signal and the overflow-actions effect, and clear on destroy:

```ts
  private readonly router = inject(Router);
  private readonly topbarState = inject(TopbarStateService);
  protected readonly editingCompany = signal(false);

  private readonly overflowEffect = effect(() => {
    const company = this.company();
    if (!company || !this.spaceRole.canEdit()) {
      this.topbarState.overflowActions.set([]);
      return;
    }
    this.topbarState.overflowActions.set(
      buildEntityActionMenu({
        canEdit: true,
        editLabel: 'Edit details',
        onEdit: () => this.editingCompany.set(true),
        onDelete: () => void this.deleteCompany(company),
        extras: [
          {
            label: 'View assets',
            icon: 'fa-solid fa-box',
            command: () =>
              this.router.navigate([
                '/t', this.tenantIdSig(), 's', this.spaceIdSig(), 'manage', 'assets',
              ]),
          },
        ],
      })
    );
  });

  ngOnDestroy(): void {
    this.topbarState.overflowActions.set([]);
  }

  protected async onCompanyEdited(): Promise<void> {
    this.editingCompany.set(false);
    await this.loadCompany();
    this.messageService.add({ severity: 'success', summary: 'Company updated.', life: 3000 });
  }

  private async deleteCompany(company: Company): Promise<void> {
    await runEntityDelete({
      confirmation: this.confirmation,
      messageService: this.messageService,
      confirm: {
        header: 'Delete company',
        entityLabel: company.name,
        message: `Delete "${company.name}"? This will permanently remove:`,
        requireTypedConfirmation: true,
      },
      preview: () => this.companyService.previewDelete(company.id),
      delete: () => this.companyService.delete(company.id),
      successSummary: 'Company deleted.',
      onSuccess: () =>
        this.router.navigate([
          '/t', this.tenantIdSig(), 's', this.spaceIdSig(), 'manage', 'companies',
        ]),
      errorFallback: 'Could not delete company. It may have associated assets.',
    });
  }
```

Make the class implement `OnDestroy` (add to the `implements` clause; import `OnDestroy`).

In `company-detail.component.html`, add the edit dialog near the other dialogs (mirror the asset-detail pattern):

```html
    <p-dialog
      header="Edit company"
      [(visible)]="editingCompany"
      [modal]="true"
      styleClass="!w-[32rem]"
      (onHide)="editingCompany.set(false)"
    >
      @if (editingCompany()) {
        <app-company-form
          [company]="company()"
          (saved)="onCompanyEdited()"
          (cancelled)="editingCompany.set(false)"
        />
      }
    </p-dialog>
```

(Confirm `app-company-form`'s input/output names match `company-form.component.ts`; adjust `[company]` / `(saved)` / `(cancelled)` if they differ.)

- [ ] **Step 4: Write the detail spec**

```ts
import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CompanyDetailComponent } from './company-detail.component';
import { TopbarStateService } from '../../../core/services/topbar-state.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';

describe('CompanyDetailComponent overflow actions', () => {
  it('populates overflowActions with Edit details + Delete for editors', () => {
    TestBed.configureTestingModule({
      imports: [CompanyDetailComponent],
      providers: [
        provideRouter([]),
        { provide: SpaceRoleService, useValue: { canEdit: () => true } },
      ],
    });
    const topbar = TestBed.inject(TopbarStateService);
    const fixture = TestBed.createComponent(CompanyDetailComponent);
    const cmp = fixture.componentInstance as unknown as { company: { set: (c: unknown) => void } };
    cmp.company.set({ id: 'c1', name: 'Acme', space_id: 's1' });
    fixture.detectChanges();

    const labels = topbar.overflowActions().map((i) => i.label ?? (i.separator ? 'SEP' : ''));
    expect(labels).toContain('Edit details');
    expect(labels).toContain('Delete');
  });

  it('clears overflowActions for viewers', () => {
    TestBed.configureTestingModule({
      imports: [CompanyDetailComponent],
      providers: [
        provideRouter([]),
        { provide: SpaceRoleService, useValue: { canEdit: () => false } },
      ],
    });
    const topbar = TestBed.inject(TopbarStateService);
    const fixture = TestBed.createComponent(CompanyDetailComponent);
    const cmp = fixture.componentInstance as unknown as { company: { set: (c: unknown) => void } };
    cmp.company.set({ id: 'c1', name: 'Acme', space_id: 's1' });
    fixture.detectChanges();
    expect(topbar.overflowActions()).toEqual([]);
  });
});
```

If the component's dependencies make full instantiation heavy in the test, narrow it to assert `buildEntityActionMenu` output for the same inputs instead (the effect body is a thin wrapper). Keep whichever compiles and passes.

- [ ] **Step 5: Run tests + build**

Run: `cd src/client && npx vitest run src/app/features/manage/companies && ng build`
Expected: PASS / build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/manage/companies/
git commit -m "Company: shared action kebab in grid + detail with delete"
```

---

### Task 5: Asset — grid refactor + detail delete

**Files:**
- Modify: `src/client/src/app/features/manage/assets/asset-list.component.ts`
- Modify: `src/client/src/app/features/manage/assets/asset-detail.component.ts`
- Test: `src/client/src/app/features/manage/assets/asset-detail.component.spec.ts` (create if absent)

- [ ] **Step 1: Refactor the asset grid** — same shape as Task 4 Step 1/2: replace the Edit/Delete portion of `rowMenu()` with `buildEntityActionMenu` (editLabel `'Edit'`, extras = existing nav items such as "View trials"), and replace `confirmDelete()`'s body with `runEntityDelete` (preview = `assetService.previewDelete`, delete = `assetService.delete`, successSummary `'Asset deleted.'`, onSuccess = `this.loadAssets()`). Preserve any existing extras already in the asset row menu.

- [ ] **Step 2: Replace the detail "Edit details" button with the overflow kebab**

In `asset-detail.component.ts`, change `topbarActionsEffect` to populate `overflowActions` instead of `actions`, and add a delete that navigates to the assets list:

```ts
  private readonly topbarActionsEffect = effect(() => {
    const asset = this.asset();
    if (!asset || !this.spaceRole.canEdit()) {
      this.topbarState.overflowActions.set([]);
      return;
    }
    this.topbarState.overflowActions.set(
      buildEntityActionMenu({
        canEdit: true,
        editLabel: 'Edit details',
        onEdit: () => this.editingAsset.set(true),
        onDelete: () => void this.deleteAsset(asset),
      })
    );
  });

  private async deleteAsset(asset: Asset): Promise<void> {
    await runEntityDelete({
      confirmation: this.confirmation,
      messageService: this.messageService,
      confirm: {
        header: 'Delete asset',
        entityLabel: asset.name,
        message: `Delete "${asset.name}"? This will permanently remove:`,
        requireTypedConfirmation: true,
      },
      preview: () => this.assetService.previewDelete(asset.id),
      delete: () => this.assetService.delete(asset.id),
      successSummary: 'Asset deleted.',
      onSuccess: () =>
        this.router.navigate([
          '/t', this.tenantIdSig(), 's', this.spaceIdSig(), 'manage', 'assets',
        ]),
    });
  }
```

Add imports for `buildEntityActionMenu`, `runEntityDelete`, `Router`, `Asset` (if not present), inject `Router`, and add `this.topbarState.overflowActions.set([])` to the existing `ngOnDestroy()` (it already calls `this.topbarState.clear()`, which now also clears overflowActions — verify and rely on that; no extra line needed). Confirm `assetService`, `confirmation`, `messageService`, `tenantIdSig`, `spaceIdSig` exist on the component (they do per the read); add `ConfirmDialogModule` / `ToastModule` to imports only if the page does not already host a confirm dialog.

- [ ] **Step 3: Spec** — mirror Task 4 Step 4 for assets (editor sees Edit details + Delete in `overflowActions`; viewer sees `[]`).

- [ ] **Step 4: Run tests + build**

Run: `cd src/client && npx vitest run src/app/features/manage/assets && ng build`
Expected: PASS / build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/manage/assets/
git commit -m "Asset: shared action kebab in grid + detail with delete"
```

---

### Task 6: Trial — grid refactor + detail delete

**Files:**
- Modify: `src/client/src/app/features/manage/trials/trial-list.component.ts`
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.ts`
- Test: `src/client/src/app/features/manage/trials/trial-detail.component.spec.ts` (create if absent)

- [ ] **Step 1: Refactor the trial grid** — same shape as Task 4: `rowMenu()` via `buildEntityActionMenu` (editLabel `'Edit'`, preserve existing extras), `confirmDelete()` via `runEntityDelete` (preview/delete from `trialService`, successSummary `'Trial deleted.'`, onSuccess = `this.loadTrials()`).

- [ ] **Step 2: Move the detail Edit into the overflow kebab + add Delete**

In `trial-detail.component.ts`, change the existing `topbarActionsEffect` (currently sets `topbarState.actions`) to set `overflowActions`:

```ts
  private readonly topbarActionsEffect = effect(() => {
    const trial = this.trial();
    if (!trial || !this.spaceRole.canEdit()) {
      this.topbarState.overflowActions.set([]);
      return;
    }
    this.topbarState.overflowActions.set(
      buildEntityActionMenu({
        canEdit: true,
        editLabel: 'Edit details',
        onEdit: () => this.editingTrial.set(true),
        onDelete: () => void this.deleteTrial(trial),
      })
    );
  });

  private async deleteTrial(trial: Trial): Promise<void> {
    await runEntityDelete({
      confirmation: this.confirmation,
      messageService: this.messageService,
      confirm: {
        header: 'Delete trial',
        entityLabel: trial.name,
        message: `Delete "${trial.name}"? This will permanently remove:`,
        requireTypedConfirmation: true,
      },
      preview: () => this.trialService.previewDelete(trial.id),
      delete: () => this.trialService.delete(trial.id),
      successSummary: 'Trial deleted.',
      onSuccess: () =>
        this.router.navigate([
          '/t', this.tenantIdSig(), 's', this.spaceIdSig(), 'manage', 'trials',
        ]),
    });
  }
```

Add imports (`buildEntityActionMenu`, `runEntityDelete`, `Router`), inject `Router`, verify `trialService` / `confirmation` / `messageService` / `tenantIdSig` / `spaceIdSig` member names (read the file and adapt the navigation param accessors to whatever the component already uses). Ensure `topbarState.clear()` is called on destroy (it is via the existing effect-driven flow; confirm and add `overflowActions.set([])` to `ngOnDestroy` if no `clear()` runs).

- [ ] **Step 3: Spec** — editor sees Edit details + Delete in `overflowActions`; viewer sees `[]`.

- [ ] **Step 4: Run tests + build**

Run: `cd src/client && npx vitest run src/app/features/manage/trials && ng build`
Expected: PASS / build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/manage/trials/trial-list.component.ts src/client/src/app/features/manage/trials/trial-detail.component.ts src/client/src/app/features/manage/trials/trial-detail.component.spec.ts
git commit -m "Trial: shared action kebab in grid + detail with delete"
```

---

### Task 7: Marker / Note row menus — refactor to shared builder

**Files:**
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.ts` (`markerMenu()`, `noteMenu()`)

No behavior change — markers/notes already pair Edit + Delete in their row kebab. Refactor both builders to `buildEntityActionMenu` so all surfaces share one definition.

- [ ] **Step 1: Refactor `markerMenu()` and `noteMenu()`**

For each, replace the hand-built MenuItem array with:

```ts
  markerMenu(marker: Marker): MenuItem[] {
    return buildEntityActionMenu({
      canEdit: this.spaceRole.canEdit(),
      editLabel: 'Edit',
      onEdit: () => this.startMarkerEdit(marker),   // use the existing inline-edit trigger
      onDelete: () => void this.deleteMarker(marker), // existing method
    });
  }
```

Adapt `startMarkerEdit` / `deleteMarker` / `noteMenu`'s equivalents to the method names already in the file (read first). Markers/notes keep their existing lighter confirm (no cascade preview) — leave `deleteMarker` / `deleteNote` bodies as they are; only the menu construction changes. Preserve the existing `menuCache` keying if present.

- [ ] **Step 2: Run trial specs + build**

Run: `cd src/client && npx vitest run src/app/features/manage/trials && ng build`
Expected: PASS / build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/manage/trials/trial-detail.component.ts
git commit -m "Markers/notes: build row menus via shared action builder"
```

---

### Task 8: Event detail panel — kebab + wire delete

**Files:**
- Modify: `src/client/src/app/features/events/event-detail-panel.component.ts`
- Modify: `src/client/src/app/features/events/event-detail-panel.component.html`
- Modify: `src/client/src/app/features/events/events-page.component.html`
- Modify: `src/client/src/app/features/events/events-page.component.ts`
- Test: `src/client/src/app/features/events/event-detail-panel.component.spec.ts` (extend if present)

Replace the bare pen-icon header button with the shared kebab, and wire the orphaned `onDeleteEvent`. Delete appears only for an actual event selection (where `detail()` is present), not detected items or marker/catalyst selections (which route to the trial page for edit).

- [ ] **Step 1: Add a `delete` output + kebab items to the panel**

In `event-detail-panel.component.ts`:

```ts
import { MenuItem } from 'primeng/api';
import { RowActionsComponent } from '../../shared/components/row-actions.component';
import { buildEntityActionMenu } from '../../shared/entity-actions/entity-action-menu';
```

Add `RowActionsComponent` to `imports`. Add the output and a computed menu:

```ts
  readonly delete = output<void>();

  protected readonly headerMenu = computed<MenuItem[]>(() => {
    if (!this.canEdit() || this.isDetected() || !this.detail()) return [];
    return buildEntityActionMenu({
      canEdit: true,
      editLabel: 'Edit event',
      onEdit: () => this.edit.emit(),
      onDelete: () => this.delete.emit(),
    });
  });
```

- [ ] **Step 2: Swap the header button for the kebab**

In `event-detail-panel.component.html`, replace the existing `headerActions` pen `<button>` block with:

```html
  @if (headerMenu().length > 0) {
    <app-row-actions headerActions [items]="headerMenu()" ariaLabel="Event actions" />
  }
```

- [ ] **Step 3: Wire `(delete)` on the events page**

In `events-page.component.html`, add to the `<app-event-detail-panel ...>` bindings:

```html
          (delete)="onDeleteSelected()"
```

In `events-page.component.ts`, add the handler that calls the existing `onDeleteEvent` for the selected event id:

```ts
  onDeleteSelected(): void {
    const item = this.selectedItem();
    if (!item || item.source_type !== 'event') return;
    void this.onDeleteEvent(item.id);
  }
```

(`onDeleteEvent` already exists; this gives it its first call site. Adjust `item.id` to the field the event uses as its delete id if it differs.)

- [ ] **Step 4: Write/extend the panel spec**

```ts
import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { EventDetailPanelComponent } from './event-detail-panel.component';

describe('EventDetailPanelComponent header menu', () => {
  it('includes Edit + Delete for an editable event selection', () => {
    const fixture = TestBed.configureTestingModule({
      imports: [EventDetailPanelComponent],
    }).createComponent(EventDetailPanelComponent);
    fixture.componentRef.setInput('canEdit', true);
    fixture.componentRef.setInput('detail', { id: 'e1', title: 'Readout', event_date: '2026-01-01' });
    fixture.detectChanges();
    const labels = (fixture.componentInstance as unknown as { headerMenu: () => { label?: string }[] })
      .headerMenu()
      .map((i) => i.label);
    expect(labels).toContain('Edit event');
    expect(labels).toContain('Delete');
  });

  it('is empty for viewers', () => {
    const fixture = TestBed.configureTestingModule({
      imports: [EventDetailPanelComponent],
    }).createComponent(EventDetailPanelComponent);
    fixture.componentRef.setInput('canEdit', false);
    fixture.componentRef.setInput('detail', { id: 'e1', title: 'Readout', event_date: '2026-01-01' });
    fixture.detectChanges();
    expect(
      (fixture.componentInstance as unknown as { headerMenu: () => unknown[] }).headerMenu()
    ).toEqual([]);
  });
});
```

If `isDetected()` reads other inputs, set them so the panel treats this selection as a non-detected event.

- [ ] **Step 5: Run tests + build**

Run: `cd src/client && npx vitest run src/app/features/events && ng build`
Expected: PASS / build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/events/
git commit -m "Events: shared action kebab in detail panel + wire delete"
```

---

### Task 9: Full verification

- [ ] **Step 1: Lint + build the whole client**

Run: `cd src/client && ng lint && ng build`
Expected: no lint errors, build succeeds.

- [ ] **Step 2: Run the full unit suite**

Run: `cd src/client && npm run test:units`
Expected: PASS.

- [ ] **Step 3: Browser smoke (one end-to-end path)**

Start the app, open a trial detail page as an editor, open the `⋯` kebab, choose Delete, complete the typed confirmation, and verify you land on the trials list with a "Trial deleted." toast. Repeat the kebab presence check on a company and asset detail page (Edit + Delete present), and on the events page detail panel (Edit + Delete present, delete removes the event).

- [ ] **Step 4: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "Unified edit/delete surface: verification fixups"
```

---

## Self-review notes

- **Spec coverage:** decisions 1-3 map to Tasks 1-3 (shared idiom + topbar kebab) and Tasks 4-8 (per-entity wiring incl. post-delete navigation to parent list). Orphaned `onDeleteEvent` wired in Task 8. Role gating asserted in each detail spec.
- **Type consistency:** `buildEntityActionMenu` signature (Task 1) and `runEntityDelete` options (Task 2) are used verbatim in Tasks 4-8. `overflowActions` signal name consistent across service/component/shell (Task 3) and all consumers.
- **Known adaptation points (read the file first):** exact member names for `assetService`/`trialService`, the `tenantIdSig`/`spaceIdSig` accessors per detail component, `company-form` I/O names, and marker/note inline-edit trigger method names. These are wiring details to confirm against the actual file, not design gaps.
