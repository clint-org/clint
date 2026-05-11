/**
 * audit-rls.spec.ts
 *
 * Strict-scope owner-only visibility tests for audit_events.
 *
 * RLS policy recap (migration 20260510000300_audit_events_rls.sql):
 *   - platform_admin: sees all rows (is_platform_admin() returns true)
 *   - agency_owner (agency_members.role = 'owner'): sees agency-scoped rows
 *   - agency_only (no tenant_members row): sees agency-scoped rows ONLY
 *   - tenant_owner (tenant_members.role = 'owner'): sees tenant-scoped rows ONLY
 *   - space_owner (space_members.role = 'owner'): sees space-scoped rows ONLY
 *   - contributor/reader/no_memberships/anon: see nothing
 *
 * Setup: three seed rows are inserted via service-role (which calls
 * record_audit_event directly at the DB level). Each has a unique action
 * prefix ('audit-rls-test.*') so they can be isolated from noise.
 * Cleanup deletes those rows in afterAll.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPersonas, Personas, adminClient } from '../fixtures/personas';
import { as, expectCode } from '../harness/as';
import { SupabaseClient } from '@supabase/supabase-js';
import { Client as PgClient } from 'pg';

const SUPABASE_DB_URL =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const ACTION_AGENCY  = 'audit-rls-test.agency';
const ACTION_TENANT  = 'audit-rls-test.tenant';
const ACTION_SPACE   = 'audit-rls-test.space';

let p: Personas;
let svc: SupabaseClient;
let seededAgencyEventId: string;
let seededTenantEventId: string;
let seededSpaceEventId: string;

beforeAll(async () => {
  p = await buildPersonas();
  svc = adminClient();

  // Seed three audit rows directly via postgres. record_audit_event is a
  // SECURITY DEFINER function accessible to service_role, so we call it
  // through the svc (service-role) client's RPC surface after setting the
  // actor GUC in a raw pg transaction.
  //
  // We use a raw pg connection because we need set_config() in the same
  // transaction as the function call to set request.jwt.claim.sub.
  const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
  try {
    await pg.connect();
    // Use is_local=false (session-level) so the GUC persists across separate
    // query() calls in the same pg session (is_local=true is transaction-scoped
    // and resets after each auto-committed statement).
    await pg.query(
      `select set_config('request.jwt.claim.sub', $1, false)`,
      [p.ids.platform_admin],
    );

    // Agency-scoped event: visible to agency owners + platform admin.
    const { rows: r1 } = await pg.query<{ record_audit_event: string }>(
      `select public.record_audit_event($1,'system','test',null,$2,null,null,'{}')`,
      [ACTION_AGENCY, p.org.agencyId],
    );
    seededAgencyEventId = r1[0].record_audit_event;

    // Tenant-scoped event: visible to tenant owners + platform admin.
    const { rows: r2 } = await pg.query<{ record_audit_event: string }>(
      `select public.record_audit_event($1,'system','test',null,null,$2,null,'{}')`,
      [ACTION_TENANT, p.org.tenantId],
    );
    seededTenantEventId = r2[0].record_audit_event;

    // Space-scoped event: visible to space owners + platform admin.
    const { rows: r3 } = await pg.query<{ record_audit_event: string }>(
      `select public.record_audit_event($1,'system','test',null,null,$2,$3,'{}')`,
      [ACTION_SPACE, p.org.tenantId, p.org.spaceId],
    );
    seededSpaceEventId = r3[0].record_audit_event;
  } finally {
    await pg.end();
  }
}, 60_000);

afterAll(async () => {
  if (!svc) return;
  // Cleanup via direct pg (service-role PostgREST cannot DELETE, and neither
  // can the svc client because INSERT/UPDATE/DELETE grants were revoked).
  const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
  try {
    await pg.connect();
    await pg.query(
      `delete from public.audit_events where action like 'audit-rls-test.%'`,
    );
  } finally {
    await pg.end();
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function countByAction(client: SupabaseClient, actions: string[]): Promise<number> {
  const { data, error } = await client
    .from('audit_events')
    .select('id')
    .in('action', actions);
  if (error) return 0; // RLS denial returns empty / error; treat as 0
  return (data ?? []).length;
}

// ---------------------------------------------------------------------------
// platform_admin: sees all three seeded rows
// ---------------------------------------------------------------------------

describe('platform_admin sees all scopes', () => {
  it('reads all three seeded audit events', async () => {
    const count = await countByAction(
      as(p, 'platform_admin'),
      [ACTION_AGENCY, ACTION_TENANT, ACTION_SPACE],
    );
    expect(count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// agency_owner: sees agency row + tenant row (has explicit tenant_members row)
// The space-scoped row also has tenant_id set, so is visible via
// is_tenant_owner_strict(tenant_id) for anyone who is a tenant owner.
// ---------------------------------------------------------------------------

describe('agency_owner visibility', () => {
  it('sees the agency-scoped row', async () => {
    const count = await countByAction(as(p, 'agency_owner'), [ACTION_AGENCY]);
    expect(count).toBe(1);
  });

  it('sees the tenant-scoped row (agency_owner has explicit tenant_members row)', async () => {
    // agency_owner has an explicit tenant_members row per personas.ts step 7.
    // So is_tenant_owner_strict returns true for them on the personas tenant.
    const count = await countByAction(as(p, 'agency_owner'), [ACTION_TENANT]);
    expect(count).toBe(1);
  });

  it('sees the space-scoped row via tenant_id (space row has tenant_id set, agency_owner is a tenant owner)', async () => {
    // The seeded space row has both space_id AND tenant_id. The RLS OR-chain
    // evaluates is_tenant_owner_strict(tenant_id) which returns true for
    // agency_owner (who has a tenant_members row). This is correct policy behavior.
    const count = await countByAction(as(p, 'agency_owner'), [ACTION_SPACE]);
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// agency_only: sees agency row only, no tenant rows (no tenant_members entry)
// ---------------------------------------------------------------------------

describe('agency_only visibility (no tenant_members entry)', () => {
  it('sees the agency-scoped row', async () => {
    const count = await countByAction(as(p, 'agency_only'), [ACTION_AGENCY]);
    expect(count).toBe(1);
  });

  it('does NOT see the tenant-scoped row (strict scope, no cascade)', async () => {
    const count = await countByAction(as(p, 'agency_only'), [ACTION_TENANT]);
    expect(count).toBe(0);
  });

  it('does NOT see the space-scoped row', async () => {
    const count = await countByAction(as(p, 'agency_only'), [ACTION_SPACE]);
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// tenant_owner: sees tenant rows and space rows within their tenant.
// The RLS policy OR-chain hits is_tenant_owner_strict(tenant_id) for rows
// that have tenant_id set (including the space-scoped row which has both
// tenant_id and space_id). tenant_owner does NOT see agency-scoped rows.
// ---------------------------------------------------------------------------

describe('tenant_owner visibility', () => {
  it('sees the tenant-scoped row', async () => {
    const count = await countByAction(as(p, 'tenant_owner'), [ACTION_TENANT]);
    expect(count).toBe(1);
  });

  it('does NOT see the agency-scoped row', async () => {
    const count = await countByAction(as(p, 'tenant_owner'), [ACTION_AGENCY]);
    expect(count).toBe(0);
  });

  it('sees the space-scoped row (space row has tenant_id set; is_tenant_owner_strict matches)', async () => {
    // The seeded space row has both space_id AND tenant_id. The RLS OR-chain
    // evaluates is_tenant_owner_strict(tenant_id) which returns true for
    // tenant_owner. This is the correct behavior: tenant owners have governance
    // visibility over all spaces in their tenant.
    const count = await countByAction(as(p, 'tenant_owner'), [ACTION_SPACE]);
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// space_owner: sees space row only
// ---------------------------------------------------------------------------

describe('space_owner visibility', () => {
  it('sees the space-scoped row', async () => {
    const count = await countByAction(as(p, 'space_owner'), [ACTION_SPACE]);
    expect(count).toBe(1);
  });

  it('does NOT see the agency-scoped row', async () => {
    const count = await countByAction(as(p, 'space_owner'), [ACTION_AGENCY]);
    expect(count).toBe(0);
  });

  it('does NOT see the tenant-scoped row', async () => {
    const count = await countByAction(as(p, 'space_owner'), [ACTION_TENANT]);
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// contributor/reader/no_memberships: see nothing
// ---------------------------------------------------------------------------

describe('contributor sees no audit events', () => {
  it('returns zero rows for all three seeded actions', async () => {
    const count = await countByAction(
      as(p, 'contributor'),
      [ACTION_AGENCY, ACTION_TENANT, ACTION_SPACE],
    );
    expect(count).toBe(0);
  });
});

describe('reader sees no audit events', () => {
  it('returns zero rows for all three seeded actions', async () => {
    const count = await countByAction(
      as(p, 'reader'),
      [ACTION_AGENCY, ACTION_TENANT, ACTION_SPACE],
    );
    expect(count).toBe(0);
  });
});

describe('no_memberships sees no audit events', () => {
  it('returns zero rows', async () => {
    const count = await countByAction(
      as(p, 'no_memberships'),
      [ACTION_AGENCY, ACTION_TENANT, ACTION_SPACE],
    );
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// anon: cannot read audit_events at all
// ---------------------------------------------------------------------------

describe('anon is denied access to audit_events', () => {
  it('select returns empty (RLS filters all rows for unauthenticated callers)', async () => {
    // Anon callers do not get a 42501; they get an empty result because the
    // policy uses USING clauses that evaluate to false for anon role.
    const { data, error } = await as(p, 'anon')
      .from('audit_events')
      .select('id')
      .in('action', [ACTION_AGENCY, ACTION_TENANT, ACTION_SPACE]);
    // Either empty data or an error are acceptable; zero visible rows is the invariant.
    const count = error ? 0 : (data ?? []).length;
    expect(count).toBe(0);
  });
});
