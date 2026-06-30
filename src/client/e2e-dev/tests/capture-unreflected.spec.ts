/**
 * Ad-hoc evidence capture for issue #159 (approval/launch stage lift). Seeds an
 * asset with an actual asset-anchored Approval whose indication is unmapped, then
 * captures the three UX surfaces that change with the fix:
 *   1. asset-profile.png  -- the asset profile's amber "approval not reflected" diagnostic
 *   2. bullseye-panel.png -- the bullseye side panel's matching diagnostic (deep-linked ?product=)
 *   3. event-form.png     -- the Log Event form: INDICATION (LIFTS STAGE) picker + soft-warn hint
 *
 * Run HEADED (Cloudflare): CAPTURE_OUT_DIR=/abs/dir ./e2e-dev/run.sh e2e-dev/tests/capture-unreflected.spec.ts
 * Everything writes into a throwaway scratch space and is torn down afterwards.
 */
import { test, createScratchWorld, openAs, settle, type ScratchWorld } from '../fixtures';
import { seedUnreflectedApproval, type SeedIds } from '../helpers/seed';
import * as path from 'node:path';

const OUT_DIR = process.env['CAPTURE_OUT_DIR'];

test('capture unreflected-approval evidence (#159)', async ({ browser }) => {
  if (!OUT_DIR) throw new Error('CAPTURE_OUT_DIR is required');
  const out = (name: string): string => path.join(OUT_DIR, name);

  const world: ScratchWorld = await createScratchWorld();
  try {
    const seed: SeedIds = await seedUnreflectedApproval(world);
    const sp = (sub: string): string => `/t/${world.tenantId}/s/${world.spaceId}${sub}`;
    const { page, context } = await openAs(browser, world, 'owner');
    try {
      // 1. Asset-profile diagnostic.
      await settle(page, sp(`/profiles/assets/${seed.assetId}`));
      await page.screenshot({ path: out('asset-profile.png'), fullPage: true });

      // 2. Bullseye side-panel diagnostic (deep-link opens the panel for the asset).
      await settle(page, sp(`/bullseye?product=${seed.assetId}`));
      await page.waitForTimeout(1500);
      await page.screenshot({ path: out('bullseye-panel.png'), fullPage: true });

      // 3. Log Event form: indication picker + soft-warn (best-effort; the two
      // diagnostics above are already saved if the dialog selectors drift).
      try {
        await settle(page, sp(`/profiles/assets/${seed.assetId}`));
        await page.getByRole('button', { name: /Add event/i }).first().click();
        await page.getByText('Select an event type to start').click();
        await page.keyboard.type('Approval');
        await page.waitForTimeout(500);
        // Two matches render: a bold category header and the selectable type.
        // The last is the type; selecting it closes the dropdown and renders the
        // INDICATION (LIFTS STAGE) picker + soft-warn hint -- that is the evidence.
        await page.getByRole('option', { name: /^Approval$/ }).last().click();
        await page
          .getByText(/won't update the asset's stage/i)
          .waitFor({ state: 'visible', timeout: 5000 });
        await page.screenshot({ path: out('event-form.png'), fullPage: true });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('event-form capture skipped:', (e as Error).message);
      }
    } finally {
      await context.close();
    }
  } finally {
    await world.cleanup();
  }
});
