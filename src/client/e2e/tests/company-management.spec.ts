import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';
import { fillInput, clearAndFill } from '../helpers/form.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Company Management CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;

  test.beforeAll(async ({ browser }) => {
    page = await authenticatedPage(browser);
    tenantId = await createTestTenant(page, 'Company CRUD Org');
    spaceId = await createTestSpace(page, tenantId, 'Company Test Space');
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('company list loads', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/companies`, {
      waitUntil: 'networkidle',
    });
    await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Company' })).toBeVisible();
  });

  test('create company via modal', async () => {
    await page.getByRole('button', { name: 'Add Company' }).click();
    await expect(page.locator('#company-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#company-name', 'Test Company');
    await page.getByRole('button', { name: 'Create Company' }).click();

    await expect(page.getByText('Test Company')).toBeVisible({ timeout: 10000 });
  });

  test('edit company via modal', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/companies`, {
      waitUntil: 'networkidle',
    });
    const row = page.locator('tr', { hasText: 'Test Company' });
    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#company-name')).toBeVisible({ timeout: 5000 });

    await clearAndFill(page, '#company-name', 'Updated Company');
    await page.getByRole('button', { name: 'Update Company' }).click();

    await expect(page.getByText('Updated Company')).toBeVisible({ timeout: 10000 });
  });

  test('delete company succeeds', async () => {
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/companies`, {
      waitUntil: 'networkidle',
    });
    const row = page.locator('tr', { hasText: 'Updated Company' });
    await row.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('Updated Company')).not.toBeVisible({ timeout: 5000 });
  });
});
