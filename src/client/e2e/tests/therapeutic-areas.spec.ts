import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import {
  createTestTenant,
  createTestSpace,
} from '../helpers/test-data.helper';
import { fillInput, clearAndFill } from '../helpers/form.helper';
import { clickRowAction } from '../helpers/menu.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Indication Management CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  // The old /manage/therapeutic-areas now redirects to /settings/taxonomies
  const taUrl = () => `/t/${tenantId}/s/${spaceId}/settings/taxonomies?tab=indications`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('TA Org');
    spaceId = await createTestSpace(tenantId, 'TA Test Space');

    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('indication list loads', async () => {
    await page.goto(taUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Add indication' })).toBeVisible();
  });

  test('create indication via modal', async () => {
    await page.getByRole('button', { name: 'Add indication' }).click();
    await expect(page.locator('#ta-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#ta-name', 'Oncology');
    await page.waitForTimeout(300);
    await fillInput(page, '#ta-abbreviation', 'ONC');
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(3000);

    await page.goto(taUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Oncology')).toBeVisible({ timeout: 10000 });
  });

  test('edit indication via modal', async () => {
    const row = page.locator('tr', { hasText: 'Oncology' });
    await clickRowAction(page, row, 'Edit');
    await expect(page.locator('#ta-name')).toBeVisible({ timeout: 5000 });

    await clearAndFill(page, '#ta-name', 'Immunology');
    await clearAndFill(page, '#ta-abbreviation', 'IMM');
    await page.getByRole('button', { name: 'Update' }).click();
    await page.waitForTimeout(2000);

    await page.goto(taUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Immunology')).toBeVisible({ timeout: 10000 });
  });

  test('delete indication via typed confirm', async () => {
    // Indications replaced therapeutic_areas. Trials no longer have a direct
    // indication FK, so this test simply verifies the indication is removed
    // from the list after the typed-confirm delete flow.
    const row = page.locator('tr', { hasText: 'Immunology' });
    await clickRowAction(page, row, 'Delete');

    const dialog = page.locator('.p-dialog', {
      has: page.locator('input#confirm-delete-typed'),
    });
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await dialog.locator('input#confirm-delete-typed').fill('Immunology');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    await page.goto(taUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Immunology')).not.toBeVisible({ timeout: 5000 });
  });
});
