import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';
import { fillInput, clearAndFill } from '../helpers/form.helper';
import { clickRowAction } from '../helpers/menu.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Taxonomies - Indications', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const taxUrl = () => `/t/${tenantId}/s/${spaceId}/settings/taxonomies?tab=indications`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Tax TA Org');
    spaceId = await createTestSpace(tenantId, 'Tax TA Space');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('taxonomies page loads with TA tab active', async () => {
    await page.goto(taxUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Add indication' })).toBeVisible();
  });

  test('create indication', async () => {
    await page.getByRole('button', { name: 'Add indication' }).click();
    await expect(page.locator('#ta-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#ta-name', 'Cardiology');
    await page.waitForTimeout(200);
    await fillInput(page, '#ta-abbreviation', 'CARD');
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Cardiology')).toBeVisible({ timeout: 10000 });
  });

  test('edit indication pre-populates form', async () => {
    const row = page.locator('tr', { hasText: 'Cardiology' });
    await clickRowAction(page, row, 'Edit');
    await expect(page.locator('#ta-name')).toBeVisible({ timeout: 5000 });

    // KEY ASSERTION: Verify pre-population (this was the bug)
    await expect(page.locator('#ta-name')).toHaveValue('Cardiology');

    await clearAndFill(page, '#ta-name', 'Neurology');
    await clearAndFill(page, '#ta-abbreviation', 'NEURO');
    await page.getByRole('button', { name: 'Update' }).click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Neurology')).toBeVisible({ timeout: 10000 });
  });

  test('delete indication via typed-name confirm', async () => {
    const row = page.locator('tr', { hasText: 'Neurology' });
    await clickRowAction(page, row, 'Delete');

    // Cascade-safety T12: every named delete uses the type-the-name gate.
    const dialog = page.locator('.p-dialog', {
      has: page.locator('input#confirm-delete-typed'),
    });
    await expect(dialog).toBeVisible({ timeout: 10000 });
    const confirmBtn = dialog.getByRole('button', { name: 'Delete', exact: true });
    await expect(confirmBtn).toBeDisabled();
    await dialog.locator('input#confirm-delete-typed').fill('Neurology');
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    await page.goto(taxUrl(), { waitUntil: 'domcontentloaded' });
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
    await page.goto(taxUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Add mechanism' })).toBeVisible();
  });

  test('create MOA', async () => {
    await page.getByRole('button', { name: 'Add mechanism' }).click();
    await expect(page.locator('#moa-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#moa-name', 'PD-1 Inhibitor');
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('PD-1 Inhibitor')).toBeVisible({ timeout: 10000 });
  });

  test('edit MOA pre-populates form', async () => {
    const row = page.locator('tr', { hasText: 'PD-1 Inhibitor' });
    await clickRowAction(page, row, 'Edit');
    await expect(page.locator('#moa-name')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#moa-name')).toHaveValue('PD-1 Inhibitor');

    await clearAndFill(page, '#moa-name', 'VEGF Inhibitor');
    await page.getByRole('button', { name: 'Update' }).click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('VEGF Inhibitor')).toBeVisible({ timeout: 10000 });
  });

  test('delete MOA via typed-name confirm', async () => {
    const row = page.locator('tr', { hasText: 'VEGF Inhibitor' });
    await clickRowAction(page, row, 'Delete');

    const dialog = page.locator('.p-dialog', {
      has: page.locator('input#confirm-delete-typed'),
    });
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await dialog.locator('input#confirm-delete-typed').fill('VEGF Inhibitor');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    await page.goto(taxUrl(), { waitUntil: 'domcontentloaded' });
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
    await page.goto(taxUrl(), { waitUntil: 'domcontentloaded' });
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

    await page.goto(taxUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Intravenous')).toBeVisible({ timeout: 10000 });
  });

  test('edit ROA pre-populates form', async () => {
    const row = page.locator('tr', { hasText: 'Intravenous' });
    await clickRowAction(page, row, 'Edit');
    await expect(page.locator('#roa-name')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#roa-name')).toHaveValue('Intravenous');

    await clearAndFill(page, '#roa-name', 'Subcutaneous');
    await clearAndFill(page, '#roa-abbreviation', 'SC');
    await page.getByRole('button', { name: 'Update' }).click();
    await page.waitForTimeout(2000);

    await page.goto(taxUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Subcutaneous')).toBeVisible({ timeout: 10000 });
  });

  test('delete ROA via typed-name confirm', async () => {
    const row = page.locator('tr', { hasText: 'Subcutaneous' });
    await clickRowAction(page, row, 'Delete');

    const dialog = page.locator('.p-dialog', {
      has: page.locator('input#confirm-delete-typed'),
    });
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await dialog.locator('input#confirm-delete-typed').fill('Subcutaneous');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    await page.goto(taxUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Subcutaneous')).not.toBeVisible({ timeout: 5000 });
  });
});
