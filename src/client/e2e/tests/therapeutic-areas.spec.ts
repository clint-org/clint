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
import { clickRowAction } from '../helpers/menu.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Therapeutic Area Management CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  // The old /manage/therapeutic-areas now redirects to /settings/taxonomies
  const taUrl = () => `/t/${tenantId}/s/${spaceId}/settings/taxonomies?tab=therapeutic-areas`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('TA Org');
    spaceId = await createTestSpace(tenantId, 'TA Test Space');

    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('therapeutic area list loads', async () => {
    await page.goto(taUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Add therapeutic area' })).toBeVisible();
  });

  test('create therapeutic area via modal', async () => {
    await page.getByRole('button', { name: 'Add therapeutic area' }).click();
    await expect(page.locator('#ta-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#ta-name', 'Oncology');
    await page.waitForTimeout(300);
    await fillInput(page, '#ta-abbreviation', 'ONC');
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(3000);

    await page.goto(taUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Oncology')).toBeVisible({ timeout: 10000 });
  });

  test('edit therapeutic area via modal', async () => {
    const row = page.locator('tr', { hasText: 'Oncology' });
    await clickRowAction(page, row, 'Edit');
    await expect(page.locator('#ta-name')).toBeVisible({ timeout: 5000 });

    await clearAndFill(page, '#ta-name', 'Immunology');
    await clearAndFill(page, '#ta-abbreviation', 'IMM');
    await page.getByRole('button', { name: 'Update' }).click();
    await page.waitForTimeout(2000);

    await page.goto(taUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Immunology')).toBeVisible({ timeout: 10000 });
  });

  test('delete therapeutic area via typed confirm leaves trials with null TA (set null cascade)', async () => {
    // Cascade-safety T6 flipped trials.therapeutic_area_id from BLOCK to
    // ON DELETE SET NULL. Trials in the deleted area survive with a null TA
    // reference. Seed a trial bound to the TA, delete the TA, then assert:
    //   (a) the TA is gone from the list
    //   (b) the trial row still exists with therapeutic_area_id = null
    const companyId = await createTestCompany(spaceId, 'TA Cascade Co ' + Date.now());
    const productId = await createTestProduct(spaceId, companyId, 'TA Cascade Product');
    // Read back the TA we are about to delete so we can target by id below.
    const admin = getAdminClient();
    const { data: ta } = await admin
      .from('therapeutic_areas')
      .select('id')
      .eq('space_id', spaceId)
      .eq('name', 'Immunology')
      .single();
    const trialId = await createTestTrial(spaceId, productId, ta!.id, 'TA Cascade Trial');

    const row = page.locator('tr', { hasText: 'Immunology' });
    await clickRowAction(page, row, 'Delete');

    const dialog = page.locator('.p-dialog', {
      has: page.locator('input#confirm-delete-typed'),
    });
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await dialog.locator('input#confirm-delete-typed').fill('Immunology');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    await page.goto(taUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Immunology')).not.toBeVisible({ timeout: 5000 });

    // Trial survives with null therapeutic_area_id. Query directly so this is
    // robust to whether the trial list / detail surfaces the (uncategorized)
    // label or simply hides the now-orphaned TA chip.
    const { data: trialAfter } = await admin
      .from('trials')
      .select('id, therapeutic_area_id')
      .eq('id', trialId)
      .single();
    expect(trialAfter).not.toBeNull();
    expect(trialAfter!.therapeutic_area_id).toBeNull();
  });
});
