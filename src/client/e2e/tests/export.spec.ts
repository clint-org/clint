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
  // Tests share one page and the accumulated __exportBlobs array; order matters.
  test.describe.configure({ mode: 'serial' });

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
      const w = window as unknown as {
        __exportBlobs: { type: string; size: number }[];
        __exportBlobObjects: Blob[];
      };
      w.__exportBlobs = [];
      w.__exportBlobObjects = [];
      const orig = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (obj: Blob | MediaSource): string => {
        if (obj instanceof Blob) {
          w.__exportBlobs.push({ type: obj.type, size: obj.size });
          w.__exportBlobObjects.push(obj);
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

    // <app-export-dialog> is always in the DOM; PrimeNG appends the rendered
    // overlay panel (.p-dialog) to the body only while the dialog is open.
    const dialog = page.locator('.p-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Export image')).toBeVisible();
    // PNG is capture-as-is: no deck options, just the explanatory line.
    await expect(dialog.getByText('matches the timeline exactly')).toBeVisible();
    await expect(dialog.getByText('Zoom level')).toBeHidden();

    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    await expect
      .poll(async () => (await lastBlob())?.type, { timeout: 30000 })
      .toBe('image/png');
    expect((await lastBlob())!.size).toBeGreaterThan(10000);

    // Decode the actual PNG: dimensions must be sane and the top-left region
    // must be the grid's slate-800 header band. The capture is the app
    // surface itself, not a framed deck slide.
    const probe = await page.evaluate(async () => {
      const w = window as unknown as { __exportBlobObjects: Blob[] };
      const bmp = await createImageBitmap(w.__exportBlobObjects.at(-1)!);
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const px = ctx.getImageData(40, 40, 1, 1).data;
      return { width: bmp.width, height: bmp.height, sample: [px[0], px[1], px[2]] };
    });
    expect(probe.width).toBeGreaterThan(1000);
    expect(probe.width).toBeLessThanOrEqual(16384);
    expect(probe.height).toBeGreaterThan(200);
    // slate-800 is rgb(30, 41, 59); allow small codec tolerance
    expect(Math.abs(probe.sample[0] - 30)).toBeLessThanOrEqual(3);
    expect(Math.abs(probe.sample[1] - 41)).toBeLessThanOrEqual(3);
    expect(Math.abs(probe.sample[2] - 59)).toBeLessThanOrEqual(3);

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

// ---------------------------------------------------------------------------
// Cross-surface export audit + regression net.
//
// One rich space feeds every surface. Each test exports, saves the artifact to
// /tmp/export-audit/<surface>.<ext> plus a <surface>-live.png screenshot of the
// on-screen view, and asserts the export contract: PNGs are crisp (capture
// scale 2x of a real-size render), the off-screen host never enters the
// viewport, and every workbook carries the visible columns plus the fields the
// surface's detail pane shows.
// ---------------------------------------------------------------------------

import ExcelJS from 'exceljs';
import {
  createTestAgency,
  createTestAssetIndication,
  createTestEvent,
  createTestMarker,
  createTestMarkerType,
  createTestMoa,
  createTestRoa,
  getAdminClient,
  getSystemMarkerCategoryId,
  linkAssetMoa,
  linkAssetRoa,
} from '../helpers/test-data.helper';
import {
  auditPath,
  installExportCapture,
  lastBlob,
  lastPngDimensions,
  runExport,
  saveLastBlob,
  visibleHostSightings,
} from '../helpers/export-capture.helper';

const NCT_DELIVER = 'NCT03548935';
const NCT_KEYNOTE = 'NCT04184622';

async function loadWorkbook(path: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return wb;
}

function sheetHeaders(sheet: ExcelJS.Worksheet): string[] {
  const headers: string[] = [];
  sheet.getRow(1).eachCell((cell) => headers.push(String(cell.value ?? '')));
  return headers;
}

function sheetRows(sheet: ExcelJS.Worksheet): Record<string, unknown>[] {
  const headers = sheetHeaders(sheet);
  const rows: Record<string, unknown>[] = [];
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    const out: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      out[h] = row.getCell(i + 1).value;
    });
    rows.push(out);
  });
  return rows;
}

test.describe('Export surfaces audit', () => {
  test.describe.configure({ mode: 'serial' });

  let page: Page;
  let tenantId: string;
  let spaceId: string;

  const surfaceUrl = (path: string): string =>
    `/t/${tenantId}/s/${spaceId}/${path}`;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000);
    const admin = getAdminClient();

    tenantId = await createTestTenant('Artifact Audit Org');
    await createTestAgency('Stout Audit Agency', { tenantId });
    spaceId = await createTestSpace(tenantId, 'Artifact Audit Space');

    const azId = await createTestCompany(spaceId, 'AstraZeneca');
    const merckId = await createTestCompany(spaceId, 'Merck');

    const hfId = await createTestTherapeuticArea(spaceId, 'Heart Failure');
    const oncId = await createTestTherapeuticArea(spaceId, 'Oncology');

    const farxigaId = await createTestProduct(spaceId, azId, 'Farxiga');
    const keytrudaId = await createTestProduct(spaceId, merckId, 'Keytruda');
    await admin.from('assets').update({ generic_name: 'dapagliflozin' }).eq('id', farxigaId);
    await admin.from('assets').update({ generic_name: 'pembrolizumab' }).eq('id', keytrudaId);

    const sglt2 = await createTestMoa(spaceId, 'SGLT2 inhibitor');
    const pd1 = await createTestMoa(spaceId, 'PD-1 antagonist');
    const oral = await createTestRoa(spaceId, 'Oral');
    const iv = await createTestRoa(spaceId, 'Intravenous');
    await linkAssetMoa(farxigaId, sglt2);
    await linkAssetMoa(keytrudaId, pd1);
    await linkAssetRoa(farxigaId, oral);
    await linkAssetRoa(keytrudaId, iv);

    // Trials before asset_indications: trg_auto_derive nulls development_status
    // for indication rows created ahead of their trials.
    const deliverId = await createTestTrial(spaceId, farxigaId, hfId, 'DELIVER Trial');
    const keynoteId = await createTestTrial(spaceId, keytrudaId, oncId, 'KEYNOTE-99 Trial');
    await createTestTrialPhase(spaceId, deliverId, 'P3', '2022-01-01', '2026-12-31');
    await createTestTrialPhase(spaceId, keynoteId, 'P2', '2023-03-01');
    await admin
      .from('trials')
      .update({
        identifier: NCT_DELIVER,
        acronym: 'DELIVER',
        status: 'Active',
        recruitment_status: 'RECRUITING',
        study_type: 'INTERVENTIONAL',
        notes: 'Pivotal HFpEF readout expected H2.',
      })
      .eq('id', deliverId);
    await admin
      .from('trials')
      .update({
        identifier: NCT_KEYNOTE,
        acronym: 'KEYNOTE-99',
        status: 'Active',
        recruitment_status: 'ACTIVE_NOT_RECRUITING',
        study_type: 'INTERVENTIONAL',
      })
      .eq('id', keynoteId);

    await createTestAssetIndication(spaceId, farxigaId, hfId, 'LAUNCHED');
    await createTestAssetIndication(spaceId, keytrudaId, oncId, 'P3');

    // Future catalysts: markers with future event dates.
    const dataCatId = await getSystemMarkerCategoryId('Data');
    const regCatId = await getSystemMarkerCategoryId('Regulatory');
    const readoutType = await createTestMarkerType(spaceId, 'Data Readout', dataCatId, {
      color: '#16a34a',
    });
    const pdufaType = await createTestMarkerType(spaceId, 'PDUFA', regCatId, {
      color: '#ea580c',
    });
    const future = (months: number): string => {
      const d = new Date();
      d.setMonth(d.getMonth() + months);
      return d.toISOString().slice(0, 10);
    };
    await createTestMarker(spaceId, readoutType, 'DELIVER topline readout', future(3), {
      trialId: deliverId,
      projection: 'company',
      description: 'Topline HFpEF efficacy data.',
      sourceUrl: 'https://example.com/deliver',
    });
    await createTestMarker(spaceId, pdufaType, 'Keytruda sBLA PDUFA', future(6), {
      trialId: keynoteId,
      projection: 'stout',
    });

    // Analyst events for the events grid.
    await createTestEvent(spaceId, 'Phase 3 Topline Results', '2026-05-15', {
      categoryName: 'Clinical',
      priority: 'high',
      assetId: farxigaId,
      description: 'DELIVER met its primary endpoint.',
      tags: ['readout', 'hfpef'],
    });
    await createTestEvent(spaceId, 'CEO transition announced', '2026-04-02', {
      categoryName: 'Leadership',
      priority: 'low',
      companyId: merckId,
    });

    page = await authenticatedPage(browser);
    await installExportCapture(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('bullseye PNG is crisp, framed, and never flickers on-screen', async () => {
    await page.goto(surfaceUrl('bullseye'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('svg.bullseye-svg', { timeout: 30000 });
    await page.screenshot({ path: auditPath('bullseye-live.png'), fullPage: true });

    await runExport(page, 'PNG');
    expect((await lastBlob(page))?.type).toBe('image/png');
    await saveLastBlob(page, auditPath('bullseye.png'));

    const dims = await lastPngDimensions(page);
    // 2x capture of a real-size (~900px+) chart render. The defect renders the
    // SVG at its ~300px intrinsic fallback, which lands far below this.
    expect(dims.width).toBeGreaterThan(1600);
    expect(dims.height).toBeGreaterThan(1600);

    expect(await visibleHostSightings(page)).toEqual([]);
  });

  test('bullseye Excel carries asset rows plus the detail-pane trial fields', async () => {
    await page.goto(surfaceUrl('bullseye'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('svg.bullseye-svg', { timeout: 30000 });
    await runExport(page, 'Excel');
    await saveLastBlob(page, auditPath('bullseye.xlsx'));

    const wb = await loadWorkbook(auditPath('bullseye.xlsx'));
    const assets = wb.getWorksheet('Assets');
    expect(assets, 'Assets sheet present').toBeTruthy();
    const assetHeaders = sheetHeaders(assets!);
    for (const h of ['Group', 'Company', 'Asset', 'Generic', 'Phase', 'MOA', 'ROA', 'Indication', 'Trials', 'Recent changes']) {
      expect(assetHeaders, `Assets header ${h}`).toContain(h);
    }
    const assetRows = sheetRows(assets!);
    expect(assetRows.some((r) => r['Asset'] === 'Farxiga' && r['MOA'] === 'SGLT2 inhibitor')).toBe(true);

    const trials = wb.getWorksheet('Trials');
    expect(trials, 'Trials sheet present').toBeTruthy();
    const trialHeaders = sheetHeaders(trials!);
    for (const h of ['Company', 'Asset', 'Trial', 'Acronym', 'NCT ID', 'Status', 'Recruitment status', 'Study type', 'Phase']) {
      expect(trialHeaders, `Trials header ${h}`).toContain(h);
    }
    const trialRows = sheetRows(trials!);
    expect(trialRows.some((r) => r['NCT ID'] === NCT_DELIVER)).toBe(true);
  });

  test('heatmap PNG matches the live matrix and never flickers on-screen', async () => {
    await page.goto(surfaceUrl('heatmap/by-company'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('table.matrix', { timeout: 30000 });
    await page.screenshot({ path: auditPath('heatmap-live.png'), fullPage: true });

    await runExport(page, 'PNG');
    expect((await lastBlob(page))?.type).toBe('image/png');
    await saveLastBlob(page, auditPath('heatmap.png'));

    // The off-screen host must never intersect the viewport (the flicker).
    expect(await visibleHostSightings(page)).toEqual([]);

    const dims = await lastPngDimensions(page);
    // A 2x render of the host's definite-width layout. The defect laid the
    // matrix out at a degenerate 1e6px wide and a few px tall (canvas-clamped
    // to 16384 x 3), so bound both axes.
    expect(dims.width).toBeGreaterThan(1800);
    expect(dims.width).toBeLessThan(4200);
    expect(dims.height).toBeGreaterThan(380);
  });

  test('heatmap Excel carries matrix, cells, and the detail-pane asset list', async () => {
    await page.goto(surfaceUrl('heatmap/by-company'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('table.matrix', { timeout: 30000 });
    await runExport(page, 'Excel');
    await saveLastBlob(page, auditPath('heatmap.xlsx'));

    const wb = await loadWorkbook(auditPath('heatmap.xlsx'));
    const matrix = wb.getWorksheet('Matrix');
    expect(matrix).toBeTruthy();
    const matrixHeaders = sheetHeaders(matrix!);
    expect(matrixHeaders).toContain('Group');
    expect(matrixHeaders, 'companies count from the detail panel').toContain('Companies');
    expect(matrixHeaders).toContain('Total');

    expect(wb.getWorksheet('Cells')).toBeTruthy();

    const assets = wb.getWorksheet('Assets');
    expect(assets, 'Assets sheet mirrors the bubble detail panel').toBeTruthy();
    const assetRows = sheetRows(assets!);
    expect(assetRows.some((r) => r['Asset'] === 'Farxiga')).toBe(true);
  });

  test('catalysts Excel includes the date column and detail-pane fields', async () => {
    await page.goto(surfaceUrl('catalysts'), { waitUntil: 'domcontentloaded' });
    await page.getByText('DELIVER topline readout').first().waitFor({ timeout: 30000 });
    await page.screenshot({ path: auditPath('catalysts-live.png'), fullPage: true });

    await runExport(page, null);
    await saveLastBlob(page, auditPath('catalysts.xlsx'));

    const wb = await loadWorkbook(auditPath('catalysts.xlsx'));
    const sheet = wb.getWorksheet('Catalysts');
    expect(sheet).toBeTruthy();
    const headers = sheetHeaders(sheet!);
    for (const h of ['Date', 'Category', 'Catalyst', 'Company', 'Asset', 'Trial', 'Phase', 'Status', 'Marker type', 'Description', 'Source URL']) {
      expect(headers, `Catalysts header ${h}`).toContain(h);
    }
    const rows = sheetRows(sheet!);
    const deliver = rows.find((r) => r['Catalyst'] === 'DELIVER topline readout');
    expect(deliver).toBeTruthy();
    expect(deliver!['Date'], 'date cell populated').toBeTruthy();
    expect(deliver!['Status']).toBe('Projected');
    expect(deliver!['Description']).toBe('Topline HFpEF efficacy data.');
  });

  test('events Excel includes event date, entity, tags, and description', async () => {
    await page.goto(surfaceUrl('events'), { waitUntil: 'domcontentloaded' });
    await page.getByText('Phase 3 Topline Results').first().waitFor({ timeout: 30000 });
    await page.screenshot({ path: auditPath('events-live.png'), fullPage: true });

    await runExport(page, null);
    await saveLastBlob(page, auditPath('events.xlsx'));

    const wb = await loadWorkbook(auditPath('events.xlsx'));
    const sheet = wb.getWorksheet('Events');
    expect(sheet).toBeTruthy();
    const headers = sheetHeaders(sheet!);
    for (const h of ['Logged', 'Event date', 'Source', 'Title', 'Category', 'Entity', 'Priority', 'Tags', 'Description']) {
      expect(headers, `Events header ${h}`).toContain(h);
    }
    const rows = sheetRows(sheet!);
    const topline = rows.find((r) => String(r['Title']).includes('Phase 3 Topline Results'));
    expect(topline).toBeTruthy();
    expect(topline!['Event date'], 'event date cell populated').toBeTruthy();
    expect(String(topline!['Tags'])).toContain('readout');
  });

  test('trials Excel includes phase, dates, recruitment, and notes', async () => {
    await page.goto(surfaceUrl('manage/trials'), { waitUntil: 'domcontentloaded' });
    await page.getByText(NCT_DELIVER).first().waitFor({ timeout: 30000 });
    await page.screenshot({ path: auditPath('trials-live.png'), fullPage: true });

    await runExport(page, null);
    await saveLastBlob(page, auditPath('trials.xlsx'));

    const wb = await loadWorkbook(auditPath('trials.xlsx'));
    const sheet = wb.getWorksheet('Trials');
    expect(sheet).toBeTruthy();
    const headers = sheetHeaders(sheet!);
    for (const h of ['Trial', 'Acronym', 'NCT ID', 'Asset', 'Company', 'Status', 'Phase', 'Phase start', 'Phase end', 'Recruitment status', 'Study type', 'Markers', 'Notes']) {
      expect(headers, `Trials header ${h}`).toContain(h);
    }
    const rows = sheetRows(sheet!);
    const deliver = rows.find((r) => r['NCT ID'] === NCT_DELIVER);
    expect(deliver).toBeTruthy();
    expect(deliver!['Acronym']).toBe('DELIVER');
    expect(deliver!['Phase']).toBeTruthy();
    expect(deliver!['Phase start'], 'phase start date populated').toBeTruthy();
    expect(deliver!['Recruitment status']).toBeTruthy();
  });

  test('companies Excel includes asset count', async () => {
    await page.goto(surfaceUrl('manage/companies'), { waitUntil: 'domcontentloaded' });
    await page.getByText('AstraZeneca').first().waitFor({ timeout: 30000 });
    await page.screenshot({ path: auditPath('companies-live.png'), fullPage: true });

    await runExport(page, null);
    await saveLastBlob(page, auditPath('companies.xlsx'));

    const wb = await loadWorkbook(auditPath('companies.xlsx'));
    const sheet = wb.getWorksheet('Companies');
    expect(sheet).toBeTruthy();
    const headers = sheetHeaders(sheet!);
    for (const h of ['Company', 'Assets', 'Order']) {
      expect(headers, `Companies header ${h}`).toContain(h);
    }
    const rows = sheetRows(sheet!);
    const az = rows.find((r) => r['Company'] === 'AstraZeneca');
    expect(az).toBeTruthy();
    expect(Number(az!['Assets'])).toBeGreaterThan(0);
  });

  test('assets Excel uses domain headers and carries MOA, ROA, generic', async () => {
    await page.goto(surfaceUrl('manage/assets'), { waitUntil: 'domcontentloaded' });
    await page.getByText('Farxiga').first().waitFor({ timeout: 30000 });
    await page.screenshot({ path: auditPath('assets-live.png'), fullPage: true });

    await runExport(page, null);
    await saveLastBlob(page, auditPath('assets.xlsx'));

    const wb = await loadWorkbook(auditPath('assets.xlsx'));
    const sheet = wb.getWorksheet('Assets');
    expect(sheet).toBeTruthy();
    const headers = sheetHeaders(sheet!);
    // The asset detail surface shows logo, generic, MOA/ROA, and trials; the
    // grid already carries every data field, so the export contract is the
    // visible column set with domain-vocabulary headers.
    for (const h of ['Asset', 'Generic', 'Company', 'MOA', 'ROA', 'Trials', 'Order']) {
      expect(headers, `Assets header ${h}`).toContain(h);
    }
    const rows = sheetRows(sheet!);
    const farxiga = rows.find((r) => r['Asset'] === 'Farxiga');
    expect(farxiga).toBeTruthy();
    expect(String(farxiga!['MOA'])).toContain('SGLT2 inhibitor');
    expect(String(farxiga!['Generic'])).toBe('dapagliflozin');
  });

  test('timeline PNG and Excel export directly from the header menu', async () => {
    await page.goto(surfaceUrl('timeline'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('app-dashboard-grid', { timeout: 30000 });
    await page.screenshot({ path: auditPath('timeline-live.png'), fullPage: true });

    await runExport(page, 'Image (PNG)');
    expect((await lastBlob(page))?.type).toBe('image/png');
    await saveLastBlob(page, auditPath('timeline.png'));
    const dims = await lastPngDimensions(page);
    expect(dims.width).toBeGreaterThan(1000);
    expect(await visibleHostSightings(page)).toEqual([]);

    await runExport(page, 'Excel (XLSX)');
    await saveLastBlob(page, auditPath('timeline.xlsx'));
  });
});
