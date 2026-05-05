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
    await row.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
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
    await page.reload({ waitUntil: 'networkidle' });
    const row = page.locator('tr', { hasText: 'Expandable Product' });
    await row.waitFor({ timeout: 10000 });
    const expandButton = row.locator('button').first();
    await expandButton.click();
    await expect(page.getByRole('button', { name: 'Add Trial' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Seeded Trial')).toBeVisible({ timeout: 5000 });
  });

  test('edit product pre-populates form', async () => {
    // Ensure we're on the products page (prior test may have left the page in an unexpected state)
    await page.goto(productsUrl(), { waitUntil: 'networkidle' });

    const row = page.locator('tr', { hasText: 'Updated Product' });
    await row.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.locator('#product-name')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#product-name')).toHaveValue('Updated Product');
    await page.keyboard.press('Escape');
  });

  test('create product with empty name is prevented', async () => {
    await page.getByRole('button', { name: 'Add Product' }).click();
    await expect(page.locator('#product-name')).toBeVisible({ timeout: 5000 });
    // The form auto-disables the submit button when required fields are empty;
    // assert that, then dismiss. (Clicking a disabled button auto-waits and
    // would otherwise time out.)
    await expect(page.getByRole('button', { name: 'Create Product' })).toBeDisabled();
    await expect(page.locator('.p-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('delete product succeeds', async () => {
    // Delete the "Updated Product" (the one without trials)
    await page.goto(productsUrl(), { waitUntil: 'networkidle' });
    const rows = page.locator('tr', { hasText: 'Updated Product' });
    const count = await rows.count();
    // Open row-actions menu and click Delete
    await rows.first().locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    // Handle PrimeNG ConfirmDialog
    await page.locator('.p-confirmdialog-accept-button, .p-confirm-dialog-accept').click();
    await page.waitForTimeout(2000);

    await page.goto(productsUrl(), { waitUntil: 'networkidle' });
    // Should have one fewer row with this name
    const newCount = await page.locator('tr', { hasText: 'Updated Product' }).count();
    expect(newCount).toBeLessThan(count);
  });
});
