/**
 * Unauthenticated behaviour: protected routes bounce to /login, and the apex
 * default host serves the marketing landing. No session cookie is injected.
 */
import { test, expect, createScratchWorld, settle, type ScratchWorld } from '../fixtures';
import { DEV_APEX } from '../helpers/dev-env';

test.describe.configure({ mode: 'serial' });

test.describe('@anon unauthenticated', () => {
  let world: ScratchWorld;

  test.beforeAll(async () => {
    world = await createScratchWorld();
  });
  test.afterAll(async () => {
    await world?.cleanup();
  });

  test('protected space route redirects to login', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: world.baseURL });
    const page = await context.newPage();
    await settle(page, `/t/${world.tenantId}/s/${world.spaceId}/timeline`);
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });

  test('apex default host serves the marketing landing', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: `https://${DEV_APEX}` });
    const page = await context.newPage();
    await settle(page, '/');
    await expect(page.getByText(/Page not found/i)).toHaveCount(0);
    // not pushed into an authed space shell
    await expect(page).not.toHaveURL(/\/s\//);
    await context.close();
  });
});
