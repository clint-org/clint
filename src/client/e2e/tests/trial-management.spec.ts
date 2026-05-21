import { test, expect, Page } from '@playwright/test';
import { authenticatedPage, getAuthStorage } from '../helpers/auth.helper';
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
import { clickRowAction } from '../helpers/menu.helper';

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
    const assetId = await createTestProduct(spaceId, companyId, 'Trial Test Asset');
    const taId = await createTestTherapeuticArea(spaceId, 'Trial TA');
    trialId = await createTestTrial(spaceId, assetId, taId, 'Test Trial');

    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('trial detail page loads with sections', async () => {
    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    // Section cards use uppercase h2 headings: "Basic info", "Markers", "Notes"
    // "Phase" section only shows if trial has phase_type set
    await expect(page.getByRole('heading', { name: 'Basic info' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Markers' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
  });

  test('edit trial basic info', async () => {
    // The "Edit details" topbar action opens the trial-edit dialog.
    await page.getByRole('button', { name: 'Edit details' }).click();
    await expect(page.locator('#edit-trial-name')).toBeVisible({ timeout: 5000 });

    await clearAndFill(page, '#edit-trial-name', 'Updated Trial');
    // Dialog submit button is labeled "Save".
    await page.locator('.p-dialog').getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(2000);

    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Updated Trial' })).toBeVisible({
      timeout: 10000,
    });
  });

  test('add a trial marker', async () => {
    // "Add marker" button is inside the Markers section card
    await page.getByRole('button', { name: 'Add marker' }).click();
    await expect(page.locator('#marker-event-date')).toBeVisible({ timeout: 5000 });

    // Select a category first (required)
    await page.locator('#marker-category').click();
    await page.locator('.p-select-option, .p-listbox-option, [role="option"]').first().click();
    await page.waitForTimeout(300);

    // Select a marker type (required, depends on category)
    await page.locator('#marker-type').click();
    await page.locator('.p-select-option, .p-listbox-option, [role="option"]').first().click();
    await page.waitForTimeout(300);

    await fillInput(page, '#marker-title', 'Test marker title');
    await page.waitForTimeout(300);
    await fillInput(page, '#marker-event-date', '2025-03-15');
    await page.waitForTimeout(300);

    // Submit the marker form -- scope to the form to avoid matching the trigger button
    await page.locator('form').getByRole('button', { name: 'Add Marker' }).click();
    await page.waitForTimeout(3000);

    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    // The marker table renders dates via `| date: 'mediumDate'` (e.g. "Mar 15, 2025"),
    // so assert against the marker title instead -- it's unique and format-stable.
    await expect(page.getByText('Test marker title')).toBeVisible({ timeout: 5000 });
  });

  test('delete a trial marker via literal "delete" typed confirm', async () => {
    // Find the marker row by title and open the row-actions menu
    const markerRow = page.locator('tr', { hasText: 'Test marker title' });
    await clickRowAction(page, markerRow, 'Delete');

    // Cascade-safety T12: unnamed single-marker delete uses the literal
    // word 'delete' as the typed-confirmation gate.
    const dialog = page.locator('.p-dialog', {
      has: page.locator('input#confirm-delete-typed'),
    });
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await dialog.locator('input#confirm-delete-typed').fill('delete');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    // Scope the assertion to the markers table -- the activity feed still
    // shows "Marker removed: Test marker title" after the deletion.
    await expect(page.locator('p-table tbody').getByText('Test marker title')).not.toBeVisible({
      timeout: 5000,
    });
  });

  test('add a trial note', async () => {
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.locator('#note-content')).toBeVisible({ timeout: 5000 });

    await fillInput(page, '#note-content', 'This is a test note for the trial.');
    await page.locator('form').getByRole('button', { name: 'Add Note' }).click();
    await page.waitForTimeout(2000);

    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    // Scope to the Notes section -- the activity feed also surfaces note text.
    const notesSection = page.locator('app-section-card', {
      has: page.getByRole('heading', { name: 'Notes' }),
    });
    await expect(notesSection.getByText('This is a test note for the trial.')).toBeVisible({
      timeout: 5000,
    });
  });

  test('delete a trial note via literal "delete" typed confirm', async () => {
    // Notes use row-actions in a list layout
    const noteContainer = page.locator('li', {
      hasText: 'This is a test note for the trial.',
    });
    await clickRowAction(page, noteContainer, 'Delete');

    // Single-note deletes also use the literal 'delete' typed-confirm path.
    const dialog = page.locator('.p-dialog', {
      has: page.locator('input#confirm-delete-typed'),
    });
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await dialog.locator('input#confirm-delete-typed').fill('delete');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    // Scope to the Notes section -- the activity feed retains "Note removed" text.
    const notesSection = page.locator('app-section-card', {
      has: page.getByRole('heading', { name: 'Notes' }),
    });
    await expect(notesSection.getByText('This is a test note for the trial.')).not.toBeVisible({
      timeout: 5000,
    });
  });

  test('back button navigates away from trial detail', async () => {
    await page.goto(trialUrl(), { waitUntil: 'networkidle' });
    // The back button is now in the contextual topbar
    await page.locator('.topbar-back').click();
    await expect(page).not.toHaveURL(/\/trials\//);
  });
});

test.describe('Trial List CRUD', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  let companyId: string;
  let assetId: string;
  let taId: string;
  const trialsUrl = () => `/t/${tenantId}/s/${spaceId}/manage/trials`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Trial List Org');
    spaceId = await createTestSpace(tenantId, 'Trial List Space');
    companyId = await createTestCompany(spaceId, 'Trial Co');
    assetId = await createTestProduct(spaceId, companyId, 'Trial Asset');
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

  test('create trial via DB and verify it appears in list', async () => {
    // The trial form has many fields with complex Angular bindings that are
    // difficult to set reliably via Playwright. Create via DB helper instead
    // and verify it renders in the list.
    await createTestTrial(spaceId, assetId, taId, 'KEYNOTE-001');
    await page.goto(trialsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('KEYNOTE-001')).toBeVisible({ timeout: 10000 });
  });

  test('edit trial from list opens detail and pre-populates dialog', async () => {
    // Edit menuitem on the list row now navigates to the trial detail page,
    // where the "Edit details" topbar action opens the edit dialog.
    const row = page.locator('tr', { hasText: 'KEYNOTE-001' });
    await clickRowAction(page, row, 'Edit');
    await expect(page).toHaveURL(/\/manage\/trials\/[0-9a-f-]+/, { timeout: 10000 });

    await page.getByRole('button', { name: 'Edit details' }).click();
    await expect(page.locator('#edit-trial-name')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#edit-trial-name')).toHaveValue('KEYNOTE-001');

    await clearAndFill(page, '#edit-trial-name', 'KEYNOTE-002');
    await page.locator('.p-dialog').getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(2000);

    await page.goto(trialsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('KEYNOTE-002')).toBeVisible({ timeout: 10000 });
  });

  test('delete trial from list cascades to marker_assignments and trial_notes', async () => {
    // Seed a trial with one marker_assignment and one trial_note so we can
    // assert the cascade actually clears both (T6 flipped the FKs to CASCADE).
    const admin = getAdminClient();
    const userId = getAuthStorage().userId;
    const cascadeTrialName = 'KEYNOTE-CASCADE ' + Date.now();
    const cascadeTrialId = await createTestTrial(spaceId, assetId, taId, cascadeTrialName);

    // Seed a marker_type + marker + assignment for the cascade trial.
    const { data: cat } = await admin
      .from('marker_categories')
      .select('id')
      .eq('name', 'Data')
      .eq('is_system', true)
      .single();
    const { data: mt, error: mtErr } = await admin
      .from('marker_types')
      .insert({
        space_id: spaceId,
        created_by: userId,
        name: 'CascadeMT ' + Date.now(),
        category_id: cat!.id,
        shape: 'circle',
        fill_style: 'filled',
        color: '#14b8a6',
      })
      .select('id')
      .single();
    if (mtErr) throw new Error(`Could not seed marker_type: ${mtErr.message}`);
    const { data: marker, error: mErr } = await admin
      .from('markers')
      .insert({
        space_id: spaceId,
        created_by: userId,
        marker_type_id: mt!.id,
        title: 'CascadeMarker ' + Date.now(),
        event_date: new Date().toISOString().slice(0, 10),
      })
      .select('id')
      .single();
    if (mErr) throw new Error(`Could not seed marker: ${mErr.message}`);
    const { data: assignment, error: aErr } = await admin
      .from('marker_assignments')
      .insert({ marker_id: marker!.id, trial_id: cascadeTrialId })
      .select('id')
      .single();
    if (aErr) throw new Error(`Could not seed assignment: ${aErr.message}`);
    const { data: note, error: nErr } = await admin
      .from('trial_notes')
      .insert({
        trial_id: cascadeTrialId,
        space_id: spaceId,
        created_by: userId,
        content: 'cascade test note',
      })
      .select('id')
      .single();
    if (nErr) throw new Error(`Could not seed note: ${nErr.message}`);

    await page.goto(trialsUrl(), { waitUntil: 'networkidle' });
    const row = page.locator('tr', { hasText: cascadeTrialName });
    await expect(row).toBeVisible({ timeout: 10000 });

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/rest/v1/rpc/preview_trial_delete') && r.ok(),
        { timeout: 10000 },
      ),
      clickRowAction(page, row, 'Delete'),
    ]);

    const dialog = page.locator('.p-dialog', {
      has: page.locator('input#confirm-delete-typed'),
    });
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await dialog.locator('input#confirm-delete-typed').fill(cascadeTrialName);
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/rest/v1/trials') && r.request().method() === 'DELETE',
        { timeout: 10000 },
      ),
      dialog.getByRole('button', { name: 'Delete', exact: true }).click(),
    ]);
    await expect(dialog).toBeHidden({ timeout: 10000 });

    await page.goto(trialsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText(cascadeTrialName)).not.toBeVisible({ timeout: 5000 });

    // Cascade assertions: assignment and note rows are gone with the trial.
    const { data: assignmentAfter } = await admin
      .from('marker_assignments')
      .select('id')
      .eq('id', assignment!.id)
      .maybeSingle();
    expect(assignmentAfter).toBeNull();
    const { data: noteAfter } = await admin
      .from('trial_notes')
      .select('id')
      .eq('id', note!.id)
      .maybeSingle();
    expect(noteAfter).toBeNull();
  });

  test('delete the original KEYNOTE-002 trial via typed confirm', async () => {
    await page.goto(trialsUrl(), { waitUntil: 'networkidle' });
    const row = page.locator('tr', { hasText: 'KEYNOTE-002' });
    await clickRowAction(page, row, 'Delete');

    const dialog = page.locator('.p-dialog', {
      has: page.locator('input#confirm-delete-typed'),
    });
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await dialog.locator('input#confirm-delete-typed').fill('KEYNOTE-002');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    await page.goto(trialsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByText('KEYNOTE-002')).not.toBeVisible({ timeout: 5000 });
  });
});
