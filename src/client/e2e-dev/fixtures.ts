/**
 * Playwright fixtures for the dev-targeted regression suite.
 *
 * `world`      a fresh scratch agency/tenant/space + role users, provisioned per
 *              test and torn down after (even on failure). Maximal isolation, no
 *              db reset. For read-only specs that want to share one world across
 *              many tests, call createScratchWorld() in a beforeAll instead.
 *
 * `pageAs`     factory that opens a browser context authenticated as a given role
 *              (owner/editor/viewer/nonMember) at the world's tenant host, with the
 *              sb-auth-dev session cookie pre-injected. Contexts are closed on teardown.
 *
 * `gotoSettled` navigate + wait for the Cloudflare JS challenge to clear and the
 *              SPA to settle. Runs HEADED (headless never clears the challenge).
 */

import { test as base, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  createScratchWorld,
  userFor,
  type RoleName,
  type ScratchWorld,
} from './helpers/scratch-world';
import { sessionCookie } from './helpers/auth-cookie';

export { createScratchWorld, apiAs, userFor } from './helpers/scratch-world';
export type { RoleName, ScratchWorld, RoleUser } from './helpers/scratch-world';

/**
 * Open a browser context authenticated as a role at the world's host. For specs
 * that share one (optionally seeded) world across many read-only tests via
 * beforeAll/afterAll, instead of the per-test `world` fixture.
 */
export async function openAs(
  browser: Browser,
  world: ScratchWorld,
  role: RoleName
): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({ baseURL: world.baseURL });
  await context.addCookies([sessionCookie(userFor(world, role).session)]);
  return { page: await context.newPage(), context };
}

/** Navigate + clear Cloudflare + let the SPA settle. */
export async function settle(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await waitForCloudflare(page);
  await page.waitForLoadState('networkidle').catch(() => {});
  await dismissEnvBadge(page);
}

/**
 * Dismiss the dev/local environment badge (app-env-banner). It is a `fixed`
 * bottom-right z-50 overlay that intercepts pointer events on bottom-anchored
 * controls (e.g. the import review "Confirm" button). The dismiss state is an
 * in-memory signal in the app shell (app.component), so one click persists
 * across SPA route changes within the same page load. Best-effort: no-op if the
 * badge is absent (prod build) or already dismissed.
 */
export async function dismissEnvBadge(page: Page): Promise<void> {
  const badge = page.getByRole('button', { name: /Dismiss the (DEV|LOCAL) environment badge/ });
  if (await badge.count().catch(() => 0)) {
    await badge
      .first()
      .click({ timeout: 2000 })
      .catch(() => {});
  }
}

export interface DevFixtures {
  /** Roles to provision for the `world` fixture. Override per spec with
   *  test.use({ worldRoles: [...] }). Default: owner only (least auth traffic). */
  worldRoles: RoleName[];
  world: ScratchWorld;
  pageAs: (role: RoleName) => Promise<Page>;
  gotoSettled: (page: Page, path: string) => Promise<void>;
}

export const test = base.extend<DevFixtures>({
  worldRoles: [['owner'], { option: true }],

  world: async ({ worldRoles }, use) => {
    const world = await createScratchWorld({ roles: worldRoles });
    try {
      await use(world);
    } finally {
      await world.cleanup();
    }
  },

  pageAs: async ({ browser, world }, use) => {
    const contexts: BrowserContext[] = [];
    const factory = async (role: RoleName): Promise<Page> => {
      const { page, context } = await openAs(browser, world, role);
      contexts.push(context);
      return page;
    };
    await use(factory);
    for (const ctx of contexts) await ctx.close().catch(() => {});
  },

  gotoSettled: async ({}, use) => {
    await use(settle);
  },
});

/** Poll until the Cloudflare interstitial title disappears (headed auto-solves). */
export async function waitForCloudflare(page: Page, maxSeconds = 25): Promise<void> {
  for (let i = 0; i < maxSeconds; i++) {
    const title = await page.title().catch(() => '');
    if (!/just a moment|attention required|checking your browser/i.test(title)) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(
    'Cloudflare challenge did not clear in time. The suite must run HEADED ' +
      '(headless never clears it); on a datacenter-IP CI runner a Cloudflare WAF bypass is required.'
  );
}

export { expect } from '@playwright/test';
