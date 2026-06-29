/**
 * Admin-surface contexts for the dev suite.
 *
 * Reaches the agency portal and super-admin console via REAL host-based brand
 * resolution (the ?wl_kind override is disabled on deployed dev because
 * environment.dev.ts ships production:true). Cookies live at the shared
 * `.dev.clintapp.com` apex, so they carry to every subdomain.
 */
import { type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { Session } from '@supabase/supabase-js';
import { sessionCookie } from './auth-cookie';
import { DEV_APEX, SCRATCH_PREFIX } from './dev-env';
import { userFor, type RoleName, type ScratchWorld } from './scratch-world';

export interface HostContext {
  page: Page;
  context: BrowserContext;
}

/** Agency brand host: `pwreg-ag-<id>.dev.clintapp.com` (matches the p_subdomain
 *  passed to provision_agency in scratch-world.ts:212 -> brand kind 'agency'). */
export function agencyHost(world: ScratchWorld): string {
  return `${SCRATCH_PREFIX}-ag-${world.id}.${DEV_APEX}`;
}

/** Magic super-admin host: `admin.dev.clintapp.com`. get_brand_by_host returns
 *  kind='super-admin' for the reserved 'admin' subdomain (migration
 *  20260430032945_fix_get_brand_by_host_drop_accent_color.sql:64-70). */
export function superAdminHost(): string {
  return `admin.${DEV_APEX}`;
}

async function openAtHost(browser: Browser, host: string, session: Session): Promise<HostContext> {
  const context = await browser.newContext({ baseURL: `https://${host}` });
  await context.addCookies([sessionCookie(session)]);
  return { page: await context.newPage(), context };
}

/**
 * Agency portal (/admin/*) as the agency owner. The world's provisioner is BOTH
 * a platform_admin and the agency owner, so it satisfies agencyGuard AND the
 * stricter auditAgencyGuard (is_agency_member owner).
 *
 * Note: no `role` param -- only the provisioner is an agency member in a scratch
 * world. Testing a non-owner agency member would need an explicit agency_members
 * insert via the pooler (deferred). For deny tests use roleAtHost().
 */
export async function agencyPageAs(browser: Browser, world: ScratchWorld): Promise<HostContext> {
  return openAtHost(browser, agencyHost(world), world.provisioner.session);
}

/** Super-admin console (/super-admin/*) as a platform_admin (the provisioner). */
export async function superAdminPageAs(
  browser: Browser,
  world: ScratchWorld
): Promise<HostContext> {
  return openAtHost(browser, superAdminHost(), world.provisioner.session);
}

/**
 * A role user's session at an arbitrary host -- for guard-redirect (deny) tests.
 * Role users are neither platform admins nor agency members, so they are bounced
 * by superAdminGuard / agencyGuard.
 */
export async function roleAtHost(
  browser: Browser,
  world: ScratchWorld,
  host: string,
  role: RoleName
): Promise<HostContext> {
  return openAtHost(browser, host, userFor(world, role).session);
}
