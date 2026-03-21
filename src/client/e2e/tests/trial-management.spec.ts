import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Trial Management CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  let trialId: string;

  test.beforeAll(async ({ browser }) => {
    page = await authenticatedPage(browser);
    tenantId = await createTestTenant(page, 'Trial CRUD Org');
    spaceId = await createTestSpace(page, tenantId, 'Trial Test Space');

    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/companies`, {
      waitUntil: 'networkidle',
    });
    await page.getByRole('button', { name: 'Add Company' }).click();
    await page.locator('#company-name').fill('Trial Test Co');
    await page.getByRole('button', { name: 'Create Company' }).click();
    await expect(page.locator('p-dialog')).not.toBeVisible({ timeout: 5000 });

    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/products`, {
      waitUntil: 'networkidle',
    });
    await page.getByRole('button', { name: 'Add Product' }).click();
    await page.locator('#product-name').fill('Trial Test Product');
    await page.getByRole('button', { name: 'Create Product' }).click();
    await expect(page.locator('p-dialog').first()).not.toBeVisible({ timeout: 5000 });

    const expandButton = page
      .locator('tr', { hasText: 'Trial Test Product' })
      .getByRole('button', { name: /expand/i });
    await expandButton.click();
    await expect(page.getByText(/Trials for Trial Test Product/)).toBeVisible();

    await page.getByRole('button', { name: 'Add Trial' }).click();
    await expect(page.locator('p-dialog').nth(1)).toBeVisible();
    await page.locator('#trial-name').fill('Test Trial');
    await page.getByRole('button', { name: 'Create Trial' }).click();
    await expect(page.locator('p-dialog').nth(1)).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Test Trial')).toBeVisible();

    const detailButton = page.locator('tr', { hasText: 'Test Trial' }).getByRole('button', { name: 'Detail' });
    const [response] = await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
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
    await expect(page.getByRole('heading', { name: 'Test Trial' })).toBeVisible();
    await expect(page.getByText('Basic Info')).toBeVisible();
    await expect(page.getByText('Phases')).toBeVisible();
    await expect(page.getByText('Markers')).toBeVisible();
    await expect(page.getByText('Notes')).toBeVisible();
  });

  test('edit trial basic info', async () => {
    await page.getByRole('button', { name: 'Edit Trial' }).click();
    await expect(page.getByText('Edit Trial').first()).toBeVisible();

    const nameInput = page.locator('#trial-name');
    await nameInput.clear();
    await nameInput.fill('Updated Trial');
    await page.getByRole('button', { name: 'Update Trial' }).click();

    await expect(page.getByRole('heading', { name: 'Updated Trial' })).toBeVisible({
      timeout: 5000,
    });
  });

  test('add a trial phase', async () => {
    await page.getByRole('button', { name: 'Add Phase' }).click();

    const phaseTypeSelect = page.locator('#phase-type');
    await phaseTypeSelect.click();
    await page.getByText('P1', { exact: true }).click();

    await page.locator('#phase-start-date').fill('2025-01-01');
    await page.locator('#phase-end-date').fill('2025-06-30');
    await page.getByRole('button', { name: 'Add Phase', exact: true }).click();

    await expect(page.locator('tr', { hasText: 'P1' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('2025-01-01')).toBeVisible();
  });

  test('delete a trial phase', async () => {
    page.on('dialog', (dialog) => dialog.accept());

    const phaseRow = page.locator('tr', { hasText: 'P1' });
    await phaseRow.getByRole('button', { name: 'Delete' }).click();

    await expect(page.locator('tr', { hasText: 'P1' })).not.toBeVisible({ timeout: 5000 });
  });

  test('add a trial marker', async () => {
    await page.getByRole('button', { name: 'Add Marker' }).click();

    await page.locator('#marker-event-date').fill('2025-03-15');
    await page.locator('#marker-tooltip').fill('Test marker tooltip');
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

    await page.locator('#note-content').fill('This is a test note for the trial.');
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

  test('CT.gov sync button populates fields from mocked API', async () => {
    await page.route('**/clinicaltrials.gov/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          studies: [
            {
              protocolSection: {
                identificationModule: {
                  nctId: 'NCT12345678',
                  briefTitle: 'Mocked CT.gov Trial',
                },
                statusModule: {
                  overallStatus: 'Recruiting',
                  startDateStruct: { date: '2024-01-15' },
                  primaryCompletionDateStruct: { date: '2026-12-31' },
                },
                designModule: {
                  studyType: 'Interventional',
                  phases: ['Phase 3'],
                  designInfo: {
                    maskingInfo: { masking: 'Double' },
                    primaryPurpose: 'Treatment',
                  },
                  enrollmentInfo: { count: 500 },
                },
                sponsorCollaboratorsModule: {
                  leadSponsor: { name: 'Mocked Sponsor' },
                },
                armsInterventionsModule: {
                  interventions: [{ type: 'Drug', name: 'MockDrug' }],
                },
                eligibilityModule: {
                  sex: 'All',
                  minimumAge: '18 Years',
                  maximumAge: '75 Years',
                  healthyVolunteers: false,
                },
                oversightModule: {
                  isFdaRegulatedDrug: true,
                  isFdaRegulatedDevice: false,
                  oversightHasDmc: true,
                },
              },
            },
          ],
        }),
      }),
    );

    await page.getByRole('button', { name: 'Edit Trial' }).click();

    const identifierInput = page.locator('#trial-identifier');
    await identifierInput.clear();
    await identifierInput.fill('NCT12345678');

    await page.getByRole('button', { name: 'Sync from CT.gov' }).click();
    await expect(page.getByText('Synced successfully')).toBeVisible({ timeout: 10000 });

    await page.unroute('**/clinicaltrials.gov/**');
  });

  test('back button navigates away from trial detail', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/trials/${trialId}`, {
      waitUntil: 'networkidle',
    });
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).not.toHaveURL(/\/trials\//);
  });
});
