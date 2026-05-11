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
 * Withdraw dialog flow, and Purge dialog flow. Prior versions are seeded
 * directly via the admin client to keep these tests focused on the
 * panel/dialog surface; drawer-driven forking is covered separately.
 */
test.describe.configure({ mode: 'serial' });

async function seedArchivedVersion(opts: {
  spaceId: string;
  entityType: 'company';
  entityId: string;
  headline: string;
  versionNumber: number;
  publishedAt: string;
  archivedAt: string;
  publishNote: string | null;
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
      published_by: opts.userId,
      publish_note: opts.publishNote,
      archived_at: opts.archivedAt,
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
  versionNumber?: number;
  publishedAt?: string;
  publishNote?: string | null;
  thesis?: string;
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
      thesis_md: opts.thesis ?? '',
      watch_md: '',
      implications_md: '',
      last_edited_by: opts.userId,
      version_number: opts.versionNumber ?? null,
      published_at: opts.publishedAt ?? new Date().toISOString(),
      published_by: opts.userId,
      publish_note: opts.publishNote ?? null,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to seed published version: ${error.message}`);
  return data.id;
}

async function seedWithdrawnVersion(opts: {
  spaceId: string;
  entityType: 'company';
  entityId: string;
  headline: string;
  versionNumber: number;
  publishedAt: string;
  withdrawnAt: string;
  publishNote: string | null;
  withdrawNote: string | null;
  thesis?: string;
  userId: string;
}): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('primary_intelligence')
    .insert({
      space_id: opts.spaceId,
      entity_type: opts.entityType,
      entity_id: opts.entityId,
      state: 'withdrawn',
      headline: opts.headline,
      thesis_md: opts.thesis ?? '',
      watch_md: '',
      implications_md: '',
      last_edited_by: opts.userId,
      version_number: opts.versionNumber,
      published_at: opts.publishedAt,
      published_by: opts.userId,
      publish_note: opts.publishNote,
      withdrawn_at: opts.withdrawnAt,
      withdrawn_by: opts.userId,
      withdraw_note: opts.withdrawNote,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to seed withdrawn version: ${error.message}`);
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
      archivedAt: '2026-04-05T00:00:00Z',
      publishNote: 'initial release',
      userId,
    });
    await seedPublishedVersion({
      spaceId,
      entityType: 'company',
      entityId: companyId,
      headline: 'Acme thesis v2',
      versionNumber: 2,
      publishedAt: '2026-04-05T00:00:00Z',
      publishNote: 'expanded thesis',
      userId,
    });

    await page.goto(companyUrl, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Acme thesis v2', level: 3 })).toBeVisible({
      timeout: 10000,
    });

    const historyRegion = page.getByRole('region', { name: 'History' });
    await expect(historyRegion.getByText('2 versions')).toBeVisible();
    await historyRegion.locator('button[aria-expanded]').first().click();

    // Both publish events render with their version chips inside articles
    // alongside their publish notes. Scope to articles to avoid colliding
    // with the latestPublished chip in the panel header.
    const v1Article = historyRegion.locator('article', { hasText: 'initial release' });
    const v2Article = historyRegion.locator('article', { hasText: 'expanded thesis' });
    await expect(v1Article.getByText('v1', { exact: true })).toBeVisible();
    await expect(v2Article.getByText('v2', { exact: true })).toBeVisible();
    await expect(historyRegion.getByText('"initial release"')).toBeVisible();
    await expect(historyRegion.getByText('"expanded thesis"')).toBeVisible();
    // The archived sub-line for v1 is nested under v2's publish row.
    await expect(v2Article.getByText('v1 archived')).toBeVisible();

    // Withdraw v2 via the IntelligenceBlock control.
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

    await expect(page.getByRole('heading', { name: 'Acme thesis v2', level: 3 })).toBeHidden({
      timeout: 5000,
    });
    await expect(page.getByRole('button', { name: 'Add primary intelligence' })).toBeVisible();

    await page.reload({ waitUntil: 'networkidle' });
    const historyAfter = page.getByRole('region', { name: 'History' });
    await expect(historyAfter.getByText('2 versions')).toBeVisible();
    await historyAfter.locator('button[aria-expanded]').first().click();
    await expect(historyAfter.getByText('Withdrawn').first()).toBeVisible();
    await expect(historyAfter.getByText('"superseded by external press release"')).toBeVisible();
  });

  test('diff base skips withdrawn versions', async () => {
    await ensureClean(spaceId, 'company', companyId);

    await seedArchivedVersion({
      spaceId,
      entityType: 'company',
      entityId: companyId,
      headline: 'Acme v1 headline',
      versionNumber: 1,
      publishedAt: '2026-04-01T00:00:00Z',
      archivedAt: '2026-04-05T00:00:00Z',
      publishNote: 'initial',
      userId,
    });
    await seedWithdrawnVersion({
      spaceId,
      entityType: 'company',
      entityId: companyId,
      headline: 'Acme v2 headline withdrawn branch',
      versionNumber: 2,
      publishedAt: '2026-04-05T00:00:00Z',
      withdrawnAt: '2026-04-06T00:00:00Z',
      publishNote: 'branch we abandoned',
      withdrawNote: 'wrong data',
      userId,
    });
    await seedPublishedVersion({
      spaceId,
      entityType: 'company',
      entityId: companyId,
      headline: 'Acme v3 headline',
      versionNumber: 3,
      publishedAt: '2026-04-07T00:00:00Z',
      publishNote: 'rewritten',
      userId,
    });

    await page.goto(companyUrl, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Acme v3 headline', level: 3 })).toBeVisible({
      timeout: 10000,
    });

    const historyRegion = page.getByRole('region', { name: 'History' });
    await historyRegion.locator('button[aria-expanded]').first().click();

    // Expand v3's Published row.
    const v3Row = historyRegion.locator('article', { hasText: 'v3' }).first();
    await v3Row.locator('button[aria-expanded]').first().click();

    // The diff base label should reference v1, not v2.
    await expect(historyRegion.getByText('Changes vs v1')).toBeVisible();

    // The diff body should include ins/del marks against v1's content.
    await expect(historyRegion.locator('ins').first()).toBeVisible();
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
