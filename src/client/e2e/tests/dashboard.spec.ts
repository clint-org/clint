import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';

test.describe('Dashboard', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;

  test.beforeAll(async ({ browser }) => {
    page = await authenticatedPage(browser);
    tenantId = await createTestTenant(page, 'Dashboard Test Org');
    spaceId = await createTestSpace(page, tenantId, 'Dashboard Test Space');

    await page.goto(`/t/${tenantId}/s/${spaceId}`, { waitUntil: 'networkidle' });

    await page.waitForSelector('app-dashboard-grid', { timeout: 30000 });
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('dashboard loads and renders trial timeline grid', async () => {
    const grid = page.locator('app-dashboard-grid');
    await expect(grid).toBeVisible();

    const trialCells = page.locator('app-dashboard-grid').getByText(/trial/i).first();
    await expect(trialCells).toBeVisible();
  });

  test('filter controls are visible', async () => {
    const filterPanel = page.locator('app-filter-panel');
    await expect(filterPanel).toBeVisible();
  });

  test('zoom control is present and functional', async () => {
    const zoomControl = page.locator('app-zoom-control');
    await expect(zoomControl).toBeVisible();

    const yearButton = zoomControl.getByText('Year');
    await expect(yearButton).toBeVisible();

    const quarterButton = zoomControl.getByText('Quarter');
    await expect(quarterButton).toBeVisible();

    const monthButton = zoomControl.getByText('Month');
    await expect(monthButton).toBeVisible();

    await quarterButton.click();
    await page.waitForTimeout(500);

    await yearButton.click();
    await page.waitForTimeout(500);
  });

  test('legend displays marker types', async () => {
    const legend = page.locator('app-legend');
    await expect(legend).toBeVisible();

    const legendList = legend.locator('[role="list"][aria-label="Marker type legend"]');
    await expect(legendList).toBeVisible();

    const legendItems = legend.locator('[role="listitem"]');
    await expect(legendItems.first()).toBeVisible();
    expect(await legendItems.count()).toBeGreaterThan(0);
  });

  test('clicking a trial navigates to trial detail', async () => {
    const grid = page.locator('app-dashboard-grid');
    const trialLink = grid.locator('[class*="cursor-pointer"]').first();

    if (await trialLink.isVisible()) {
      await trialLink.click();
      await expect(page).toHaveURL(/\/manage\/trials\/[^/]+/, { timeout: 10000 });

      await page.goto(`/t/${tenantId}/s/${spaceId}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('app-dashboard-grid', { timeout: 30000 });
    }
  });
});
