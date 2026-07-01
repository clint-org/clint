/**
 * Activity page filter controls (#192), driven against deployed dev.
 *
 * The static capture only proved the controls render; this exercises them:
 *  - free-text search matches text that lives ONLY in the change payload (a drug
 *    name), which is the bug the payload-search migration fixes;
 *  - the Source column filter narrows to a single change source;
 *  - the Type column filter narrows to a single change type.
 *
 * It also asserts the browser console stays clean throughout -- a row that
 * throws in the change-summary util silently drops from the table, so a passing
 * count is meaningless without a console guard.
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
  const colHeader = page.getByRole('columnheader', { name: new RegExp(`^${header}`) });
  await colHeader.getByRole('button', { name: 'Show Filter Menu' }).click();
  // The filter menu's p-select trigger, then the option.
  await page.locator('.p-select').last().click();
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
  // Selecting applies the filter (filterCallback); dismiss the overlay so it
  // does not intercept subsequent row assertions.
  await page.keyboard.press('Escape');
  await page.waitForLoadState('networkidle').catch(() => {});
}

test('Activity filters: search reaches payload text, Source + Type narrow the log', async ({
  world,
  pageAs,
  gotoSettled,
}) => {
  await seedActivityDetectedChanges(world);
  const page = await pageAs('owner');

  // Capture console errors + uncaught exceptions for the whole run. A row that
  // throws in getDetectedSummary drops silently, so this is the real guard.
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

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

  // Clear filters (grid persists them to the URL, so a reload would restore the
  // Source filter -- the toolbar's Clear is the reset affordance), back to six.
  await page.getByRole('button', { name: /Clear filters/ }).click();
  await expect(rows(page)).toHaveCount(6);

  // Narrow by Type -> Status changed: the two status_changed rows.
  await pickColumnFilter(page, 'Type', 'Status changed');
  await expect(rows(page)).toHaveCount(2);

  // No row may have thrown during any of the above.
  expect(consoleErrors, `unexpected console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
});
