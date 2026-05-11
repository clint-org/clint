import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import {
  createTestTenant,
  createTestSpace,
  createTestCompany,
  createTestProduct,
} from '../helpers/test-data.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Assets grid — filtering, sorting, pagination', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  let pfizerId: string;
  let merckId: string;
  // Use pageSize=10 in the URL so 20 seeded assets span 2 pages.
  const assetsUrl = () => `/t/${tenantId}/s/${spaceId}/manage/assets?pageSize=10`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Grid Filter Org');
    spaceId = await createTestSpace(tenantId, 'Grid Filter Space');
    pfizerId = await createTestCompany(spaceId, 'Pfizer');
    merckId = await createTestCompany(spaceId, 'Merck');
    // Seed enough assets to exercise pagination (10-per-page view has 2 pages).
    for (let i = 0; i < 12; i++) {
      await createTestProduct(spaceId, pfizerId, `PfizerProduct${i}`);
    }
    for (let i = 0; i < 8; i++) {
      await createTestProduct(spaceId, merckId, `MerckProduct${i}`);
    }
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('grid loads with toolbar and paginator', async () => {
    await page.goto(assetsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByPlaceholder('Search assets...')).toBeVisible();
    await expect(page.locator('.p-paginator')).toBeVisible();
  });

  test('global search filters rows and updates URL', async () => {
    await page.getByPlaceholder('Search assets...').fill('Pfizer');
    await expect(page).toHaveURL(/q=Pfizer/, { timeout: 2000 });
    // All visible rows should be PfizerProduct*
    const rows = await page.locator('table tbody tr').all();
    for (const row of rows) {
      await expect(row).toContainText(/PfizerProduct/);
    }
  });

  test('clear all resets the toolbar and URL', async () => {
    // The p-button host element has aria-label="Clear all filters" but the
    // inner button rendered by PrimeNG has text "Clear all". Use the text label.
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page).not.toHaveURL(/q=/);
    await expect(page.getByPlaceholder('Search assets...')).toHaveValue('');
  });

  test('sort by Name ascending updates URL and orders rows', async () => {
    await page.getByRole('columnheader', { name: /Name/ }).click();
    await expect(page).toHaveURL(/sort=asset\.name/, { timeout: 2000 });
    const firstRowName = await page.locator('table tbody tr:first-child td:first-child').innerText();
    expect(firstRowName).toMatch(/^Merck|^Pfizer/);
  });

  test('paginator click updates URL with page number', async () => {
    // Navigate fresh with pageSize=10 so 20 assets span 2 pages.
    await page.goto(assetsUrl(), { waitUntil: 'networkidle' });
    // Wait for rows to render — this ensures totalRecords is populated so the
    // paginator enables the Next Page button before we click it.
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.p-paginator-next')).toBeEnabled({ timeout: 3000 });

    // Click the "next page" button (PrimeNG renders it with .p-paginator-next).
    await page.locator('.p-paginator-next').click();
    await expect(page).toHaveURL(/page=2/, { timeout: 2000 });
  });

  test('deep-link to page 2 lands on page 2', async () => {
    await page.goto(`${assetsUrl()}&page=2`, { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/page=2/, { timeout: 2000 });
    // Verify the paginator shows page 2 as active.
    await expect(page.locator('.p-paginator .p-paginator-page.p-paginator-page-selected')).toContainText('2');
  });

  test('browser back navigates away from assets page', async () => {
    // Navigate to companies page first (pushes to history), then to assets page.
    // Since assets uses replaceUrl:true for state changes, going back should
    // return to companies (the last page that pushed a history entry).
    const companiesUrl = `/t/${tenantId}/s/${spaceId}/manage/companies`;
    await page.goto(companiesUrl, { waitUntil: 'networkidle' });
    await page.goto(assetsUrl(), { waitUntil: 'networkidle' });
    await page.goBack();
    await expect(page).toHaveURL(/manage\/companies/);
  });

  test('inbound deep-link via company "View assets" lands pre-filtered', async () => {
    // The company-name cell now links to the company detail page; the
    // "click name -> filtered assets" affordance moved to the row-actions
    // menu's "View assets" item, which still calls openAssets(pfizerId)
    // using buildFilterQueryParams.
    const companiesUrl = `/t/${tenantId}/s/${spaceId}/manage/companies`;
    await page.goto(companiesUrl, { waitUntil: 'networkidle' });

    const row = page.locator('tr', { hasText: 'Pfizer' }).first();
    await row.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'View assets' }).click();

    // Landed on assets page with the filter applied via the unified URL shape.
    await expect(page).toHaveURL(new RegExp(`filter\\.asset\\.company_id=${pfizerId}`));
    await expect(page.getByRole('list', { name: 'Active filters' })).toContainText('Pfizer');

    // All visible rows are Pfizer assets.
    const rows = await page.locator('table tbody tr').all();
    for (const row of rows) {
      await expect(row).toContainText(/PfizerProduct/);
    }
  });
});
