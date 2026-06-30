/**
 * Ad-hoc evidence capture for issue #175 (timeline stale after an event edit).
 * Seeds a trial with a 'Topline readout' event, opens the trial-detail page,
 * renames the event via the merged Edit dialog, then screenshots the WHOLE page
 * after the edit. The page shows both surfaces at once:
 *   - the event TABLE (entity-events-section) -- always reflects the edit
 *   - the embedded TIMELINE (app-timeline-view) -- pre-fix keeps the old title
 *
 * before-dev.png (current dev, no fix): the timeline marker still reads "Topline
 *   readout" while the table shows the renamed title -- the bug.
 * after-dev.png  (fixed dev): the timeline marker reads the renamed title too.
 *
 * Run HEADED (Cloudflare): CAPTURE_OUT=/abs/before-dev.png ./e2e-dev/run.sh \
 *   e2e-dev/tests/capture-timeline-stale.spec.ts
 * Everything writes into a throwaway scratch world and is torn down afterwards.
 */
import { test, createScratchWorld, openAs, settle, type ScratchWorld } from '../fixtures';
import { seedBasics } from '../helpers/seed';

const OUT = process.env['CAPTURE_OUT'];
const RENAMED = 'Topline readout (edited via dialog)';

test('capture timeline-stale-after-edit evidence (#175)', async ({ browser }) => {
  if (!OUT) throw new Error('CAPTURE_OUT is required');

  const world: ScratchWorld = await createScratchWorld();
  try {
    const seed = await seedBasics(world);
    const path = `/t/${world.tenantId}/s/${world.spaceId}/profiles/trials/${seed.trialId}`;
    const { page, context } = await openAs(browser, world, 'owner');
    try {
      await settle(page, path);

      // Rename the event via the merged "Edit event" dialog (keeps the trial anchor).
      const actions = page.getByLabel('Actions for event Topline readout', { exact: true });
      await actions.waitFor({ state: 'visible', timeout: 15_000 });
      await actions.click();
      await page.getByRole('menuitem', { name: /^Edit$/ }).click();
      const editDialog = page.getByRole('dialog', { name: /edit event/i });
      await editDialog.waitFor({ state: 'visible' });
      await editDialog.locator('#ev-title').fill(RENAMED);
      await editDialog.getByRole('button', { name: /^Update event$/ }).click();
      await editDialog.waitFor({ state: 'hidden' });

      // Let the (changed) handler settle (table refetch + landscape reload post-fix).
      await page.waitForTimeout(2000);

      // The marker glyph shows no inline title at this density; its title only
      // surfaces on hover. Hover the Topline marker so the tooltip exposes the
      // title the timeline currently holds: pre-fix "Topline readout" (stale),
      // post-fix the renamed title. The aria-label substring matches both states.
      const marker = page
        .locator('app-timeline-view [role="button"][aria-label*="Topline"]')
        .first();
      await marker.waitFor({ state: 'visible', timeout: 15_000 });
      await marker.hover();
      await page.waitForTimeout(800);
      // Viewport (not fullPage) screenshot: fullPage scrolls the page to stitch,
      // which dismisses the hover tooltip. The timeline + toast are above the fold.
      await page.screenshot({ path: OUT });
    } finally {
      await context.close();
    }
  } finally {
    await world.cleanup();
  }
});
