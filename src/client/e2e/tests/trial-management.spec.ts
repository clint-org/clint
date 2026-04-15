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
    // The "Edit trial" button is in the topbar actions (set by the component)
    await page.getByRole('button', { name: 'Edit trial' }).click();
    await expect(page.locator('#trial-name')).toBeVisible({ timeout: 5000 });

    await clearAndFill(page, '#trial-name', 'Updated Trial');
    // Submit button says "Update trial" (lowercase)
    await page.getByRole('button', { name: 'Update trial' }).click();
    await page.waitForTimeout(2000);

    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Updated Trial')).toBeVisible({ timeout: 10000 });
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
    await expect(page.getByText('2025-03-15')).toBeVisible({ timeout: 5000 });
  });

  test('delete a trial marker', async () => {
    // Find the marker row and open the row-actions menu
    const markerRow = page.locator('tr', { hasText: '2025-03-15' });
    await markerRow.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    // Handle PrimeNG ConfirmDialog
    await page.locator('.p-confirmdialog-accept-button, .p-confirm-dialog-accept').click();
    await page.waitForTimeout(2000);

    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('2025-03-15')).not.toBeVisible({ timeout: 5000 });
  });

  test('add a trial note', async () => {
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.locator('#note-content')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#note-content', 'This is a test note for the trial.');
    await page.getByRole('button', { name: 'Add Note' }).click();
    await page.waitForTimeout(2000);

    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('This is a test note for the trial.')).toBeVisible({
      timeout: 5000,
    });
  });

  test('delete a trial note', async () => {
    // Notes use row-actions in a list layout
    const noteContainer = page.locator('li', {
      hasText: 'This is a test note for the trial.',
    });
    await noteContainer.locator('app-row-actions button').first().click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    // Handle PrimeNG ConfirmDialog
    await page.locator('.p-confirmdialog-accept-button, .p-confirm-dialog-accept').click();
    await page.waitForTimeout(2000);

    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('This is a test note for the trial.')).not.toBeVisible({
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

  test('create trial from list', async () => {
    await page.getByRole('button', { name: 'Add trial' }).click();
    await expect(page.locator('#trial-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#trial-name', 'KEYNOTE-001');
    await page.getByRole('button', { name: 'Create trial' }).click();
    await page.waitForTimeout(2000);

    await page.goto(trialsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('KEYNOTE-001')).toBeVisible({ timeout: 10000 });
  });

  test('edit trial from list pre-populates form', async () => {
    const row = page.locator('tr', { hasText: 'KEYNOTE-001' });
    await row.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.locator('#trial-name')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#trial-name')).toHaveValue('KEYNOTE-001');

    await clearAndFill(page, '#trial-name', 'KEYNOTE-002');
    await page.getByRole('button', { name: 'Update trial' }).click();
    await page.waitForTimeout(2000);

    await page.goto(trialsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('KEYNOTE-002')).toBeVisible({ timeout: 10000 });
  });

  test('delete trial from list', async () => {
    const row = page.locator('tr', { hasText: 'KEYNOTE-002' });
    await row.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    // Handle PrimeNG ConfirmDialog
    await page.locator('.p-confirmdialog-accept-button, .p-confirm-dialog-accept').click();
    await page.waitForTimeout(2000);

    await page.goto(trialsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('KEYNOTE-002')).not.toBeVisible({ timeout: 5000 });
  });
});
