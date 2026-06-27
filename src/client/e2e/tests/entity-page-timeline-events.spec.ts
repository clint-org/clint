import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import {
  createTestTenant,
  createTestSpace,
  createTestCompany,
  createTestProduct,
  createTestTherapeuticArea,
  createTestTrial,
  createTestTrialPhase,
} from '../helpers/test-data.helper';

test.describe('Entity-page timeline + events panel', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  let companyId: string;
  let productId: string;
  let trialId: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60000);
    tenantId = await createTestTenant('Entity Timeline Org');
    spaceId = await createTestSpace(tenantId, 'Entity Timeline Space');
    const taId = await createTestTherapeuticArea(spaceId, 'Test TA', 'TTA');
    companyId = await createTestCompany(spaceId, 'TestCo');
    productId = await createTestProduct(spaceId, companyId, 'TestProd');
    trialId = await createTestTrial(spaceId, productId, taId, 'TestTrial');
    await createTestTrialPhase(spaceId, trialId, 'P3', '2025-01-01');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('trial detail page renders Timeline + Events panel', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/trials/${trialId}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.locator('app-timeline-view')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('app-entity-events-panel')).toBeVisible();
    // The "Events" label lives on the surrounding section-card header (the panel
    // itself is body-only since the card shell was standardized), so assert the
    // card heading rather than text inside the panel.
    await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
  });

  test('asset detail page renders Timeline + Events panel', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/assets/${productId}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.locator('app-timeline-view')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('app-entity-events-panel')).toBeVisible();
  });

  test('company detail page renders forward-windowed Timeline + Events panel', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/companies/${companyId}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.locator('app-timeline-view')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('app-entity-events-panel')).toBeVisible();
  });
});
