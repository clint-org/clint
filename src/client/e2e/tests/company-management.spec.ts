import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';
import { fillInput, clearAndFill } from '../helpers/form.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Company Management CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const companiesUrl = () => `/t/${tenantId}/s/${spaceId}/manage/companies`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Company CRUD Org');
    spaceId = await createTestSpace(tenantId, 'Company Test Space');

    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });



  test('company list loads', async () => {
    await page.goto(companiesUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Add Company' })).toBeVisible();
  });

  test('create company via modal', async () => {
    await page.getByRole('button', { name: 'Add Company' }).click();
    await expect(page.locator('#company-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#company-name', 'Test Company');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rest/') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Create Company' }).click(),
    ]);

    await page.goto(companiesUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Test Company')).toBeVisible({ timeout: 10000 });
  });

  test('edit company via modal', async () => {
    const row = page.locator('tr', { hasText: 'Test Company' });
    await row.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.locator('#company-name')).toBeVisible({ timeout: 5000 });

    await clearAndFill(page, '#company-name', 'Updated Company');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rest/') && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: 'Update Company' }).click(),
    ]);

    await page.goto(companiesUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Updated Company')).toBeVisible({ timeout: 10000 });
  });

  test('edit company pre-populates name', async () => {
    const row = page.locator('tr', { hasText: 'Updated Company' });
    await row.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.locator('#company-name')).toBeVisible({ timeout: 5000 });
    // Verify name pre-population
    await expect(page.locator('#company-name')).toHaveValue('Updated Company');
    await page.keyboard.press('Escape');
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

  test('delete company succeeds', async () => {
    const row = page.locator('tr', { hasText: 'Updated Company' });
    await row.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    // Handle PrimeNG ConfirmDialog
    await page.locator('.p-confirmdialog-accept-button, .p-confirm-dialog-accept').click();
    await page.waitForTimeout(1000);

    await page.goto(companiesUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Updated Company')).not.toBeVisible({ timeout: 5000 });
  });
});
