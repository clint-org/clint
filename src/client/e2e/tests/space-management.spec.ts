import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';
import { fillInput } from '../helpers/form.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Space Management', () => {
  let page: Page;
  let tenantId: string;
  const spacesUrl = () => `/t/${tenantId}/spaces`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Space Mgmt Org');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('spaces page loads', async () => {
    await page.goto(spacesUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'New space' })).toBeVisible();
  });

  test('create space via dialog', async () => {
    await page.getByRole('button', { name: 'New space' }).click();
    await expect(page.locator('.p-dialog')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#space-name', 'E2E Test Space');
    // Scope click to the dialog to avoid strict mode violation (button exists in topbar too)
    await page.locator('.p-dialog').getByRole('button', { name: 'Create space' }).click();

    // Should navigate to the new space
    await page.waitForURL(/\/s\//, { timeout: 10000 });
  });

  test('created space appears in list', async () => {
    await page.goto(spacesUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('E2E Test Space')).toBeVisible({ timeout: 10000 });
  });

  test('create space with empty name is prevented', async () => {
    await page.getByRole('button', { name: 'New space' }).click();
    await expect(page.locator('.p-dialog')).toBeVisible({ timeout: 5000 });

    // Try submitting without filling name -- scope to dialog
    await page.locator('.p-dialog').getByRole('button', { name: 'Create space' }).click();
    // Dialog should remain open (form prevents submission)
    await expect(page.locator('.p-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('space list shows pre-seeded space if any', async () => {
    // Create a second space via DB helper
    await createTestSpace(tenantId, 'DB Seeded Space');
    await page.goto(spacesUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('DB Seeded Space')).toBeVisible({ timeout: 10000 });
  });
});
