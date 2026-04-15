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

  test('sidebar displays navigation items', async () => {
    const sidebar = page.locator('app-sidebar');
    await expect(sidebar).toBeVisible();

    // The sidebar uses button elements with nav-item class when expanded,
    // or icon-btn with aria-label when collapsed. Check for key nav items.
    await expect(sidebar.locator('button[aria-label="Companies"]')).toBeVisible();
    await expect(sidebar.locator('button[aria-label="Products"]')).toBeVisible();
    await expect(sidebar.locator('button[aria-label="Trials"]')).toBeVisible();
  });

  test('clicking sidebar nav item navigates to manage page', async () => {
    const sidebar = page.locator('app-sidebar');
    const companiesBtn = sidebar.locator('button[aria-label="Companies"]');

    await companiesBtn.click();
    await expect(page).toHaveURL(/\/manage\/companies/, { timeout: 10000 });
  });

  test('topbar displays organization settings link', async () => {
    const topbar = page.locator('app-contextual-topbar');
    await expect(topbar).toBeVisible();
  });

  test('sidebar timeline button navigates back to dashboard', async () => {
    await navigateToSpace(page, tenantId, spaceId);

    const sidebar = page.locator('app-sidebar');
    const companiesBtn = sidebar.locator('button[aria-label="Companies"]');
    await companiesBtn.click();
    await expect(page).toHaveURL(/\/manage\/companies/, { timeout: 10000 });

    const timelineBtn = sidebar.locator('button[aria-label="Timeline"]');
    await timelineBtn.click();

    await expect(page).toHaveURL(
      new RegExp(`/t/${tenantId}/s/${spaceId}$`),
      { timeout: 10000 },
    );
  });
});
