/**
 * Role firewall -- the highest-value regression net. One scratch world, four
 * identities (owner / editor / viewer / non-member), asserting control
 * visibility and guard redirects across representative guarded surfaces.
 *
 * Hard assertions are on durable signals (final URL, control presence). Toast
 * copy auto-dismisses, so it is checked with expect.soft (recorded, non-fatal).
 *
 * Sources: TP-002/004/006 in docs/notes/event-model-qa-test-paths.md + the guard
 * inventory (spaceGuard / spaceOwnerGuard / editGuard / importGuard).
 */
import { test, expect } from '../fixtures';

const sp = (tenantId: string, spaceId: string, sub = '') => `/t/${tenantId}/s/${spaceId}${sub}`;

// the firewall is the one spec that needs every role
test.use({ worldRoles: ['owner', 'editor', 'viewer', 'nonMember'] });

test.describe('@firewall role firewall', () => {
  test('non-member is denied the space and bounced to the spaces list', async ({
    world,
    pageAs,
    gotoSettled,
  }) => {
    const page = await pageAs('nonMember');
    await gotoSettled(page, sp(world.tenantId, world.spaceId, '/timeline'));

    // spaceGuard: explicit-membership model, no tenant->space cascade
    await expect(page).not.toHaveURL(/\/timeline/);
    await expect(page).toHaveURL(/\/spaces/);
    await expect.soft(page.getByText(/No access to this space/i)).toBeVisible({ timeout: 6_000 });
  });

  test('viewer is denied owner-only space settings', async ({ world, pageAs, gotoSettled }) => {
    const page = await pageAs('viewer');
    await gotoSettled(page, sp(world.tenantId, world.spaceId, '/settings/members'));

    // spaceOwnerGuard redirects to the space root, not 404
    await expect(page).not.toHaveURL(/\/settings\/members/);
    await expect.soft(page.getByText(/Owner access required/i)).toBeVisible({ timeout: 6_000 });
  });

  test('owner can open owner-only space settings', async ({ world, pageAs, gotoSettled }) => {
    const page = await pageAs('owner');
    await gotoSettled(page, sp(world.tenantId, world.spaceId, '/settings/members'));

    await expect(page).toHaveURL(/\/settings\/members/);
    // members management surface is present (heading/region naming "member")
    await expect(page.getByText(/member/i).first()).toBeVisible();
  });

  test('viewer is denied import (editor-gated)', async ({ world, pageAs, gotoSettled }) => {
    const page = await pageAs('viewer');
    await gotoSettled(page, sp(world.tenantId, world.spaceId, '/import'));

    await expect(page).not.toHaveURL(/\/import/);
  });

  test('editor sees write controls that viewer does not', async ({
    world,
    pageAs,
    gotoSettled,
  }) => {
    const editor = await pageAs('editor');
    await gotoSettled(editor, sp(world.tenantId, world.spaceId, '/profiles/companies'));
    await expect(editor).toHaveURL(/\/profiles\/companies/);
    await expect(editor.getByRole('button', { name: /add compan/i })).toBeVisible();

    const viewer = await pageAs('viewer');
    await gotoSettled(viewer, sp(world.tenantId, world.spaceId, '/profiles/companies'));
    await expect(viewer).toHaveURL(/\/profiles\/companies/);
    // viewer can read the list but has no mutate affordance
    await expect(viewer.getByRole('button', { name: /add compan/i })).toHaveCount(0);
  });
});
