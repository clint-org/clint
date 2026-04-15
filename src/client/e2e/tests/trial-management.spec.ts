import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import {
  createTestTenant,
  createTestSpace,
  createTestCompany,
  createTestProduct,
  createTestTherapeuticArea,
  createTestTrial,
} from '../helpers/test-data.helper';
import { fillInput, clearAndFill } from '../helpers/form.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Trial Management CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  let trialId: string;
  const trialUrl = () => `/t/${tenantId}/s/${spaceId}/manage/trials/${trialId}`;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60000);

    tenantId = await createTestTenant('Trial CRUD Org');
    spaceId = await createTestSpace(tenantId, 'Trial Test Space');
    const companyId = await createTestCompany(spaceId, 'Trial Test Co');
    const productId = await createTestProduct(spaceId, companyId, 'Trial Test Product');
    const taId = await createTestTherapeuticArea(spaceId, 'Trial TA');
    trialId = await createTestTrial(spaceId, productId, taId, 'Test Trial');

    page = await authenticatedPage(browser);
    page.on('dialog', (dialog) => dialog.accept());
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('trial detail page loads with sections', async () => {
    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Basic Info')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Phases' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Markers' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
  });

  test('edit trial basic info', async () => {
    await page.getByRole('button', { name: 'Edit Trial' }).click();
    await expect(page.locator('#trial-name')).toBeVisible({ timeout: 5000 });

    await clearAndFill(page, '#trial-name', 'Updated Trial');
    await page.getByRole('button', { name: 'Update Trial' }).click();
    await page.waitForTimeout(2000);

    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('Updated Trial')).toBeVisible({ timeout: 10000 });
  });

  test('add a trial phase', async () => {
    await page.getByRole('button', { name: 'Add Phase' }).click();
    await expect(page.locator('#phase-start-date')).toBeVisible({ timeout: 5000 });

    // Select phase type first (required field)
    await page.locator('#phase-type').click();
    await page.getByText('P1', { exact: true }).click();
    await page.waitForTimeout(300);

    await fillInput(page, '#phase-start-date', '2025-01-01');
    await page.waitForTimeout(300);
    await fillInput(page, '#phase-end-date', '2025-06-30');
    await page.waitForTimeout(300);
    await page.locator('form').getByRole('button', { name: 'Add Phase' }).click();
    await page.waitForTimeout(3000);

    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('2025-01-01')).toBeVisible({ timeout: 5000 });
  });

  test('delete a trial phase', async () => {
    const phaseRow = page.locator('tr', { hasText: '2025-01-01' });
    await phaseRow.getByRole('button', { name: 'Delete' }).click();
    await page.waitForTimeout(2000);

    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('2025-01-01')).not.toBeVisible({ timeout: 5000 });
  });

  test('add a trial marker', async () => {
    await page.getByRole('button', { name: 'Add Marker' }).click();
    await expect(page.locator('#marker-event-date')).toBeVisible({ timeout: 5000 });

    // Select a marker type (required)
    await page.locator('#marker-type').click();
    await page.locator('.p-select-option, .p-listbox-option, [role="option"]').first().click();
    await page.waitForTimeout(300);

    await fillInput(page, '#marker-event-date', '2025-03-15');
    await page.waitForTimeout(300);
    await fillInput(page, '#marker-tooltip', 'Test marker tooltip');
    await page.waitForTimeout(300);
    await page.locator('form').getByRole('button', { name: 'Add Marker' }).click();
    await page.waitForTimeout(3000);

    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('2025-03-15')).toBeVisible({ timeout: 5000 });
  });

  test('delete a trial marker', async () => {
    const markerRow = page.locator('tr', { hasText: '2025-03-15' });
    await markerRow.getByRole('button', { name: 'Delete' }).click();
    await page.waitForTimeout(2000);

    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('2025-03-15')).not.toBeVisible({ timeout: 5000 });
  });

  test('add a trial note', async () => {
    await page.getByRole('button', { name: 'Add Note' }).click();
    await expect(page.locator('#note-content')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#note-content', 'This is a test note for the trial.');
    await page.locator('form').getByRole('button', { name: 'Add Note' }).click();
    await page.waitForTimeout(2000);

    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('This is a test note for the trial.')).toBeVisible({
      timeout: 5000,
    });
  });

  test('delete a trial note', async () => {
    const noteContainer = page.locator('div', {
      hasText: 'This is a test note for the trial.',
    });
    await noteContainer.getByRole('button', { name: 'Delete' }).first().click();
    await page.waitForTimeout(2000);

    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('This is a test note for the trial.')).not.toBeVisible({
      timeout: 5000,
    });
  });

  test('back button navigates away from trial detail', async () => {
    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).not.toHaveURL(/\/trials\//);
  });
});

test.describe('Trial List CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  let companyId: string;
  let productId: string;
  let taId: string;
  const trialsUrl = () => `/t/${tenantId}/s/${spaceId}/manage/trials`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Trial List Org');
    spaceId = await createTestSpace(tenantId, 'Trial List Space');
    companyId = await createTestCompany(spaceId, 'Trial Co');
    productId = await createTestProduct(spaceId, companyId, 'Trial Product');
    taId = await createTestTherapeuticArea(spaceId, 'Oncology');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('trial list loads', async () => {
    await page.goto(trialsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Add trial' })).toBeVisible();
  });

  test('create trial from list', async () => {
    await page.getByRole('button', { name: 'Add trial' }).click();
    await expect(page.locator('#trial-name')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#trial-name', 'KEYNOTE-001');
    await page.getByRole('button', { name: 'Create Trial' }).click();
    await page.waitForTimeout(2000);

    await page.goto(trialsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('KEYNOTE-001')).toBeVisible({ timeout: 10000 });
  });

  test('edit trial from list pre-populates form', async () => {
    const row = page.locator('tr', { hasText: 'KEYNOTE-001' });
    await row.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.locator('#trial-name')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#trial-name')).toHaveValue('KEYNOTE-001');

    await clearAndFill(page, '#trial-name', 'KEYNOTE-002');
    await page.getByRole('button', { name: 'Update Trial' }).click();
    await page.waitForTimeout(2000);

    await page.goto(trialsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('KEYNOTE-002')).toBeVisible({ timeout: 10000 });
  });

  test('delete trial from list', async () => {
    page.on('dialog', (d) => d.accept());
    const row = page.locator('tr', { hasText: 'KEYNOTE-002' });
    await row.locator('app-row-actions button').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.waitForTimeout(2000);

    await page.goto(trialsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('KEYNOTE-002')).not.toBeVisible({ timeout: 5000 });
  });
});
