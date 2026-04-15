import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';
import { fillInput, clearAndFill } from '../helpers/form.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Taxonomies - Therapeutic Areas', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const taxUrl = () => `/t/${tenantId}/s/${spaceId}/settings/taxonomies?tab=therapeutic-areas`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Tax TA Org');
    spaceId = await createTestSpace(tenantId, 'Tax TA Space');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('taxonomies page loads with TA tab active', async () => {
    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Add therapeutic area' })).toBeVisible();
  });

  test('create therapeutic area', async () => {
    await page.getByRole('button', { name: 'Add therapeutic area' }).click();
    await expect(page.locator('#ta-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#ta-name', 'Cardiology');
    await page.waitForTimeout(200);
    await fillInput(page, '#ta-abbreviation', 'CARD');
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Cardiology')).toBeVisible({ timeout: 10000 });
  });

  test('edit therapeutic area pre-populates form', async () => {
    const row = page.locator('tr', { hasText: 'Cardiology' });
    await row.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.locator('#ta-name')).toBeVisible({ timeout: 5000 });

    // KEY ASSERTION: Verify pre-population (this was the bug)
    await expect(page.locator('#ta-name')).toHaveValue('Cardiology');

    await clearAndFill(page, '#ta-name', 'Neurology');
    await clearAndFill(page, '#ta-abbreviation', 'NEURO');
    await page.getByRole('button', { name: 'Update' }).click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Neurology')).toBeVisible({ timeout: 10000 });
  });

  test('delete therapeutic area', async () => {
    page.on('dialog', (d) => d.accept());
    const row = page.locator('tr', { hasText: 'Neurology' });
    await row.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Neurology')).not.toBeVisible({ timeout: 5000 });
  });
});

test.describe('Taxonomies - Mechanisms of Action', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const taxUrl = () => `/t/${tenantId}/s/${spaceId}/settings/taxonomies?tab=moa`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Tax MOA Org');
    spaceId = await createTestSpace(tenantId, 'Tax MOA Space');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('MOA tab loads', async () => {
    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Add mechanism' })).toBeVisible();
  });

  test('create MOA', async () => {
    await page.getByRole('button', { name: 'Add mechanism' }).click();
    await expect(page.locator('#moa-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#moa-name', 'PD-1 Inhibitor');
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('PD-1 Inhibitor')).toBeVisible({ timeout: 10000 });
  });

  test('edit MOA pre-populates form', async () => {
    const row = page.locator('tr', { hasText: 'PD-1 Inhibitor' });
    await row.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.locator('#moa-name')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#moa-name')).toHaveValue('PD-1 Inhibitor');

    await clearAndFill(page, '#moa-name', 'VEGF Inhibitor');
    await page.getByRole('button', { name: 'Update' }).click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('VEGF Inhibitor')).toBeVisible({ timeout: 10000 });
  });

  test('delete MOA', async () => {
    page.on('dialog', (d) => d.accept());
    const row = page.locator('tr', { hasText: 'VEGF Inhibitor' });
    await row.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('VEGF Inhibitor')).not.toBeVisible({ timeout: 5000 });
  });
});

test.describe('Taxonomies - Routes of Administration', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const taxUrl = () => `/t/${tenantId}/s/${spaceId}/settings/taxonomies?tab=roa`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Tax ROA Org');
    spaceId = await createTestSpace(tenantId, 'Tax ROA Space');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('ROA tab loads', async () => {
    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Add route' })).toBeVisible();
  });

  test('create ROA', async () => {
    await page.getByRole('button', { name: 'Add route' }).click();
    await expect(page.locator('#roa-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#roa-name', 'Intravenous');
    await page.waitForTimeout(200);
    await fillInput(page, '#roa-abbreviation', 'IV');
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Intravenous')).toBeVisible({ timeout: 10000 });
  });

  test('edit ROA pre-populates form', async () => {
    const row = page.locator('tr', { hasText: 'Intravenous' });
    await row.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.locator('#roa-name')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#roa-name')).toHaveValue('Intravenous');

    await clearAndFill(page, '#roa-name', 'Subcutaneous');
    await clearAndFill(page, '#roa-abbreviation', 'SC');
    await page.getByRole('button', { name: 'Update' }).click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Subcutaneous')).toBeVisible({ timeout: 10000 });
  });

  test('delete ROA', async () => {
    page.on('dialog', (d) => d.accept());
    const row = page.locator('tr', { hasText: 'Subcutaneous' });
    await row.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Subcutaneous')).not.toBeVisible({ timeout: 5000 });
  });
});
