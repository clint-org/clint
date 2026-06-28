import { test, expect, Page } from '@playwright/test';
import { authenticatedPage, getAuthStorage } from '../helpers/auth.helper';
import {
  createTestAgency,
  createTestCompany,
  createTestSpace,
  createTestTenant,
  getAdminClient,
} from '../helpers/test-data.helper';

/**
 * E2E coverage for the multi-brief drawer: an entity with multiple published
 * briefs shows the lead expanded in an IntelligenceBlock and non-lead entries
 * collapsed in an IntelligenceBriefList below. The Add-entry button opens the
 * drawer in new-brief mode (blank form), the Pin button promotes a non-lead
 * entry to lead, and the Version-history affordance inside a collapsed entry
 * opens the history panel for that entry.
 *
 * All write RPCs (set_intelligence_lead) require is_agency_member_of_space;
 * createTestAgency links the test user as an agency owner so those RPCs pass
 * the server gate. Read-path tests (rendering, Add-entry drawer open) work
 * with space-owner role alone, but the shared setup uses agency + space owner
 * so one beforeAll covers all scenarios.
 *
 * Seeding uses the admin (service-role) client to insert anchors and PI rows
 * directly, matching the intelligence-history.spec.ts pattern.
 */
test.describe.configure({ mode: 'serial' });

/**
 * Insert one anchor (brief) and one published PI row for it via the admin
 * client. Returns the anchor id.
 */
async function seedPublishedBrief(opts: {
  spaceId: string;
  entityType: 'company';
  entityId: string;
  headline: string;
  isLead: boolean;
  displayOrder: number;
  userId: string;
}): Promise<string> {
  const admin = getAdminClient();

  const { data: anchor, error: anchorErr } = await admin
    .from('primary_intelligence_anchors')
    .insert({
      space_id: opts.spaceId,
      entity_type: opts.entityType,
      entity_id: opts.entityId,
      is_lead: opts.isLead,
      display_order: opts.displayOrder,
      created_by: opts.userId,
    })
    .select('id')
    .single();
  if (anchorErr) throw new Error(`Failed to create anchor: ${anchorErr.message}`);

  const { error: piErr } = await admin.from('primary_intelligence').insert({
    space_id: opts.spaceId,
    anchor_id: anchor.id,
    state: 'published',
    headline: opts.headline,
    summary_md: '',
    implications_md: '',
    last_edited_by: opts.userId,
    version_number: 1,
    published_at: new Date().toISOString(),
    published_by: opts.userId,
  });
  if (piErr) throw new Error(`Failed to create PI row: ${piErr.message}`);

  return anchor.id;
}

/**
 * Remove all anchors for an entity. The primary_intelligence rows cascade via
 * the anchor FK, so this is a complete teardown for the entity's brief state.
 */
async function cleanBriefs(spaceId: string, entityId: string): Promise<void> {
  const admin = getAdminClient();
  await admin
    .from('primary_intelligence_anchors')
    .delete()
    .eq('space_id', spaceId)
    .eq('entity_id', entityId);
}

test.describe('multi-brief drawer', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  let companyId: string;
  let companyUrl: string;
  let userId: string;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Multi Brief Org');
    // Agency membership is required for the set_intelligence_lead RPC gate.
    await createTestAgency('Multi Brief Agency', { tenantId });
    spaceId = await createTestSpace(tenantId, 'Multi Brief Space');
    companyId = await createTestCompany(spaceId, 'Briefs Co');
    companyUrl = `/t/${tenantId}/s/${spaceId}/profiles/companies/${companyId}`;
    page = await authenticatedPage(browser);
    userId = getAuthStorage().userId;
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('empty state: entity with no briefs shows the Add-intelligence affordance', async () => {
    await cleanBriefs(spaceId, companyId);

    await page.goto(companyUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Briefs Co', level: 1 })).toBeVisible({
      timeout: 10000,
    });
    // IntelligenceEmptyComponent renders a p-button labelled "Add intelligence"
    await expect(page.getByRole('button', { name: 'Add intelligence' })).toBeVisible();
  });

  test('detail page with two briefs: Intelligence (2) header, lead expanded, non-lead collapsed in list', async () => {
    await cleanBriefs(spaceId, companyId);
    await seedPublishedBrief({
      spaceId,
      entityType: 'company',
      entityId: companyId,
      headline: 'Lead thesis alpha',
      isLead: true,
      displayOrder: 0,
      userId,
    });
    await seedPublishedBrief({
      spaceId,
      entityType: 'company',
      entityId: companyId,
      headline: 'Sibling brief beta',
      isLead: false,
      displayOrder: 1,
      userId,
    });

    await page.goto(companyUrl, { waitUntil: 'domcontentloaded' });
    // Section header shows the count
    await expect(page.getByText('Intelligence (2)')).toBeVisible({ timeout: 10000 });
    // Lead brief renders in the expanded IntelligenceBlock (h3)
    await expect(page.getByRole('heading', { name: 'Lead thesis alpha', level: 3 })).toBeVisible();
    // Non-lead brief appears as a collapsed row in the IntelligenceBriefList
    const briefList = page.getByRole('list', { name: 'Additional intelligence entries' });
    await expect(briefList).toBeVisible();
    await expect(briefList.getByText('Sibling brief beta')).toBeVisible();
  });

  test('Add entry opens the drawer in new-brief mode with a blank headline', async () => {
    // Requires existing intelligence so the Add-entry button (not the empty-state
    // Add-intelligence button) is rendered.
    await page.goto(companyUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Intelligence (2)')).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Add entry' }).click();

    // Drawer opens: the headline input must be visible and empty (new-brief mode
    // never pre-seeds content from an existing brief).
    const headlineInput = page.locator('#pi-headline');
    await expect(headlineInput).toBeVisible({ timeout: 5000 });
    await expect(headlineInput).toHaveValue('');

    // Close the drawer without saving
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('pin button promotes a non-lead brief to the lead position', async () => {
    await page.goto(companyUrl, { waitUntil: 'domcontentloaded' });
    // Confirm the current lead before pinning
    await expect(page.getByRole('heading', { name: 'Lead thesis alpha', level: 3 })).toBeVisible({
      timeout: 10000,
    });

    // Click the pin button on the sibling brief (only one pin button visible)
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/rest/v1/rpc/set_intelligence_lead') && r.ok()
      ),
      page.getByRole('button', { name: 'Pin as lead entry' }).click(),
    ]);

    // After the UI reloads, the former sibling is now the lead
    await expect(
      page.getByRole('heading', { name: 'Sibling brief beta', level: 3 })
    ).toBeVisible({ timeout: 5000 });
    // Former lead drops into the brief-list
    const briefList = page.getByRole('list', { name: 'Additional intelligence entries' });
    await expect(briefList.getByText('Lead thesis alpha')).toBeVisible();
  });

  test('expanding a non-lead brief and clicking Version history opens the history panel', async () => {
    // After the pin test: "Sibling brief beta" is lead; "Lead thesis alpha" is in the list.
    await page.goto(companyUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Intelligence (2)')).toBeVisible({ timeout: 10000 });

    const briefList = page.getByRole('list', { name: 'Additional intelligence entries' });
    // The expand toggle button accessible name is the brief headline text
    await briefList.getByRole('button', { name: 'Lead thesis alpha' }).click();

    // Version history button appears in the expanded body
    await expect(
      briefList.getByRole('button', { name: 'View version history for this entry' })
    ).toBeVisible({ timeout: 5000 });
    await briefList.getByRole('button', { name: 'View version history for this entry' }).click();

    // History panel is visible on the page (section aria-labelledby="history-heading")
    await expect(page.getByRole('region', { name: 'History' })).toBeVisible({ timeout: 5000 });
  });
});
