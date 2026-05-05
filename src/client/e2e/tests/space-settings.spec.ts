import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';
import { fillInput, clearAndFill } from '../helpers/form.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Space Settings - General', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const generalUrl = () => `/t/${tenantId}/s/${spaceId}/settings/general`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Space Settings Org');
    spaceId = await createTestSpace(tenantId, 'Settings Space');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('general settings page loads with space name', async () => {
    await page.goto(generalUrl(), { waitUntil: 'networkidle' });
    const nameInput = page.locator('#space-name');
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveValue('Settings Space');
  });

  test('edit space name via save button', async () => {
    await clearAndFill(page, '#space-name', 'Renamed Space');
    const saveBtn = page.getByRole('button', { name: 'Save changes' });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await page.waitForTimeout(1500);

    // Verify persistence
    await page.goto(generalUrl(), { waitUntil: 'networkidle' });
    await expect(page.locator('#space-name')).toHaveValue('Renamed Space');
  });

  test('save button is disabled when no changes', async () => {
    const saveBtn = page.getByRole('button', { name: 'Save changes' });
    await expect(saveBtn).toBeDisabled();
  });
});

test.describe('Space Settings - Members', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const membersUrl = () => `/t/${tenantId}/s/${spaceId}/settings/members`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Space Members Org');
    spaceId = await createTestSpace(tenantId, 'Members Space');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('members page loads with at least one member', async () => {
    await page.goto(membersUrl(), { waitUntil: 'networkidle' });
    // Wait for the members table to render with at least one data row
    await expect(page.locator('p-table tbody tr').first()).toBeVisible({ timeout: 15000 });
  });

  test('invite-to-space button is visible in topbar', async () => {
    await page.goto(membersUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Invite to space' })).toBeVisible({
      timeout: 10000,
    });
  });
});
