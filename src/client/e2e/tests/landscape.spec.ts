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
  createTestAssetIndication,
} from '../helpers/test-data.helper';

test.describe('Landscape bullseye', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  let taHfpefId: string;
  let farxigaId: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(90000);

    tenantId = await createTestTenant('Landscape Test Org');
    spaceId = await createTestSpace(tenantId, 'Landscape Test Space');

    // HFpEF with three competing companies, one of which is Launched
    taHfpefId = await createTestTherapeuticArea(spaceId, 'Heart Failure HFpEF', 'HFpEF');

    const azId = await createTestCompany(spaceId, 'AstraZeneca');
    const merckId = await createTestCompany(spaceId, 'Merck');
    const pfizerId = await createTestCompany(spaceId, 'Pfizer');

    farxigaId = await createTestProduct(spaceId, azId, 'Farxiga');
    const keytrudaId = await createTestProduct(spaceId, merckId, 'Keytruda');
    const eliquisId = await createTestProduct(spaceId, pfizerId, 'Eliquis');

    const dapaHf = await createTestTrial(spaceId, farxigaId, taHfpefId, 'DAPA-HF');
    const deliver = await createTestTrial(spaceId, farxigaId, taHfpefId, 'DELIVER');
    const keynoteHf = await createTestTrial(spaceId, keytrudaId, taHfpefId, 'KEYNOTE-HFpEF');
    const eliquisHf = await createTestTrial(spaceId, eliquisId, taHfpefId, 'ELIQUIS-HF');

    // Phase data: trial phases are clinical phases only (PRECLIN-OBS).
    // Development status (LAUNCHED, APPROVED) lives on asset_indications.
    await createTestTrialPhase(spaceId, dapaHf, 'P3', '2018-01-01');
    await createTestTrialPhase(spaceId, deliver, 'P3', '2019-01-01');
    await createTestTrialPhase(spaceId, keynoteHf, 'P3', '2021-01-01');
    await createTestTrialPhase(spaceId, eliquisHf, 'P2', '2020-01-01');
    await createTestTrialPhase(spaceId, eliquisHf, 'P3', '2022-01-01');

    // Asset-indication rows set the bullseye ring position.
    // Farxiga is LAUNCHED, Keytruda is P3, Eliquis is P3.
    await createTestAssetIndication(spaceId, farxigaId, taHfpefId, 'LAUNCHED');
    await createTestAssetIndication(spaceId, keytrudaId, taHfpefId, 'P3');
    await createTestAssetIndication(spaceId, eliquisId, taHfpefId, 'P3');

    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('bullseye chart renders dots for all assets', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/bullseye`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('app-bullseye-chart svg.bullseye-svg', { timeout: 30000 });

    const dots = page.locator('.bullseye-dot');
    await expect(dots).toHaveCount(3);
  });

  test('bullseye chart shows spoke labels for default grouping', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/bullseye`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('app-bullseye-chart svg.bullseye-svg', { timeout: 30000 });

    // Default grouping is by company; spoke labels render uppercase
    await expect(page.locator('app-bullseye-chart')).toContainText('ASTRAZENECA');
    await expect(page.locator('app-bullseye-chart')).toContainText('MERCK');
    await expect(page.locator('app-bullseye-chart')).toContainText('PFIZER');
  });

  test('hovering a dot shows the product name in a tooltip', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/bullseye`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('.bullseye-dot', { timeout: 30000 });

    const farxigaDot = page.locator('.bullseye-dot', { hasText: '' }).first();
    await farxigaDot.hover();
    await page.waitForTimeout(300);
  });

  test('clicking a dot populates the detail panel and updates the URL', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/bullseye`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('.bullseye-dot', { timeout: 30000 });

    const farxigaDot = page.locator('[aria-label*="Farxiga"]').first();
    await expect(farxigaDot).toBeVisible();
    await farxigaDot.click();

    // URL should gain a ?product= query param
    await expect(page).toHaveURL(new RegExp(`product=${farxigaId}`));

    // The detail panel should show the asset and list its trials
    const panel = page.locator('app-bullseye-detail-panel');
    await expect(panel).toContainText('Farxiga');
    await expect(panel).toContainText('DAPA-HF');
    await expect(panel).toContainText('DELIVER');
  });

  test('Escape key clears the selection', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/bullseye?product=${farxigaId}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('.bullseye-dot', { timeout: 30000 });
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/product=/);
  });

  test('empty space shows the empty state and view assets button', async () => {
    const emptySpaceId = await createTestSpace(tenantId, 'Empty Bullseye Space');
    await page.goto(`/t/${tenantId}/s/${emptySpaceId}/bullseye`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByText(/No assets match the current filters/)).toBeVisible();
    await expect(page.getByText('View assets')).toBeVisible();
  });
});
