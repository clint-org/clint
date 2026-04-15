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

  test.afterAll(async () => {
    await page.close();
  });

  test('marker type list loads with system types', async () => {
    await page.goto(mtUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Add marker type' })).toBeVisible();
    // System marker types should be visible from seed data
    await expect(page.getByText('Topline Data')).toBeVisible({ timeout: 10000 });
  });

  test('create marker type with category', async () => {
    await page.getByRole('button', { name: 'Add marker type' }).click();
    await expect(page.locator('#mt-name')).toBeVisible({ timeout: 5000 });

    // Select category first (required field added by bug fix)
    await page.locator('#mt-category').click();
    await page.locator('.p-select-overlay').getByText('Data').click();

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
    await page.getByRole('menuitem', { name: 'Edit' }).click();
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
    const row = page.locator('tr', { hasText: 'Safety Signal' });
    await row.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    // Handle PrimeNG ConfirmDialog
    await page.locator('.p-confirmdialog-accept-button, .p-confirm-dialog-accept').click();
    await page.waitForTimeout(1000);

    await page.goto(mtUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Safety Signal')).not.toBeVisible({ timeout: 5000 });
  });

  test('create without category prevents submission', async () => {
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
