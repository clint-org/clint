/**
 * Help / reference pages render their editorial content (markers, phases,
 * taxonomies at space scope; roles at tenant scope).
 */
import { test, expect, createScratchWorld, openAs, settle, type ScratchWorld } from '../fixtures';

test.describe.configure({ mode: 'serial' });

test.describe('@help reference pages', () => {
  let world: ScratchWorld;

  test.beforeAll(async () => {
    world = await createScratchWorld();
  });
  test.afterAll(async () => {
    await world?.cleanup();
  });

  const spacePath = (sub: string) => `/t/${world.tenantId}/s/${world.spaceId}${sub}`;

  test('space help pages load', async ({ browser }) => {
    const { page, context } = await openAs(browser, world, 'owner');
    for (const sub of ['/help/markers', '/help/phases', '/help/taxonomies']) {
      await settle(page, spacePath(sub));
      await expect(page.getByText(/Page not found/i)).toHaveCount(0);
      await expect(page).not.toHaveURL(/\/login/);
    }
    await context.close();
  });

  test('tenant roles help loads', async ({ browser }) => {
    const { page, context } = await openAs(browser, world, 'owner');
    await settle(page, `/t/${world.tenantId}/help/roles`);
    await expect(page.getByText(/role|owner|editor|viewer/i).first()).toBeVisible();
    await context.close();
  });
});
