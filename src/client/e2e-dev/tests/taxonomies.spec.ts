/**
 * Taxonomy admin (editor-gated): the Taxonomies settings page loads its tabbed
 * surface (Indications / MOA / ROA, plus Event Types / Event Categories on dev's
 * event-model build). Viewer is denied (covered in role-firewall via editGuard).
 */
import { test, expect, createScratchWorld, openAs, settle, type ScratchWorld } from '../fixtures';

test.describe.configure({ mode: 'serial' });

test.describe('@taxonomy taxonomy admin', () => {
  let world: ScratchWorld;

  test.beforeAll(async () => {
    world = await createScratchWorld({ roles: ['editor'] });
  });
  test.afterAll(async () => {
    await world?.cleanup();
  });

  test('editor opens the taxonomies settings page', async ({ browser }) => {
    const { page, context } = await openAs(browser, world, 'editor');
    await settle(page, `/t/${world.tenantId}/s/${world.spaceId}/settings/taxonomies`);
    await expect(page).toHaveURL(/\/settings\/taxonomies/);
    await expect(page.getByText(/Page not found/i)).toHaveCount(0);
    // tabbed taxonomy surface
    await expect(page.getByText(/Indication|MOA|ROA/i).first()).toBeVisible();
    await context.close();
  });
});
