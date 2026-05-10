import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import {
  createTestAgency,
  createTestCompany,
  createTestSpace,
  createTestTenant,
  getAdminClient,
} from '../helpers/test-data.helper';

/**
 * Drives the intelligence version-history UI: history panel rendering,
 * Withdraw dialog flow, and Purge dialog flow.
 *
 * Prior versions are seeded directly via the admin client rather than
 * exercising the IntelligenceDrawer's republish path. The drawer
 * currently updates the loaded published row in place, which intentionally
 * does NOT bump version_number (republish-as-new-version requires a
 * separate "fork to new draft" flow that the drawer does not yet
 * implement). Seeding lets the E2E focus on the history panel and
 * withdraw/purge UI we just built.
 */
test.describe.configure({ mode: 'serial' });

async function seedArchivedVersion(opts: {
  spaceId: string;
  entityType: 'company';
  entityId: string;
  headline: string;
  versionNumber: number;
  publishedAt: string;
  userId: string;
}): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('primary_intelligence')
    .insert({
      space_id: opts.spaceId,
      entity_type: opts.entityType,
      entity_id: opts.entityId,
      state: 'archived',
      headline: opts.headline,
      thesis_md: '',
      watch_md: '',
      implications_md: '',
      last_edited_by: opts.userId,
      version_number: opts.versionNumber,
      published_at: opts.publishedAt,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to seed archived version: ${error.message}`);
  return data.id;
}

async function seedPublishedVersion(opts: {
  spaceId: string;
  entityType: 'company';
  entityId: string;
  headline: string;
  userId: string;
}): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('primary_intelligence')
    .insert({
      space_id: opts.spaceId,
      entity_type: opts.entityType,
      entity_id: opts.entityId,
      state: 'published',
      headline: opts.headline,
      thesis_md: '',
      watch_md: '',
      implications_md: '',
      last_edited_by: opts.userId,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to seed published version: ${error.message}`);
  return data.id;
}

async function ensureClean(spaceId: string, entityType: string, entityId: string): Promise<void> {
  const admin = getAdminClient();
  await admin
    .from('primary_intelligence')
    .delete()
    .eq('space_id', spaceId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId);
}

test.describe('intelligence version history', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  let companyId: string;
  let companyUrl: string;
  let userId: string;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Intel History Org');
    await createTestAgency('Intel History Agency', { tenantId });
    spaceId = await createTestSpace(tenantId, 'Intel History Space');
    companyId = await createTestCompany(spaceId, 'Acme Bio');
    companyUrl = `/t/${tenantId}/s/${spaceId}/manage/companies/${companyId}`;
    page = await authenticatedPage(browser);
    const { getAuthStorage } = await import('../helpers/auth.helper');
    userId = getAuthStorage().userId;
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('history panel renders "No prior versions" for a brand-new company', async () => {
    await ensureClean(spaceId, 'company', companyId);

    await page.goto(companyUrl, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Acme Bio', level: 1 })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('region', { name: 'History' })).toBeVisible();
    await expect(page.getByText('No prior versions')).toBeVisible();
  });

  test('history panel shows seeded versions; Withdraw flow soft-deletes the current row', async () => {
    await ensureClean(spaceId, 'company', companyId);

    await seedArchivedVersion({
      spaceId,
      entityType: 'company',
      entityId: companyId,
      headline: 'Acme thesis v1',
      versionNumber: 1,
      publishedAt: '2026-04-01T00:00:00Z',
      userId,
    });
    await seedPublishedVersion({
      spaceId,
      entityType: 'company',
      entityId: companyId,
      headline: 'Acme thesis v2',
      userId,
    });

    await page.goto(companyUrl, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Acme thesis v2', level: 3 })).toBeVisible({
      timeout: 10000,
    });

    // History panel header summarises "2 versions" and an expand caret.
    const historyRegion = page.getByRole('region', { name: 'History' });
    await expect(historyRegion.getByText('2 versions')).toBeVisible();
    await historyRegion.locator('button[aria-expanded]').first().click();

    // Expanded list shows the archived v1 chip.
    await expect(historyRegion.getByText('Archived', { exact: true })).toBeVisible();

    // Withdraw the current published v2.
    await page.getByRole('button', { name: 'Withdraw' }).first().click();
    const withdrawDialog = page.getByRole('dialog', { name: 'Withdraw this read' });
    await expect(withdrawDialog).toBeVisible({ timeout: 5000 });
    await withdrawDialog.getByLabel(/reason/i).fill('superseded by external press release');
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/rest/v1/rpc/withdraw_primary_intelligence') && r.ok(),
      ),
      withdrawDialog.getByRole('button', { name: 'Withdraw' }).click(),
    ]);

    // Live area falls back to the empty state.
    await expect(page.getByRole('heading', { name: 'Acme thesis v2', level: 3 })).toBeHidden({
      timeout: 5000,
    });
    await expect(page.getByRole('button', { name: 'Add primary intelligence' })).toBeVisible();

    // History panel still has 2 versions: v1 Archived + v2 Withdrawn.
    const historyAfter = page.getByRole('region', { name: 'History' });
    await expect(historyAfter.getByText('2 versions')).toBeVisible();
    await historyAfter.locator('button[aria-expanded]').first().click();
    await expect(historyAfter.getByText('Withdrawn', { exact: true })).toBeVisible();
    await expect(historyAfter.getByText('Archived', { exact: true })).toBeVisible();
  });

  test('Purge dialog: typed-confirmation gate disables submit until the headline matches', async () => {
    await ensureClean(spaceId, 'company', companyId);

    const headline = 'Acme thesis to purge';
    await seedPublishedVersion({
      spaceId,
      entityType: 'company',
      entityId: companyId,
      headline,
      userId,
    });

    await page.goto(companyUrl, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: headline, level: 3 })).toBeVisible({
      timeout: 10000,
    });

    // Trigger the overflow Purge button on the IntelligenceBlock.
    await page.getByRole('button', { name: 'Purge this version' }).click();
    const purgeDialog = page.getByRole('dialog', { name: 'Purge this read' });
    await expect(purgeDialog).toBeVisible({ timeout: 5000 });

    const purgeInput = purgeDialog.getByLabel(`Type ${headline} to confirm purge`);
    const purgeConfirm = purgeDialog.getByRole('button', { name: 'Purge' });

    // Wrong phrase keeps Purge disabled.
    await purgeInput.fill('definitely not the headline');
    await expect(purgeConfirm).toBeDisabled();

    // Correct headline enables Purge; clicking it removes the row.
    await purgeInput.fill(headline);
    await expect(purgeConfirm).toBeEnabled();
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/rest/v1/rpc/purge_primary_intelligence') && r.ok(),
      ),
      purgeConfirm.click(),
    ]);

    await expect(page.getByRole('heading', { name: headline, level: 3 })).toBeHidden({
      timeout: 5000,
    });
    await expect(page.getByRole('button', { name: 'Add primary intelligence' })).toBeVisible();
  });
});
