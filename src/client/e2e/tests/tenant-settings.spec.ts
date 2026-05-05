import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant } from '../helpers/test-data.helper';
import { fillInput, clearAndFill } from '../helpers/form.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Tenant Settings', () => {
  let page: Page;
  let tenantId: string;
  const settingsUrl = () => `/t/${tenantId}/settings`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Settings Test Org');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('settings page loads with tenant name input visible', async () => {
    await page.goto(settingsUrl(), { waitUntil: 'networkidle' });
    await expect(page.locator('#tenant-name')).toBeVisible();
  });

  test('save and add-owner controls are visible', async () => {
    // "Save" sits next to the tenant-name input (saves the rename).
    await expect(page.getByRole('button', { name: 'Save' }).first()).toBeVisible();
    // "Add owner" is the topbar action that opens the owner-invite dialog.
    await expect(page.getByRole('button', { name: 'Add owner' })).toBeVisible();
  });

  test('add-owner dialog opens and closes', async () => {
    await page.getByRole('button', { name: 'Add owner' }).click();
    await expect(page.locator('.p-dialog')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await expect(page.locator('.p-dialog')).not.toBeVisible();
  });

  test('owners table shows at least one owner', async () => {
    await expect(page.locator('p-table tbody tr').first()).toBeVisible({ timeout: 10000 });
  });
});
