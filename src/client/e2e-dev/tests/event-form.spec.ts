/**
 * Merged event form (create / edit / re-anchor / re-type). SCAFFOLD: the flow
 * and assertions are taken verbatim from the verified TPs, but the trial-detail
 * dialog selectors need one headed verification pass before this is enabled.
 * Event creation itself is already exercised at the RPC layer by seedBasics().
 *
 * Source: TP-009 (detail panel) + QA-004 (merged EDIT dialog) in
 * docs/notes/event-model-qa-*.md.
 */
import { test, expect } from '../fixtures';
import { seedBasics } from '../helpers/seed';

test.describe('@event merged event form', () => {
  test.fixme('owner logs an event via the merged dialog and sees its glyph', async ({
    world,
    pageAs,
    gotoSettled,
  }) => {
    const seed = await seedBasics(world);
    const page = await pageAs('owner');
    await gotoSettled(
      page,
      `/t/${world.tenantId}/s/${world.spaceId}/profiles/trials/${seed.trialId}`
    );

    // type-first picker -> title/anchor/date-precision/date(calendar)/advanced
    await page.getByRole('button', { name: /add event|log event/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // ... pick type, set title, pick date on the calendar, set significance=High, submit
    // assert: the new event glyph appears on the trial timeline + in the events table.
  });

  test.fixme('detail-panel EDIT opens the merged dialog with anchor selectors (re-anchor)', async () => {
    // TP/QA-004: trial-detail event row -> EDIT -> merged "EDIT EVENT" dialog with
    // Trial/Asset/Company anchor selectors; change anchor + type; assert update +
    // an Activity 'updated' row. ct.gov-derived events show date/source read-only.
  });
});
