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
import { fillInput, clearAndFill } from '../helpers/form.helper';
import { clickRowAction } from '../helpers/menu.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Trial Management CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  let trialId: string;
  const trialUrl = () => `/t/${tenantId}/s/${spaceId}/manage/trials/${trialId}`;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60000);

    tenantId = await createTestTenant('Trial CRUD Org');
    spaceId = await createTestSpace(tenantId, 'Trial Test Space');
    const companyId = await createTestCompany(spaceId, 'Trial Test Co');
    const productId = await createTestProduct(spaceId, companyId, 'Trial Test Product');
    const taId = await createTestTherapeuticArea(spaceId, 'Trial TA');
    trialId = await createTestTrial(spaceId, productId, taId, 'Test Trial');

    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('trial detail page loads with sections', async () => {
    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    // Section cards use uppercase h2 headings: "Basic info", "Markers", "Notes"
    // "Phase" section only shows if trial has phase_type set
    await expect(page.getByRole('heading', { name: 'Basic info' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Markers' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
  });

  test('edit trial basic info', async () => {
    // The "Edit details" topbar action opens the trial-edit dialog.
    await page.getByRole('button', { name: 'Edit details' }).click();
    await expect(page.locator('#edit-trial-name')).toBeVisible({ timeout: 5000 });

    await clearAndFill(page, '#edit-trial-name', 'Updated Trial');
    // Dialog submit button is labeled "Save".
    await page.locator('.p-dialog').getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(2000);

    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Updated Trial' })).toBeVisible({ timeout: 10000 });
  });

  test('add a trial marker', async () => {
    // "Add marker" button is inside the Markers section card
    await page.getByRole('button', { name: 'Add marker' }).click();
    await expect(page.locator('#marker-event-date')).toBeVisible({ timeout: 5000 });

    // Select a category first (required)
    await page.locator('#marker-category').click();
    await page.locator('.p-select-option, .p-listbox-option, [role="option"]').first().click();
    await page.waitForTimeout(300);

    // Select a marker type (required, depends on category)
    await page.locator('#marker-type').click();
    await page.locator('.p-select-option, .p-listbox-option, [role="option"]').first().click();
    await page.waitForTimeout(300);

    await fillInput(page, '#marker-title', 'Test marker title');
    await page.waitForTimeout(300);
    await fillInput(page, '#marker-event-date', '2025-03-15');
    await page.waitForTimeout(300);

    // Submit the marker form -- scope to the form to avoid matching the trigger button
    await page.locator('form').getByRole('button', { name: 'Add Marker' }).click();
    await page.waitForTimeout(3000);

    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    // The marker table renders dates via `| date: 'mediumDate'` (e.g. "Mar 15, 2025"),
    // so assert against the marker title instead -- it's unique and format-stable.
    await expect(page.getByText('Test marker title')).toBeVisible({ timeout: 5000 });
  });

  test('delete a trial marker', async () => {
    // Find the marker row by title and open the row-actions menu
    const markerRow = page.locator('tr', { hasText: 'Test marker title' });
    await clickRowAction(page, markerRow, 'Delete');
    // Handle PrimeNG ConfirmDialog
    await page.locator('.p-confirmdialog-accept-button, .p-confirm-dialog-accept').click();
    await page.waitForTimeout(2000);

    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    // Scope the assertion to the markers table -- the activity feed still
    // shows "Marker removed: Test marker title" after the deletion.
    await expect(
      page.locator('p-table tbody').getByText('Test marker title'),
    ).not.toBeVisible({ timeout: 5000 });
  });

  test('add a trial note', async () => {
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.locator('#note-content')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#note-content', 'This is a test note for the trial.');
    await page.locator('form').getByRole('button', { name: 'Add Note' }).click();
    await page.waitForTimeout(2000);

    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    // Scope to the Notes section -- the activity feed also surfaces note text.
    const notesSection = page.locator('app-section-card', { has: page.getByRole('heading', { name: 'Notes' }) });
    await expect(notesSection.getByText('This is a test note for the trial.')).toBeVisible({
      timeout: 5000,
    });
  });

  test('delete a trial note', async () => {
    // Notes use row-actions in a list layout
    const noteContainer = page.locator('li', {
      hasText: 'This is a test note for the trial.',
    });
    await clickRowAction(page, noteContainer, 'Delete');
    // Handle PrimeNG ConfirmDialog
    await page.locator('.p-confirmdialog-accept-button, .p-confirm-dialog-accept').click();
    await page.waitForTimeout(2000);

    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    // Scope to the Notes section -- the activity feed retains "Note removed" text.
    const notesSection = page.locator('app-section-card', { has: page.getByRole('heading', { name: 'Notes' }) });
    await expect(notesSection.getByText('This is a test note for the trial.')).not.toBeVisible({
      timeout: 5000,
    });
  });

  test('back button navigates away from trial detail', async () => {
    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    // The back button is now in the contextual topbar
    await page.locator('.topbar-back').click();
    await expect(page).not.toHaveURL(/\/trials\//);
  });
});

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

  test.afterAll(async () => {
    await page.close();
  });

  test('trial list loads', async () => {
    await page.goto(trialsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Add trial' })).toBeVisible();
  });

  test('create trial via DB and verify it appears in list', async () => {
    // The trial form has many fields with complex Angular bindings that are
    // difficult to set reliably via Playwright. Create via DB helper instead
    // and verify it renders in the list.
    await createTestTrial(spaceId, productId, taId, 'KEYNOTE-001');
    await page.goto(trialsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('KEYNOTE-001')).toBeVisible({ timeout: 10000 });
  });

  test('edit trial from list opens detail and pre-populates dialog', async () => {
    // Edit menuitem on the list row now navigates to the trial detail page,
    // where the "Edit details" topbar action opens the edit dialog.
    const row = page.locator('tr', { hasText: 'KEYNOTE-001' });
    await clickRowAction(page, row, 'Edit');
    await expect(page).toHaveURL(/\/manage\/trials\/[0-9a-f-]+/, { timeout: 10000 });

    await page.getByRole('button', { name: 'Edit details' }).click();
    await expect(page.locator('#edit-trial-name')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#edit-trial-name')).toHaveValue('KEYNOTE-001');

    await clearAndFill(page, '#edit-trial-name', 'KEYNOTE-002');
    await page.locator('.p-dialog').getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(2000);

    await page.goto(trialsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('KEYNOTE-002')).toBeVisible({ timeout: 10000 });
  });

  test('delete trial from list', async () => {
    const row = page.locator('tr', { hasText: 'KEYNOTE-002' });
    await clickRowAction(page, row, 'Delete');
    // Handle PrimeNG ConfirmDialog
    await page.locator('.p-confirmdialog-accept-button, .p-confirm-dialog-accept').click();
    await page.waitForTimeout(2000);

    await page.goto(trialsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('KEYNOTE-002')).not.toBeVisible({ timeout: 5000 });
  });
});
