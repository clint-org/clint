/**
 * Populated read surfaces. One scratch world, seeded once with a company ->
 * asset -> Phase 3 trial -> clinical event, shared across read-only assertions.
 * Proves the real data path (create_* RPCs -> get_dashboard_data -> render),
 * not just empty states.
 */
import { test, expect, createScratchWorld, openAs, settle, type ScratchWorld } from '../fixtures';
import { seedBasics, type SeedIds } from '../helpers/seed';

test.describe.configure({ mode: 'serial' });

test.describe('@seeded populated views', () => {
  let world: ScratchWorld;
  let seed: SeedIds;

  test.beforeAll(async () => {
    world = await createScratchWorld();
    seed = await seedBasics(world);
  });
  test.afterAll(async () => {
    await world?.cleanup();
  });

  const path = (sub: string) => `/t/${world.tenantId}/s/${world.spaceId}${sub}`;

  test('profiles list the seeded company, asset and trial', async ({ browser }) => {
    const { page, context } = await openAs(browser, world, 'owner');

    await settle(page, path('/profiles/companies'));
    await expect(page.getByText(seed.companyName)).toBeVisible();

    await settle(page, path('/profiles/assets'));
    await expect(page.getByText(seed.assetName)).toBeVisible();

    await settle(page, path('/profiles/trials'));
    await expect(page.getByText(seed.trialName)).toBeVisible();

    await context.close();
  });

  test('timeline renders trial data (no empty state)', async ({ browser }) => {
    const { page, context } = await openAs(browser, world, 'owner');
    await settle(page, path('/timeline'));
    await expect(page.getByText('No clinical trial data to display', { exact: false })).toHaveCount(
      0
    );
    await context.close();
  });

  test('bullseye renders the seeded asset (no empty state)', async ({ browser }) => {
    const { page, context } = await openAs(browser, world, 'owner');
    await settle(page, path('/bullseye'));
    await expect(page.getByText('No assets match', { exact: false })).toHaveCount(0);
    await context.close();
  });
});
