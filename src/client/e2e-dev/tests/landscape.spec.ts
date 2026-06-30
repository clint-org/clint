/**
 * Landscape suite beyond the bullseye: heatmap (multi-facet) and the Future
 * Events surface. Seeded once so the views render populated. The legacy
 * /catalysts path redirects to /future-events on dev (Stage 3 IA rename).
 */
import { test, expect, createScratchWorld, openAs, settle, type ScratchWorld } from '../fixtures';
import { seedBasics } from '../helpers/seed';

test.describe.configure({ mode: 'serial' });

test.describe('@landscape heatmap + future events', () => {
  let world: ScratchWorld;

  test.beforeAll(async () => {
    world = await createScratchWorld();
    await seedBasics(world);
  });
  test.afterAll(async () => {
    await world?.cleanup();
  });

  const path = (sub: string) => `/t/${world.tenantId}/s/${world.spaceId}${sub}`;

  test('heatmap renders without error', async ({ browser }) => {
    const { page, context } = await openAs(browser, world, 'owner');
    await settle(page, path('/heatmap'));
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/Page not found/i)).toHaveCount(0);
    // group-by facet controls present (MOA / Indication / Company / ROA)
    await expect(page.getByText(/MOA|Indication|Company/i).first()).toBeVisible();
    await context.close();
  });

  test('future events surface loads (catalysts redirect)', async ({ browser }) => {
    const { page, context } = await openAs(browser, world, 'owner');
    await settle(page, path('/catalysts'));
    await expect(page.getByText(/Page not found/i)).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/login/);
    await context.close();
  });

  // Regression guard for #158 / #166. Freezing the year/quarter header on scroll
  // set it to z-10, but markers also carry z-10 (marker.component) and come later
  // in the DOM -- so on vertical scroll the marker glyphs painted OVER the frozen
  // header instead of passing under it. The header must stay sticky AND outrank
  // every marker's z-index. (Structural assertion rather than a pixel snapshot:
  // deterministic and data-independent; the original miss came from verifying a
  // synthetic harness whose markers had no z-index.)
  test('timeline frozen header outranks markers on scroll', async ({ browser }) => {
    const { page, context } = await openAs(browser, world, 'owner');
    await settle(page, path('/timeline'));
    await expect(page).not.toHaveURL(/\/login/);

    const scroll = page.locator('[data-grid-scroll]');
    await expect(scroll).toBeVisible();
    const header = scroll.locator('app-grid-header');
    await expect(header).toBeVisible();
    // markers render on the lanes (the app-marker host is zero-size -- the glyph
    // is an absolutely-positioned child -- so assert attached, not visible).
    await expect(scroll.locator('app-marker').first()).toBeAttached();

    // header is frozen to the top of the scroll body
    expect(await header.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');

    // header z-index must exceed every marker's. Markers sit at z-10 (9999 only
    // while a tooltip is open); if the header drops to <= the marker z, glyphs
    // paint over it on scroll -- the #158 regression.
    const headerZ = await header.evaluate((el) => parseInt(getComputedStyle(el).zIndex || '0', 10));
    const maxMarkerZ = await scroll.evaluate((root) => {
      let max = 0;
      root.querySelectorAll('app-marker, app-marker *').forEach((el) => {
        const z = parseInt(getComputedStyle(el as HTMLElement).zIndex, 10);
        if (!Number.isNaN(z)) max = Math.max(max, z);
      });
      return max;
    });
    expect(maxMarkerZ).toBeGreaterThan(0); // sanity: a marker rendered with a z-index
    expect(headerZ).toBeGreaterThan(maxMarkerZ);

    await context.close();
  });
});
