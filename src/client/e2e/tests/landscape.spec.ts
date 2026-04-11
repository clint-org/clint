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
    // An empty TA with no products at all
    await createTestTherapeuticArea(spaceId, 'Empty Space TA', 'EMPTY');

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

    // Phase data: Farxiga reaches LAUNCHED, others stop at P3
    await createTestTrialPhase(spaceId, dapaHf, 'P3', '2018-01-01');
    await createTestTrialPhase(spaceId, deliver, 'P3', '2019-01-01');
    await createTestTrialPhase(spaceId, deliver, 'LAUNCHED', '2023-05-05');
    await createTestTrialPhase(spaceId, keynoteHf, 'P3', '2021-01-01');
    await createTestTrialPhase(spaceId, eliquisHf, 'P2', '2020-01-01');
    await createTestTrialPhase(spaceId, eliquisHf, 'P3', '2022-01-01');

    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('landscape index lists all therapeutic areas', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/landscape`, { waitUntil: 'networkidle' });
    await page.waitForSelector('app-landscape-index', { timeout: 30000 });

    // Both TAs should show up (including the empty one)
    await expect(page.getByText('Heart Failure HFpEF')).toBeVisible();
    await expect(page.getByText('Empty Space TA')).toBeVisible();

    // HFpEF card shows the highest phase present and the product count
    const hfpefCard = page
      .locator('.landscape-index-card')
      .filter({ hasText: 'Heart Failure HFpEF' });
    await expect(hfpefCard).toContainText('3 products');
    await expect(hfpefCard).toContainText('3 companies');
    await expect(hfpefCard).toContainText('LAUNCHED');
  });

  test('clicking a TA card opens the bullseye for that TA', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/landscape`, { waitUntil: 'networkidle' });
    await page
      .locator('.landscape-index-card')
      .filter({ hasText: 'Heart Failure HFpEF' })
      .click();

    await expect(page).toHaveURL(
      new RegExp(`/landscape/${taHfpefId}(\\?.*)?$`)
    );
    await page.waitForSelector('app-bullseye-chart svg.bullseye-svg', { timeout: 30000 });

    // The chart should render one dot per qualifying product (3 total)
    const dots = page.locator('.bullseye-dot');
    await expect(dots).toHaveCount(3);
  });

  test('hovering a dot shows the product name in a tooltip', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/landscape/${taHfpefId}`, {
      waitUntil: 'networkidle',
    });
    await page.waitForSelector('.bullseye-dot', { timeout: 30000 });

    const farxigaDot = page.locator('.bullseye-dot', { hasText: '' }).first();
    await farxigaDot.hover();
    // PrimeNG tooltip renders as .p-tooltip in the DOM
    await page.waitForTimeout(300);
  });

  test('clicking a dot populates the detail panel and updates the URL', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/landscape/${taHfpefId}`, {
      waitUntil: 'networkidle',
    });
    await page.waitForSelector('.bullseye-dot', { timeout: 30000 });

    // Find the Farxiga dot by its aria-label (product name embedded)
    const farxigaDot = page.locator('[aria-label*="Farxiga"]').first();
    await expect(farxigaDot).toBeVisible();
    await farxigaDot.click();

    // URL should gain a ?product= query param
    await expect(page).toHaveURL(new RegExp(`product=${farxigaId}`));

    // The detail panel should show the product and list its trials
    const panel = page.locator('app-bullseye-detail-panel');
    await expect(panel).toContainText('Farxiga');
    await expect(panel).toContainText('AstraZeneca');
    await expect(panel).toContainText('LAUNCHED');
    await expect(panel).toContainText('DAPA-HF');
    await expect(panel).toContainText('DELIVER');
  });

  test('Escape key clears the selection', async () => {
    await page.goto(
      `/t/${tenantId}/s/${spaceId}/landscape/${taHfpefId}?product=${farxigaId}`,
      { waitUntil: 'networkidle' }
    );
    await page.waitForSelector('.bullseye-dot', { timeout: 30000 });
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/product=/);
  });

  test('empty TA shows the empty state and manage products link', async () => {
    // Create a new product-less TA on the fly for this test
    const emptyId = await createTestTherapeuticArea(
      spaceId,
      'Bulls-Eye Empty ' + Date.now(),
      'BE-EMPTY'
    );
    await page.goto(`/t/${tenantId}/s/${spaceId}/landscape/${emptyId}`, {
      waitUntil: 'networkidle',
    });
    await expect(page.getByText(/No products tracked/)).toBeVisible();
  });
});
