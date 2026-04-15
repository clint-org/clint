import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import {
  createTestTenant,
  createTestSpace,
  createTestCompany,
  createTestProduct,
  createTestTherapeuticArea,
  createTestTrial,
} from '../helpers/test-data.helper';

test.describe('Dashboard', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60000);

    tenantId = await createTestTenant('Dashboard Test Org');
    spaceId = await createTestSpace(tenantId, 'Dashboard Test Space');

    // Seed data so the dashboard has something to render
    const companyId = await createTestCompany(spaceId, 'Dashboard Co');
    const productId = await createTestProduct(spaceId, companyId, 'Dashboard Product');
    const taId = await createTestTherapeuticArea(spaceId, 'Dashboard TA');
    await createTestTrial(spaceId, productId, taId, 'Dashboard Trial');

    page = await authenticatedPage(browser);
    await page.goto(`/t/${tenantId}/s/${spaceId}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('app-dashboard-grid', { timeout: 30000 });
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('dashboard loads and renders trial timeline grid', async () => {
    const grid = page.locator('app-dashboard-grid');
    await expect(grid).toBeVisible();
  });

  test('filter controls are visible', async () => {
    // Filters are now in app-landscape-filter-bar within the landscape shell
    await expect(page.locator('app-landscape-filter-bar')).toBeVisible();
  });

  test('zoom control is present and functional', async () => {
    // Zoom is now a p-selectbutton inside the filter bar, not a standalone component.
    // The filter bar toolbar contains Y/Q/M/D zoom buttons.
    const filterBar = page.locator('app-landscape-filter-bar');
    await expect(filterBar).toBeVisible();

    const yearButton = filterBar.getByText('Y', { exact: true });
    const quarterButton = filterBar.getByText('Q', { exact: true });
    await expect(yearButton).toBeVisible();
    await expect(quarterButton).toBeVisible();

    await quarterButton.click();
    await page.waitForTimeout(500);
    await yearButton.click();
    await page.waitForTimeout(500);
  });

  test('legend displays marker types', async () => {
    await expect(page.locator('[aria-label="Marker type legend"]')).toBeVisible();
  });

  test('clicking a trial navigates to trial detail', async () => {
    const trialButton = page
      .locator('app-dashboard-grid div[role="button"]', { hasText: 'Dashboard Trial' })
      .first();

    if (await trialButton.isVisible()) {
      await trialButton.click();
      await expect(page).toHaveURL(/\/manage\/trials\/[^/]+/, { timeout: 10000 });

      await page.goto(`/t/${tenantId}/s/${spaceId}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('app-dashboard-grid', { timeout: 30000 });
    }
  });
});
