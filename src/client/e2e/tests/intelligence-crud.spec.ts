import { test, expect, Page } from '@playwright/test';
import { authenticatedPage, getAuthStorage } from '../helpers/auth.helper';
import {
  createTestTenant,
  createTestSpace,
  createTestCompany,
  getAdminClient,
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
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('heading', { name: 'Smoke Co', level: 1 })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole('button', { name: 'Add primary intelligence' })).toBeVisible();
  });

  test('engagement detail page renders the empty intelligence state', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/engagement`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('heading', { name: 'Engagement', level: 1 })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole('button', { name: 'Add primary intelligence' })).toBeVisible();
  });

  test('company list links navigate to the detail page', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/companies`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByRole('link', { name: 'Smoke Co' }).click();
    await page.waitForURL(/\/manage\/companies\/[0-9a-f-]+$/, { timeout: 5000 });
    await expect(page.getByRole('heading', { name: 'Smoke Co', level: 1 })).toBeVisible();
  });

  test('deleting a company also clears its primary_intelligence rows (polymorphic cleanup)', async () => {
    // Cascade-safety T3: AFTER DELETE trigger on companies/assets/trials/
    // markers removes the polymorphic primary_intelligence and
    // primary_intelligence_links rows that reference the deleted parent by
    // (entity_type, entity_id). Seed rows directly via the admin client so
    // this test does not require agency membership (PI writes are gated on
    // is_agency_member_of_space).
    const admin = getAdminClient();
    const userId = getAuthStorage().userId;

    const polyCompanyName = 'PolyCleanupCo ' + Date.now();
    const polyCompanyId = await createTestCompany(spaceId, polyCompanyName);

    const { data: pi, error: piErr } = await admin
      .from('primary_intelligence')
      .insert({
        space_id: spaceId,
        entity_type: 'company',
        entity_id: polyCompanyId,
        state: 'published',
        headline: 'Cleanup target thesis',
        summary_md: '',
        implications_md: '',
        last_edited_by: userId,
        version_number: 1,
        published_at: new Date().toISOString(),
        published_by: userId,
      })
      .select('id')
      .single();
    if (piErr) throw new Error(`Could not seed PI: ${piErr.message}`);

    // Delete via PostgREST (the route the UI uses for company delete). The
    // delete cascades assets/trials AND fires the polymorphic-cleanup
    // trigger that removes the PI row.
    const { error: delErr } = await admin.from('companies').delete().eq('id', polyCompanyId);
    if (delErr) throw new Error(`Could not delete company: ${delErr.message}`);

    const { data: piAfter } = await admin
      .from('primary_intelligence')
      .select('id')
      .eq('id', pi!.id)
      .maybeSingle();
    expect(piAfter).toBeNull();
  });
});
