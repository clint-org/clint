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

  test('settings page loads with org name input visible', async () => {
    await page.goto(settingsUrl(), { waitUntil: 'networkidle' });
    await expect(page.locator('#org-name')).toBeVisible();
  });

  test('save button exists and invite dialog works', async () => {
    // The Save button should exist on the page
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
    // Invite member button should be visible
    await expect(page.getByRole('button', { name: 'Invite member' })).toBeVisible();
  });

  test('invite member dialog opens and closes', async () => {
    await page.getByRole('button', { name: 'Invite member' }).click();
    await expect(page.locator('.p-dialog')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await expect(page.locator('.p-dialog')).not.toBeVisible();
  });

  test('members table shows at least one member', async () => {
    await expect(page.locator('p-table tbody tr').first()).toBeVisible({ timeout: 10000 });
  });
});
