import { test } from '@playwright/test';
import { createScratchWorld, openAs, settle } from '../fixtures';
import { captureParamsFromEnv } from '../helpers/capture.mjs';
import * as seeds from '../helpers/seed';

// Single ad-hoc capture driven by env vars. Run via:
//   CAPTURE_PATH=/timeline CAPTURE_OUT=/abs/before-dev.png ./e2e-dev/run.sh e2e-dev/tests/capture.spec.ts
test('capture dev surface', async ({ browser }) => {
  const params = captureParamsFromEnv(process.env);
  const world = await createScratchWorld();
  try {
    if (params.seed) {
      const fn = (seeds as Record<string, unknown>)[params.seed];
      if (typeof fn !== 'function') throw new Error(`unknown CAPTURE_SEED: ${params.seed}`);
      await (fn as (w: typeof world) => Promise<void>)(world);
    }
    const { page, context } = await openAs(browser, world, 'owner');
    try {
      // A CAPTURE_PATH that is not already tenant- or admin-rooted is treated as
      // a space sub-path and resolved against the scratch world, so space-scoped
      // surfaces (e.g. /activity) can be captured without hardcoding the dynamic
      // tenant/space ids.
      const rooted = /^\/(t|admin|super-admin)(\/|$)/.test(params.path);
      const path = rooted
        ? params.path
        : `/t/${world.tenantId}/s/${world.spaceId}${params.path.startsWith('/') ? '' : '/'}${params.path}`;
      await settle(page, path);
      await page.screenshot({ path: params.out, fullPage: true });
    } finally {
      await context.close();
    }
  } finally {
    await world.cleanup();
  }
});
