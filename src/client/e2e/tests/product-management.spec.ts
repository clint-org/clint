import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';
import { fillInput, clearAndFill } from '../helpers/form.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Product Management CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;

  test.beforeAll(async ({ browser }) => {
    page = await authenticatedPage(browser);
    tenantId = await createTestTenant(page, 'Product CRUD Org');
    spaceId = await createTestSpace(page, tenantId, 'Product Test Space');

    // Create prerequisite company
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/companies`, {
      waitUntil: 'networkidle',
    });
    await page.getByRole('button', { name: 'Add Company' }).click();
    await expect(page.locator('#company-name')).toBeVisible({ timeout: 5000 });
    await fillInput(page, '#company-name', 'Product Test Co');
    await page.getByRole('button', { name: 'Create Company' }).click();
    await expect(page.getByText('Product Test Co')).toBeVisible({ timeout: 10000 });
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
    await expect(page.locator('#product-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#product-name', 'Test Product');
    await fillInput(page, '#product-generic-name', 'test-generic');
    await page.getByRole('button', { name: 'Create Product' }).click();

    await expect(page.getByText('Test Product')).toBeVisible({ timeout: 10000 });
  });

  test('edit product via modal', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/products`, {
      waitUntil: 'networkidle',
    });
    const row = page.locator('tr', { hasText: 'Test Product' });
    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#product-name')).toBeVisible({ timeout: 5000 });

    await clearAndFill(page, '#product-name', 'Updated Product');
    await page.getByRole('button', { name: 'Update Product' }).click();

    await expect(page.getByText('Updated Product')).toBeVisible({ timeout: 10000 });
  });

  test('expand product row to see trials section', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/products`, {
      waitUntil: 'networkidle',
    });
    const expandButton = page
      .locator('tr', { hasText: 'Updated Product' })
      .locator('button[aria-label="Expand trials"]');
    await expandButton.click();
    await expect(page.getByRole('button', { name: 'Add Trial' })).toBeVisible({ timeout: 5000 });
  });

  test('delete product succeeds', async () => {
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/products`, {
      waitUntil: 'networkidle',
    });
    const row = page.locator('tr', { hasText: 'Updated Product' });
    await row.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('Updated Product')).not.toBeVisible({ timeout: 5000 });
  });
});
