import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import {
  createTestTenant,
  createTestSpace,
  createTestCompany,
  createTestProduct,
  createTestTherapeuticArea,
  createTestTrial,
  getAdminClient,
} from '../helpers/test-data.helper';
import { fillInput, clearAndFill } from '../helpers/form.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Asset Management CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const assetsUrl = () => `/t/${tenantId}/s/${spaceId}/manage/assets`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Asset CRUD Org');
    spaceId = await createTestSpace(tenantId, 'Asset Test Space');
    await createTestCompany(spaceId, 'Asset Test Co');

    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('asset list loads', async () => {
    await page.goto(assetsUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Add Asset' })).toBeVisible();
  });

  test('create asset via modal', async () => {
    await page.getByRole('button', { name: 'Add Asset' }).click();
    await expect(page.locator('#asset-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#asset-name', 'Test Asset');
    await fillInput(page, '#asset-generic-name', 'test-generic');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rest/') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Create Asset' }).click(),
    ]);

    await page.goto(assetsUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Test Asset')).toBeVisible({ timeout: 10000 });
  });

  test('edit asset via modal', async () => {
    const row = page.locator('tr', { hasText: 'Test Asset' });
    await row.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.locator('#asset-name')).toBeVisible({ timeout: 5000 });

    await clearAndFill(page, '#asset-name', 'Updated Asset');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rest/') && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: 'Update Asset' }).click(),
    ]);

    await page.goto(assetsUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Updated Asset')).toBeVisible({ timeout: 10000 });
  });

  test('expand asset row to see trials section', async () => {
    const companyId = await createTestCompany(spaceId, 'Expand Co');
    const assetId = await createTestProduct(spaceId, companyId, 'Expandable Asset');
    const taId = await createTestTherapeuticArea(spaceId, 'Expand TA');
    await createTestTrial(spaceId, assetId, taId, 'Seeded Trial');

    await page.goto(assetsUrl(), { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const row = page.locator('tr', { hasText: 'Expandable Asset' });
    await row.waitFor({ timeout: 10000 });
    const expandButton = row.locator('button').first();
    await expandButton.click();
    await expect(page.getByRole('button', { name: 'Add Trial' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Seeded Trial')).toBeVisible({ timeout: 5000 });
  });

  test('edit asset pre-populates form', async () => {
    // Ensure we're on the assets page (prior test may have left the page in an unexpected state)
    await page.goto(assetsUrl(), { waitUntil: 'domcontentloaded' });

    const row = page.locator('tr', { hasText: 'Updated Asset' });
    await row.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.locator('#asset-name')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#asset-name')).toHaveValue('Updated Asset');
    await page.keyboard.press('Escape');
  });

  test('create asset with empty name is prevented', async () => {
    await page.getByRole('button', { name: 'Add Asset' }).click();
    await expect(page.locator('#asset-name')).toBeVisible({ timeout: 5000 });
    // The form auto-disables the submit button when required fields are empty;
    // assert that, then dismiss. (Clicking a disabled button auto-waits and
    // would otherwise time out.)
    await expect(page.getByRole('button', { name: 'Create Asset' })).toBeDisabled();
    await expect(page.locator('.p-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('delete asset via typed-confirm cascades to trials', async () => {
    // Seed a hermetic asset with one trial so we can assert the cascade
    // reached the trial after the asset delete. T6 flipped trials.product_id
    // to ON DELETE CASCADE.
    const cascadeAssetName = 'CascadeAsset ' + Date.now();
    const companyId = await createTestCompany(spaceId, 'CascadeCo ' + Date.now());
    const assetId = await createTestProduct(spaceId, companyId, cascadeAssetName);
    const taId = await createTestTherapeuticArea(spaceId, 'CascadeAssetTA ' + Date.now());
    const trialId = await createTestTrial(
      spaceId,
      assetId,
      taId,
      'CascadeAssetTrial ' + Date.now()
    );

    await page.goto(assetsUrl(), { waitUntil: 'domcontentloaded' });
    const row = page.locator('tr', { hasText: cascadeAssetName });
    await expect(row).toBeVisible({ timeout: 10000 });

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/rest/v1/rpc/preview_product_delete') && r.ok(),
        { timeout: 10000 }
      ),
      (async () => {
        await row.locator('app-row-actions button').click();
        await page.getByRole('menuitem', { name: 'Delete' }).click();
      })(),
    ]);

    const dialog = page.locator('.p-dialog', {
      has: page.locator('input#confirm-delete-typed'),
    });
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Count breakdown shows the seeded trial.
    const breakdown = dialog.locator(
      'table[aria-label="Count breakdown of items this action will remove"]'
    );
    await expect(breakdown).toBeVisible({ timeout: 5000 });
    await expect(breakdown.locator('tr[data-count-key="trials"] td').last()).toHaveText('1');

    const confirmBtn = dialog.getByRole('button', { name: 'Delete', exact: true });
    await expect(confirmBtn).toBeDisabled();
    await dialog.locator('input#confirm-delete-typed').fill(cascadeAssetName);
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    await page.goto(assetsUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('tr', { hasText: cascadeAssetName })).toHaveCount(0, {
      timeout: 5000,
    });

    // Cascade reached the trial. Query directly via admin so this is robust
    // to whichever list surface (or none) currently renders trials.
    const admin = getAdminClient();
    const { data: trialAfter } = await admin
      .from('trials')
      .select('id')
      .eq('id', trialId)
      .maybeSingle();
    expect(trialAfter).toBeNull();
  });

  test('delete "Updated Asset" via typed confirm', async () => {
    await page.goto(assetsUrl(), { waitUntil: 'domcontentloaded' });
    const rows = page.locator('tr', { hasText: 'Updated Asset' });
    await rows.first().waitFor({ timeout: 30000 });
    const count = await rows.count();

    await rows.first().locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    const dialog = page.locator('.p-dialog', {
      has: page.locator('input#confirm-delete-typed'),
    });
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await dialog.locator('input#confirm-delete-typed').fill('Updated Asset');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    await page.goto(assetsUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Add Asset' })).toBeVisible();
    const newCount = await page.locator('tr', { hasText: 'Updated Asset' }).count();
    expect(newCount).toBeLessThan(count);
  });
});
