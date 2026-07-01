import { test, expect } from '@playwright/test';
import { createScratchWorld, openAs, settle } from '../fixtures';
import { seedCompanyLogos } from '../helpers/seed';

// Dedicated capture for issue #194 (company logo tiles). Unlike the generic
// capture.spec, the company tile only renders inside the bullseye asset detail
// panel, which is opened by the `?product=<assetId>` query param -- an id only
// known after seeding. Run for before/after via:
//   CAPTURE_OUT=/abs/before-dev.png ./e2e-dev/run.sh e2e-dev/tests/capture-company-logo.spec.ts
// (HEADED; never headless -- the Cloudflare challenge needs a real browser.)
test('capture company logo tile (#194)', async ({ browser }) => {
  const out = process.env['CAPTURE_OUT'];
  if (!out) throw new Error('CAPTURE_OUT is required');

  // CAPTURE_FIXED_DOMAIN=1 seeds the corrected Arrowhead domain, i.e. the shipped
  // resolution (code fix + data correction). Unset reproduces the blank tile.
  const fixDomains = !!process.env['CAPTURE_FIXED_DOMAIN'];

  const world = await createScratchWorld();
  try {
    const { arrowhead } = await seedCompanyLogos(world, { fixDomains });
    const { page, context } = await openAs(browser, world, 'owner');
    try {
      await settle(
        page,
        `/t/${world.tenantId}/s/${world.spaceId}/bullseye?product=${arrowhead.assetId}`
      );
      // The asset panel hosts the company tile; wait for it before shooting.
      const tile = page.locator('app-company-tile').first();
      await tile.waitFor({ state: 'attached', timeout: 15_000 });
      await page.waitForTimeout(1_500); // let the logo <img> settle (load or fail)

      const panel = page.locator('app-bullseye-detail-panel').first();
      if (await panel.count()) {
        await panel.screenshot({ path: out });
      } else {
        await page.screenshot({ path: out, fullPage: true });
      }
      expect(await tile.count()).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  } finally {
    await world.cleanup();
  }
});
