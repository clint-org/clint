import { test, expect, Page } from '@playwright/test';
import { authenticatedPage, getAuthStorage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace, getAdminClient } from '../helpers/test-data.helper';

test.describe.configure({ mode: 'serial' });

/**
 * Cascade-safety T16: space archive / restore / permanently_delete e2e.
 *
 * Exercises the lifecycle implemented in T11:
 *  - archive_space (space-owner gated, reversible)
 *  - restore_space (space-owner gated)
 *  - permanently_delete_space (tenant-owner or platform-admin gated;
 *    requires archived_at not null; type-the-name confirm in UI)
 *
 * The default test user is tenant owner of every tenant they create
 * (see createTestTenant -> tenant_members insert with role 'owner').
 * Case 5 builds a separate tenant where the user is a non-owner tenant
 * member but a space owner, to assert the Permanently delete affordance
 * is hidden for that role combination.
 */
test.describe('Space archive lifecycle', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const spaceName = 'Archive Lifecycle Space';
  const spacesUrl = () => `/t/${tenantId}/spaces`;
  const archivedUrl = () => `/t/${tenantId}/spaces/archived`;
  const generalUrl = () => `/t/${tenantId}/s/${spaceId}/settings/general`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Archive Lifecycle Org');
    spaceId = await createTestSpace(tenantId, spaceName);
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('archive space from general settings hides it from default list', async () => {
    await page.goto(generalUrl(), { waitUntil: 'domcontentloaded' });

    const archiveTrigger = page.getByRole('button', { name: 'Archive space' });
    await expect(archiveTrigger).toBeVisible({ timeout: 10000 });
    await archiveTrigger.click();

    // PrimeNG ConfirmDialog accept button (legacy plain confirm path used
    // by confirmDelete when no counts / typedConfirmationValue are passed).
    const confirmAccept = page.locator('.p-confirmdialog-accept-button, .p-confirm-dialog-accept');
    await expect(confirmAccept).toBeVisible({ timeout: 5000 });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rest/v1/rpc/archive_space') && r.ok(), {
        timeout: 10000,
      }),
      confirmAccept.click(),
    ]);

    // (archived) badge shows on the same page after the row reloads.
    await expect(page.getByText('Archived', { exact: false }).first()).toBeVisible({
      timeout: 10000,
    });

    // Default spaces list no longer shows the archived space.
    await page.goto(spacesUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: spaceName, level: 3 })).toBeHidden({
      timeout: 10000,
    });
  });

  test('archived list shows the archived space', async () => {
    await page.goto(archivedUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: spaceName })).toBeVisible({
      timeout: 10000,
    });

    // Restore + Permanently delete affordances visible to the tenant owner.
    const archivedRow = page.locator('li', { hasText: spaceName });
    await expect(archivedRow.getByRole('button', { name: 'Restore' })).toBeVisible();
    await expect(archivedRow.getByRole('button', { name: 'Permanently delete' })).toBeVisible();
  });

  test('restore from archived list returns space to default list', async () => {
    await page.goto(archivedUrl(), { waitUntil: 'domcontentloaded' });
    const archivedRow = page.locator('li', { hasText: spaceName });
    await archivedRow.getByRole('button', { name: 'Restore' }).click();

    const confirmAccept = page.locator('.p-confirmdialog-accept-button, .p-confirm-dialog-accept');
    await expect(confirmAccept).toBeVisible({ timeout: 5000 });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rest/v1/rpc/restore_space') && r.ok(), {
        timeout: 10000,
      }),
      confirmAccept.click(),
    ]);

    // Space is gone from the archived list.
    await page.goto(archivedUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: spaceName })).toBeHidden({
      timeout: 10000,
    });

    // And back in the active list.
    await page.goto(spacesUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: spaceName, level: 3 })).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe('Space permanent delete (tenant owner)', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const spaceName = 'Doomed Engagement ' + Date.now();
  const archivedUrl = () => `/t/${tenantId}/spaces/archived`;
  const spacesUrl = () => `/t/${tenantId}/spaces`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Permanent Delete Org');
    spaceId = await createTestSpace(tenantId, spaceName);
    page = await authenticatedPage(browser);

    // Archive directly via admin client so this describe block focuses on
    // the permanent-delete leg without re-driving the archive UI.
    const admin = getAdminClient();
    const { error } = await admin
      .from('spaces')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', spaceId);
    if (error) throw new Error(`Could not seed archived space: ${error.message}`);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('Permanently delete enforces type-the-name then removes the space', async () => {
    await page.goto(archivedUrl(), { waitUntil: 'domcontentloaded' });
    const archivedRow = page.locator('li', { hasText: spaceName });
    await expect(archivedRow).toBeVisible({ timeout: 10000 });

    await archivedRow.getByRole('button', { name: 'Permanently delete' }).click();

    // The custom dialog (not p-confirmdialog) opens with the type-the-name
    // input. Scope every probe to that dialog to avoid colliding with the
    // global p-confirmdialog if it is ever mounted simultaneously.
    const dialog = page.locator('.p-dialog', { hasText: 'Permanently delete space' });
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const typedInput = dialog.getByLabel('Type the space name to confirm');
    const confirmBtn = dialog.locator('button.p-button:has-text("Permanently delete")');

    // Empty + wrong name keep Confirm disabled.
    await expect(confirmBtn).toBeDisabled();
    await typedInput.fill('not the right name');
    await expect(confirmBtn).toBeDisabled();

    // Exact name match enables Confirm.
    await typedInput.fill(spaceName);
    await expect(confirmBtn).toBeEnabled();

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/rest/v1/rpc/permanently_delete_space') && r.ok(),
        { timeout: 10000 }
      ),
      confirmBtn.click(),
    ]);

    // Dialog closes, archived list no longer lists the space.
    await expect(dialog).toBeHidden({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: spaceName })).toBeHidden({
      timeout: 5000,
    });

    // And the space does not reappear in the active list either.
    await page.goto(spacesUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: spaceName, level: 3 })).toBeHidden({
      timeout: 5000,
    });
  });
});

test.describe('Space owner who is not tenant owner', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  const spaceName = 'No Delete Space';
  const archivedUrl = () => `/t/${tenantId}/spaces/archived`;

  test.beforeAll(async ({ browser }) => {
    const admin = getAdminClient();
    const userId = getAuthStorage().userId;

    // Build a tenant the test user does NOT own (some other user owns it).
    // The test user gets a non-owner tenant_members row so they can see the
    // tenant in their picker, plus a space_members owner row for the space.
    const otherUserEmail = `other-owner-${Date.now()}@clint.local`;
    const { data: otherUser, error: otherUserErr } = await admin.auth.admin.createUser({
      email: otherUserEmail,
      password: `pw-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      email_confirm: true,
    });
    if (otherUserErr) throw otherUserErr;
    const otherUserId = otherUser.user!.id;

    const slug = 'space-owner-only-' + Date.now();
    const { data: tenant, error: tErr } = await admin
      .from('tenants')
      .insert({ name: 'Space Owner Only Org', slug })
      .select('id')
      .single();
    if (tErr) throw new Error(`Could not create tenant: ${tErr.message}`);
    tenantId = tenant.id;

    // Real tenant owner is the throwaway user. The current
    // tenant_members_role_check constraint pins role to 'owner' only;
    // tenant-level "member" no longer exists -- tenant access for non-
    // owners is granted implicitly via has_tenant_access() when the user
    // holds a space_members row under the tenant. See migration
    // 20260429010000_owner_only_explicit_space_access.sql.
    const { error: ownerErr } = await admin
      .from('tenant_members')
      .insert({ tenant_id: tenantId, user_id: otherUserId, role: 'owner' });
    if (ownerErr) throw new Error(`Could not seat tenant owner: ${ownerErr.message}`);

    // Space created by the throwaway owner; test user gets space-owner role.
    // The space_members row alone is enough for tenantGuard to admit the
    // user to /t/:tenantId/* because has_tenant_access() short-circuits on
    // any space_members row under the tenant.
    const { data: space, error: sErr } = await admin
      .from('spaces')
      .insert({ tenant_id: tenantId, name: spaceName, created_by: otherUserId })
      .select('id')
      .single();
    if (sErr) throw new Error(`Could not create space: ${sErr.message}`);
    spaceId = space.id;

    await admin.from('space_members').insert({ space_id: spaceId, user_id: userId, role: 'owner' });

    // Pre-archive so the space surfaces in the archived list.
    const { error: archErr } = await admin
      .from('spaces')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', spaceId);
    if (archErr) throw new Error(`Could not archive: ${archErr.message}`);

    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('Permanently delete affordance is hidden for non-tenant-owner', async () => {
    await page.goto(archivedUrl(), { waitUntil: 'domcontentloaded' });

    const archivedRow = page.locator('li', { hasText: spaceName });
    await expect(archivedRow).toBeVisible({ timeout: 10000 });

    // Restore stays available (space-owner gated).
    await expect(archivedRow.getByRole('button', { name: 'Restore' })).toBeVisible();

    // Permanently delete is hidden because the caller is not a tenant owner
    // or platform admin. Server-side RLS on permanently_delete_space would
    // reject the call regardless; the UI guard simply avoids surfacing an
    // affordance the role cannot use.
    await expect(archivedRow.getByRole('button', { name: 'Permanently delete' })).toBeHidden();
  });
});
