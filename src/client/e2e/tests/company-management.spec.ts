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

test.describe('Company Management CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const companiesUrl = () => `/t/${tenantId}/s/${spaceId}/manage/companies`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Company CRUD Org');
    spaceId = await createTestSpace(tenantId, 'Company Test Space');

    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('company list loads', async () => {
    await page.goto(companiesUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Add Company' })).toBeVisible();
  });

  test('create company via modal', async () => {
    await page.getByRole('button', { name: 'Add Company' }).click();
    await expect(page.locator('#company-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#company-name', 'Test Company');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rest/') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Create Company' }).click(),
    ]);

    await page.goto(companiesUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Test Company')).toBeVisible({ timeout: 10000 });
  });

  test('edit company via modal', async () => {
    const row = page.locator('tr', { hasText: 'Test Company' });
    await row.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.locator('#company-name')).toBeVisible({ timeout: 5000 });

    await clearAndFill(page, '#company-name', 'Updated Company');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rest/') && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: 'Update Company' }).click(),
    ]);

    await page.goto(companiesUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Updated Company')).toBeVisible({ timeout: 10000 });
  });

  test('edit company pre-populates name', async () => {
    const row = page.locator('tr', { hasText: 'Updated Company' });
    await row.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.locator('#company-name')).toBeVisible({ timeout: 5000 });
    // Verify name pre-population
    await expect(page.locator('#company-name')).toHaveValue('Updated Company');
    await page.keyboard.press('Escape');
  });

  test('create company with empty name is prevented', async () => {
    await page.getByRole('button', { name: 'Add Company' }).click();
    await expect(page.locator('#company-name')).toBeVisible({ timeout: 5000 });
    // Submit without filling name
    await page.getByRole('button', { name: 'Create Company' }).click();
    // Dialog should stay open
    await expect(page.locator('.p-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('delete company opens count-aware typed-confirm dialog and cascades', async () => {
    // Seed a hermetic graph so preview_company_delete returns non-zero counts
    // and the cascade has children to remove. Created via admin client so we
    // can also assert the cascade reached assets and trials below.
    const cascadeCompanyName = 'CascadeCompany ' + Date.now();
    const productName = 'CascadeProduct ' + Date.now();
    const taName = 'CascadeTA ' + Date.now();
    const trialName = 'CascadeTrial ' + Date.now();

    const companyId = await createTestCompany(spaceId, cascadeCompanyName);
    const productId = await createTestProduct(spaceId, companyId, productName);
    const taId = await createTestTherapeuticArea(spaceId, taName);
    const trialId = await createTestTrial(spaceId, productId, taId, trialName);

    await page.goto(companiesUrl(), { waitUntil: 'domcontentloaded' });
    const row = page.locator('tr', { hasText: cascadeCompanyName });
    await expect(row).toBeVisible({ timeout: 10000 });

    // Opening the delete menu fires preview_company_delete; wait for it so the
    // count breakdown is populated when the dialog appears.
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/rest/v1/rpc/preview_company_delete') && r.ok(),
        { timeout: 10000 }
      ),
      (async () => {
        await row.locator('app-row-actions button').click();
        await page.getByRole('menuitem', { name: 'Delete' }).click();
      })(),
    ]);

    // The cascade-aware dialog has the typed-confirm input; the legacy
    // p-confirmdialog does not, so anchor on that.
    const dialog = page.locator('.p-dialog', {
      has: page.locator('input#confirm-delete-typed'),
    });
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Count breakdown is present with basic shape (assets and trials rows
    // both non-zero for our seeded graph).
    const breakdown = dialog.locator(
      'table[aria-label="Count breakdown of items this action will remove"]'
    );
    await expect(breakdown).toBeVisible({ timeout: 5000 });
    await expect(breakdown.locator('tr[data-count-key="assets"] td').last()).toHaveText('1');
    await expect(breakdown.locator('tr[data-count-key="trials"] td').last()).toHaveText('1');

    // Confirm is disabled until the typed value matches the company name.
    const confirmBtn = dialog.getByRole('button', { name: 'Delete', exact: true });
    const input = dialog.locator('input#confirm-delete-typed');
    await expect(confirmBtn).toBeDisabled();
    await input.fill('not the right name');
    await expect(confirmBtn).toBeDisabled();
    await input.fill(cascadeCompanyName);
    await expect(confirmBtn).toBeEnabled();

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/rest/v1/companies') && r.request().method() === 'DELETE',
        { timeout: 10000 }
      ),
      confirmBtn.click(),
    ]);
    await expect(dialog).toBeHidden({ timeout: 10000 });

    // Company is gone from the list.
    await page.goto(companiesUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(cascadeCompanyName)).toBeHidden({ timeout: 5000 });

    // Cascade reached asset and trial too. Query directly via admin client
    // so this assertion does not depend on which list surface renders them.
    const admin = getAdminClient();
    const { data: productAfter } = await admin
      .from('assets')
      .select('id')
      .eq('id', productId)
      .maybeSingle();
    expect(productAfter).toBeNull();
    const { data: trialAfter } = await admin
      .from('trials')
      .select('id')
      .eq('id', trialId)
      .maybeSingle();
    expect(trialAfter).toBeNull();
  });

  test('delete the original Updated Company succeeds via typed confirm', async () => {
    await page.goto(companiesUrl(), { waitUntil: 'domcontentloaded' });
    const row = page.locator('tr', { hasText: 'Updated Company' });
    await row.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    const dialog = page.locator('.p-dialog', {
      has: page.locator('input#confirm-delete-typed'),
    });
    await expect(dialog).toBeVisible({ timeout: 10000 });

    await dialog.locator('input#confirm-delete-typed').fill('Updated Company');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    await page.goto(companiesUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Updated Company')).not.toBeVisible({ timeout: 5000 });
  });
});
