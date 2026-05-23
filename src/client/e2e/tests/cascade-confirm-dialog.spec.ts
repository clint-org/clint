import { test, expect, Locator, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import {
  createTestCompany,
  createTestMarkerType,
  createTestMoa,
  createTestProduct,
  createTestRoa,
  createTestSpace,
  createTestTenant,
  createTestTherapeuticArea,
  createTestTrial,
  getAdminClient,
  getSystemMarkerCategoryId,
} from '../helpers/test-data.helper';
import { clickRowAction } from '../helpers/menu.helper';

/**
 * Cascade-safety T17: count-aware confirm dialog e2e.
 *
 * Coverage:
 *   - For one named entity (company) verify the count-breakdown table
 *     renders with the documented keys + values from preview_company_delete.
 *   - For every named-delete surface assert the type-the-name gate:
 *     empty + wrong = disabled, exact match = enabled, cancel closes.
 *   - For unnamed-item surfaces (single marker, single note) the typed
 *     value is the literal 'delete'.
 *
 * Selectors anchor on stable handles in the rendered DOM:
 *   - The cascade-aware dialog is the `.p-dialog` containing the
 *     `input#confirm-delete-typed` field (the PrimeNG ConfirmDialog used by
 *     legacy plain-confirm callers has no such input).
 *   - The count table has a fixed aria-label and per-row data-count-key
 *     attributes added in T17 for stability.
 *   - Confirm and Cancel buttons are selected by their visible labels
 *     ('Delete' / 'Cancel' by default; helpers accept overrides).
 */

const dialogLocator = (page: Page): Locator =>
  page.locator('.p-dialog', { has: page.locator('input#confirm-delete-typed') });

const confirmInput = (dialog: Locator): Locator => dialog.locator('input#confirm-delete-typed');

const confirmButton = (dialog: Locator, label: string = 'Delete'): Locator =>
  dialog.getByRole('button', { name: label, exact: true });

const cancelButton = (dialog: Locator, label: string = 'Cancel'): Locator =>
  dialog.getByRole('button', { name: label, exact: true });

const countBreakdown = (dialog: Locator): Locator =>
  dialog.locator('table[aria-label="Count breakdown of items this action will remove"]');

/**
 * Drive the named-entity dialog through: empty -> disabled, wrong -> disabled,
 * exact -> enabled, cancel -> closed. Leaves the entity in place. Use this
 * before the destructive happy path so we exercise the full disable/enable
 * matrix without double-deleting.
 */
async function verifyTypedConfirmDisabledThenCancel(page: Page, name: string): Promise<void> {
  const dialog = dialogLocator(page);
  await expect(dialog).toBeVisible({ timeout: 10000 });

  const input = confirmInput(dialog);
  const confirm = confirmButton(dialog);
  const cancel = cancelButton(dialog);

  // Empty input keeps Confirm disabled.
  await expect(confirm).toBeDisabled();

  // Wrong name keeps Confirm disabled.
  await input.fill('not the right name');
  await expect(confirm).toBeDisabled();

  // Exact match enables Confirm.
  await input.fill(name);
  await expect(confirm).toBeEnabled();

  // Cancel closes the dialog and returns false (no delete fired).
  await cancel.click();
  await expect(dialog).toBeHidden({ timeout: 5000 });
}

/**
 * Drive the named-entity dialog through to completion: open, type exact name,
 * confirm, wait for dialog to close. Caller is responsible for opening the
 * dialog beforehand and asserting the entity is gone afterwards.
 */
async function completeTypedConfirm(page: Page, name: string): Promise<void> {
  const dialog = dialogLocator(page);
  await expect(dialog).toBeVisible({ timeout: 10000 });

  const input = confirmInput(dialog);
  await input.fill(name);

  const confirm = confirmButton(dialog);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toBeHidden({ timeout: 10000 });
}

// ============================================================================
// Named-entity surfaces
// ============================================================================

test.describe.configure({ mode: 'serial' });

test.describe('Cascade confirm dialog: company delete (count breakdown + typed gate)', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  let companyId: string;
  let productId: string;
  let taId: string;
  let trialId: string;
  const companyName = 'CascadeCo ' + Date.now();
  const companiesUrl = () => `/t/${tenantId}/s/${spaceId}/manage/companies`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Cascade Company Org');
    spaceId = await createTestSpace(tenantId, 'Cascade Company Space');

    // Build a hermetic graph so preview_company_delete returns a non-trivial
    // count breakdown. company -> product -> trial gives products=1, trials=1.
    companyId = await createTestCompany(spaceId, companyName);
    productId = await createTestProduct(spaceId, companyId, 'CascadeAsset');
    taId = await createTestTherapeuticArea(spaceId, 'CascadeTA');
    trialId = await createTestTrial(spaceId, productId, taId, 'CascadeTrial');

    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    // Best-effort cleanup; the actual delete test below removes the company,
    // which cascades through everything we created.
    const admin = getAdminClient();
    await admin.from('therapeutic_areas').delete().eq('id', taId);
    await page.close();
  });

  test('opens with count breakdown from preview_company_delete and gates submit', async () => {
    await page.goto(companiesUrl(), { waitUntil: 'domcontentloaded' });
    const row = page.locator('tr', { hasText: companyName });
    await expect(row).toBeVisible({ timeout: 10000 });

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/rest/v1/rpc/preview_company_delete') && r.ok(),
        { timeout: 10000 }
      ),
      clickRowAction(page, row, 'Delete'),
    ]);

    const dialog = dialogLocator(page);
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Count breakdown renders with the cascade-safety keys we expect for
    // company -> 1 product -> 1 trial. The "products" and "trials" rows
    // should be present with non-zero values; zero-valued keys are suppressed.
    const breakdown = countBreakdown(dialog);
    await expect(breakdown).toBeVisible({ timeout: 5000 });

    const productsRow = breakdown.locator('tr[data-count-key="products"]');
    await expect(productsRow).toBeVisible();
    await expect(productsRow.locator('td').last()).toHaveText('1');

    const trialsRow = breakdown.locator('tr[data-count-key="trials"]');
    await expect(trialsRow).toBeVisible();
    await expect(trialsRow.locator('td').last()).toHaveText('1');

    // Verify type-the-name gate. Leave the dialog open by closing via Cancel
    // so the next test can re-open it and complete the delete.
    await verifyTypedConfirmDisabledThenCancel(page, companyName);

    // Company is still present after Cancel.
    await page.goto(companiesUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(companyName)).toBeVisible({ timeout: 5000 });
  });

  test('typing the exact name and confirming deletes the company', async () => {
    await page.goto(companiesUrl(), { waitUntil: 'domcontentloaded' });
    const row = page.locator('tr', { hasText: companyName });
    await expect(row).toBeVisible({ timeout: 10000 });
    await clickRowAction(page, row, 'Delete');

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/rest/v1/companies') && r.request().method() === 'DELETE',
        { timeout: 10000 }
      ),
      completeTypedConfirm(page, companyName),
    ]);

    await page.goto(companiesUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(companyName)).toBeHidden({ timeout: 5000 });
  });
});

test.describe('Cascade confirm dialog: asset (product) delete', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  let companyId: string;
  let productId: string;
  const productName = 'CascadeAsset ' + Date.now();
  const assetsUrl = () => `/t/${tenantId}/s/${spaceId}/manage/assets`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Cascade Asset Org');
    spaceId = await createTestSpace(tenantId, 'Cascade Asset Space');
    companyId = await createTestCompany(spaceId, 'Holder');
    productId = await createTestProduct(spaceId, companyId, productName);
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('gates submit on typed name then deletes', async () => {
    await page.goto(assetsUrl(), { waitUntil: 'domcontentloaded' });
    const row = page.locator('tr', { hasText: productName });
    await expect(row).toBeVisible({ timeout: 10000 });

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/rest/v1/rpc/preview_product_delete') && r.ok(),
        { timeout: 10000 }
      ),
      clickRowAction(page, row, 'Delete'),
    ]);

    await verifyTypedConfirmDisabledThenCancel(page, productName);
    await expect(page.getByText(productName)).toBeVisible();

    // Happy path: re-open and complete the delete.
    await clickRowAction(page, row, 'Delete');
    await completeTypedConfirm(page, productName);

    await page.goto(assetsUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(productName)).toBeHidden({ timeout: 5000 });

    // Ignore: productId is unused after delete but kept above for fixture symmetry.
    void productId;
  });
});

test.describe('Cascade confirm dialog: trial delete', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const trialName = 'CascadeTrial ' + Date.now();
  const trialsUrl = () => `/t/${tenantId}/s/${spaceId}/manage/trials`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Cascade Trial Org');
    spaceId = await createTestSpace(tenantId, 'Cascade Trial Space');
    const companyId = await createTestCompany(spaceId, 'TrialHolder');
    const productId = await createTestProduct(spaceId, companyId, 'TrialProduct');
    const taId = await createTestTherapeuticArea(spaceId, 'TrialTA');
    await createTestTrial(spaceId, productId, taId, trialName);
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('gates submit on typed name then deletes', async () => {
    await page.goto(trialsUrl(), { waitUntil: 'domcontentloaded' });
    const row = page.locator('tr', { hasText: trialName });
    await expect(row).toBeVisible({ timeout: 10000 });

    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rest/v1/rpc/preview_trial_delete') && r.ok(), {
        timeout: 10000,
      }),
      clickRowAction(page, row, 'Delete'),
    ]);

    await verifyTypedConfirmDisabledThenCancel(page, trialName);
    await expect(page.getByText(trialName)).toBeVisible();

    await clickRowAction(page, row, 'Delete');
    await completeTypedConfirm(page, trialName);

    await page.goto(trialsUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(trialName)).toBeHidden({ timeout: 5000 });
  });
});

test.describe('Cascade confirm dialog: therapeutic area delete (no preview RPC)', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const taName = 'CascadeTA ' + Date.now();
  // TA list redirects to settings/taxonomies, which loads with
  // ?tab=therapeutic-areas by default.
  const taUrl = () => `/t/${tenantId}/s/${spaceId}/settings/taxonomies`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Cascade TA Org');
    spaceId = await createTestSpace(tenantId, 'Cascade TA Space');
    await createTestTherapeuticArea(spaceId, taName, 'CTA');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('gates submit on typed name then deletes (no count table)', async () => {
    await page.goto(taUrl(), { waitUntil: 'domcontentloaded' });
    const row = page.locator('tr', { hasText: taName });
    await expect(row).toBeVisible({ timeout: 10000 });
    await clickRowAction(page, row, 'Delete');

    const dialog = dialogLocator(page);
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // No preview RPC for TA, so no count table is rendered.
    await expect(countBreakdown(dialog)).toHaveCount(0);

    await verifyTypedConfirmDisabledThenCancel(page, taName);
    await expect(page.getByText(taName)).toBeVisible();

    await clickRowAction(page, row, 'Delete');
    await completeTypedConfirm(page, taName);

    await page.goto(taUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(taName)).toBeHidden({ timeout: 5000 });
  });
});

test.describe('Cascade confirm dialog: marker type delete', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const mtName = 'CascadeMT ' + Date.now();
  const mtUrl = () => `/t/${tenantId}/s/${spaceId}/settings/marker-types`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Cascade MT Org');
    spaceId = await createTestSpace(tenantId, 'Cascade MT Space');
    const categoryId = await getSystemMarkerCategoryId('Data');
    await createTestMarkerType(spaceId, mtName, categoryId);
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('gates submit on typed name then deletes', async () => {
    await page.goto(mtUrl(), { waitUntil: 'domcontentloaded' });
    const row = page.locator('tr', { hasText: mtName });
    await expect(row).toBeVisible({ timeout: 10000 });
    await clickRowAction(page, row, 'Delete');

    await verifyTypedConfirmDisabledThenCancel(page, mtName);
    await expect(page.getByText(mtName)).toBeVisible();

    await clickRowAction(page, row, 'Delete');
    await completeTypedConfirm(page, mtName);

    await page.goto(mtUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(mtName)).toBeHidden({ timeout: 5000 });
  });
});

test.describe('Cascade confirm dialog: mechanism of action delete', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const moaName = 'CascadeMoA ' + Date.now();
  const taxUrl = () => `/t/${tenantId}/s/${spaceId}/settings/taxonomies?tab=moa`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Cascade MoA Org');
    spaceId = await createTestSpace(tenantId, 'Cascade MoA Space');
    await createTestMoa(spaceId, moaName);
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('gates submit on typed name then deletes', async () => {
    await page.goto(taxUrl(), { waitUntil: 'domcontentloaded' });
    const row = page.locator('tr', { hasText: moaName });
    await expect(row).toBeVisible({ timeout: 10000 });
    await clickRowAction(page, row, 'Delete');

    await verifyTypedConfirmDisabledThenCancel(page, moaName);
    await expect(page.getByText(moaName)).toBeVisible();

    await clickRowAction(page, row, 'Delete');
    await completeTypedConfirm(page, moaName);

    await page.goto(taxUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(moaName)).toBeHidden({ timeout: 5000 });
  });
});

test.describe('Cascade confirm dialog: route of administration delete', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const roaName = 'CascadeRoA ' + Date.now();
  const taxUrl = () => `/t/${tenantId}/s/${spaceId}/settings/taxonomies?tab=roa`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Cascade RoA Org');
    spaceId = await createTestSpace(tenantId, 'Cascade RoA Space');
    await createTestRoa(spaceId, roaName);
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('gates submit on typed name then deletes', async () => {
    await page.goto(taxUrl(), { waitUntil: 'domcontentloaded' });
    const row = page.locator('tr', { hasText: roaName });
    await expect(row).toBeVisible({ timeout: 10000 });
    await clickRowAction(page, row, 'Delete');

    await verifyTypedConfirmDisabledThenCancel(page, roaName);
    await expect(page.getByText(roaName)).toBeVisible();

    await clickRowAction(page, row, 'Delete');
    await completeTypedConfirm(page, roaName);

    await page.goto(taxUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(roaName)).toBeHidden({ timeout: 5000 });
  });
});

// ============================================================================
// Unnamed-item surfaces (literal 'delete' typed-confirm gate)
// ============================================================================

test.describe('Cascade confirm dialog: unnamed-item deletes (literal "delete")', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  let trialId: string;
  let markerId: string;
  let noteId: string;
  const trialName = 'UnnamedHostTrial ' + Date.now();
  const markerTitle = 'CascadeMarker ' + Date.now();
  const noteContent = 'Cascade note body ' + Date.now();

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Cascade Unnamed Org');
    spaceId = await createTestSpace(tenantId, 'Cascade Unnamed Space');
    const companyId = await createTestCompany(spaceId, 'UnnamedHolder');
    const productId = await createTestProduct(spaceId, companyId, 'UnnamedProduct');
    const taId = await createTestTherapeuticArea(spaceId, 'UnnamedTA');
    trialId = await createTestTrial(spaceId, productId, taId, trialName);

    // Seed a marker (with one assignment) and a trial note via admin client.
    // Markers and notes have no row-builder helper, but the schema is simple.
    const admin = getAdminClient();
    const categoryId = await getSystemMarkerCategoryId('Data');
    const { data: mt, error: mtErr } = await admin
      .from('marker_types')
      .insert({
        space_id: spaceId,
        created_by: await getAuthUserId(),
        name: 'CascadeUnnamedMT ' + Date.now(),
        category_id: categoryId,
        shape: 'circle',
        fill_style: 'filled',
        color: '#14b8a6',
      })
      .select('id')
      .single();
    if (mtErr) throw new Error(`Seed marker type: ${mtErr.message}`);

    const { data: marker, error: mErr } = await admin
      .from('markers')
      .insert({
        space_id: spaceId,
        created_by: await getAuthUserId(),
        marker_type_id: mt!.id,
        title: markerTitle,
        event_date: new Date().toISOString().slice(0, 10),
      })
      .select('id')
      .single();
    if (mErr) throw new Error(`Seed marker: ${mErr.message}`);
    markerId = marker!.id;

    const { error: aErr } = await admin
      .from('marker_assignments')
      .insert({ marker_id: markerId, trial_id: trialId });
    if (aErr) throw new Error(`Seed assignment: ${aErr.message}`);

    const { data: note, error: nErr } = await admin
      .from('trial_notes')
      .insert({
        space_id: spaceId,
        trial_id: trialId,
        created_by: await getAuthUserId(),
        content: noteContent,
      })
      .select('id')
      .single();
    if (nErr) throw new Error(`Seed note: ${nErr.message}`);
    noteId = note!.id;

    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('marker delete on trial detail requires literal "delete" then succeeds', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/trials/${trialId}`, {
      waitUntil: 'domcontentloaded',
    });

    const markerRow = page.locator('tr', { hasText: markerTitle });
    await expect(markerRow).toBeVisible({ timeout: 10000 });
    await clickRowAction(page, markerRow, 'Delete');

    const dialog = dialogLocator(page);
    await expect(dialog).toBeVisible({ timeout: 10000 });

    const input = confirmInput(dialog);
    const confirm = confirmButton(dialog);

    // Empty and wrong values keep Confirm disabled.
    await expect(confirm).toBeDisabled();
    await input.fill('wrong');
    await expect(confirm).toBeDisabled();

    // Literal 'delete' enables Confirm.
    await input.fill('delete');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    // Marker row is gone.
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/trials/${trialId}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.locator('tr', { hasText: markerTitle })).toHaveCount(0, {
      timeout: 5000,
    });

    void markerId;
  });

  test('note delete on trial detail requires literal "delete" then succeeds', async () => {
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/trials/${trialId}`, {
      waitUntil: 'domcontentloaded',
    });

    const noteRow = page.locator('li', { hasText: noteContent });
    await expect(noteRow).toBeVisible({ timeout: 10000 });
    await clickRowAction(page, noteRow, 'Delete');

    const dialog = dialogLocator(page);
    await expect(dialog).toBeVisible({ timeout: 10000 });

    const input = confirmInput(dialog);
    const confirm = confirmButton(dialog);

    await expect(confirm).toBeDisabled();
    await input.fill('wrong');
    await expect(confirm).toBeDisabled();
    await input.fill('delete');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/trials/${trialId}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.locator('li', { hasText: noteContent })).toHaveCount(0, {
      timeout: 5000,
    });

    void noteId;
  });
});

// ---------------------------------------------------------------------------
// Local helper: read the authenticated test user's id from the auth-storage
// fixture. Kept inline so we do not have to widen test-data.helper's exports
// for a one-off seed path.
// ---------------------------------------------------------------------------

async function getAuthUserId(): Promise<string> {
  const { getAuthStorage } = await import('../helpers/auth.helper');
  return getAuthStorage().userId;
}
