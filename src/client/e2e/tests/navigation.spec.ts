import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import {
  createTestTenant,
  createTestSpace,
  navigateToSpace,
} from '../helpers/test-data.helper';

test.describe('Navigation', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Nav Test Org');
    spaceId = await createTestSpace(tenantId, 'Nav Test Space');

    page = await authenticatedPage(browser);
    await navigateToSpace(page, tenantId, spaceId);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('header displays navigation tabs', async () => {
    const header = page.locator('app-header');
    await expect(header).toBeVisible();

    await expect(header.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(header.getByRole('link', { name: 'Companies' })).toBeVisible();
    await expect(header.getByRole('link', { name: 'Products' })).toBeVisible();
    await expect(header.getByRole('link', { name: 'Markers' })).toBeVisible();
    await expect(header.getByRole('link', { name: 'Therapeutic Areas' })).toBeVisible();
  });

  test('navigation tabs highlight active route', async () => {
    const header = page.locator('app-header');
    const companiesLink = header.getByRole('link', { name: 'Companies' });

    await companiesLink.click();
    await expect(page).toHaveURL(/\/manage\/companies/, { timeout: 10000 });

    await expect(companiesLink).toHaveClass(/border-teal-500/);
  });

  test('settings link navigates to tenant settings', async () => {
    const settingsLink = page.locator('app-header a[href*="settings"]');
    await expect(settingsLink).toBeVisible();

    await settingsLink.click();
    await expect(page).toHaveURL(/\/settings/, { timeout: 10000 });
  });

  test('back navigation preserves context', async () => {
    await navigateToSpace(page, tenantId, spaceId);

    const header = page.locator('app-header');
    const companiesLink = header.getByRole('link', { name: 'Companies' });
    await companiesLink.click();
    await expect(page).toHaveURL(/\/manage\/companies/, { timeout: 10000 });

    const dashboardLink = header.getByRole('link', { name: 'Dashboard' });
    await dashboardLink.click();

    await expect(page).toHaveURL(
      new RegExp(`/t/${tenantId}/s/${spaceId}$`),
      { timeout: 10000 },
    );
  });
});
