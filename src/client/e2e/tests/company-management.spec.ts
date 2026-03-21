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
    await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();
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
    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#company-name')).toBeVisible({ timeout: 5000 });

    await clearAndFill(page, '#company-name', 'Updated Company');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rest/') && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: 'Update Company' }).click(),
    ]);

    await page.goto(companiesUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Updated Company')).toBeVisible({ timeout: 10000 });
  });

  test('delete company succeeds', async () => {
    page.on('dialog', (dialog) => dialog.accept());

    const row = page.locator('tr', { hasText: 'Updated Company' });
    await row.getByRole('button', { name: 'Delete' }).click();

    await page.goto(companiesUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Updated Company')).not.toBeVisible({ timeout: 5000 });
  });
});
