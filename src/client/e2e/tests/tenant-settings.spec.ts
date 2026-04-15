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

  test('settings page loads with org name', async () => {
    await page.goto(settingsUrl(), { waitUntil: 'networkidle' });
    const nameInput = page.locator('#org-name');
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveValue('Settings Test Org');
  });

  test('edit org name via save button', async () => {
    await clearAndFill(page, '#org-name', 'Renamed Org');
    const saveBtn = page.getByRole('button', { name: 'Save' });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await page.waitForTimeout(1500);
    // Reload and verify persistence
    await page.goto(settingsUrl(), { waitUntil: 'networkidle' });
    await expect(page.locator('#org-name')).toHaveValue('Renamed Org');
  });

  test('save button is disabled when no changes', async () => {
    const saveBtn = page.getByRole('button', { name: 'Save' });
    await expect(saveBtn).toBeDisabled();
  });

  test('members table is visible', async () => {
    await expect(page.getByText('e2e-test@clint.local')).toBeVisible();
  });

  test('invite member dialog opens and closes', async () => {
    await page.getByRole('button', { name: 'Invite member' }).click();
    await expect(page.locator('.p-dialog')).toBeVisible({ timeout: 5000 });
    // Close without inviting
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await expect(page.locator('.p-dialog')).not.toBeVisible();
  });
});
