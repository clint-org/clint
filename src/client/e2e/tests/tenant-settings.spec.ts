import { test, expect, Page } from '@playwright/test';
import { authenticatedPage, getAuthStorage } from '../helpers/auth.helper';
import { createTestTenant, getAdminClient } from '../helpers/test-data.helper';
import { fillInput, clearAndFill } from '../helpers/form.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Tenant Settings', () => {
  let page: Page;
  let tenantId: string;
  const settingsUrl = () => `/t/${tenantId}/settings`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Settings Test Org');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('settings page loads with tenant name input visible', async () => {
    await page.goto(settingsUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#tenant-name')).toBeVisible();
  });

  test('save and add-owner controls are visible', async () => {
    // "Save" sits next to the tenant-name input (saves the rename).
    await expect(page.getByRole('button', { name: 'Save' }).first()).toBeVisible();
    // "Add owner" is the topbar action that opens the owner-invite dialog.
    await expect(page.getByRole('button', { name: 'Add owner' })).toBeVisible();
  });

  test('add-owner dialog opens and closes', async () => {
    await page.getByRole('button', { name: 'Add owner' }).click();
    await expect(page.locator('.p-dialog')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await expect(page.locator('.p-dialog')).not.toBeVisible();
  });

  test('owners table shows at least one owner', async () => {
    await expect(page.locator('p-table tbody tr').first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Tenant delete cascade enqueues r2_pending_deletes for materials', () => {
  // Cascade-safety T1/T8: deleting a tenant cascades through spaces -> materials,
  // and the AFTER DELETE trigger on public.materials enqueues each file_path
  // into public.r2_pending_deletes. The Cloudflare worker drains the queue
  // separately. Here we assert the rows land in the queue post-delete.

  test('queues an r2 delete row for each material under the deleted tenant', async () => {
    const admin = getAdminClient();
    const userId = getAuthStorage().userId;

    // Build an isolated tenant + space + two materials so the assertion can
    // count rows by file_path without colliding with other test fixtures.
    //
    // Skip the helper createTestSpace because it inserts a space_members
    // row that trips the last-owner self-protection guard during the
    // tenant -> spaces -> space_members cascade (the per-statement cascade
    // flag from migration 20260428220000 only catches statement-level
    // triggers, and FK cascades on space_members do not re-fire the spaces
    // statement-trigger). Without the space_members row, the cascade chain
    // tenant -> spaces -> materials -> r2_pending_deletes runs cleanly.
    const tenantId = await createTestTenant('R2 Cascade Org ' + Date.now());

    const { data: spaceRow, error: spaceErr } = await admin
      .from('spaces')
      .insert({ tenant_id: tenantId, name: 'R2 Cascade Space', created_by: userId })
      .select('id')
      .single();
    if (spaceErr) throw new Error(`Could not seed space: ${spaceErr.message}`);
    const spaceId: string = spaceRow!.id;

    const stamp = Date.now();
    const filePathA = `materials/${spaceId}/cascade-a-${stamp}.pdf`;
    const filePathB = `materials/${spaceId}/cascade-b-${stamp}.pdf`;

    const { error: matErr } = await admin.from('materials').insert([
      {
        space_id: spaceId,
        uploaded_by: userId,
        file_path: filePathA,
        file_name: 'cascade-a.pdf',
        file_size_bytes: 1024,
        mime_type: 'application/pdf',
        material_type: 'briefing',
        title: 'Cascade A',
      },
      {
        space_id: spaceId,
        uploaded_by: userId,
        file_path: filePathB,
        file_name: 'cascade-b.pdf',
        file_size_bytes: 2048,
        mime_type: 'application/pdf',
        material_type: 'briefing',
        title: 'Cascade B',
      },
    ]);
    if (matErr) throw new Error(`Could not seed materials: ${matErr.message}`);

    // Sanity: queue starts clean for these paths.
    const { count: priorCount } = await admin
      .from('r2_pending_deletes')
      .select('id', { count: 'exact', head: true })
      .in('file_path', [filePathA, filePathB]);
    expect(priorCount).toBe(0);

    // Delete the tenant directly via PostgREST (the path the UI uses via
    // TenantService.deleteTenant). The cascade flows tenant -> space ->
    // materials -> r2_pending_deletes trigger.
    const { error: delErr } = await admin.from('tenants').delete().eq('id', tenantId);
    if (delErr) throw new Error(`Could not delete tenant: ${delErr.message}`);

    const { data: queued, error: qErr } = await admin
      .from('r2_pending_deletes')
      .select('file_path')
      .in('file_path', [filePathA, filePathB]);
    if (qErr) throw new Error(`Could not read r2_pending_deletes: ${qErr.message}`);
    const paths = (queued ?? []).map((r) => r.file_path).sort();
    expect(paths).toEqual([filePathA, filePathB].sort());
  });
});
