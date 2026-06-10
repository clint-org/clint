import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import {
  createTestTenant,
  createTestSpace,
  createTestCompany,
  createTestProduct,
  createTestTherapeuticArea,
  createTestTrial,
  createTestTrialPhase,
} from '../helpers/test-data.helper';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface CapturedBlob {
  type: string;
  size: number;
}

test.describe('Timeline export formats', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120000);

    tenantId = await createTestTenant('Export Test Org');
    spaceId = await createTestSpace(tenantId, 'Export Test Space');
    const companyId = await createTestCompany(spaceId, 'Export Co');
    const assetId = await createTestProduct(spaceId, companyId, 'Export Asset');
    const taId = await createTestTherapeuticArea(spaceId, 'Export TA');
    const trialId = await createTestTrial(spaceId, assetId, taId, 'EXPORT-1');
    await createTestTrialPhase(spaceId, trialId, 'P3', '2022-01-01');

    page = await authenticatedPage(browser);
    // Capture every blob handed to URL.createObjectURL so the tests can
    // assert on MIME type and size without relying on real downloads.
    // saveBlob revokes the object URL immediately, but the captured
    // type/size snapshot is unaffected by revocation.
    await page.addInitScript(() => {
      const w = window as unknown as { __exportBlobs: { type: string; size: number }[] };
      w.__exportBlobs = [];
      const orig = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (obj: Blob | MediaSource): string => {
        if (obj instanceof Blob) {
          w.__exportBlobs.push({ type: obj.type, size: obj.size });
        }
        return orig(obj);
      };
    });
    await page.goto(`/t/${tenantId}/s/${spaceId}/timeline`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('app-dashboard-grid', { timeout: 30000 });
  });

  test.afterAll(async () => {
    await page.close();
  });

  async function lastBlob(): Promise<CapturedBlob | null> {
    return page.evaluate(
      () => (window as unknown as { __exportBlobs: CapturedBlob[] }).__exportBlobs.at(-1) ?? null
    );
  }

  test('export menu lists all three formats', async () => {
    // exact: true is required: seeded grid rows ("Export Co", "Export Asset")
    // are role=button and match a substring name lookup.
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'PowerPoint' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Image (PNG)' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Excel (XLSX)' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: 'PowerPoint' })).toBeHidden();
  });

  test('PNG export produces an image blob via the dialog', async () => {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Image (PNG)' }).click();

    // The p-dialog host element is always in the DOM; the rendered overlay
    // panel (.p-dialog) only exists while the dialog is open.
    const dialog = page.locator('.p-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Export image')).toBeVisible();

    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    await expect
      .poll(async () => (await lastBlob())?.type, { timeout: 30000 })
      .toBe('image/png');
    expect((await lastBlob())!.size).toBeGreaterThan(10000);

    // Successful export closes the dialog.
    await expect(dialog).toBeHidden();
  });

  test('Excel export downloads immediately without a dialog', async () => {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Excel (XLSX)' }).click();
    await expect.poll(async () => (await lastBlob())?.type, { timeout: 30000 }).toBe(XLSX_MIME);
    expect((await lastBlob())!.size).toBeGreaterThan(1000);
    await expect(page.locator('.p-dialog')).toBeHidden();
  });
});
