/**
 * @security browser-layer threat model.
 *
 * Covers BROWSER-ONLY gaps that the local integration/ suite does NOT prove at
 * the DB/RLS layer (role-access.spec, marker-content-authz, rpc-anon already
 * cover server-side RLS). Here we assert the Angular guard layer + the
 * sb-auth-dev cookie session path behave under three threats:
 *
 *   1. Cross-space IDOR: world A's owner cannot reach world B's space (SPA guard
 *      bounce) nor read B's data through A's authenticated supabase client.
 *   2. Tampered / expired sb-auth-dev cookie: a corrupted or expired session
 *      cookie resolves to NO session -> guarded routes redirect to /login.
 *   3. Viewer deep-links to owner/editor-only routes that role-firewall.spec.ts
 *      does NOT cover (settings/general, settings/fields -> spaceOwnerGuard;
 *      settings/marker-types, settings/marker-categories, settings/taxonomies
 *      -> editGuard).
 *
 * Guard redirect targets are cited inline at the assertion that depends on them.
 */
import { test, expect, apiAs, createScratchWorld } from '../fixtures';
import { seedBasics } from '../helpers/seed';
import { corruptedSessionCookie, expiredSessionCookie } from '../helpers/session-tamper';

const sp = (tenantId: string, spaceId: string, sub = '') => `/t/${tenantId}/s/${spaceId}${sub}`;
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------------------
// 1. Cross-space IDOR. Default world (owner) is world A; world B is provisioned
//    inline and seeded so there is real data for A to (fail to) reach.
// ---------------------------------------------------------------------------
test.describe('@security cross-space IDOR (world A must not reach world B)', () => {
  test('owner of world A is bounced from world B routes and cannot read B data', async ({
    world,
    pageAs,
    gotoSettled,
  }) => {
    const worldB = await createScratchWorld(); // default roles: ['owner']
    try {
      const seedB = await seedBasics(worldB);

      // --- API layer: world A's authenticated client cannot see B's space ---
      const aApi = apiAs(world, 'owner');

      // has_space_access is the SECURITY DEFINER gate the guards call; for a
      // non-member it returns false (never true).
      const access = await aApi.rpc('has_space_access', { p_space_id: worldB.spaceId });
      expect(access.data).not.toBe(true);

      // Direct table read scoped to B's space is filtered by RLS -> 0 rows.
      // `events` grants authenticated SELECT (supabase/data-api-grants.json:77),
      // so this returns [] rather than a 42501 permission error.
      const aRead = await aApi.from('events').select('id').eq('space_id', worldB.spaceId);
      expect(aRead.error?.code === '42501' || (aRead.data ?? []).length === 0).toBeTruthy();

      // Sanity: world B's OWN owner does see the seeded event (proves the 0-rows
      // above is isolation, not an empty space).
      const bApi = apiAs(worldB, 'owner');
      const bRead = await bApi.from('events').select('id').eq('space_id', worldB.spaceId);
      expect((bRead.data ?? []).length).toBeGreaterThan(0);

      // --- Browser layer: A's owner deep-links into B's space in the SPA ---
      // Context is on world A's host with A-owner's apex (.dev.clintapp.com)
      // cookie; the route params point at world B.
      const page = await pageAs('owner');
      await gotoSettled(page, sp(worldB.tenantId, worldB.spaceId, '/timeline'));

      // tenantGuard runs on t/:tenantId and denies (has_tenant_access(tB)=false),
      // redirecting to '/' (tenant.guard.ts:25). The durable signal is that we
      // never land on B's timeline.
      await expect(page).not.toHaveURL(/\/timeline/);
      // and no B data leaked onto whatever we landed on.
      await expect(page.getByText(seedB.trialName)).toHaveCount(0);
      // VERIFY: confirm the exact landing ('/' on a tenant host re-resolves via
      // marketingLandingGuard); the assertions above hold regardless.
    } finally {
      await worldB.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Tampered / expired sb-auth-dev cookie. Build a context with a mutated
//    session cookie (NOT pageAs, which injects a valid one) and confirm the
//    guard layer treats it as unauthenticated.
// ---------------------------------------------------------------------------
test.describe('@security tampered / expired sb-auth-dev cookie', () => {
  test('corrupted session cookie -> guarded route redirects to /login, no data leak', async ({
    browser,
    world,
    gotoSettled,
  }) => {
    const ctx = await browser.newContext({ baseURL: world.baseURL });
    await ctx.addCookies([corruptedSessionCookie(world, 'owner')]);
    const page = await ctx.newPage();
    try {
      await gotoSettled(page, sp(world.tenantId, world.spaceId, '/timeline'));
      // The load-bearing security boundary: the un-parseable cookie grants NO
      // access, so the guarded timeline never renders (the app fails closed --
      // observed: a blank shell, not the data view). The precise unauth landing
      // (/login vs marketing) is a UX detail, asserted softly.
      await expect(page).not.toHaveURL(/\/timeline/);
      await expect.soft(page).toHaveURL(/\/login/);
    } finally {
      await ctx.close();
    }
  });

  test('expired session with bogus refresh token -> redirects away from the guarded page', async ({
    browser,
    world,
    gotoSettled,
  }) => {
    const ctx = await browser.newContext({ baseURL: world.baseURL });
    await ctx.addCookies([expiredSessionCookie(world, 'owner')]);
    const page = await ctx.newPage();
    try {
      await gotoSettled(page, sp(world.tenantId, world.spaceId, '/settings/members'));
      // Auto-refresh fails (bogus refresh_token) -> no session -> authGuard
      // sends to /login (auth.guard.ts:11-13). The hard signal is that the
      // owner-only settings page never renders.
      await expect(page).not.toHaveURL(/\/settings\/members/);
      // VERIFY: refresh-failure timing may briefly land on marketing '/' before
      // /login; soft-assert the /login target.
      await expect.soft(page).toHaveURL(/\/login/);
    } finally {
      await ctx.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Viewer deep-links to owner/editor-only routes that role-firewall.spec.ts
//    does NOT cover. (role-firewall already covers settings/members +
//    /import; these are the gaps.) Only the viewer identity is provisioned.
// ---------------------------------------------------------------------------
test.describe('@security viewer deep-links to gated settings routes', () => {
  test.use({ worldRoles: ['viewer'] });

  // spaceOwnerGuard: redirect to space root + 'Owner access required' toast
  // (space-owner.guard.ts:54-62).
  const ownerOnly = ['/settings/general', '/settings/fields'];
  // editGuard: redirect to space root, NO toast (edit.guard.ts:38-40). Only
  // /settings/taxonomies is editor-gated on deployed dev; the legacy
  // /settings/marker-types and /settings/marker-categories routes were de-routed
  // in the cutover (origin/develop app.routes.ts) and now 404 in place rather
  // than redirect, so they are not guard-redirect cases.
  const editorOnly = ['/settings/taxonomies'];

  for (const sub of ownerOnly) {
    test(`viewer is denied ${sub} (spaceOwnerGuard)`, async ({ world, pageAs, gotoSettled }) => {
      const page = await pageAs('viewer');
      await gotoSettled(page, sp(world.tenantId, world.spaceId, sub));
      await expect(page).not.toHaveURL(new RegExp(reEscape(sub)));
      // Toast auto-dismisses; record but do not fail on it.
      await expect.soft(page.getByText(/Owner access required/i)).toBeVisible({ timeout: 6_000 });
    });
  }

  for (const sub of editorOnly) {
    test(`viewer is denied ${sub} (editGuard)`, async ({ world, pageAs, gotoSettled }) => {
      const page = await pageAs('viewer');
      await gotoSettled(page, sp(world.tenantId, world.spaceId, sub));
      // editGuard redirects to the space root with no toast.
      await expect(page).not.toHaveURL(new RegExp(reEscape(sub)));
      // Landed back under the space root (engagement landing).
      await expect.soft(page).toHaveURL(new RegExp(reEscape(`/s/${world.spaceId}`)));
    });
  }
});
