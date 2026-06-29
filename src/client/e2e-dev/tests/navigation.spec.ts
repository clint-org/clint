/**
 * App shell + navigation: engagement landing, sidebar nav, cross-page routing,
 * and the command palette. One shared world (read-only).
 */
import { test, expect, createScratchWorld, openAs, settle, type ScratchWorld } from '../fixtures';
import { seedBasics } from '../helpers/seed';

test.describe.configure({ mode: 'serial' });

test.describe('@nav app shell + navigation', () => {
  let world: ScratchWorld;

  test.beforeAll(async () => {
    world = await createScratchWorld();
    await seedBasics(world);
  });
  test.afterAll(async () => {
    await world?.cleanup();
  });

  const path = (sub: string) => `/t/${world.tenantId}/s/${world.spaceId}${sub}`;

  test('engagement landing loads with the sidebar nav', async ({ browser }) => {
    const { page, context } = await openAs(browser, world, 'owner');
    await settle(page, path(''));
    await expect(page).not.toHaveURL(/\/login/);
    // primary nav rail items observed on dev
    for (const label of ['Home', 'Timeline', 'Bullseye', 'Heatmap']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await context.close();
  });

  test('sidebar navigates timeline -> bullseye', async ({ browser }) => {
    const { page, context } = await openAs(browser, world, 'owner');
    await settle(page, path('/timeline'));
    await page.getByText('Bullseye', { exact: true }).first().click();
    await expect(page).toHaveURL(/\/bullseye/);
    await context.close();
  });

  test('command palette opens with the keyboard shortcut and closes on Escape', async ({
    browser,
  }) => {
    const { page, context } = await openAs(browser, world, 'owner');
    await settle(page, path('/timeline'));
    await page.keyboard.press('Meta+k');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await context.close();
  });
});
