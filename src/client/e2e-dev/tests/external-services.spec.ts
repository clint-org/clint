/**
 * External-service flows isolated here so a ct.gov hiccup or AI latency never
 * fails the core suite. SCAFFOLDS (test.fixme): these hit live services and need
 * harness extensions before they can run green:
 *   - AI import needs the scratch tenant's ai_config.ai_enabled = true
 *     (importGuard + the worker both require it). seedBasics does not enable it.
 *   - ct.gov sync hits clinicaltrials.gov; pin a known-stable NCT and use
 *     generous timeouts + retries.
 *
 * Sources: TP-005 (ct.gov sync) + import/dedup TPs in docs/notes/event-model-qa-*.md.
 */
import { test, expect } from '../fixtures';
import { seedBasics } from '../helpers/seed';

test.describe('@external ct.gov + AI import', () => {
  test.fixme('ct.gov sync creates the three clinical events on a trial', async ({
    world,
    pageAs,
    gotoSettled,
  }) => {
    const seed = await seedBasics(world); // trial seeded with NCT09999999 -> use a real NCT
    const page = await pageAs('owner');
    await gotoSettled(
      page,
      `/t/${world.tenantId}/s/${world.spaceId}/profiles/trials/${seed.trialId}`
    );
    // open the CT.GOV panel -> Sync -> "Sync from CT.gov queued"; within ~seconds
    // 3 clinical events (Trial Start / Primary Completion / Trial End) appear,
    // tagged CT.GOV, and the trial START/END populate. (TP-005)
    expect(true).toBeTruthy();
  });

  test.fixme('AI import resolves an NCT and dedups a re-import', async ({
    world,
    pageAs,
    gotoSettled,
  }) => {
    // Requires ai_config.ai_enabled on the scratch tenant. /import NCT list ->
    // Fetch and resolve -> review (company/asset/trial, "New N") -> Confirm ->
    // entities + unified clinical events seeded. Re-import same NCT -> "N of N
    // NCTs already in this space" + "Proceed with 0 new trials".
    const page = await pageAs('owner');
    await gotoSettled(page, `/t/${world.tenantId}/s/${world.spaceId}/import`);
    expect(true).toBeTruthy();
  });
});
