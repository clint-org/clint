import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';
import { fillInput, clearAndFill } from '../helpers/form.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Marker Type Management CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const markerTypesUrl = () => `/t/${tenantId}/s/${spaceId}/manage/marker-types`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Marker Type Org');
    spaceId = await createTestSpace(tenantId, 'Marker Type Space');

    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('marker type list loads', async () => {
    await page.goto(markerTypesUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Marker Types' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Marker Type' })).toBeVisible();
  });

  test('create marker type via modal', async () => {
    await page.getByRole('button', { name: 'Add Marker Type' }).click();
    await expect(page.locator('#mt-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#mt-name', 'Test Approval');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rest/') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Create Marker Type' }).click(),
    ]);

    await page.goto(markerTypesUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Test Approval')).toBeVisible({ timeout: 10000 });
  });

  test('edit marker type via modal', async () => {
    const row = page.locator('tr', { hasText: 'Test Approval' });
    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#mt-name')).toBeVisible({ timeout: 5000 });

    await clearAndFill(page, '#mt-name', 'Updated Approval');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rest/') && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: 'Update Marker Type' }).click(),
    ]);

    await page.goto(markerTypesUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Updated Approval')).toBeVisible({ timeout: 10000 });
  });

  test('delete marker type succeeds', async () => {
    page.on('dialog', (dialog) => dialog.accept());

    const row = page.locator('tr', { hasText: 'Updated Approval' });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rest/') && r.request().method() === 'DELETE'),
      row.getByRole('button', { name: 'Delete' }).click(),
    ]);

    await page.goto(markerTypesUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Updated Approval')).not.toBeVisible({ timeout: 5000 });
  });
});
