/**
 * Activity page filter controls (#192), driven against deployed dev.
 *
 * The static capture only proved the controls render; this exercises them:
 *  - free-text search matches text that lives ONLY in the change payload (a drug
 *    name), which is the bug the payload-search migration fixes;
 *  - the Source column filter narrows to a single change source;
 *  - the Type column filter narrows to a single change type.
 *
 * Seeds a known spread (3 CT.gov / 2 analyst / 1 import; 2 status_changed; one
 * intervention_changed carrying "Tirzepatide 15mg" only in its payload) so every
 * assertion is deterministic. Everything is torn down with the scratch world.
 */
import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { seedActivityDetectedChanges } from '../helpers/seed';

test.use({ worldRoles: ['owner'] });

const sp = (tenantId: string, spaceId: string, sub = '') => `/t/${tenantId}/s/${spaceId}${sub}`;

/** The Activity detected-change rows (each is a role="button" table row). */
function rows(page: Page) {
  return page.locator('table tbody tr[role="button"]');
}

/** Open a column filter menu by header name and pick an option by label. */
async function pickColumnFilter(page: Page, header: string, optionLabel: string): Promise<void> {
  const th = page.locator('th', { hasText: header });
  await th.locator('button.p-column-filter-menu-button').click();
  const overlay = page.locator('.p-column-filter-overlay, .p-columnfilter-overlay').last();
  await overlay.locator('.p-select, .p-dropdown').click();
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
  // Apply: overlay has an Apply button; fall back to closing via Escape.
  const apply = overlay.getByRole('button', { name: /apply/i });
  if (await apply.count()) await apply.first().click();
  await page.waitForLoadState('networkidle').catch(() => {});
}

test('Activity filters: search reaches payload text, Source + Type narrow the log', async ({
  world,
  pageAs,
  gotoSettled,
}) => {
  await seedActivityDetectedChanges(world);
  const page = await pageAs('owner');

  await gotoSettled(page, sp(world.tenantId, world.spaceId, '/activity'));

  // Baseline: all six seeded detected changes render.
  await expect(rows(page)).toHaveCount(6);

  const search = page.getByRole('textbox', { name: 'Search activity...' });

  // The fix: "Tirzepatide" appears only in the intervention_changed payload, not
  // in the RPC title -- but it is what the Change column shows. Search must find it.
  await search.fill('Tirzepatide');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Tirzepatide');

  // A no-match query shows the filtered empty state (not the "nothing yet" one).
  await search.fill('zzz-no-such-change');
  await expect(page.getByText('No detected changes match your filters.')).toBeVisible();

  // Clearing search restores the full log.
  await search.fill('');
  await expect(rows(page)).toHaveCount(6);

  // Source column filter -> Analyst: exactly the two analyst rows remain.
  await pickColumnFilter(page, 'Source', 'Analyst');
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByText('Analyst', { exact: true }).first()).toBeVisible();

  // Reload to clear filters, then narrow by Type -> Status changed: two rows.
  await gotoSettled(page, sp(world.tenantId, world.spaceId, '/activity'));
  await expect(rows(page)).toHaveCount(6);
  await pickColumnFilter(page, 'Type', 'Status changed');
  await expect(rows(page)).toHaveCount(2);
});
