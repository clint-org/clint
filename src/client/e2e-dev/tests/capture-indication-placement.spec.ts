/**
 * Evidence capture for issue #171: by-indication bullseye placement. Seeds a
 * single asset spanning two indications at different stages (Obesity = P3, a
 * second indication lifted to APPROVED), then captures the by-indication bullseye
 * with the asset panel open. Before the fix both spokes plot at APPROVED (the
 * asset max); after, they plot at P3 and APPROVED respectively.
 *
 * Run HEADED: CAPTURE_OUT_DIR=/abs/dir ./e2e-dev/run.sh e2e-dev/tests/capture-indication-placement.spec.ts
 * Everything writes into a throwaway scratch space and is torn down afterwards.
 */
import { test, createScratchWorld, openAs, settle, type ScratchWorld } from '../fixtures';
import { seedDivergentIndicationStatus } from '../helpers/seed';
import * as path from 'node:path';

const OUT_DIR = process.env['CAPTURE_OUT_DIR'];
const SHOT = process.env['CAPTURE_SHOT'] ?? 'indication-placement.png';

test('capture by-indication bullseye placement (#171)', async ({ browser }) => {
  if (!OUT_DIR) throw new Error('CAPTURE_OUT_DIR is required');

  const world: ScratchWorld = await createScratchWorld();
  try {
    const seed = await seedDivergentIndicationStatus(world);
    const base = `/t/${world.tenantId}/s/${world.spaceId}`;
    const route =
      process.env['CAPTURE_ROUTE'] === 'heatmap'
        ? `${base}/heatmap/by-indication`
        : `${base}/bullseye?group=indication&product=${seed.assetId}`;
    const { page, context } = await openAs(browser, world, 'owner');
    try {
      await page.setViewportSize({ width: 1512, height: 900 });
      await settle(page, route);
      await page.waitForTimeout(1800);
      await page.screenshot({ path: path.join(OUT_DIR, SHOT), fullPage: true });
    } finally {
      await context.close();
    }
  } finally {
    await world.cleanup();
  }
});
