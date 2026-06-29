/**
 * Landscape suite beyond the bullseye: heatmap (multi-facet) and the Future
 * Events surface. Seeded once so the views render populated. The legacy
 * /catalysts path redirects to /future-events on dev (Stage 3 IA rename).
 */
import { test, expect, createScratchWorld, openAs, settle, type ScratchWorld } from '../fixtures';
import { seedBasics } from '../helpers/seed';

test.describe.configure({ mode: 'serial' });

test.describe('@landscape heatmap + future events', () => {
  let world: ScratchWorld;

  test.beforeAll(async () => {
    world = await createScratchWorld();
    await seedBasics(world);
  });
  test.afterAll(async () => {
    await world?.cleanup();
  });

  const path = (sub: string) => `/t/${world.tenantId}/s/${world.spaceId}${sub}`;

  test('heatmap renders without error', async ({ browser }) => {
    const { page, context } = await openAs(browser, world, 'owner');
    await settle(page, path('/heatmap'));
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/Page not found/i)).toHaveCount(0);
    // group-by facet controls present (MOA / Indication / Company / ROA)
    await expect(page.getByText(/MOA|Indication|Company/i).first()).toBeVisible();
    await context.close();
  });

  test('future events surface loads (catalysts redirect)', async ({ browser }) => {
    const { page, context } = await openAs(browser, world, 'owner');
    await settle(page, path('/catalysts'));
    await expect(page.getByText(/Page not found/i)).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/login/);
    await context.close();
  });
});
