import { Locator, Page } from '@playwright/test';

/**
 * Open a row's `app-row-actions` menu and click the named menuitem.
 *
 * Two failure modes this guards against:
 *
 * 1. Menu never opens. The PrimeNG popup-menu portal is appended to body in
 *    a follow-up tick; under CI load `getByRole('menuitem')` occasionally
 *    times out without ever finding the item.
 * 2. Menu opens empty. Some pages cache the per-row MenuItem array on the
 *    first call -- if that call lands before SpaceRoleService.fetchRole
 *    resolves, `canEdit()` is still false and the cache locks in `[]`. The
 *    overlay then renders with no menuitems.
 *
 * Strategy: open the overlay, require at least one menuitem to be visible
 * within a short window, and retry from a fresh page reload if not (a
 * reload destroys the component instance and clears the menu cache).
 */
export async function clickRowAction(
  page: Page,
  row: Locator,
  actionLabel: string,
): Promise<void> {
  const trigger = row.locator('app-row-actions button').first();
  await trigger.waitFor({ state: 'visible', timeout: 10000 });

  for (let attempt = 0; attempt < 3; attempt++) {
    await trigger.click();
    const overlay = page.locator('.p-menu-overlay').last();
    try {
      await overlay.waitFor({ state: 'visible', timeout: 2000 });
      const menuItem = overlay.getByRole('menuitem', { name: actionLabel });
      await menuItem.waitFor({ state: 'visible', timeout: 2000 });
      await menuItem.click();
      return;
    } catch {
      // Either the overlay never opened or it opened empty. Close any
      // lingering overlay (Escape) and try again. On the last retry,
      // reload the page to reset the row's menu-item cache.
      await page.keyboard.press('Escape').catch(() => undefined);
      if (attempt === 1) {
        await page.reload({ waitUntil: 'networkidle' });
        await trigger.waitFor({ state: 'visible', timeout: 10000 });
      }
    }
  }

  // Final attempt: let the standard auto-wait surface the real failure.
  await trigger.click();
  await page.getByRole('menuitem', { name: actionLabel }).click();
}
