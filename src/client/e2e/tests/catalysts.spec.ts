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

test.describe('Catalysts View', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const catalystsUrl = () => `/t/${tenantId}/s/${spaceId}/catalysts`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Catalysts Org');
    spaceId = await createTestSpace(tenantId, 'Catalysts Space');

    // Seed reference data for context
    const companyId = await createTestCompany(spaceId, 'Catalyst Co');
    const assetId = await createTestProduct(spaceId, companyId, 'Catalyst Drug');
    const taId = await createTestTherapeuticArea(spaceId, 'Oncology');
    await createTestTrial(spaceId, assetId, taId, 'Catalyst Trial');

    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('catalysts page loads without error', async () => {
    await page.goto(catalystsUrl(), { waitUntil: 'networkidle' });
    // Page should load successfully - no error messages
    await expect(page.locator('.p-message-error')).not.toBeVisible({ timeout: 5000 });
  });

  test('catalysts page shows search toolbar', async () => {
    await expect(page.getByPlaceholder(/search/i)).toBeVisible();
  });
});
