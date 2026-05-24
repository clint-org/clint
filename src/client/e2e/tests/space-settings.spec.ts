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
    await page.goto(generalUrl(), { waitUntil: 'domcontentloaded' });
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
    await page.goto(generalUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#space-name')).toHaveValue('Renamed Space');
  });

  test('save button is disabled when no changes', async () => {
    const saveBtn = page.getByRole('button', { name: 'Save changes' });
    await expect(saveBtn).toBeDisabled();
  });

  test('delete affordance is Archive, not legacy Delete', async () => {
    // Cascade-safety T5/T11: active spaces no longer expose a destructive
    // "Delete space" button. The reversible "Archive space" affordance
    // replaces it; permanent deletion lives on the archived list under a
    // tenant-owner gate.
    await page.goto(generalUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Archive space' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('button', { name: 'Delete space', exact: true })).toHaveCount(0);
  });

  test('Permanently delete is gated behind tenant-owner role for active spaces', async () => {
    // The general settings page shows the danger-zone "Permanently delete"
    // button only when the caller is a tenant owner or platform admin AND
    // the space is currently archived. For an active space, even a tenant
    // owner should NOT see the permanent-delete button on this page.
    await page.goto(generalUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Permanently delete', exact: true })).toHaveCount(
      0
    );
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
    await page.goto(membersUrl(), { waitUntil: 'domcontentloaded' });
    // Wait for the members table to render with at least one data row
    await expect(page.locator('p-table tbody tr').first()).toBeVisible({ timeout: 15000 });
  });

  test('invite-to-space button is visible in topbar', async () => {
    await page.goto(membersUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Invite to space' })).toBeVisible({
      timeout: 10000,
    });
  });
});
