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

  test('settings page loads with org name input', async () => {
    await page.goto(settingsUrl(), { waitUntil: 'networkidle' });
    const nameInput = page.locator('#org-name');
    await expect(nameInput).toBeVisible();
    // The org name should be populated after async load.
    // Use evaluate to check the Angular component property directly.
    await page.waitForFunction(
      () => {
        const ng = (window as any).ng;
        if (!ng?.getOwningComponent) return false;
        const el = document.querySelector('#org-name');
        if (!el) return false;
        const comp = ng.getOwningComponent(el);
        return comp?.orgName && comp.orgName.length > 0;
      },
      { timeout: 15000 },
    );
  });

  test('edit org name via save button', async () => {
    await clearAndFill(page, '#org-name', 'Renamed Org');
    const saveBtn = page.getByRole('button', { name: 'Save' });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await page.waitForTimeout(2000);
    // Reload and verify persistence
    await page.goto(settingsUrl(), { waitUntil: 'networkidle' });
    // Wait for the component to load and populate orgName
    await page.waitForFunction(
      (expected: string) => {
        const ng = (window as any).ng;
        if (!ng?.getOwningComponent) return false;
        const el = document.querySelector('#org-name');
        if (!el) return false;
        const comp = ng.getOwningComponent(el);
        return comp?.orgName === expected;
      },
      'Renamed Org',
      { timeout: 15000 },
    );
  });

  test('save button is disabled when no changes', async () => {
    const saveBtn = page.getByRole('button', { name: 'Save' });
    await expect(saveBtn).toBeDisabled();
  });

  test('members table is visible', async () => {
    await expect(page.getByText('e2e-test@clint.local')).toBeVisible({ timeout: 10000 });
  });

  test('invite member dialog opens and closes', async () => {
    await page.getByRole('button', { name: 'Invite member' }).click();
    await expect(page.locator('.p-dialog')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await expect(page.locator('.p-dialog')).not.toBeVisible();
  });
});
