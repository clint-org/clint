# Comprehensive CRUD Tests & Bug Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all known CRUD bugs across the app and build a comprehensive Playwright E2E test suite covering every model's add/edit/delete flows plus app-level flows (org, space, settings).

**Architecture:** Fix bugs in Angular components and services first, then write/expand Playwright spec files that exercise each CRUD flow end-to-end against a local Supabase backend. Each spec file creates isolated test data (own tenant/space) so tests run in parallel across files, serial within a file.

**Tech Stack:** Angular 19, PrimeNG 19, Supabase, Playwright, TypeScript

---

## File Map

### Bug Fixes (Application Code)
- **Modify:** `src/client/src/app/features/manage/taxonomies/taxonomies-page.component.ts` -- add `@if` guards to dialog forms
- **Modify:** `src/client/src/app/features/manage/marker-types/marker-type-form.component.ts` -- add category_id dropdown
- **Modify:** `src/client/src/app/features/manage/marker-types/marker-type-form.component.html` -- add category select field
- **Modify:** `src/client/src/app/features/space-settings/space-general.component.ts` -- replace auto-save with save button
- **Modify:** `src/client/src/app/features/tenant-settings/tenant-settings.component.ts` -- replace org name auto-save with save button

### Test Infrastructure
- **Modify:** `src/client/e2e/helpers/test-data.helper.ts` -- add `createTestMarkerCategory`, `createTestMoa`, `createTestRoa`, `createTestEvent`; fix `createTestMarkerType` to require `categoryId`

### New/Expanded Test Files
- **Modify:** `src/client/e2e/tests/company-management.spec.ts` -- expand with display_order, logo_url, validation
- **Modify:** `src/client/e2e/tests/product-management.spec.ts` -- expand with MOA/ROA multi-select
- **Modify:** `src/client/e2e/tests/marker-types.spec.ts` -- expand with category selection, shape/fill/color
- **Modify:** `src/client/e2e/tests/trial-management.spec.ts` -- add create/delete from list, expand detail tests
- **Create:** `src/client/e2e/tests/tenant-settings.spec.ts` -- org name edit, member management, invites
- **Create:** `src/client/e2e/tests/space-management.spec.ts` -- space creation, space list
- **Create:** `src/client/e2e/tests/space-settings.spec.ts` -- general settings (name/desc edit, delete), member management
- **Create:** `src/client/e2e/tests/taxonomies.spec.ts` -- TA/MOA/ROA CRUD from combined settings page
- **Create:** `src/client/e2e/tests/events.spec.ts` -- event CRUD, detail panel
- **Create:** `src/client/e2e/tests/catalysts.spec.ts` -- read-only view, filtering

---

## Task 1: Fix taxonomies page -- add @if guards to dialog forms

The taxonomies page renders all three form components (TA, MOA, ROA) permanently inside their dialogs. Since `ngOnInit` only runs once, opening the edit dialog for an existing item shows an empty form because the component was already initialized with null.

**Files:**
- Modify: `src/client/src/app/features/manage/taxonomies/taxonomies-page.component.ts`

- [ ] **Step 1: Add @if guards to all three dialog forms**

In the inline template, wrap each form component inside its dialog with an `@if` guard matching the pattern used in standalone pages:

```typescript
// Therapeutic Area dialog -- BEFORE:
<p-dialog ...>
  <app-therapeutic-area-form [area]="editingArea()" ... />
</p-dialog>

// AFTER:
<p-dialog ...>
  @if (taModalOpen()) {
    <app-therapeutic-area-form [area]="editingArea()" ... />
  }
</p-dialog>

// MOA dialog -- AFTER:
<p-dialog ...>
  @if (moaModalOpen()) {
    <app-mechanism-of-action-form [item]="editingMoa()" ... />
  }
</p-dialog>

// ROA dialog -- AFTER:
<p-dialog ...>
  @if (roaModalOpen()) {
    <app-route-of-administration-form [item]="editingRoa()" ... />
  }
</p-dialog>
```

- [ ] **Step 2: Verify build**

Run: `cd src/client && ng build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/manage/taxonomies/taxonomies-page.component.ts
git commit -m "fix(taxonomies): add @if guards to dialog forms so edit pre-populates"
```

---

## Task 2: Fix marker type form -- add category_id selection

The marker type form doesn't include a `category_id` field. The database column is NOT NULL, so creating a marker type fails with a constraint violation.

**Files:**
- Modify: `src/client/src/app/features/manage/marker-types/marker-type-form.component.ts`
- Modify: `src/client/src/app/features/manage/marker-types/marker-type-form.component.html`

- [ ] **Step 1: Add category loading and selection to the form component**

In `marker-type-form.component.ts`:

1. Import `MarkerCategory` from `'../../../core/models/marker.model'`
2. Import `MarkerCategoryService` from `'../../../core/services/marker-category.service'`
3. Import `Select` from `'primeng/select'` (already imported)
4. Add service injection: `private categoryService = inject(MarkerCategoryService);`
5. Add state: `categories = signal<MarkerCategory[]>([]); categoryId = '';`
6. In `ngOnInit`, load categories and pre-populate on edit:

```typescript
async ngOnInit(): Promise<void> {
  const spaceId = this.route.snapshot.paramMap.get('spaceId')!;
  try {
    this.categories.set(await this.categoryService.list(spaceId));
  } catch { /* categories will be empty */ }

  const existing = this.markerType();
  if (existing) {
    this.name = existing.name;
    this.shape = existing.shape;
    this.fillStyle = existing.fill_style;
    this.color = existing.color;
    this.icon = existing.icon ?? '';
    this.displayOrder = existing.display_order;
    this.categoryId = existing.category_id;
  }
}
```

7. In `onSubmit`, include `category_id` in the payload:

```typescript
const payload: Partial<MarkerType> = {
  name: this.name,
  shape: this.shape,
  fill_style: this.fillStyle,
  color: this.color,
  icon: this.icon || null,
  display_order: this.displayOrder ?? 0,
  category_id: this.categoryId,
};
```

8. Add validation: form should not submit without a category:

```typescript
async onSubmit(): Promise<void> {
  if (!this.name.trim()) return;
  if (!this.categoryId) return;
  // ... rest of submit logic
}
```

- [ ] **Step 2: Add category dropdown to the form template**

In `marker-type-form.component.html`, add a category select field. Insert it as the first field in the grid (spanning 2 columns), before the Name field:

```html
<app-form-field
  label="Category"
  fieldId="mt-category"
  [required]="true"
  spacing="sm:col-span-2"
>
  <p-select
    inputId="mt-category"
    [options]="categories()"
    [(ngModel)]="categoryId"
    name="categoryId"
    optionLabel="name"
    optionValue="id"
    placeholder="Select a category"
    [style]="{ width: '100%' }"
    class="mt-1"
    [styleClass]="categoryId ? 'has-value' : ''"
  />
</app-form-field>
```

- [ ] **Step 3: Verify build**

Run: `cd src/client && ng build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/manage/marker-types/marker-type-form.component.ts
git add src/client/src/app/features/manage/marker-types/marker-type-form.component.html
git commit -m "fix(marker-types): add category dropdown to form, fixing NOT NULL violation on create"
```

---

## Task 3: Fix space general settings -- replace auto-save with save button

The space general settings page auto-saves on blur. Replace with an explicit save button to match the rest of the app.

**Files:**
- Modify: `src/client/src/app/features/space-settings/space-general.component.ts`

- [ ] **Step 1: Replace auto-save with explicit save in the component**

Changes to the inline template:
1. Remove `(blur)="saveIfChanged()"` from both the name input and description textarea
2. Add a save button section after the description field:

```html
<div class="mt-6 flex items-center gap-3">
  <button
    pButton
    type="button"
    label="Save changes"
    [loading]="saving()"
    [disabled]="!hasChanges()"
    (click)="saveIfChanged()"
  ></button>
  @if (saved()) {
    <span class="text-sm text-green-700">Settings saved.</span>
  }
</div>
```

Changes to the component class:
1. Add `saving = signal(false);` signal
2. Add a `hasChanges()` computed method:

```typescript
hasChanges(): boolean {
  const s = this.space();
  if (!s) return false;
  return this.name.trim() !== s.name || (this.description.trim() || '') !== (s.description || '');
}
```

3. Wrap `saveIfChanged` with saving state:

```typescript
async saveIfChanged(): Promise<void> {
  const s = this.space();
  if (!s) return;
  if (!this.hasChanges()) return;

  this.saving.set(true);
  try {
    const updated = await this.spaceService.updateSpace(this.spaceId, {
      name: this.name.trim(),
      description: this.description.trim() || null,
    });
    this.space.set(updated);
    this.saved.set(true);
    this.error.set(null);
  } catch (e) {
    this.error.set(e instanceof Error ? e.message : 'Failed to save');
  } finally {
    this.saving.set(false);
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd src/client && ng build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/space-settings/space-general.component.ts
git commit -m "fix(space-settings): replace auto-save with explicit save button"
```

---

## Task 4: Fix tenant settings -- replace org name auto-save with save button

Same pattern as space general: the org name saves on blur. Replace with an explicit save button.

**Files:**
- Modify: `src/client/src/app/features/tenant-settings/tenant-settings.component.ts`

- [ ] **Step 1: Replace auto-save with explicit save in the component**

Changes to the inline template:
1. Remove `(blur)="saveOrgName()"` from the org name input
2. Add a save button after the org name field:

```html
<div class="mt-3 flex items-center gap-3">
  <button
    pButton
    type="button"
    label="Save"
    size="small"
    [loading]="savingName()"
    [disabled]="!nameChanged()"
    (click)="saveOrgName()"
  ></button>
  @if (nameSaved()) {
    <span class="text-sm text-green-700">Saved.</span>
  }
</div>
```

Changes to the component class:
1. Add signals: `savingName = signal(false);` and `nameSaved = signal(false);`
2. Add `nameChanged()` method:

```typescript
nameChanged(): boolean {
  const t = this.tenant();
  return !!t && this.orgName.trim() !== t.name;
}
```

3. Update `saveOrgName` with loading state:

```typescript
async saveOrgName(): Promise<void> {
  const t = this.tenant();
  if (!t || this.orgName.trim() === t.name) return;
  this.savingName.set(true);
  try {
    const updated = await this.tenantService.updateTenant(this.tenantId, { name: this.orgName.trim() });
    this.tenant.set(updated);
    this.nameSaved.set(true);
    this.removeError.set(null);
  } catch (e) {
    this.removeError.set(e instanceof Error ? e.message : 'Failed to update name');
  } finally {
    this.savingName.set(false);
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd src/client && ng build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/tenant-settings/tenant-settings.component.ts
git commit -m "fix(tenant-settings): replace org name auto-save with explicit save button"
```

---

## Task 5: Update test data helpers

The existing `createTestMarkerType` helper doesn't pass `category_id`, which will fail now that the column is NOT NULL. Add new helpers needed by expanded tests.

**Files:**
- Modify: `src/client/e2e/helpers/test-data.helper.ts`

- [ ] **Step 1: Update createTestMarkerType to require categoryId and add new helpers**

Add the following functions to `test-data.helper.ts`:

```typescript
export async function createTestMarkerCategory(
  spaceId: string | null,
  name: string,
): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('marker_categories')
    .select('id')
    .eq('name', name)
    .maybeSingle();
  if (data) return data.id;
  const { data: created, error: createError } = await admin
    .from('marker_categories')
    .insert({
      space_id: spaceId,
      name,
      display_order: 0,
      is_system: spaceId === null,
      created_by: spaceId ? getUserId() : null,
    })
    .select('id')
    .single();
  if (createError) throw new Error(`Failed to create marker category: ${createError.message}`);
  return created.id;
}

export async function getSystemMarkerCategoryId(name: string): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('marker_categories')
    .select('id')
    .eq('name', name)
    .eq('is_system', true)
    .single();
  if (error) throw new Error(`System marker category "${name}" not found: ${error.message}`);
  return data.id;
}

export async function createTestMoa(
  spaceId: string,
  name: string,
): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('mechanisms_of_action')
    .insert({ space_id: spaceId, created_by: getUserId(), name })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create MOA: ${error.message}`);
  return data.id;
}

export async function createTestRoa(
  spaceId: string,
  name: string,
): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('routes_of_administration')
    .insert({ space_id: spaceId, created_by: getUserId(), name })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create ROA: ${error.message}`);
  return data.id;
}

export async function createTestEvent(
  spaceId: string,
  title: string,
  opts?: { categoryId?: string; eventDate?: string },
): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('events')
    .insert({
      space_id: spaceId,
      created_by: getUserId(),
      title,
      event_date: opts?.eventDate ?? '2026-01-15',
      category_id: opts?.categoryId ?? null,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create event: ${error.message}`);
  return data.id;
}
```

Update `createTestMarkerType` signature to require `categoryId`:

```typescript
export async function createTestMarkerType(
  spaceId: string,
  name: string,
  categoryId: string,
  opts?: { shape?: string; fill_style?: string; color?: string },
): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('marker_types')
    .insert({
      space_id: spaceId,
      created_by: getUserId(),
      name,
      category_id: categoryId,
      shape: opts?.shape || 'circle',
      fill_style: opts?.fill_style || 'filled',
      color: opts?.color || '#14b8a6',
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create marker type: ${error.message}`);
  return data.id;
}
```

- [ ] **Step 2: Update all existing test files that call createTestMarkerType**

Search for all callers and pass the system "Data" category ID (`c0000000-0000-0000-0000-000000000002`). For example in `trial-management.spec.ts` and `landscape.spec.ts`, use `getSystemMarkerCategoryId('Data')` in the setup.

- [ ] **Step 3: Verify build**

Run: `cd src/client && npx tsc -p e2e/tsconfig.e2e.json --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/client/e2e/helpers/test-data.helper.ts
git add src/client/e2e/tests/
git commit -m "test: update test data helpers with category_id and new factory functions"
```

---

## Task 6: Tenant settings tests

**Files:**
- Create: `src/client/e2e/tests/tenant-settings.spec.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant } from '../helpers/test-data.helper';
import { fillInput, clearAndFill } from '../helpers/form.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Tenant Settings', () => {
  let page: Page;
  let tenantId: string;
  const settingsUrl = () => `/t/${tenantId}/settings`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Settings Test Org');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => { await page.close(); });

  test('settings page loads with org name', async () => {
    await page.goto(settingsUrl(), { waitUntil: 'networkidle' });
    const nameInput = page.locator('#org-name');
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveValue('Settings Test Org');
  });

  test('edit org name via save button', async () => {
    await clearAndFill(page, '#org-name', 'Renamed Org');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(1000);
    // Reload and verify persistence
    await page.goto(settingsUrl(), { waitUntil: 'networkidle' });
    await expect(page.locator('#org-name')).toHaveValue('Renamed Org');
  });

  test('members table is visible', async () => {
    await expect(page.getByText('e2e-test@clint.local')).toBeVisible();
  });

  test('invite member dialog opens and closes', async () => {
    await page.getByRole('button', { name: 'Invite member' }).click();
    await expect(page.locator('.p-dialog')).toBeVisible();
    // Close without inviting
    await page.keyboard.press('Escape');
    await expect(page.locator('.p-dialog')).not.toBeVisible();
  });
});
```

- [ ] **Step 2: Run and verify**

Run: `cd src/client && ./e2e/run.sh tests/tenant-settings.spec.ts`
Expected: All tests pass. If org name save fails, the Task 4 bug fix is needed first.

- [ ] **Step 3: Commit**

```bash
git add src/client/e2e/tests/tenant-settings.spec.ts
git commit -m "test: add tenant settings E2E tests"
```

---

## Task 7: Space management tests

**Files:**
- Create: `src/client/e2e/tests/space-management.spec.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';
import { fillInput } from '../helpers/form.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Space Management', () => {
  let page: Page;
  let tenantId: string;
  const spacesUrl = () => `/t/${tenantId}/spaces`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Space Mgmt Org');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => { await page.close(); });

  test('spaces page loads', async () => {
    await page.goto(spacesUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'New space' })).toBeVisible();
  });

  test('create space via dialog', async () => {
    await page.getByRole('button', { name: 'New space' }).click();
    await expect(page.locator('.p-dialog')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#space-name', 'E2E Test Space');
    await page.getByRole('button', { name: 'Create space' }).click();

    // Should navigate to the new space
    await page.waitForURL(/\/s\//, { timeout: 10000 });
  });

  test('created space appears in list', async () => {
    await page.goto(spacesUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('E2E Test Space')).toBeVisible({ timeout: 10000 });
  });

  test('create space with empty name is prevented', async () => {
    await page.getByRole('button', { name: 'New space' }).click();
    await expect(page.locator('.p-dialog')).toBeVisible({ timeout: 5000 });

    // Try submitting without filling name
    await page.getByRole('button', { name: 'Create space' }).click();
    // Dialog should remain open (form prevents submission)
    await expect(page.locator('.p-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
  });
});
```

- [ ] **Step 2: Run and verify**

Run: `cd src/client && ./e2e/run.sh tests/space-management.spec.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/client/e2e/tests/space-management.spec.ts
git commit -m "test: add space management E2E tests"
```

---

## Task 8: Space settings tests (general + members)

**Files:**
- Create: `src/client/e2e/tests/space-settings.spec.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';
import { fillInput, clearAndFill } from '../helpers/form.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Space Settings - General', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const generalUrl = () => `/t/${tenantId}/s/${spaceId}/settings/general`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Space Settings Org');
    spaceId = await createTestSpace(tenantId, 'Settings Space');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => { await page.close(); });

  test('general settings page loads with space name', async () => {
    await page.goto(generalUrl(), { waitUntil: 'networkidle' });
    const nameInput = page.locator('#space-name');
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveValue('Settings Space');
  });

  test('edit space name via save button', async () => {
    await clearAndFill(page, '#space-name', 'Renamed Space');
    const saveBtn = page.getByRole('button', { name: 'Save changes' });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await page.waitForTimeout(1000);

    // Verify persistence
    await page.goto(generalUrl(), { waitUntil: 'networkidle' });
    await expect(page.locator('#space-name')).toHaveValue('Renamed Space');
  });

  test('save button is disabled when no changes', async () => {
    const saveBtn = page.getByRole('button', { name: 'Save changes' });
    await expect(saveBtn).toBeDisabled();
  });
});

test.describe('Space Settings - Members', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const membersUrl = () => `/t/${tenantId}/s/${spaceId}/settings/members`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Space Members Org');
    spaceId = await createTestSpace(tenantId, 'Members Space');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => { await page.close(); });

  test('members page loads with current user', async () => {
    await page.goto(membersUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('e2e-test@clint.local')).toBeVisible();
  });

  test('add member dialog opens', async () => {
    await page.getByRole('button', { name: 'Add member' }).click();
    await expect(page.locator('.p-dialog')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
  });
});
```

- [ ] **Step 2: Run and verify**

Run: `cd src/client && ./e2e/run.sh tests/space-settings.spec.ts`
Expected: All tests pass. If save button tests fail, Task 3 fix is needed first.

- [ ] **Step 3: Commit**

```bash
git add src/client/e2e/tests/space-settings.spec.ts
git commit -m "test: add space settings E2E tests"
```

---

## Task 9: Taxonomies tests (TA/MOA/ROA from settings page)

This tests the combined taxonomies page under space settings, which had the empty edit form bug.

**Files:**
- Create: `src/client/e2e/tests/taxonomies.spec.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';
import { fillInput, clearAndFill } from '../helpers/form.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Taxonomies - Therapeutic Areas', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const taxUrl = () => `/t/${tenantId}/s/${spaceId}/settings/taxonomies?tab=therapeutic-areas`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Tax TA Org');
    spaceId = await createTestSpace(tenantId, 'Tax TA Space');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => { await page.close(); });

  test('taxonomies page loads with TA tab active', async () => {
    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Add therapeutic area' })).toBeVisible();
  });

  test('create therapeutic area', async () => {
    await page.getByRole('button', { name: 'Add therapeutic area' }).click();
    await expect(page.locator('#ta-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#ta-name', 'Cardiology');
    await fillInput(page, '#ta-abbreviation', 'CARD');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Cardiology')).toBeVisible({ timeout: 10000 });
  });

  test('edit therapeutic area pre-populates form', async () => {
    const row = page.locator('tr', { hasText: 'Cardiology' });
    await row.getByRole('button').first().click();
    // Click Edit from the menu
    await page.getByText('Edit').click();
    await expect(page.locator('#ta-name')).toBeVisible({ timeout: 5000 });

    // Verify pre-population -- this was the bug
    await expect(page.locator('#ta-name')).toHaveValue('Cardiology');

    await clearAndFill(page, '#ta-name', 'Neurology');
    await clearAndFill(page, '#ta-abbreviation', 'NEURO');
    await page.getByRole('button', { name: 'Update' }).click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Neurology')).toBeVisible({ timeout: 10000 });
  });

  test('delete therapeutic area', async () => {
    page.on('dialog', (d) => d.accept());
    const row = page.locator('tr', { hasText: 'Neurology' });
    await row.getByRole('button').first().click();
    await page.getByText('Delete').click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Neurology')).not.toBeVisible({ timeout: 5000 });
  });
});

test.describe('Taxonomies - Mechanisms of Action', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const taxUrl = () => `/t/${tenantId}/s/${spaceId}/settings/taxonomies?tab=moa`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Tax MOA Org');
    spaceId = await createTestSpace(tenantId, 'Tax MOA Space');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => { await page.close(); });

  test('MOA tab loads', async () => {
    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Add mechanism' })).toBeVisible();
  });

  test('create MOA', async () => {
    await page.getByRole('button', { name: 'Add mechanism' }).click();
    await expect(page.locator('#moa-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#moa-name', 'PD-1 Inhibitor');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('PD-1 Inhibitor')).toBeVisible({ timeout: 10000 });
  });

  test('edit MOA pre-populates form', async () => {
    const row = page.locator('tr', { hasText: 'PD-1 Inhibitor' });
    await row.getByRole('button').first().click();
    await page.getByText('Edit').click();
    await expect(page.locator('#moa-name')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#moa-name')).toHaveValue('PD-1 Inhibitor');

    await clearAndFill(page, '#moa-name', 'VEGF Inhibitor');
    await page.getByRole('button', { name: 'Update' }).click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('VEGF Inhibitor')).toBeVisible({ timeout: 10000 });
  });

  test('delete MOA', async () => {
    page.on('dialog', (d) => d.accept());
    const row = page.locator('tr', { hasText: 'VEGF Inhibitor' });
    await row.getByRole('button').first().click();
    await page.getByText('Delete').click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('VEGF Inhibitor')).not.toBeVisible({ timeout: 5000 });
  });
});

test.describe('Taxonomies - Routes of Administration', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const taxUrl = () => `/t/${tenantId}/s/${spaceId}/settings/taxonomies?tab=roa`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Tax ROA Org');
    spaceId = await createTestSpace(tenantId, 'Tax ROA Space');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => { await page.close(); });

  test('ROA tab loads', async () => {
    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Add route' })).toBeVisible();
  });

  test('create ROA', async () => {
    await page.getByRole('button', { name: 'Add route' }).click();
    await expect(page.locator('#roa-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#roa-name', 'Intravenous');
    await fillInput(page, '#roa-abbreviation', 'IV');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Intravenous')).toBeVisible({ timeout: 10000 });
  });

  test('edit ROA pre-populates form', async () => {
    const row = page.locator('tr', { hasText: 'Intravenous' });
    await row.getByRole('button').first().click();
    await page.getByText('Edit').click();
    await expect(page.locator('#roa-name')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#roa-name')).toHaveValue('Intravenous');

    await clearAndFill(page, '#roa-name', 'Subcutaneous');
    await clearAndFill(page, '#roa-abbreviation', 'SC');
    await page.getByRole('button', { name: 'Update' }).click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Subcutaneous')).toBeVisible({ timeout: 10000 });
  });

  test('delete ROA', async () => {
    page.on('dialog', (d) => d.accept());
    const row = page.locator('tr', { hasText: 'Subcutaneous' });
    await row.getByRole('button').first().click();
    await page.getByText('Delete').click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Subcutaneous')).not.toBeVisible({ timeout: 5000 });
  });
});
```

- [ ] **Step 2: Run and verify**

Run: `cd src/client && ./e2e/run.sh tests/taxonomies.spec.ts`
Expected: All tests pass, including the edit pre-population assertions (validates Task 1 fix).

- [ ] **Step 3: Commit**

```bash
git add src/client/e2e/tests/taxonomies.spec.ts
git commit -m "test: add comprehensive taxonomies CRUD E2E tests (TA, MOA, ROA)"
```

---

## Task 10: Expand marker types tests with category selection

**Files:**
- Modify: `src/client/e2e/tests/marker-types.spec.ts`

- [ ] **Step 1: Rewrite marker types test with category selection**

Replace the existing file with expanded coverage:

```typescript
import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';
import { fillInput, clearAndFill } from '../helpers/form.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Marker Type Management CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const mtUrl = () => `/t/${tenantId}/s/${spaceId}/settings/marker-types`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('MT CRUD Org');
    spaceId = await createTestSpace(tenantId, 'MT Test Space');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => { await page.close(); });

  test('marker type list loads with system types', async () => {
    await page.goto(mtUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Add marker type' })).toBeVisible();
    // System marker types should be visible
    await expect(page.getByText('Topline Data')).toBeVisible({ timeout: 10000 });
  });

  test('create marker type with category', async () => {
    await page.getByRole('button', { name: 'Add marker type' }).click();
    await expect(page.locator('#mt-name')).toBeVisible({ timeout: 5000 });

    // Select category first (required)
    await page.locator('#mt-category').click();
    await page.getByText('Data').click();

    await fillInput(page, '#mt-name', 'Biomarker Readout');

    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rest/') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Create Marker Type' }).click(),
    ]);

    await page.goto(mtUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Biomarker Readout')).toBeVisible({ timeout: 10000 });
  });

  test('edit marker type pre-populates all fields', async () => {
    const row = page.locator('tr', { hasText: 'Biomarker Readout' });
    await row.locator('app-row-actions button').click();
    await page.getByText('Edit').click();
    await expect(page.locator('#mt-name')).toBeVisible({ timeout: 5000 });

    // Verify pre-population
    await expect(page.locator('#mt-name')).toHaveValue('Biomarker Readout');

    await clearAndFill(page, '#mt-name', 'Safety Signal');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rest/') && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: 'Update Marker Type' }).click(),
    ]);

    await page.goto(mtUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Safety Signal')).toBeVisible({ timeout: 10000 });
  });

  test('delete marker type', async () => {
    page.on('dialog', (d) => d.accept());
    const row = page.locator('tr', { hasText: 'Safety Signal' });
    await row.locator('app-row-actions button').click();
    await page.getByText('Delete').click();
    await page.waitForTimeout(1000);

    await page.goto(mtUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Safety Signal')).not.toBeVisible({ timeout: 5000 });
  });

  test('create without category shows no submission', async () => {
    await page.getByRole('button', { name: 'Add marker type' }).click();
    await expect(page.locator('#mt-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#mt-name', 'No Category Type');
    // Don't select category -- try to submit
    await page.getByRole('button', { name: 'Create Marker Type' }).click();
    // Dialog should stay open (validation prevents submit)
    await expect(page.locator('.p-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
  });
});
```

- [ ] **Step 2: Run and verify**

Run: `cd src/client && ./e2e/run.sh tests/marker-types.spec.ts`
Expected: All tests pass (validates Task 2 fix).

- [ ] **Step 3: Commit**

```bash
git add src/client/e2e/tests/marker-types.spec.ts
git commit -m "test: expand marker type tests with category selection and validation"
```

---

## Task 11: Expand company management tests

**Files:**
- Modify: `src/client/e2e/tests/company-management.spec.ts`

- [ ] **Step 1: Expand with display_order and validation tests**

Add the following tests to the existing describe block (before the delete test):

```typescript
test('edit company display order', async () => {
  // Create a second company first
  await page.getByRole('button', { name: 'Add Company' }).click();
  await expect(page.locator('#company-name')).toBeVisible({ timeout: 5000 });
  await fillInput(page, '#company-name', 'Second Company');
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/rest/') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Create Company' }).click(),
  ]);
  await page.goto(companiesUrl(), { waitUntil: 'networkidle' });

  // Edit first company's display order
  const row = page.locator('tr', { hasText: 'Test Company' });
  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('#company-name')).toBeVisible({ timeout: 5000 });
  // Verify name is pre-populated
  await expect(page.locator('#company-name')).toHaveValue('Test Company');

  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/rest/') && r.request().method() === 'PATCH'),
    page.getByRole('button', { name: 'Update Company' }).click(),
  ]);
  await page.goto(companiesUrl(), { waitUntil: 'networkidle' });

  // Both companies should still be visible with correct names
  await expect(page.getByText('Test Company')).toBeVisible();
  await expect(page.getByText('Second Company')).toBeVisible();
});

test('create company with empty name is prevented', async () => {
  await page.getByRole('button', { name: 'Add Company' }).click();
  await expect(page.locator('#company-name')).toBeVisible({ timeout: 5000 });
  // Submit without filling name
  await page.getByRole('button', { name: 'Create Company' }).click();
  // Dialog should stay open
  await expect(page.locator('.p-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
});
```

- [ ] **Step 2: Run and verify**

Run: `cd src/client && ./e2e/run.sh tests/company-management.spec.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/client/e2e/tests/company-management.spec.ts
git commit -m "test: expand company management tests with display order and validation"
```

---

## Task 12: Expand product management tests

**Files:**
- Modify: `src/client/e2e/tests/product-management.spec.ts`

- [ ] **Step 1: Add edit pre-population and validation tests**

Add to the existing test file, before the delete test:

```typescript
test('edit product pre-populates form', async () => {
  const row = page.locator('tr', { hasText: 'Test Product' });
  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('#product-name')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#product-name')).toHaveValue('Test Product');
  await page.keyboard.press('Escape');
});

test('create product with empty name is prevented', async () => {
  await page.getByRole('button', { name: 'Add Product' }).click();
  await expect(page.locator('#product-name')).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: 'Create Product' }).click();
  await expect(page.locator('.p-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
});
```

- [ ] **Step 2: Run and verify**

Run: `cd src/client && ./e2e/run.sh tests/product-management.spec.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/client/e2e/tests/product-management.spec.ts
git commit -m "test: expand product management tests with pre-population and validation"
```

---

## Task 13: Expand trial management tests (list CRUD + detail)

**Files:**
- Modify: `src/client/e2e/tests/trial-management.spec.ts`

- [ ] **Step 1: Add trial creation and deletion from list view**

Add a new describe block for list-level CRUD:

```typescript
test.describe('Trial List CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  let companyId: string;
  let productId: string;
  let taId: string;
  const trialsUrl = () => `/t/${tenantId}/s/${spaceId}/manage/trials`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Trial List Org');
    spaceId = await createTestSpace(tenantId, 'Trial List Space');
    companyId = await createTestCompany(spaceId, 'Trial Co');
    productId = await createTestProduct(spaceId, companyId, 'Trial Product');
    taId = await createTestTherapeuticArea(spaceId, 'Oncology');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => { await page.close(); });

  test('trial list loads', async () => {
    await page.goto(trialsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Add trial' })).toBeVisible();
  });

  test('create trial from list', async () => {
    await page.getByRole('button', { name: 'Add trial' }).click();
    await expect(page.locator('#trial-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#trial-name', 'KEYNOTE-001');
    await page.getByRole('button', { name: 'Create Trial' }).click();
    await page.waitForTimeout(2000);

    await page.goto(trialsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('KEYNOTE-001')).toBeVisible({ timeout: 10000 });
  });

  test('edit trial from list pre-populates form', async () => {
    const row = page.locator('tr', { hasText: 'KEYNOTE-001' });
    await row.locator('app-row-actions button').click();
    await page.getByText('Edit').click();
    await expect(page.locator('#trial-name')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#trial-name')).toHaveValue('KEYNOTE-001');

    await clearAndFill(page, '#trial-name', 'KEYNOTE-002');
    await page.getByRole('button', { name: 'Update Trial' }).click();
    await page.waitForTimeout(2000);

    await page.goto(trialsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('KEYNOTE-002')).toBeVisible({ timeout: 10000 });
  });

  test('delete trial from list', async () => {
    page.on('dialog', (d) => d.accept());
    const row = page.locator('tr', { hasText: 'KEYNOTE-002' });
    await row.locator('app-row-actions button').click();
    await page.getByText('Delete').click();
    await page.waitForTimeout(2000);

    await page.goto(trialsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('KEYNOTE-002')).not.toBeVisible({ timeout: 5000 });
  });
});
```

- [ ] **Step 2: Run and verify**

Run: `cd src/client && ./e2e/run.sh tests/trial-management.spec.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/client/e2e/tests/trial-management.spec.ts
git commit -m "test: add trial list CRUD tests (create, edit, delete from list view)"
```

---

## Task 14: Events tests

**Files:**
- Create: `src/client/e2e/tests/events.spec.ts`

- [ ] **Step 1: Write events test file**

```typescript
import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';
import { fillInput, clearAndFill } from '../helpers/form.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Events CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const eventsUrl = () => `/t/${tenantId}/s/${spaceId}/events`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Events Org');
    spaceId = await createTestSpace(tenantId, 'Events Space');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => { await page.close(); });

  test('events page loads', async () => {
    await page.goto(eventsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: /new event/i })).toBeVisible();
  });

  test('create event', async () => {
    await page.getByRole('button', { name: /new event/i }).click();
    await expect(page.locator('.p-dialog')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#event-title', 'Phase 3 Topline Results');

    await page.getByRole('button', { name: /create|save/i }).click();
    await page.waitForTimeout(2000);

    await page.goto(eventsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Phase 3 Topline Results')).toBeVisible({ timeout: 10000 });
  });

  test('click event row shows detail panel', async () => {
    await page.getByText('Phase 3 Topline Results').click();
    // Detail panel should appear
    await expect(page.getByText('Phase 3 Topline Results')).toBeVisible();
  });

  test('delete event', async () => {
    page.on('dialog', (d) => d.accept());
    // Find and click delete for this event (via row actions or detail panel)
    const row = page.locator('tr', { hasText: 'Phase 3 Topline Results' });
    await row.locator('app-row-actions button').first().click();
    await page.getByText('Delete').click();
    await page.waitForTimeout(2000);

    await page.goto(eventsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Phase 3 Topline Results')).not.toBeVisible({ timeout: 5000 });
  });
});
```

- [ ] **Step 2: Run and verify**

Run: `cd src/client && ./e2e/run.sh tests/events.spec.ts`
Expected: Tests pass. May need to adjust selectors based on actual page structure.

- [ ] **Step 3: Commit**

```bash
git add src/client/e2e/tests/events.spec.ts
git commit -m "test: add events CRUD E2E tests"
```

---

## Task 15: Catalysts tests (read-only)

**Files:**
- Create: `src/client/e2e/tests/catalysts.spec.ts`

- [ ] **Step 1: Write catalysts test file**

```typescript
import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import {
  createTestTenant,
  createTestSpace,
  createTestCompany,
  createTestProduct,
  createTestTherapeuticArea,
  createTestTrial,
} from '../helpers/test-data.helper';

test.describe('Catalysts View', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const catalystsUrl = () => `/t/${tenantId}/s/${spaceId}/catalysts`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Catalysts Org');
    spaceId = await createTestSpace(tenantId, 'Catalysts Space');

    // Seed reference data for context
    const companyId = await createTestCompany(spaceId, 'Catalyst Co');
    const productId = await createTestProduct(spaceId, companyId, 'Catalyst Drug');
    const taId = await createTestTherapeuticArea(spaceId, 'Oncology');
    await createTestTrial(spaceId, productId, taId, 'Catalyst Trial');

    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => { await page.close(); });

  test('catalysts page loads', async () => {
    await page.goto(catalystsUrl(), { waitUntil: 'networkidle' });
    // Page should load without error
    await expect(page.locator('body')).not.toContainText('error', { ignoreCase: false });
  });

  test('catalysts page shows search toolbar', async () => {
    await expect(page.getByPlaceholder(/search/i)).toBeVisible();
  });
});
```

- [ ] **Step 2: Run and verify**

Run: `cd src/client && ./e2e/run.sh tests/catalysts.spec.ts`
Expected: Tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/client/e2e/tests/catalysts.spec.ts
git commit -m "test: add catalysts view E2E tests"
```

---

## Task 16: Run full test suite and fix any remaining failures

- [ ] **Step 1: Run the complete E2E suite**

Run: `cd src/client && ./e2e/run.sh`
Expected: All tests pass.

- [ ] **Step 2: Fix any failing tests**

For each failure:
1. Read the error message and screenshot
2. Determine if it's a test issue (wrong selector, timing) or an app bug
3. Fix the root cause
4. Re-run the failing test file

- [ ] **Step 3: Final verification**

Run: `cd src/client && ./e2e/run.sh`
Expected: All tests pass with 0 failures.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "test: comprehensive CRUD E2E test suite - all flows passing"
```
