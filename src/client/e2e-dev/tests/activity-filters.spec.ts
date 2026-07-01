/**
 * Activity page filter controls (#192), driven against deployed dev.
 *
 * The feature IS the filters, so this exercises EVERY control end-to-end:
 *  - global search matches text that lives ONLY in the change payload (a drug
 *    name), the bug the payload-search migration fixes;
 *  - the Logged column's date-range picker narrows by date (the bug where the
 *    old single-date match-mode menu was silently dropped);
 *  - the Source column filter narrows to a single change source;
 *  - the Type column filter narrows to a single change type.
 *
 * It also asserts the browser console stays clean throughout -- a row that
 * throws in the change-summary util silently drops from the table, so a passing
 * count is meaningless without a console guard.
 *
 * Seeds a known spread (3 CT.gov / 2 analyst / 1 import; 2 status_changed; one
 * intervention_changed carrying "Tirzepatide 15mg" only in its payload; all rows
 * dated Feb 2026) so every assertion is deterministic. Torn down with the world.
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

/** Open a select column filter menu by header name and pick an option by label. */
async function pickSelectFilter(page: Page, header: string, optionLabel: string): Promise<void> {
  const colHeader = page.getByRole('columnheader', { name: new RegExp(`^${header}`) });
  await colHeader.getByRole('button', { name: 'Show Filter Menu' }).click();
  await page.locator('.p-select').last().click();
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
  await page.keyboard.press('Escape');
  await page.waitForLoadState('networkidle').catch(() => {});
}

/** Click the toolbar "Clear filters" chip and wait for the reset fetch. */
async function clearFilters(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Clear filters/ }).click();
  await page.waitForLoadState('networkidle').catch(() => {});
}

test('Activity filters: search, Logged date range, Source, Type all narrow the log', async ({
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
  await expect(rows(page)).toHaveCount(6);

  // --- Search: reaches payload-only text (the Tirzepatide intervention row) ---
  const search = page.getByRole('textbox', { name: 'Search activity...' });
  await search.fill('Tirzepatide');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Tirzepatide');
  await search.fill('zzz-no-such-change');
  await expect(page.getByText('No detected changes match your filters.')).toBeVisible();
  await search.fill('');
  await expect(rows(page)).toHaveCount(6);

  // --- Logged date range: pick a range in the CURRENT month (no seeded rows,
  //     which are all Feb 2026) via the range picker -> zero rows. This is the
  //     path that used to silently drop the filter. ---
  const logged = page.getByRole('columnheader', { name: /^Logged/ });
  await logged.getByRole('button', { name: 'Show Filter Menu' }).click();
  const calendar = page.locator('.p-datepicker-panel');
  await calendar.waitFor();
  await calendar.getByRole('gridcell', { name: '1', exact: true }).first().click();
  await calendar.getByRole('gridcell', { name: '28', exact: true }).first().click();
  await page.keyboard.press('Escape');
  await page.waitForLoadState('networkidle').catch(() => {});
  await expect(rows(page)).toHaveCount(0);
  await clearFilters(page);
  await expect(rows(page)).toHaveCount(6);

  // --- Source -> Analyst: the two analyst rows. ---
  await pickSelectFilter(page, 'Source', 'Analyst');
  await expect(rows(page)).toHaveCount(2);
  await clearFilters(page);
  await expect(rows(page)).toHaveCount(6);

  // --- Type -> Status changed: the two status_changed rows. ---
  await pickSelectFilter(page, 'Type', 'Status changed');
  await expect(rows(page)).toHaveCount(2);

  // No row may have thrown during any of the above.
  expect(consoleErrors, `unexpected console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
});
