import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import {
  createTestTenant,
  createTestSpace,
  createTestCompany,
} from '../helpers/test-data.helper';

/**
 * Route smoke for the new entity detail pages. Confirms each page renders,
 * shows the IntelligenceEmpty placeholder, and does not crash the build.
 *
 * The full add / edit / delete loop is intentionally NOT covered here:
 * primary_intelligence writes are gated by is_agency_member_of_space,
 * and the current test helpers only set up tenant_members + space_members.
 * Adding agency / agency_members / agency-tenant link is a larger
 * test-infrastructure change tracked separately.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Intelligence detail pages: route smoke', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  let companyId: string;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Intel Smoke Org');
    spaceId = await createTestSpace(tenantId, 'Intel Smoke Space');
    companyId = await createTestCompany(spaceId, 'Smoke Co');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('company detail page renders the empty intelligence state', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/companies/${companyId}`, {
      waitUntil: 'networkidle',
    });
    await expect(page.getByRole('heading', { name: 'Smoke Co', level: 1 })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole('button', { name: 'Add primary intelligence' })).toBeVisible();
  });

  test('engagement detail page renders the empty intelligence state', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/engagement`, {
      waitUntil: 'networkidle',
    });
    await expect(page.getByRole('heading', { name: 'Engagement', level: 1 })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole('button', { name: 'Add primary intelligence' })).toBeVisible();
  });

  test('company list links navigate to the detail page', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/companies`, {
      waitUntil: 'networkidle',
    });
    await page.getByRole('link', { name: 'Smoke Co' }).click();
    await page.waitForURL(/\/manage\/companies\/[0-9a-f-]+$/, { timeout: 5000 });
    await expect(page.getByRole('heading', { name: 'Smoke Co', level: 1 })).toBeVisible();
  });
});
