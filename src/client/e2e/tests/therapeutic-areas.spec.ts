import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';
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

  test('delete therapeutic area succeeds', async () => {
    const row = page.locator('tr', { hasText: 'Immunology' });
    await clickRowAction(page, row, 'Delete');
    // Handle PrimeNG ConfirmDialog
    await page.locator('.p-confirmdialog-accept-button, .p-confirm-dialog-accept').click();
    await page.waitForTimeout(2000);

    await page.goto(taUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Immunology')).not.toBeVisible({ timeout: 5000 });
  });
});
