import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';
import { fillInput, clearAndFill } from '../helpers/form.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Therapeutic Area Management CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;

  test.beforeAll(async ({ browser }) => {
    page = await authenticatedPage(browser);
    tenantId = await createTestTenant(page, 'TA Org');
    spaceId = await createTestSpace(page, tenantId, 'TA Test Space');
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('therapeutic area list loads', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/therapeutic-areas`, {
      waitUntil: 'networkidle',
    });
    await expect(page.getByRole('heading', { name: 'Therapeutic Areas' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Therapeutic Area' })).toBeVisible();
  });

  test('create therapeutic area via modal', async () => {
    await page.getByRole('button', { name: 'Add Therapeutic Area' }).click();
    await expect(page.locator('#ta-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#ta-name', 'Oncology');
    await fillInput(page, '#ta-abbreviation', 'ONC');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText('Oncology')).toBeVisible({ timeout: 10000 });
  });

  test('edit therapeutic area via modal', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/therapeutic-areas`, {
      waitUntil: 'networkidle',
    });
    const row = page.locator('tr', { hasText: 'Oncology' });
    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#ta-name')).toBeVisible({ timeout: 5000 });

    await clearAndFill(page, '#ta-name', 'Immunology');
    await clearAndFill(page, '#ta-abbreviation', 'IMM');
    await page.getByRole('button', { name: 'Update' }).click();

    await expect(page.getByText('Immunology')).toBeVisible({ timeout: 10000 });
  });

  test('delete therapeutic area succeeds', async () => {
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/therapeutic-areas`, {
      waitUntil: 'networkidle',
    });
    const row = page.locator('tr', { hasText: 'Immunology' });
    await row.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('Immunology')).not.toBeVisible({ timeout: 5000 });
  });
});
