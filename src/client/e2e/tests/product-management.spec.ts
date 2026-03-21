import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Product Management CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;

  test.beforeAll(async ({ browser }) => {
    page = await authenticatedPage(browser);
    tenantId = await createTestTenant(page, 'Product CRUD Org');
    spaceId = await createTestSpace(page, tenantId, 'Product Test Space');

    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/companies`, {
      waitUntil: 'networkidle',
    });
    await page.getByRole('button', { name: 'Add Company' }).click();
    await page.locator('#company-name').fill('Product Test Co');
    await page.getByRole('button', { name: 'Create Company' }).click();
    await expect(page.locator('p-dialog')).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Product Test Co')).toBeVisible();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('product list loads', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/products`, {
      waitUntil: 'networkidle',
    });
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Product' })).toBeVisible();
  });

  test('create product via modal', async () => {
    await page.getByRole('button', { name: 'Add Product' }).click();
    await expect(page.locator('p-dialog').first()).toBeVisible();

    await page.locator('#product-name').fill('Test Product');
    await page.locator('#product-generic-name').fill('test-generic');
    await page.getByRole('button', { name: 'Create Product' }).click();

    await expect(page.locator('p-dialog').first()).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Test Product')).toBeVisible();
  });

  test('edit product via modal', async () => {
    const row = page.locator('tr', { hasText: 'Test Product' });
    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('p-dialog').first()).toBeVisible();

    const nameInput = page.locator('#product-name');
    await nameInput.clear();
    await nameInput.fill('Updated Product');
    await page.getByRole('button', { name: 'Update Product' }).click();

    await expect(page.locator('p-dialog').first()).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Updated Product')).toBeVisible();
  });

  test('expand product row to see trials section', async () => {
    const expandButton = page
      .locator('tr', { hasText: 'Updated Product' })
      .getByRole('button', { name: /expand/i });
    await expandButton.click();
    await expect(page.getByText(/Trials for Updated Product/)).toBeVisible();
  });

  test('delete product succeeds', async () => {
    page.on('dialog', (dialog) => dialog.accept());

    const row = page.locator('tr', { hasText: 'Updated Product' });
    await row.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('Updated Product')).not.toBeVisible({ timeout: 5000 });
  });
});
