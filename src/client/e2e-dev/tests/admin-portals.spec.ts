/**
 * Agency portal (/admin/*), super-admin console (/super-admin/*) and audit logs.
 *
 * Reached via REAL host-based brand resolution, NOT the ?wl_kind override: the
 * dev build ships environment.production=true (src/environments/environment.dev.ts:4),
 * so main.ts:24 `if (!environment.production)` disables the override on deployed dev.
 *   - Agency portal: the scratch agency host `pwreg-ag-<id>.dev.clintapp.com`
 *     (matches agencies.subdomain -> brand kind 'agency'); see scratch-world.ts:212.
 *   - Super-admin: the magic `admin.dev.clintapp.com` host -> brand kind
 *     'super-admin' (migration 20260430032945_fix_get_brand_by_host_drop_accent_color.sql:64-70).
 * Both are covered by the shared `.dev.clintapp.com` apex cookie.
 *
 * The world's provisioner is BOTH a platform_admin and the agency owner
 * (scratch-world.ts:205, 213), which satisfies agencyGuard / auditAgencyGuard /
 * superAdminGuard. agencyPageAs + superAdminPageAs use the provisioner session;
 * role users (space members, not platform/agency admins) drive the deny tests.
 *
 * Sources: app.routes.ts (admin/super-admin route + guard wiring), guard inventory
 * (agency.guard.ts / super-admin.guard.ts / audit-agency.guard.ts / audit-space.guard.ts),
 * and QA-009 (agency audit ACTOR shows "--") in docs/notes/event-model-qa-dev-issues.md.
 */
import { test, expect, apiAs } from '../fixtures';
import type { BrowserContext } from '@playwright/test';
import {
  agencyHost,
  agencyPageAs,
  roleAtHost,
  superAdminHost,
  superAdminPageAs,
} from '../helpers/admin-context';

const sp = (tenantId: string, spaceId: string, sub = '') => `/t/${tenantId}/s/${spaceId}${sub}`;

// Default worldRoles is ['owner']; owner is reused as the non-admin identity for the
// two redirect tests, so no extra GoTrue sign-ins (and the provisioner covers all
// positive admin cases).
// SCAFFOLD (test.fixme): authored + grounded; pending a headed verification pass. Reaches the
// agency host (pwreg-ag-<id>.dev.clintapp.com) and super-admin host (admin.dev.clintapp.com) --
// both brand kinds confirmed via get_brand_by_host -- so each clears Cloudflare separately
// (3 solves). The QA-009 actor-email soft assertions are EXPECTED to fail until that bug is
// fixed. Verify the host-based admin contexts headed before enabling.
test.describe('@admin agency portal + super-admin + audit', () => {
  // Contexts opened via the raw `browser` fixture are NOT auto-closed; track + close.
  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const c of opened.splice(0)) await c.close().catch(() => {});
  });

  test('agency owner sees the tenant list, create form, and branding', async ({
    browser,
    world,
    gotoSettled,
  }) => {
    const { page, context } = await agencyPageAs(browser, world);
    opened.push(context);

    // --- Tenants list (agency-tenant-list.component.ts:38,44,220-name from scratch-world.ts) ---
    await gotoSettled(page, '/admin/tenants');
    await expect(page).toHaveURL(/\/admin\/tenants/); // agencyGuard passed for the agency owner
    await expect(page.getByRole('heading', { name: 'Tenants', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /provision tenant/i })).toBeVisible();
    // The scratch world provisioned `PW Reg Tenant <id>` (scratch-world.ts:220) under this agency.
    await expect
      .soft(page.getByText(new RegExp(`PW Reg Tenant ${world.id}`)))
      .toBeVisible({ timeout: 10_000 });

    // --- Create form renders (agency-tenant-new.component.ts:63) -- render only, no submit ---
    await gotoSettled(page, '/admin/tenants/new');
    await expect(page).toHaveURL(/\/admin\/tenants\/new/);
    await expect(page.getByRole('heading', { name: 'Provision tenant', level: 1 })).toBeVisible();

    // --- Branding (agency-branding.component.ts:45) ---
    await gotoSettled(page, '/admin/branding');
    await expect(page).toHaveURL(/\/admin\/branding/);
    await expect(page.getByRole('heading', { name: 'Agency branding', level: 1 })).toBeVisible();
  });

  test('agency owner opens the agency audit log [QA-009 actor]', async ({
    browser,
    world,
    gotoSettled,
  }) => {
    const { page, context } = await agencyPageAs(browser, world);
    opened.push(context);

    // auditAgencyGuard requires is_agency_member(owner); the provisioner is the agency owner.
    await gotoSettled(page, '/admin/audit-log');
    await expect(page).toHaveURL(/\/admin\/audit-log/);
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
    // Shared audit table rendered -> guard passed (audit-log-table.component.html:90).
    await expect(page.getByRole('columnheader', { name: 'Actor' })).toBeVisible();

    // KNOWN-BUG QA-009: provision_agency / provision_tenant are agency-scope audited with
    // actor = the provisioner, but actor_email renders "--". Assert the table is populated
    // (rows exist even if actor is null), then SOFT-assert the actor resolves to the email.
    // VERIFY: agency-scope rows + their action strings are unconfirmed; if the agency audit
    // log is empty for a fresh scratch agency, the two assertions below become no-ops/soft.
    const emptyMsg = page.getByText('No audit events match the current filter.');
    await expect.soft(emptyMsg).toHaveCount(0); // expect at least one provisioning audit row
    await expect
      .soft(page.getByText(world.provisioner.email)) // KNOWN-BUG QA-009: currently "--"
      .toBeVisible({ timeout: 8_000 });
  });

  test('platform admin opens every super-admin surface', async ({
    browser,
    world,
    gotoSettled,
  }) => {
    const { page, context } = await superAdminPageAs(browser, world);
    opened.push(context);

    // Agencies (super-admin-agencies.component.ts:54)
    await gotoSettled(page, '/super-admin/agencies');
    await expect(page).toHaveURL(/\/super-admin\/agencies/); // superAdminGuard passed (platform admin)
    await expect(page.getByRole('heading', { name: 'Agencies', level: 1 })).toBeVisible();

    // Tenants (super-admin-tenants.component.ts:51)
    await gotoSettled(page, '/super-admin/tenants');
    await expect(page).toHaveURL(/\/super-admin\/tenants/);
    await expect(page.getByRole('heading', { name: 'Tenants', level: 1 })).toBeVisible();

    // Domains (super-admin-domains.component.ts:38)
    await gotoSettled(page, '/super-admin/domains');
    await expect(page).toHaveURL(/\/super-admin\/domains/);
    await expect(page.getByRole('heading', { name: 'Retired hostnames', level: 1 })).toBeVisible();

    // AI usage -- h1 is dynamic ({{ heading() }}), so anchor on the table aria-label
    // (super-admin-ai-usage.component.ts:179).
    await gotoSettled(page, '/super-admin/ai-usage');
    await expect(page).toHaveURL(/\/super-admin\/ai-usage/);
    await expect(page.getByLabel('AI usage by tenant')).toBeVisible();

    // Platform audit log (super-admin-audit-log.component.ts:11)
    await gotoSettled(page, '/super-admin/audit-log');
    await expect(page).toHaveURL(/\/super-admin\/audit-log/);
    await expect(page.getByRole('heading', { name: 'Platform audit log', level: 1 })).toBeVisible();
  });

  test('non-admin is redirected out of /super-admin', async ({ browser, world, gotoSettled }) => {
    // owner role user is authenticated but NOT a platform_admin -> superAdminGuard
    // (super-admin.guard.ts:20-23) redirects to '/'.
    const { page, context } = await roleAtHost(browser, world, superAdminHost(), 'owner');
    opened.push(context);
    await gotoSettled(page, '/super-admin/agencies');
    await expect(page).not.toHaveURL(/\/super-admin/);
    // VERIFY: landing on the admin-host '/' (marketing landing) -- confirm headed.
  });

  test('non-agency-member is redirected out of /admin', async ({ browser, world, gotoSettled }) => {
    // owner role user is a space owner, not an agency member nor platform_admin ->
    // agencyGuard (agency.guard.ts:29-32) redirects to '/'.
    const { page, context } = await roleAtHost(browser, world, agencyHost(world), 'owner');
    opened.push(context);
    await gotoSettled(page, '/admin/tenants');
    await expect(page).not.toHaveURL(/\/admin\/tenants/);
    // VERIFY: landing on the agency-host '/' (marketing landing) -- confirm headed.
  });

  test('space audit log lists an audited action after a mutation [QA-009 actor]', async ({
    world,
    pageAs,
    gotoSettled,
  }) => {
    // KNOWN-BUG QA-009: the space audit ACTOR renders "--" instead of the provisioner
    // email, so the soft assertion at the end of this test fails. Declared as an expected
    // failure (kept soft per QA-009 tracking) so the suite stays green; remove this
    // annotation when QA-009 is fixed and the actor email resolves -- at which point this
    // test will report "expected to fail but passed", prompting the cleanup.
    test.fail();

    // Mutation: owner invites a throwaway email (Tier-1 audited path,
    // invite_to_space at 20260501060000_canonicalize_email.sql:149).
    const invite = await apiAs(world, 'owner').rpc('invite_to_space', {
      p_space_id: world.spaceId,
      p_email: `pwreg-invitee-${world.id}@pwreg.test`,
      p_role: 'viewer',
    });
    expect(invite.error, invite.error?.message).toBeNull();

    const page = await pageAs('owner'); // owner = space owner -> auditSpaceGuard passes
    await gotoSettled(page, sp(world.tenantId, world.spaceId, '/settings/audit-log'));
    await expect(page).toHaveURL(/\/settings\/audit-log/);
    await expect(page.getByRole('columnheader', { name: 'Actor' })).toBeVisible();

    // `space.created` is GUARANTEED: create_space emits it at scope='space' with the
    // provisioner as actor (20260510001400_audit_instrument_spaces.sql:68). Assert the
    // audited action row exists even if the actor email is null.
    const createdRow = page.getByRole('row').filter({ hasText: 'space.created' });
    await expect(createdRow.first()).toBeVisible({ timeout: 10_000 });

    // KNOWN-BUG QA-009: actor should resolve to the provisioner email, not "--"
    // (audit-log-table.component.html:102 renders `actor_email ?? '--'`). SOFT so the
    // open bug is recorded without failing the suite.
    await expect.soft(createdRow.first()).toContainText(world.provisioner.email);
  });
});
