/**
 * Timeline export: the Export menu offers PowerPoint / Image (PNG) / Excel, and
 * the PNG path produces a valid image blob. Captured via a URL.createObjectURL
 * hook (no disk write), the same technique as e2e/helpers/export-capture.helper.
 */
import { test, expect, createScratchWorld, openAs, settle, type ScratchWorld } from '../fixtures';
import { seedBasics } from '../helpers/seed';

test.describe.configure({ mode: 'serial' });

interface CapturedBlob {
  type: string;
  size: number;
}
declare global {
  interface Window {
    __exportBlobs?: CapturedBlob[];
  }
}

test.describe('@export timeline export', () => {
  let world: ScratchWorld;

  test.beforeAll(async () => {
    world = await createScratchWorld();
    await seedBasics(world);
  });
  test.afterAll(async () => {
    await world?.cleanup();
  });

  test('PNG export produces an image blob', async ({ browser }) => {
    const { page, context } = await openAs(browser, world, 'owner');
    await context.addInitScript(() => {
      window.__exportBlobs = [];
      const orig = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (obj: Blob | MediaSource): string => {
        if (obj instanceof Blob) window.__exportBlobs!.push({ type: obj.type, size: obj.size });
        return orig(obj as Blob);
      };
    });

    await settle(page, `/t/${world.tenantId}/s/${world.spaceId}/timeline`);

    await page
      .getByRole('button', { name: /export/i })
      .first()
      .click();
    await page
      .getByRole('menuitem', { name: /image|png/i })
      .first()
      .click();

    await expect
      .poll(
        () =>
          page.evaluate(() =>
            window.__exportBlobs?.some((b) => b.type.includes('png') && b.size > 1000)
          ),
        {
          timeout: 30_000,
        }
      )
      .toBeTruthy();

    await context.close();
  });
});
