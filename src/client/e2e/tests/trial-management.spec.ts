import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';
import { fillInput, clearAndFill } from '../helpers/form.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Trial Management CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  let trialId: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60000);
    page = await authenticatedPage(browser);
    tenantId = await createTestTenant(page, 'Trial CRUD Org');
    spaceId = await createTestSpace(page, tenantId, 'Trial Test Space');

    // Create company
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/companies`, {
      waitUntil: 'networkidle',
    });
    await page.getByRole('button', { name: 'Add Company' }).click();
    await expect(page.locator('#company-name')).toBeVisible({ timeout: 5000 });
    await fillInput(page, '#company-name', 'Trial Test Co');
    await page.getByRole('button', { name: 'Create Company' }).click();
    await expect(page.getByText('Trial Test Co')).toBeVisible({ timeout: 10000 });

    // Create product
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/products`, {
      waitUntil: 'networkidle',
    });
    await page.getByRole('button', { name: 'Add Product' }).click();
    await expect(page.locator('#product-name')).toBeVisible({ timeout: 5000 });
    await fillInput(page, '#product-name', 'Trial Test Product');
    await page.getByRole('button', { name: 'Create Product' }).click();
    await expect(page.getByText('Trial Test Product')).toBeVisible({ timeout: 10000 });

    // Expand product row to add trial
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/products`, {
      waitUntil: 'networkidle',
    });
    const expandButton = page
      .locator('tr', { hasText: 'Trial Test Product' })
      .locator('button[aria-label="Expand trials"]');
    await expandButton.click();
    await expect(page.getByRole('button', { name: 'Add Trial' })).toBeVisible({ timeout: 5000 });

    // Create trial
    await page.getByRole('button', { name: 'Add Trial' }).click();
    await expect(page.locator('#trial-name')).toBeVisible({ timeout: 5000 });
    await fillInput(page, '#trial-name', 'Test Trial');
    await page.getByRole('button', { name: 'Create Trial' }).click();
    await expect(page.getByText('Test Trial')).toBeVisible({ timeout: 10000 });

    // Navigate to trial detail
    const detailButton = page
      .locator('tr', { hasText: 'Test Trial' })
      .getByRole('button', { name: 'Detail' });
    await Promise.all([
      page.waitForURL(/\/trials\/[^/]+/, { timeout: 10000 }),
      detailButton.click(),
    ]);

    const urlMatch = page.url().match(/\/trials\/([^/]+)/);
    if (!urlMatch) throw new Error('Failed to extract trialId from URL');
    trialId = urlMatch[1];
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('trial detail page loads with sections', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/trials/${trialId}`, {
      waitUntil: 'networkidle',
    });
    await expect(page.getByText('Basic Info')).toBeVisible();
    await expect(page.getByText('Phases')).toBeVisible();
    await expect(page.getByText('Markers')).toBeVisible();
    await expect(page.getByText('Notes')).toBeVisible();
  });

  test('edit trial basic info', async () => {
    await page.getByRole('button', { name: 'Edit Trial' }).click();

    const nameInput = page.locator('#trial-name');
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await clearAndFill(page, '#trial-name', 'Updated Trial');
    await page.getByRole('button', { name: 'Update Trial' }).click();

    await expect(page.getByText('Updated Trial')).toBeVisible({ timeout: 10000 });
  });

  test('add a trial phase', async () => {
    await page.getByRole('button', { name: 'Add Phase' }).click();

    await expect(page.locator('#phase-start-date')).toBeVisible({ timeout: 5000 });
    await page.locator('#phase-start-date').fill('2025-01-01');
    await page.locator('#phase-end-date').fill('2025-06-30');
    await page.getByRole('button', { name: 'Add Phase', exact: true }).click();

    await expect(page.getByText('2025-01-01')).toBeVisible({ timeout: 5000 });
  });

  test('delete a trial phase', async () => {
    page.on('dialog', (dialog) => dialog.accept());

    const phaseRow = page.locator('tr', { hasText: '2025-01-01' });
    await phaseRow.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('2025-01-01')).not.toBeVisible({ timeout: 5000 });
  });

  test('add a trial marker', async () => {
    await page.getByRole('button', { name: 'Add Marker' }).click();

    await expect(page.locator('#marker-event-date')).toBeVisible({ timeout: 5000 });
    await page.locator('#marker-event-date').fill('2025-03-15');
    await fillInput(page, '#marker-tooltip', 'Test marker tooltip');
    await page.getByRole('button', { name: 'Add Marker', exact: true }).click();

    await expect(page.getByText('2025-03-15')).toBeVisible({ timeout: 5000 });
  });

  test('delete a trial marker', async () => {
    page.on('dialog', (dialog) => dialog.accept());

    const markerRow = page.locator('tr', { hasText: '2025-03-15' });
    await markerRow.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('2025-03-15')).not.toBeVisible({ timeout: 5000 });
  });

  test('add a trial note', async () => {
    await page.getByRole('button', { name: 'Add Note' }).click();

    await expect(page.locator('#note-content')).toBeVisible({ timeout: 5000 });
    await fillInput(page, '#note-content', 'This is a test note for the trial.');
    await page.getByRole('button', { name: 'Add Note', exact: true }).click();

    await expect(page.getByText('This is a test note for the trial.')).toBeVisible({
      timeout: 5000,
    });
  });

  test('delete a trial note', async () => {
    page.on('dialog', (dialog) => dialog.accept());

    const noteContainer = page.locator('div', {
      hasText: 'This is a test note for the trial.',
    });
    await noteContainer.getByRole('button', { name: 'Delete' }).first().click();

    await expect(page.getByText('This is a test note for the trial.')).not.toBeVisible({
      timeout: 5000,
    });
  });

  test('back button navigates away from trial detail', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/trials/${trialId}`, {
      waitUntil: 'networkidle',
    });
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).not.toHaveURL(/\/trials\//);
  });
});
