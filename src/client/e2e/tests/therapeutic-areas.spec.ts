import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';
import { fillInput, clearAndFill } from '../helpers/form.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Therapeutic Area Management CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const taUrl = () => `/t/${tenantId}/s/${spaceId}/manage/therapeutic-areas`;

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
    await expect(page.getByRole('heading', { name: 'Therapeutic Areas' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Therapeutic Area' })).toBeVisible();
  });

  test('create therapeutic area via modal', async () => {
    await page.getByRole('button', { name: 'Add Therapeutic Area' }).click();
    await expect(page.locator('#ta-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#ta-name', 'Oncology');
    await fillInput(page, '#ta-abbreviation', 'ONC');
    await page.waitForTimeout(200);
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rest/') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Create' }).click(),
    ]);

    await page.goto(taUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Oncology')).toBeVisible({ timeout: 10000 });
  });

  test('edit therapeutic area via modal', async () => {
    const row = page.locator('tr', { hasText: 'Oncology' });
    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#ta-name')).toBeVisible({ timeout: 5000 });

    await clearAndFill(page, '#ta-name', 'Immunology');
    await clearAndFill(page, '#ta-abbreviation', 'IMM');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rest/') && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: 'Update' }).click(),
    ]);

    await page.goto(taUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Immunology')).toBeVisible({ timeout: 10000 });
  });

  test('delete therapeutic area succeeds', async () => {
    page.on('dialog', (dialog) => dialog.accept());

    const row = page.locator('tr', { hasText: 'Immunology' });
    await row.getByRole('button', { name: 'Delete' }).click();

    await page.goto(taUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Immunology')).not.toBeVisible({ timeout: 5000 });
  });
});
