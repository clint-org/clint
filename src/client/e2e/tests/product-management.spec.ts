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

test.describe('Product Management CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const productsUrl = () => `/t/${tenantId}/s/${spaceId}/manage/products`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Product CRUD Org');
    spaceId = await createTestSpace(tenantId, 'Product Test Space');
    await createTestCompany(spaceId, 'Product Test Co');

    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('product list loads', async () => {
    await page.goto(productsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Product' })).toBeVisible();
  });

  test('create product via modal', async () => {
    await page.getByRole('button', { name: 'Add Product' }).click();
    await expect(page.locator('#product-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#product-name', 'Test Product');
    await fillInput(page, '#product-generic-name', 'test-generic');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rest/') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Create Product' }).click(),
    ]);

    await page.goto(productsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Test Product')).toBeVisible({ timeout: 10000 });
  });

  test('edit product via modal', async () => {
    const row = page.locator('tr', { hasText: 'Test Product' });
    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#product-name')).toBeVisible({ timeout: 5000 });

    await clearAndFill(page, '#product-name', 'Updated Product');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rest/') && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: 'Update Product' }).click(),
    ]);

    await page.goto(productsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Updated Product')).toBeVisible({ timeout: 10000 });
  });

  test('expand product row to see trials section', async () => {
    const companyId = await createTestCompany(spaceId, 'Expand Co');
    const productId = await createTestProduct(spaceId, companyId, 'Expandable Product');
    const taId = await createTestTherapeuticArea(spaceId, 'Expand TA');
    await createTestTrial(spaceId, productId, taId, 'Seeded Trial');

    await page.goto(productsUrl(), { waitUntil: 'networkidle' });
    const expandButton = page
      .locator('tr', { hasText: 'Expandable Product' })
      .locator('button[aria-label="Expand trials"]');
    await expandButton.click();
    await expect(page.getByRole('button', { name: 'Add Trial' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Seeded Trial')).toBeVisible({ timeout: 5000 });
  });

  test('delete product succeeds', async () => {
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto(productsUrl(), { waitUntil: 'networkidle' });
    const row = page.locator('tr', { hasText: 'Updated Product' }).first();
    await row.getByRole('button', { name: 'Delete' }).click();

    await page.goto(productsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Updated Product')).not.toBeVisible({ timeout: 5000 });
  });
});
