import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Marker Type Management CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;

  test.beforeAll(async ({ browser }) => {
    page = await authenticatedPage(browser);
    tenantId = await createTestTenant(page, 'Marker Type Org');
    spaceId = await createTestSpace(page, tenantId, 'Marker Type Space');
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('marker type list loads', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/marker-types`, {
      waitUntil: 'networkidle',
    });
    await expect(page.getByRole('heading', { name: 'Marker Types' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Marker Type' })).toBeVisible();
  });

  test('create marker type via modal', async () => {
    await page.getByRole('button', { name: 'Add Marker Type' }).click();
    await expect(page.locator('p-dialog')).toBeVisible();

    await page.locator('#mt-name').fill('Test Approval');

    const shapeSelect = page.locator('#mt-shape');
    await shapeSelect.click();
    await page.getByText('Diamond', { exact: true }).click();

    const fillSelect = page.locator('#mt-fill-style');
    await fillSelect.click();
    await page.getByText('Filled', { exact: true }).click();

    await page.getByRole('button', { name: 'Create Marker Type' }).click();

    await expect(page.locator('p-dialog')).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Test Approval')).toBeVisible();
    await expect(page.getByText('diamond')).toBeVisible();
  });

  test('edit marker type via modal', async () => {
    const row = page.locator('tr', { hasText: 'Test Approval' });
    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('p-dialog')).toBeVisible();

    const nameInput = page.locator('#mt-name');
    await nameInput.clear();
    await nameInput.fill('Updated Approval');
    await page.getByRole('button', { name: 'Update Marker Type' }).click();

    await expect(page.locator('p-dialog')).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Updated Approval')).toBeVisible();
  });

  test('delete marker type succeeds', async () => {
    page.on('dialog', (dialog) => dialog.accept());

    const row = page.locator('tr', { hasText: 'Updated Approval' });
    await row.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('Updated Approval')).not.toBeVisible({ timeout: 5000 });
  });
});
