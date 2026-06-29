/**
 * Smoke: the spine. Provision a scratch tenant/space on dev, authenticate the
 * owner via an injected session cookie, clear Cloudflare, and assert the
 * authenticated timeline renders. This is the gate the whole suite stands on.
 */
import { test, expect } from '../fixtures';

test.describe('@smoke dev spine', () => {
  test('owner reaches an authenticated timeline past Cloudflare', async ({
    world,
    pageAs,
    gotoSettled,
  }) => {
    const page = await pageAs('owner');
    const rest: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/rest/v1/')) rest.push(`${r.status()}`);
    });

    await gotoSettled(page, `/t/${world.tenantId}/s/${world.spaceId}/timeline`);

    // not bounced to login, and not stuck on the Cloudflare interstitial
    await expect(page).toHaveURL(/\/timeline/);
    await expect(page).not.toHaveURL(/\/login/);

    // brand resolved from host -> tenant name in the shell (proves auth + brand)
    await expect(page.getByText(`PW Reg Tenant ${world.id}`).first()).toBeVisible();

    // empty scratch space -> the dashboard empty state, not an error
    await expect(
      page.getByText('No clinical trial data to display', { exact: false })
    ).toBeVisible();

    // data layer answered (dashboard RPCs returned)
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every((s) => s.startsWith('2'))).toBeTruthy();
  });
});
