/**
 * Ad-hoc capture for issue #168: the bullseye must recenter left of the detail
 * panel when an asset is clicked, instead of staying centered in the full width
 * with the 340px panel overlaying its right edge.
 *
 * Seeds one company/asset/trial so the bullseye renders a single clickable dot,
 * opens the panel by clicking it, waits for the slide + recenter transition to
 * settle, then screenshots. Run for BEFORE (current dev) and AFTER (fix deploy):
 *   CAPTURE_OUT=/abs/before-dev.png ./e2e-dev/run.sh \
 *     e2e-dev/tests/bullseye-panel-recenter-capture.spec.ts
 */
import { test, createScratchWorld, openAs, settle, type ScratchWorld } from '../fixtures';
import { seedBasics } from '../helpers/seed';

test('capture bullseye with detail panel open', async ({ browser }) => {
  const out = process.env.CAPTURE_OUT;
  if (!out) throw new Error('set CAPTURE_OUT to an absolute png path');

  const world = await createScratchWorld();
  try {
    await seedBasics(world);
    const { page, context } = await openAs(browser, world, 'owner');
    try {
      await settle(page, `/t/${world.tenantId}/s/${world.spaceId}/bullseye`);

      // Open the detail panel by clicking the seeded asset's dot.
      const dot = page.locator('.bullseye-dot').first();
      await dot.waitFor({ state: 'visible', timeout: 15_000 });
      await dot.click();

      // Wait for the panel to mount and the 200ms slide + recenter to finish.
      await page.locator('.landscape-panel-wrap').waitFor({ state: 'visible' });
      await page.waitForTimeout(600);

      await page.screenshot({ path: out, fullPage: true });
    } finally {
      await context.close();
    }
  } finally {
    await world.cleanup();
  }
});
