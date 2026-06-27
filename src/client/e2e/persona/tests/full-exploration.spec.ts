import { test, expect } from '../fixtures';

const BASE = 'https://bi.dev.clintapp.com';
const TENANT_ID = '02cbe930-7f17-46c4-942b-bc854b625cee';
const SPACES_URL = `${BASE}/t/${TENANT_ID}/spaces`;

const REPORT_DIR = 'e2e/persona/reports';

let obesitySpaceId = '';
let noDataSpaceId = '';

test.describe.configure({ mode: 'serial' });

test.describe('Full App Exploration', () => {

  // ── Phase 0: Discover space IDs ──────────────────────────────────────

  test('00 - discover space IDs from spaces page', async ({ cdpPage: page }) => {
    await page.goto(SPACES_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Obesity Test')).toBeVisible({ timeout: 30_000 });

    // Click into Obesity Test to get its space ID from the URL
    await page.getByText('Obesity Test').click();
    await page.waitForURL(/\/s\//, { timeout: 15_000 });
    const url1 = page.url();
    const match1 = url1.match(/\/s\/([a-f0-9-]+)/);
    obesitySpaceId = match1?.[1] || '';
    console.log(`Obesity Test space ID: ${obesitySpaceId}`);

    // Go back and get No Data Test space ID
    await page.goto(SPACES_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('No Data Test')).toBeVisible({ timeout: 15_000 });
    await page.getByText('No Data Test').click();
    await page.waitForURL(/\/s\//, { timeout: 15_000 });
    const url2 = page.url();
    const match2 = url2.match(/\/s\/([a-f0-9-]+)/);
    noDataSpaceId = match2?.[1] || '';
    console.log(`No Data Test space ID: ${noDataSpaceId}`);

    expect(obesitySpaceId).toBeTruthy();
    expect(noDataSpaceId).toBeTruthy();
  });

  // ── Phase 1: Spaces page ─────────────────────────────────────────────

  test('01 - spaces list page', async ({ cdpPage: page }) => {
    await page.goto(SPACES_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Obesity Test')).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${REPORT_DIR}/01-spaces-list.png`, fullPage: true });
  });

  // ── Phase 2: Obesity Test space (seeded data) ────────────────────────

  test('02 - obesity: engagement landing (home)', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${REPORT_DIR}/02-obesity-home.png`, fullPage: true });
  });

  test('03 - obesity: timeline view', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}/timeline`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${REPORT_DIR}/03-obesity-timeline.png`, fullPage: true });
  });

  test('04 - obesity: bullseye view', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}/bullseye`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${REPORT_DIR}/04-obesity-bullseye.png`, fullPage: true });
  });

  test('05 - obesity: positioning view', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}/positioning`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${REPORT_DIR}/05-obesity-positioning.png`, fullPage: true });
  });

  test('06 - obesity: catalysts view', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}/catalysts`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${REPORT_DIR}/06-obesity-catalysts.png`, fullPage: true });
  });

  test('07 - obesity: companies list', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}/profiles/companies`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${REPORT_DIR}/07-obesity-companies.png`, fullPage: true });
  });

  test('08 - obesity: assets list', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}/profiles/assets`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${REPORT_DIR}/08-obesity-assets.png`, fullPage: true });
  });

  test('09 - obesity: trials list', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}/profiles/trials`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${REPORT_DIR}/09-obesity-trials.png`, fullPage: true });
  });

  test('10 - obesity: engagement detail', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}/profiles/engagement`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${REPORT_DIR}/10-obesity-engagement.png`, fullPage: true });
  });

  test('11 - obesity: intelligence feed', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}/intelligence`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${REPORT_DIR}/11-obesity-intelligence.png`, fullPage: true });
  });

  test('12 - obesity: materials', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}/materials`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${REPORT_DIR}/12-obesity-materials.png`, fullPage: true });
  });

  test('13 - obesity: events log', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}/events`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${REPORT_DIR}/13-obesity-events.png`, fullPage: true });
  });

  test('14 - obesity: settings - general', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}/settings/general`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${REPORT_DIR}/14-obesity-settings-general.png`, fullPage: true });
  });

  test('15 - obesity: settings - members', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}/settings/members`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${REPORT_DIR}/15-obesity-settings-members.png`, fullPage: true });
  });

  test('16 - obesity: settings - taxonomies', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}/settings/taxonomies`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${REPORT_DIR}/16-obesity-settings-taxonomies.png`, fullPage: true });
  });

  test('17 - obesity: settings - marker types', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}/settings/marker-types`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${REPORT_DIR}/17-obesity-settings-marker-types.png`, fullPage: true });
  });

  test('18 - obesity: settings - fields', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}/settings/fields`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${REPORT_DIR}/18-obesity-settings-fields.png`, fullPage: true });
  });

  test('19 - obesity: help - markers', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}/help/markers`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${REPORT_DIR}/19-obesity-help-markers.png`, fullPage: true });
  });

  // ── Phase 3: No Data Test space (empty state) ───────────────────────

  test('20 - nodata: engagement landing (home)', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${noDataSpaceId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${REPORT_DIR}/20-nodata-home.png`, fullPage: true });
  });

  test('21 - nodata: timeline view', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${noDataSpaceId}/timeline`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${REPORT_DIR}/21-nodata-timeline.png`, fullPage: true });
  });

  test('22 - nodata: bullseye view', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${noDataSpaceId}/bullseye`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${REPORT_DIR}/22-nodata-bullseye.png`, fullPage: true });
  });

  test('23 - nodata: companies list', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${noDataSpaceId}/profiles/companies`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${REPORT_DIR}/23-nodata-companies.png`, fullPage: true });
  });

  test('24 - nodata: assets list', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${noDataSpaceId}/profiles/assets`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${REPORT_DIR}/24-nodata-assets.png`, fullPage: true });
  });

  test('25 - nodata: trials list', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${noDataSpaceId}/profiles/trials`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${REPORT_DIR}/25-nodata-trials.png`, fullPage: true });
  });

  test('26 - nodata: intelligence feed', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${noDataSpaceId}/intelligence`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${REPORT_DIR}/26-nodata-intelligence.png`, fullPage: true });
  });

  test('27 - nodata: catalysts view', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${noDataSpaceId}/catalysts`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${REPORT_DIR}/27-nodata-catalysts.png`, fullPage: true });
  });

  // ── Phase 4: Interaction tests (on Obesity Test) ─────────────────────

  test('28 - obesity: click into first company detail', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}/profiles/companies`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Click first row in the table
    const firstRow = page.locator('table tbody tr, p-table tbody tr, .p-datatable-tbody tr').first();
    if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstRow.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${REPORT_DIR}/28-obesity-company-detail.png`, fullPage: true });
    } else {
      await page.screenshot({ path: `${REPORT_DIR}/28-obesity-company-detail-no-rows.png`, fullPage: true });
    }
  });

  test('29 - obesity: click into first asset detail', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}/profiles/assets`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const firstRow = page.locator('table tbody tr, p-table tbody tr, .p-datatable-tbody tr').first();
    if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstRow.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${REPORT_DIR}/29-obesity-asset-detail.png`, fullPage: true });
    } else {
      await page.screenshot({ path: `${REPORT_DIR}/29-obesity-asset-detail-no-rows.png`, fullPage: true });
    }
  });

  test('30 - obesity: click into first trial detail', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}/profiles/trials`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const firstRow = page.locator('table tbody tr, p-table tbody tr, .p-datatable-tbody tr').first();
    if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstRow.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${REPORT_DIR}/30-obesity-trial-detail.png`, fullPage: true });
    } else {
      await page.screenshot({ path: `${REPORT_DIR}/30-obesity-trial-detail-no-rows.png`, fullPage: true });
    }
  });

  // ── Phase 5: Topbar and command palette ──────────────────────────────

  test('31 - obesity: topbar and landscape tabs', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}/timeline`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Capture the topbar with landscape tabs visible
    const topbar = page.locator('app-contextual-topbar, .topbar, header');
    if (await topbar.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await page.screenshot({ path: `${REPORT_DIR}/31-obesity-topbar-tabs.png` });
    } else {
      await page.screenshot({ path: `${REPORT_DIR}/31-obesity-topbar.png` });
    }
  });

  test('32 - obesity: sidebar expanded', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/s/${obesitySpaceId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Hover over sidebar to expand it
    const sidebar = page.locator('app-sidebar');
    await sidebar.hover();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${REPORT_DIR}/32-obesity-sidebar-expanded.png` });
  });

  // ── Phase 6: Tenant-level pages ──────────────────────────────────────

  test('33 - tenant settings', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/settings`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${REPORT_DIR}/33-tenant-settings.png`, fullPage: true });
  });

  test('34 - help: phases', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/help/phases`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${REPORT_DIR}/34-help-phases.png`, fullPage: true });
  });

  test('35 - help: roles', async ({ cdpPage: page }) => {
    await page.goto(`${BASE}/t/${TENANT_ID}/help/roles`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${REPORT_DIR}/35-help-roles.png`, fullPage: true });
  });
});
