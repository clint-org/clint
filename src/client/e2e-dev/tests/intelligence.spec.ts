/**
 * Intelligence section: the feed page and its sub-tab bar (Intelligence |
 * Intelligence Feed | Activity | Materials per TP-007). Empty scratch space, so
 * the feed shows its empty state; the surfaces must load (no 404 / no login bounce).
 */
import { test, expect, createScratchWorld, openAs, settle, type ScratchWorld } from '../fixtures';

test.describe.configure({ mode: 'serial' });

test.describe('@intelligence feed + activity + materials', () => {
  let world: ScratchWorld;

  test.beforeAll(async () => {
    world = await createScratchWorld();
  });
  test.afterAll(async () => {
    await world?.cleanup();
  });

  const path = (sub: string) => `/t/${world.tenantId}/s/${world.spaceId}${sub}`;

  test('intelligence feed loads', async ({ browser }) => {
    const { page, context } = await openAs(browser, world, 'owner');
    await settle(page, path('/intelligence'));
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/Page not found/i)).toHaveCount(0);
    await context.close();
  });

  test('activity page loads (no 404)', async ({ browser }) => {
    const { page, context } = await openAs(browser, world, 'owner');
    await settle(page, path('/activity'));
    await expect(page.getByText(/Page not found/i)).toHaveCount(0);
    await context.close();
  });

  test('materials browser loads', async ({ browser }) => {
    const { page, context } = await openAs(browser, world, 'owner');
    await settle(page, path('/materials'));
    await expect(page.getByText(/Page not found/i)).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/login/);
    await context.close();
  });
});
