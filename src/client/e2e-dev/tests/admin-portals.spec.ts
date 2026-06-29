/**
 * Agency portal (/admin/*), super-admin (/super-admin/*) and audit logs.
 * SCAFFOLDS (test.fixme): these need harness extensions:
 *   - Agency portal renders on the AGENCY host (the scratch agency's subdomain
 *     `pwreg-ag-<id>.dev.clintapp.com`, brand kind 'agency'); the world tracks
 *     agencyId but not yet an agency-host page helper + agency_members row.
 *   - Super-admin renders on a super-admin host (or the ?wl_kind=super-admin dev
 *     override) for a platform_admin; the world's provisioner is platform_admin
 *     but is intentionally not exposed as a role.
 *   - Audit logs (space/tenant/agency) need audited actions to assert rows.
 *
 * Sources: guard inventory (agencyGuard / superAdminGuard / audit*Guard) +
 * QA-009 (agency audit ACTOR shows "--") in docs/notes/event-model-qa-dev-issues.md.
 */
import { test } from '../fixtures';

test.describe('@admin agency + super-admin + audit', () => {
  test.fixme('agency owner manages tenants in the agency portal', async () => {
    // agency host -> /admin/tenants list; create/edit tenant; members; branding.
  });

  test.fixme('platform admin opens the super-admin console', async () => {
    // super-admin host (or ?wl_kind=super-admin) -> /super-admin/agencies|tenants|
    // domains|ai-usage|audit-log render for a platform_admin; non-admin -> redirect.
  });

  test.fixme('space audit log lists audited actions', async () => {
    // owner -> /settings/audit-log after a mutation; assert the action row + actor.
    // Regression guard for QA-009 (ACTOR rendered "--" when actor_email is null).
  });
});
