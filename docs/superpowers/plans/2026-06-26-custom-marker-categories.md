# Custom Marker Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let space owners/editors create, rename, reorder, and delete their own marker categories (in a dedicated settings page and inline from the marker-type form), instead of being forced into the 5 immutable system categories.

**Architecture:** The `marker_categories` table and its owner/editor RLS policies already exist; this work exposes them. Category writes mirror the sibling `MarkerTypeService` (direct PostgREST insert/update/delete relying on RLS, no new RPCs). One small additive migration adds a per-space unique-name guard. The legend and markers-help already group by category, so they need no logic change.

**Tech Stack:** Angular 19 (standalone, signals, OnPush), PrimeNG 21, Tailwind v4, Supabase/Postgres, Vitest.

## Global Constraints

- No emojis, no em dashes anywhere (code, copy, comments, commits). Use commas/colons/periods.
- Do not attribute Claude in commits.
- Angular: standalone components, `ChangeDetectionStrategy.OnPush`, `inject()` (no constructor DI), `input()`/`output()`/`model()` (no decorators), signals for state, `computed()` for derived, native control flow (`@if`/`@for`), `class`/`style` bindings (never `ngClass`/`ngStyle`), reactive patterns. Lint is fully ratcheted at `error`.
- PrimeNG components for forms/tables/dialogs/overlays. `pTooltip` from `primeng/tooltip`, never native `title=`.
- Tailwind brand utilities `bg-brand-*`/`text-brand-*`/`border-brand-*`/`ring-brand-*`, never `bg-teal-*`/`bg-indigo-*`. Slate/red/amber/green/cyan/violet stay hard-coded (data colors).
- Empty-state audit (src/client/CLAUDE.md section 13): domain vocabulary column headers and action labels, role-appropriate affordances (no greyed buttons / post-click denials), loading skeleton + named error states.
- Category stays **required** in the marker-type form; nothing pre-selected. No catch-all / default bucket.
- System categories (`is_system = true`, null `space_id`) are immutable and not editable/reorderable/deletable.
- Verification per change: `cd src/client && ng lint && ng build`. After migration: `supabase db reset` + `supabase db advisors --local --type all`. Unit tests: `npm run test:units`.

---

## File Structure

- `supabase/migrations/<ts>_marker_categories_unique_name.sql` — additive partial unique index (new).
- `src/client/src/app/core/services/marker-category.service.ts` — add `create`/`update`/`delete` + `MarkerCategoryInUseError` (modify).
- `src/client/src/app/core/services/marker-category.service.spec.ts` — service tests (new).
- `src/client/src/app/features/manage/marker-categories/marker-category-form.component.ts` / `.html` — name-only create/edit form (new).
- `src/client/src/app/features/manage/marker-categories/marker-category-list.component.ts` / `.html` — management page (new).
- `src/client/src/app/features/manage/marker-categories/marker-category-list.component.spec.ts` — page tests (new).
- `src/client/src/app/app.routes.ts` — register `settings/marker-categories` (modify).
- `src/client/src/app/features/manage/marker-types/marker-type-list.component.ts` / `.html` — add "Manage categories" link (modify).
- `src/client/src/app/features/manage/marker-types/marker-type-form.component.ts` / `.html` — inline "New category" affordance (modify).
- `src/client/src/app/features/manage/marker-types/marker-type-form.component.spec.ts` — inline-create test (new).
- `src/client/src/app/features/help/markers-help.component.ts` — editorial sentence + FAQ entry (modify).
- `.claude/hooks/runbook-review-guard.sh` — already maps `marker_categories` if present; verify/extend (modify if needed).

---

## Task 1: Migration — per-space unique category name

**Files:**
- Create: `supabase/migrations/<generated-ts>_marker_categories_unique_name.sql`

**Interfaces:**
- Produces: a partial unique index `marker_categories_space_name_uniq` enforcing `(space_id, lower(name))` for custom rows. Postgres raises SQLSTATE `23505` on a duplicate custom name.

- [ ] **Step 1: Generate the migration file**

Run (from repo root of the worktree):
```bash
supabase migration new marker_categories_unique_name
```
Expected: prints the new file path under `supabase/migrations/`.

- [ ] **Step 2: Write the migration SQL**

Put this in the generated file (lowercase SQL per the style guide):
```sql
-- enforce unique custom category names within a space (case-insensitive).
-- system categories (is_system = true, null space_id) are unaffected.
create unique index marker_categories_space_name_uniq
  on public.marker_categories (space_id, lower(name))
  where is_system = false;
```

- [ ] **Step 3: Apply and verify the migration**

Run:
```bash
supabase db reset
```
Expected: completes without error; the new migration is listed in the apply log.

Then verify the index exists and rejects a duplicate (this should ERROR on the second insert):
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select indexname from pg_indexes where tablename = 'marker_categories' and indexname = 'marker_categories_space_name_uniq';"
```
Expected: one row, `marker_categories_space_name_uniq`.

- [ ] **Step 4: Run the advisor**

Run:
```bash
supabase db advisors --local --type all
```
Expected: no new ERROR/WARN attributable to this index.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations
git commit -m "feat(db): unique custom marker category name per space"
```

---

## Task 2: MarkerCategoryService — create / update / delete

**Files:**
- Modify: `src/client/src/app/core/services/marker-category.service.ts`
- Test: `src/client/src/app/core/services/marker-category.service.spec.ts` (create)

**Interfaces:**
- Consumes: `MarkerCategory` model (`src/app/core/models/marker.model.ts`) — fields `id`, `space_id`, `name`, `display_order`, `is_system`.
- Produces:
  - `class MarkerCategoryInUseError extends Error` (exported).
  - `create(spaceId: string, name: string): Promise<MarkerCategory>` — inserts `{ name, space_id, is_system: false, display_order }` where `display_order = max(visible display_order) + 1`; invalidates tag `markers:types`.
  - `update(id: string, changes: { name?: string; display_order?: number }): Promise<MarkerCategory>` — invalidates `markers:types`.
  - `delete(id: string): Promise<void>` — on Postgres FK violation (`code === '23503'`) throws `MarkerCategoryInUseError`; invalidates `markers:types`.

- [ ] **Step 1: Write the failing tests**

Create `src/client/src/app/core/services/marker-category.service.spec.ts`. Reuse the query-builder stub pattern from `marker.service.spec.ts` (copy `makeQueryBuilder` and the `ClientStub`/`CacheStub`/`makeService` helpers, swapping `MarkerService` for `MarkerCategoryService`). Then:

```typescript
describe('MarkerCategoryService.create', () => {
  it('inserts a custom category with is_system false and order after the current max', async () => {
    // First query: read current max display_order (returns 5 = highest system order).
    const maxQb = makeQueryBuilder([{ display_order: 5 }]);
    // Second query: the insert returning the new row.
    const insertQb = makeQueryBuilder({
      id: 'cat-new',
      space_id: 'space-1',
      name: 'Manufacturing',
      display_order: 6,
      is_system: false,
    });
    const from = vi.fn().mockReturnValueOnce(maxQb).mockReturnValueOnce(insertQb);
    const invalidateTags = vi.fn();
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    const result = await service.create('space-1', 'Manufacturing');

    expect(insertQb.insert).toHaveBeenCalledWith({
      name: 'Manufacturing',
      space_id: 'space-1',
      is_system: false,
      display_order: 6,
    });
    expect(result.id).toBe('cat-new');
    expect(invalidateTags).toHaveBeenCalledWith(['markers:types']);
  });

  it('starts ordering at 1 when no categories exist', async () => {
    const maxQb = makeQueryBuilder([]);
    const insertQb = makeQueryBuilder({ id: 'cat-1', display_order: 1 });
    const from = vi.fn().mockReturnValueOnce(maxQb).mockReturnValueOnce(insertQb);
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );

    await service.create('space-1', 'IP');

    expect(insertQb.insert).toHaveBeenCalledWith(
      expect.objectContaining({ display_order: 1 })
    );
  });
});

describe('MarkerCategoryService.delete', () => {
  it('throws MarkerCategoryInUseError on a foreign-key violation', async () => {
    const delQb = makeQueryBuilder(null, { code: '23503', message: 'fk' });
    const from = vi.fn().mockReturnValue(delQb);
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags: vi.fn() }
    );

    await expect(service.delete('cat-1')).rejects.toBeInstanceOf(MarkerCategoryInUseError);
  });

  it('invalidates the markers:types tag on success', async () => {
    const delQb = makeQueryBuilder(null);
    const from = vi.fn().mockReturnValue(delQb);
    const invalidateTags = vi.fn();
    const service = makeService(
      { from, rpc: vi.fn(), auth: { getUser: vi.fn(), getSession: vi.fn() } },
      { get: vi.fn(), invalidateTags }
    );

    await service.delete('cat-1');

    expect(invalidateTags).toHaveBeenCalledWith(['markers:types']);
  });
});
```

Add the `import` for `MarkerCategoryInUseError` from `./marker-category.service`.

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd src/client && npm run test:units -- marker-category.service
```
Expected: FAIL — `create`/`delete`/`MarkerCategoryInUseError` are not defined.

- [ ] **Step 3: Implement the service methods**

Edit `src/client/src/app/core/services/marker-category.service.ts`. Add the error class above the `@Injectable`:

```typescript
export class MarkerCategoryInUseError extends Error {
  constructor() {
    super('This category is still used by marker types. Reassign them before deleting it.');
    this.name = 'MarkerCategoryInUseError';
  }
}
```

Add these methods inside the class (keep the existing `list`):

```typescript
async create(spaceId: string, name: string): Promise<MarkerCategory> {
  // Place new custom categories after the highest existing order (system + this space)
  // so they sort below the system categories in the legend.
  let maxQuery = this.supabase.client
    .from('marker_categories')
    .select('display_order')
    .order('display_order', { ascending: false })
    .limit(1);
  maxQuery = maxQuery.or(`is_system.eq.true,space_id.eq.${spaceId}`);
  const { data: maxRows } = await maxQuery.throwOnError();
  const nextOrder = ((maxRows?.[0]?.display_order as number | undefined) ?? 0) + 1;

  const { data } = await this.supabase.client
    .from('marker_categories')
    .insert({ name, space_id: spaceId, is_system: false, display_order: nextOrder })
    .select()
    .single()
    .throwOnError();
  this.cache.invalidateTags(['markers:types']);
  return data as MarkerCategory;
}

async update(
  id: string,
  changes: { name?: string; display_order?: number }
): Promise<MarkerCategory> {
  const { data } = await this.supabase.client
    .from('marker_categories')
    .update(changes)
    .eq('id', id)
    .select()
    .single()
    .throwOnError();
  this.cache.invalidateTags(['markers:types']);
  return data as MarkerCategory;
}

async delete(id: string): Promise<void> {
  try {
    await this.supabase.client.from('marker_categories').delete().eq('id', id).throwOnError();
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === '23503') {
      throw new MarkerCategoryInUseError();
    }
    throw e;
  }
  this.cache.invalidateTags(['markers:types']);
}
```

Note: the spec stub's `makeQueryBuilder` resolves the chain when awaited, so `.order().limit().or().throwOnError()` must each return the builder. If `order`/`limit`/`or` are missing on the stub, add them as `vi.fn().mockReturnValue(qb)` in the copied helper.

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd src/client && npm run test:units -- marker-category.service
```
Expected: PASS (all 4 tests).

- [ ] **Step 5: Lint**

Run:
```bash
cd src/client && ng lint
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/core/services/marker-category.service.ts src/client/src/app/core/services/marker-category.service.spec.ts
git commit -m "feat(markers): category create/update/delete service methods"
```

---

## Task 3: Marker-category management page

**Files:**
- Create: `src/client/src/app/features/manage/marker-categories/marker-category-form.component.ts`
- Create: `src/client/src/app/features/manage/marker-categories/marker-category-form.component.html`
- Create: `src/client/src/app/features/manage/marker-categories/marker-category-list.component.ts`
- Create: `src/client/src/app/features/manage/marker-categories/marker-category-list.component.html`
- Create: `src/client/src/app/features/manage/marker-categories/marker-category-list.component.spec.ts`
- Modify: `src/client/src/app/app.routes.ts`
- Modify: `src/client/src/app/features/manage/marker-types/marker-type-list.component.ts` and `.html`

**Interfaces:**
- Consumes: `MarkerCategoryService.list/create/update/delete`, `MarkerCategoryInUseError`, `MarkerTypeService.list` (for in-use counts), `SpaceRoleService.canEdit()`, shared `ManagePageShellComponent`, `confirmDelete`.
- Produces: route `settings/marker-categories` → `MarkerCategoryListComponent`.

- [ ] **Step 1: Write the form component (name-only)**

Create `marker-category-form.component.ts` mirroring `marker-type-form.component.ts` but with a single `name` field:

```typescript
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';

import { MarkerCategory } from '../../../core/models/marker.model';
import { MarkerCategoryService } from '../../../core/services/marker-category.service';
import { FormFieldComponent } from '../../../shared/components/form-field.component';
import { FormActionsComponent } from '../../../shared/components/form-actions.component';

@Component({
  selector: 'app-marker-category-form',
  standalone: true,
  imports: [FormsModule, InputText, MessageModule, FormFieldComponent, FormActionsComponent],
  templateUrl: './marker-category-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkerCategoryFormComponent implements OnInit {
  readonly category = input<MarkerCategory | null>(null);
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  private categoryService = inject(MarkerCategoryService);
  private route = inject(ActivatedRoute);

  readonly name = signal('');
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly nameBlurred = signal(false);
  readonly nameInvalid = computed(() => this.nameBlurred() && !this.name().trim());

  ngOnInit(): void {
    const existing = this.category();
    if (existing) this.name.set(existing.name);
  }

  async onSubmit(): Promise<void> {
    this.nameBlurred.set(true);
    const name = this.name().trim();
    if (!name) return;

    this.saving.set(true);
    this.error.set(null);
    try {
      const existing = this.category();
      if (existing) {
        await this.categoryService.update(existing.id, { name });
      } else {
        const spaceId = this.route.snapshot.paramMap.get('spaceId')!;
        await this.categoryService.create(spaceId, name);
      }
      this.saved.emit();
    } catch (e) {
      this.error.set(
        e && typeof e === 'object' && 'message' in e && typeof e.message === 'string'
          ? e.message
          : 'Could not save category. Check your connection and try again.'
      );
    } finally {
      this.saving.set(false);
    }
  }
}
```

Create `marker-category-form.component.html` mirroring the marker-type form's name field + `app-form-actions`:

```html
<form (ngSubmit)="onSubmit()" class="space-y-4">
  @if (error()) {
    <p-message severity="error" [closable]="false">{{ error() }}</p-message>
  }

  <app-form-field
    label="Category name"
    fieldId="mc-name"
    [required]="true"
    [error]="nameInvalid() ? 'Category name is required.' : null"
  >
    <input
      pInputText
      id="mc-name"
      class="w-full mt-1"
      [ngModel]="name()"
      (ngModelChange)="name.set($event)"
      name="name"
      required
      placeholder="e.g. Manufacturing, Intellectual property"
      (blur)="nameBlurred.set(true)"
      [attr.aria-required]="true"
      [attr.aria-invalid]="nameInvalid()"
    />
  </app-form-field>

  <app-form-actions
    [saving]="saving()"
    saveLabel="Save category"
    (cancelled)="cancelled.emit()"
  />
</form>
```

Note: confirm `app-form-actions` input/output names against `shared/components/form-actions.component.ts` and adjust `saveLabel`/`(cancelled)` bindings to match its actual API before running.

- [ ] **Step 2: Write the list component**

Create `marker-category-list.component.ts`. Model on `marker-type-list.component.ts` (topbar action, dialog host, role gating). Add in-use counts and reorder:

```typescript
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { Tooltip } from 'primeng/tooltip';

import { MarkerCategory, MarkerType } from '../../../core/models/marker.model';
import {
  MarkerCategoryInUseError,
  MarkerCategoryService,
} from '../../../core/services/marker-category.service';
import { MarkerTypeService } from '../../../core/services/marker-type.service';
import { MarkerCategoryFormComponent } from './marker-category-form.component';
import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell.component';
import { TopbarStateService } from '../../../core/services/topbar-state.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';
import { confirmDelete } from '../../../shared/utils/confirm-delete';

@Component({
  selector: 'app-marker-category-list',
  standalone: true,
  imports: [
    TableModule,
    ButtonModule,
    Dialog,
    MessageModule,
    Tooltip,
    RouterLink,
    MarkerCategoryFormComponent,
    ManagePageShellComponent,
  ],
  templateUrl: './marker-category-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkerCategoryListComponent implements OnInit, OnDestroy {
  private categoryService = inject(MarkerCategoryService);
  private markerTypeService = inject(MarkerTypeService);
  private route = inject(ActivatedRoute);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  private readonly topbarState = inject(TopbarStateService);
  protected spaceRole = inject(SpaceRoleService);
  spaceId = '';

  readonly categories = signal<MarkerCategory[]>([]);
  readonly typeCountByCategory = signal<Map<string, number>>(new Map());
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly editingCategory = signal<MarkerCategory | null>(null);

  readonly customCategories = computed(() =>
    this.categories()
      .filter((c) => !c.is_system)
      .sort((a, b) => a.display_order - b.display_order)
  );
  readonly systemCategories = computed(() =>
    this.categories()
      .filter((c) => c.is_system)
      .sort((a, b) => a.display_order - b.display_order)
  );

  private readonly topbarActionsEffect = effect(() => {
    if (this.spaceRole.canEdit()) {
      this.topbarState.actions.set([
        {
          label: 'Add category',
          icon: 'fa-solid fa-plus',
          text: true,
          callback: () => this.openCreateModal(),
        },
      ]);
    } else {
      this.topbarState.actions.set([]);
    }
  });

  ngOnInit(): void {
    this.spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    this.load();
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  typeCount(categoryId: string): number {
    return this.typeCountByCategory().get(categoryId) ?? 0;
  }

  openCreateModal(): void {
    this.editingCategory.set(null);
    this.modalOpen.set(true);
  }

  openEditModal(c: MarkerCategory): void {
    this.editingCategory.set(c);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.editingCategory.set(null);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [categories, types] = await Promise.all([
        this.categoryService.list(this.spaceId),
        this.markerTypeService.list(this.spaceId),
      ]);
      this.categories.set(categories);
      const counts = new Map<string, number>();
      for (const t of types) {
        counts.set(t.category_id, (counts.get(t.category_id) ?? 0) + 1);
      }
      this.typeCountByCategory.set(counts);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load categories');
    } finally {
      this.loading.set(false);
    }
  }

  async onSaved(): Promise<void> {
    const wasEditing = this.editingCategory() !== null;
    this.closeModal();
    await this.load();
    this.messageService.add({
      severity: 'success',
      summary: wasEditing ? 'Category updated.' : 'Category created.',
      life: 3000,
    });
  }

  async moveUp(c: MarkerCategory): Promise<void> {
    const list = this.customCategories();
    const idx = list.findIndex((x) => x.id === c.id);
    if (idx <= 0) return;
    await this.swapOrder(list[idx], list[idx - 1]);
  }

  async moveDown(c: MarkerCategory): Promise<void> {
    const list = this.customCategories();
    const idx = list.findIndex((x) => x.id === c.id);
    if (idx < 0 || idx >= list.length - 1) return;
    await this.swapOrder(list[idx], list[idx + 1]);
  }

  private async swapOrder(a: MarkerCategory, b: MarkerCategory): Promise<void> {
    try {
      await this.categoryService.update(a.id, { display_order: b.display_order });
      await this.categoryService.update(b.id, { display_order: a.display_order });
      await this.load();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not reorder categories.');
    }
  }

  async deleteCategory(c: MarkerCategory): Promise<void> {
    if (this.typeCount(c.id) > 0) return;
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete category',
      entityLabel: c.name,
      message: `Delete "${c.name}"? This category will be removed from the legend.`,
    });
    if (!ok) return;
    try {
      await this.categoryService.delete(c.id);
      await this.load();
      this.messageService.add({ severity: 'success', summary: 'Category deleted.', life: 3000 });
    } catch (e) {
      this.error.set(
        e instanceof MarkerCategoryInUseError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Could not delete category.'
      );
    }
  }
}
```

Create `marker-category-list.component.html`. Mirror the marker-type list shell (use `app-manage-page-shell` with the same inputs that file uses; check its API first). Render two tables: system (read-only) then custom (with actions). Custom row delete uses `pTooltip` and `[disabled]` when in use. Example body for the custom table:

```html
<app-manage-page-shell
  title="Marker categories"
  [loading]="loading()"
  [error]="error()"
>
  <p class="mb-4 text-sm text-slate-600">
    Categories group marker types in the timeline legend. The five system categories are
    fixed; add your own for markers that do not fit them.
  </p>

  <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">System categories</h3>
  <p-table [value]="systemCategories()" styleClass="mb-6">
    <ng-template #header>
      <tr><th>Category</th><th>Marker types</th><th>Origin</th></tr>
    </ng-template>
    <ng-template #body let-c>
      <tr>
        <td>{{ c.name }}</td>
        <td>{{ typeCount(c.id) }}</td>
        <td><span class="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">System</span></td>
      </tr>
    </ng-template>
  </p-table>

  <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Custom categories</h3>
  <p-table [value]="customCategories()">
    <ng-template #header>
      <tr><th>Category</th><th>Marker types</th><th class="text-right">Actions</th></tr>
    </ng-template>
    <ng-template #body let-c let-i="rowIndex">
      <tr>
        <td>{{ c.name }}</td>
        <td>{{ typeCount(c.id) }}</td>
        <td class="text-right">
          @if (spaceRole.canEdit()) {
            <button
              type="button"
              pButton
              text
              icon="fa-solid fa-arrow-up"
              pTooltip="Move up"
              tooltipPosition="top"
              [disabled]="i === 0"
              (click)="moveUp(c)"
              aria-label="Move category up"
            ></button>
            <button
              type="button"
              pButton
              text
              icon="fa-solid fa-arrow-down"
              pTooltip="Move down"
              tooltipPosition="top"
              [disabled]="i === customCategories().length - 1"
              (click)="moveDown(c)"
              aria-label="Move category down"
            ></button>
            <button
              type="button"
              pButton
              text
              icon="fa-solid fa-pen"
              pTooltip="Rename"
              tooltipPosition="top"
              (click)="openEditModal(c)"
              aria-label="Rename category"
            ></button>
            <button
              type="button"
              pButton
              text
              icon="fa-solid fa-trash"
              [pTooltip]="typeCount(c.id) > 0 ? typeCount(c.id) + ' marker types use this. Reassign them first.' : 'Delete'"
              tooltipPosition="top"
              [disabled]="typeCount(c.id) > 0"
              (click)="deleteCategory(c)"
              aria-label="Delete category"
            ></button>
          }
        </td>
      </tr>
    </ng-template>
    <ng-template #emptymessage>
      <tr>
        <td colspan="3" class="py-6 text-center text-sm text-slate-500">
          @if (spaceRole.canEdit()) {
            No custom categories yet. Add one for markers that do not fit the system categories.
          } @else {
            No custom categories in this space yet.
          }
        </td>
      </tr>
    </ng-template>
  </p-table>

  <p-dialog
    [visible]="modalOpen()"
    (visibleChange)="$event ? null : closeModal()"
    [modal]="true"
    [header]="editingCategory() ? 'Rename category' : 'Add category'"
    [style]="{ width: '28rem' }"
  >
    @if (modalOpen()) {
      <app-marker-category-form
        [category]="editingCategory()"
        (saved)="onSaved()"
        (cancelled)="closeModal()"
      />
    }
  </p-dialog>
</app-manage-page-shell>
```

Note: confirm `ManagePageShellComponent` input names (`title`/`loading`/`error`) and PrimeNG `p-table`/`p-dialog` template ref syntax against the marker-type list before running; adjust to match the codebase exactly. Use the same skeleton/error affordances the marker-type list uses.

- [ ] **Step 3: Register the route**

In `src/client/src/app/app.routes.ts`, add directly after the `settings/marker-types` route block (around line 425):

```typescript
{
  path: 'settings/marker-categories',
  loadComponent: () =>
    import('./features/manage/marker-categories/marker-category-list.component').then(
      (m) => m.MarkerCategoryListComponent
    ),
},
```

- [ ] **Step 4: Add a "Manage categories" link from the marker-type list**

In `marker-type-list.component.ts`, add a method to build the link (mirroring `markersHelpLink`):

```typescript
protected markerCategoriesLink(): string[] {
  const tenantId = this.route.snapshot.paramMap.get('tenantId')!;
  return ['/t', tenantId, 's', this.spaceId, 'settings', 'marker-categories'];
}
```

In `marker-type-list.component.html`, add a small uppercase-tracked reference link near the existing markers-help link (match its styling):

```html
<a
  [routerLink]="markerCategoriesLink()"
  class="text-xs font-semibold uppercase tracking-wide text-brand-700 hover:underline"
>
  Manage categories
</a>
```

- [ ] **Step 5: Write the list-component test**

Create `marker-category-list.component.spec.ts`. Use Angular `TestBed` with stubbed services (follow any existing `*-list.component.spec.ts` if present; otherwise unit-test the pure logic by constructing the component via `runInInjectionContext` with stubbed `MarkerCategoryService`/`MarkerTypeService`/`SpaceRoleService`). Cover:

```typescript
// 1. typeCount reflects the loaded marker types.
// After load() with types [{category_id:'c1'},{category_id:'c1'},{category_id:'c2'}],
// expect component.typeCount('c1') === 2 and typeCount('c2') === 1.

// 2. deleteCategory is a no-op when the category is in use.
// With typeCountByCategory set to {c1:1}, calling deleteCategory({id:'c1',...})
// must NOT call categoryService.delete.

// 3. customCategories excludes system rows and sorts by display_order.
// Given categories [{id:'s',is_system:true,display_order:1},
//   {id:'b',is_system:false,display_order:7},{id:'a',is_system:false,display_order:6}],
// expect customCategories().map(c=>c.id) === ['a','b'].
```

Write each as a concrete `it()` with the stub services returning the fixtures above and asserting the stated expectation. For assertion 2, assert `deleteSpy` was not called.

- [ ] **Step 6: Run tests + lint + build**

Run:
```bash
cd src/client && npm run test:units -- marker-category-list && ng lint && ng build
```
Expected: tests PASS, lint clean, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/client/src/app/features/manage/marker-categories src/client/src/app/app.routes.ts src/client/src/app/features/manage/marker-types/marker-type-list.component.ts src/client/src/app/features/manage/marker-types/marker-type-list.component.html
git commit -m "feat(markers): marker category management page"
```

---

## Task 4: Inline "New category" in the marker-type form

**Files:**
- Modify: `src/client/src/app/features/manage/marker-types/marker-type-form.component.ts`
- Modify: `src/client/src/app/features/manage/marker-types/marker-type-form.component.html`
- Test: `src/client/src/app/features/manage/marker-types/marker-type-form.component.spec.ts` (create)

**Interfaces:**
- Consumes: `MarkerCategoryService.create`, the existing `categories`/`categoryId` signals.
- Produces: inline create flow that appends the new category to `categories()` and sets `categoryId` to the new id.

- [ ] **Step 1: Write the failing test**

Create `marker-type-form.component.spec.ts`. Construct the component via `runInInjectionContext` with a stubbed `MarkerCategoryService` whose `create` resolves to `{ id: 'cat-new', name: 'Manufacturing', space_id: 'space-1', display_order: 6, is_system: false }`, a stubbed `MarkerTypeService`, and a stubbed `ActivatedRoute` (snapshot paramMap returns `spaceId`). Then:

```typescript
it('adds the created category to the list and selects it', async () => {
  // component.newCategoryName set to 'Manufacturing', then:
  await component.confirmNewCategory();

  expect(categoryCreateSpy).toHaveBeenCalledWith('space-1', 'Manufacturing');
  expect(component.categories().some((c) => c.id === 'cat-new')).toBe(true);
  expect(component.categoryId()).toBe('cat-new');
  expect(component.showNewCategory()).toBe(false);
});

it('does not call create for a blank name', async () => {
  component.newCategoryName.set('   ');
  await component.confirmNewCategory();
  expect(categoryCreateSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd src/client && npm run test:units -- marker-type-form.component
```
Expected: FAIL — `showNewCategory`/`newCategoryName`/`confirmNewCategory` not defined.

- [ ] **Step 3: Implement the inline-create logic**

In `marker-type-form.component.ts`, add signals + method:

```typescript
readonly showNewCategory = signal(false);
readonly newCategoryName = signal('');
readonly creatingCategory = signal(false);

toggleNewCategory(): void {
  this.showNewCategory.update((v) => !v);
  this.newCategoryName.set('');
}

async confirmNewCategory(): Promise<void> {
  const name = this.newCategoryName().trim();
  if (!name) return;
  this.creatingCategory.set(true);
  this.error.set(null);
  try {
    const spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    const created = await this.categoryService.create(spaceId, name);
    this.categories.update((list) => [...list, created]);
    this.categoryId.set(created.id);
    this.showNewCategory.set(false);
    this.newCategoryName.set('');
  } catch (e) {
    this.error.set(
      e && typeof e === 'object' && 'message' in e && typeof e.message === 'string'
        ? e.message
        : 'Could not create the category.'
    );
  } finally {
    this.creatingCategory.set(false);
  }
}
```

- [ ] **Step 4: Add the inline affordance to the form HTML**

In `marker-type-form.component.html`, inside the Category `app-form-field` (after the `</p-select>`), add the toggle + inline input:

```html
@if (!showNewCategory()) {
  <button
    type="button"
    pButton
    text
    size="small"
    icon="fa-solid fa-plus"
    label="New category"
    class="mt-1"
    (click)="toggleNewCategory()"
  ></button>
} @else {
  <div class="mt-2 flex items-center gap-2">
    <input
      pInputText
      class="w-full"
      [ngModel]="newCategoryName()"
      (ngModelChange)="newCategoryName.set($event)"
      name="newCategoryName"
      placeholder="New category name"
      aria-label="New category name"
    />
    <button
      type="button"
      pButton
      icon="fa-solid fa-check"
      pTooltip="Create category"
      tooltipPosition="top"
      [disabled]="creatingCategory() || !newCategoryName().trim()"
      (click)="confirmNewCategory()"
      aria-label="Create category"
    ></button>
    <button
      type="button"
      pButton
      text
      icon="fa-solid fa-xmark"
      pTooltip="Cancel"
      tooltipPosition="top"
      (click)="toggleNewCategory()"
      aria-label="Cancel new category"
    ></button>
  </div>
}
```

- [ ] **Step 5: Run the test + lint + build**

Run:
```bash
cd src/client && npm run test:units -- marker-type-form.component && ng lint && ng build
```
Expected: tests PASS, lint clean, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/manage/marker-types/marker-type-form.component.ts src/client/src/app/features/manage/marker-types/marker-type-form.component.html src/client/src/app/features/manage/marker-types/marker-type-form.component.spec.ts
git commit -m "feat(markers): inline new-category create in marker-type form"
```

---

## Task 5: Editorial note in markers-help

**Files:**
- Modify: `src/client/src/app/features/help/markers-help.component.ts`

**Interfaces:**
- Consumes: existing `colorRules`, `faq` computed.
- Produces: one clarifying sentence/FAQ that custom categories carry no brand color convention.

- [ ] **Step 1: Add a sentence after the color-rule list**

In the markers-help template (the "Editorial color rule" block around line 59), add below the `@for (rule of colorRules ...)` list:

```html
<p class="mt-2 text-xs text-slate-500">
  These color roles apply to the system categories. Custom categories added for this
  space use analyst-chosen colors and carry no fixed color convention.
</p>
```

- [ ] **Step 2: Add an FAQ entry**

In the `faq` computed array, add an entry:

```typescript
{
  q: 'Can I add my own marker categories?',
  a: 'Yes. Space owners and editors can add categories from Settings > Marker Categories, then file custom marker types under them. New categories appear as their own group in this legend.',
},
```

- [ ] **Step 3: Lint + build**

Run:
```bash
cd src/client && ng lint && ng build
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/help/markers-help.component.ts
git commit -m "docs(help): note custom marker categories in markers help"
```

---

## Task 6: Docs regen, drift hook, final verification

**Files:**
- Modify (generated): runbook auto-gen blocks via `npm run docs:arch`
- Modify (if needed): `.claude/hooks/runbook-review-guard.sh`

- [ ] **Step 1: Verify the drift hook maps the new help page**

Run:
```bash
grep -n "marker_categories\|markers-help\|marker-categories" .claude/hooks/runbook-review-guard.sh
```
If `marker_categories` is not already mapped to the markers help page, add it to the `helpRules` map (mirror the existing `marker_types` rule). If it already maps, no change.

- [ ] **Step 2: Regenerate architecture docs**

Ensure local Supabase is running (`supabase start`), then:
```bash
cd src/client && npm run docs:arch
```
Expected: regenerates auto-gen blocks; the new route appears in the route tree.

- [ ] **Step 3: Full verification sweep**

Run:
```bash
cd src/client && npm run test:units && ng lint && ng build
```
Expected: all unit tests PASS, lint clean, build succeeds.

- [ ] **Step 4: Commit the regen**

```bash
git add docs .claude/hooks/runbook-review-guard.sh
git commit -m "docs(runbook): regen auto-gen blocks for marker categories"
```

---

## Manual verification (after all tasks)

Run the app locally (`cd src/client && npm start`, local Supabase up), sign in to a space as owner/editor, then:

1. Settings > Marker Types > "Manage categories" opens the page; system categories show locked, custom section empty-state reads correctly.
2. Add a category ("Manufacturing"); it appears in the custom list with 0 marker types and delete enabled.
3. Add a second category; reorder up/down persists across reload.
4. In the marker-type form, "New category" inline creates and auto-selects it; submit stays blocked until a category is chosen.
5. Create a marker type under "Manufacturing"; back on the categories page its count is 1 and delete is disabled with the tooltip.
6. Open the timeline legend: a "MANUFACTURING" group appears at the bottom; the markers-help page shows the new FAQ and the custom-color note.
7. Sign in as a viewer: categories page is read-only, no action buttons.
8. Try to delete an in-use category via the service path (count > 0): the friendly in-use message shows, not a raw Postgres error.

## Out of scope

- Reassigning marker types on category delete (delete-in-use is blocked instead).
- Editing/reordering system categories.
- A catch-all / default bucket.
- Any change to icon shape, fill, color, inner mark, or marker status.
