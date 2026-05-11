/**
 * audit-emission.spec.ts
 *
 * Tier 1 RPC and trigger emission tests. Verifies that each instrumented RPC
 * and safety-net trigger writes an audit event with the expected action, scope
 * columns, and metadata shape. All assertions read through the service-role
 * client (adminClient) because RLS blocks the test runner's own JWT from
 * reading audit_events in most scopes.
 *
 * Each test creates its own scratch entity, calls the RPC under test, then
 * queries audit_events via adminClient to verify. Cleanup runs in afterAll
 * hooks via the scratch helpers.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPersonas, Personas, adminClient } from '../fixtures/personas';
import { createScratchAgency, createScratchTenant, createScratchSpace } from '../fixtures/scratch';
import { as, expectOk, expectCode } from '../harness/as';
import { SupabaseClient } from '@supabase/supabase-js';
import { Client as PgClient } from 'pg';

const SUPABASE_DB_URL =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let p: Personas;
let svc: SupabaseClient;

beforeAll(async () => {
  p = await buildPersonas();
  svc = adminClient();
}, 60_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Query the most-recent audit_events row matching the given action and
 *  optional scope (agency_id/tenant_id/space_id). Returns null if not found.
 */
async function findAuditEvent(
  action: string,
  scope?: { agency_id?: string; tenant_id?: string; space_id?: string },
): Promise<Record<string, unknown> | null> {
  let query = svc.from('audit_events').select('*').eq('action', action);
  if (scope?.agency_id) query = query.eq('agency_id', scope.agency_id);
  if (scope?.tenant_id) query = query.eq('tenant_id', scope.tenant_id);
  if (scope?.space_id) query = query.eq('space_id', scope.space_id);
  query = query.order('occurred_at', { ascending: false }).limit(1);
  const { data, error } = await query;
  if (error) throw new Error(`findAuditEvent(${action}): ${error.message}`);
  return (data?.[0] as Record<string, unknown>) ?? null;
}

// ---------------------------------------------------------------------------
// provision_agency: emits agency.provision
// ---------------------------------------------------------------------------

describe('provision_agency emits agency.provision', () => {
  let agencyId: string;
  let cleanup: () => Promise<void>;

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it('emits agency.provision with source=rpc and correct metadata', async () => {
    const scratch = await createScratchAgency(p);
    agencyId = scratch.agencyId;
    cleanup = scratch.cleanup;

    const row = await findAuditEvent('agency.provision', { agency_id: agencyId });
    expect(row, 'expected an agency.provision audit row').not.toBeNull();
    expect(row!['source']).toBe('rpc');
    expect(row!['agency_id']).toBe(agencyId);

    const meta = row!['metadata'] as Record<string, unknown>;
    expect(typeof meta['subdomain']).toBe('string');
    expect(typeof meta['display_name']).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// provision_tenant: emits tenant.provision
// ---------------------------------------------------------------------------

describe('provision_tenant emits tenant.provision', () => {
  let tenantId: string;
  let cleanup: () => Promise<void>;

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it('emits tenant.provision with agency_id + tenant_id scope and metadata', async () => {
    const scratch = await createScratchTenant(p);
    tenantId = scratch.tenantId;
    cleanup = scratch.cleanup;

    const { data: tenantRow } = await svc.from('tenants').select('agency_id').eq('id', tenantId).single();
    const agencyId = (tenantRow as { agency_id: string }).agency_id;

    const row = await findAuditEvent('tenant.provision', { tenant_id: tenantId });
    expect(row, 'expected a tenant.provision audit row').not.toBeNull();
    expect(row!['source']).toBe('rpc');
    expect(row!['agency_id']).toBe(agencyId);
    expect(row!['tenant_id']).toBe(tenantId);

    const meta = row!['metadata'] as Record<string, unknown>;
    expect(typeof meta['subdomain']).toBe('string');
    expect(typeof meta['name']).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// update_tenant_branding: emits tenant.branding_updated
// ---------------------------------------------------------------------------

describe('update_tenant_branding emits tenant.branding_updated', () => {
  let scratch: Awaited<ReturnType<typeof createScratchTenant>>;

  afterAll(async () => {
    if (scratch) await scratch.cleanup();
  });

  it('emits tenant.branding_updated with changed_fields metadata', async () => {
    scratch = await createScratchTenant(p);
    const { tenantId } = scratch;

    // agency_owner has tenant_members row per personas.ts, but this tenant
    // belongs to personas.org.agencyId. Use platform_admin for maximum access.
    const r = await as(p, 'platform_admin').rpc('update_tenant_branding', {
      p_tenant_id: tenantId,
      p_branding: { app_display_name: 'BrandEmission', primary_color: '#001122' },
    });
    expectOk(r);

    const row = await findAuditEvent('tenant.branding_updated', { tenant_id: tenantId });
    expect(row, 'expected a tenant.branding_updated audit row').not.toBeNull();
    expect(row!['source']).toBe('rpc');

    const meta = row!['metadata'] as Record<string, unknown>;
    const fields = meta['changed_fields'] as string[];
    expect(Array.isArray(fields)).toBe(true);
    expect(fields).toContain('app_display_name');
    expect(fields).toContain('primary_color');
    expect(fields).not.toContain('logo_url');
  });
});

// ---------------------------------------------------------------------------
// update_agency_branding: emits agency.branding_updated
// ---------------------------------------------------------------------------

describe('update_agency_branding emits agency.branding_updated', () => {
  let scratch: Awaited<ReturnType<typeof createScratchAgency>>;

  afterAll(async () => {
    if (scratch) await scratch.cleanup();
  });

  it('emits agency.branding_updated with changed_fields containing the submitted key', async () => {
    scratch = await createScratchAgency(p);
    const { agencyId } = scratch;

    const r = await as(p, 'platform_admin').rpc('update_agency_branding', {
      p_agency_id: agencyId,
      p_branding: { contact_email: 'branding-test@example.invalid' },
    });
    expectOk(r);

    const row = await findAuditEvent('agency.branding_updated', { agency_id: agencyId });
    expect(row, 'expected an agency.branding_updated audit row').not.toBeNull();

    const meta = row!['metadata'] as Record<string, unknown>;
    const fields = meta['changed_fields'] as string[];
    expect(fields).toContain('contact_email');
    expect(fields).not.toContain('primary_color');
  });
});

// ---------------------------------------------------------------------------
// update_tenant_access: emits tenant.access_policy_updated
// ---------------------------------------------------------------------------

describe('update_tenant_access emits tenant.access_policy_updated', () => {
  it('emits tenant.access_policy_updated with allowlist and self_join metadata', async () => {
    // Use the personas.org tenant. tenant_owner has owner membership there.
    const r = await as(p, 'tenant_owner').rpc('update_tenant_access', {
      p_tenant_id: p.org.tenantId,
      p_settings: {
        email_domain_allowlist: ['example-emission.com'],
        email_self_join_enabled: true,
      },
    });
    expectOk(r);

    const row = await findAuditEvent('tenant.access_policy_updated', { tenant_id: p.org.tenantId });
    expect(row, 'expected a tenant.access_policy_updated audit row').not.toBeNull();
    expect(row!['source']).toBe('rpc');

    const meta = row!['metadata'] as Record<string, unknown>;
    // These keys may be present depending on whether they changed; verify
    // at minimum the self_join toggle keys are present.
    expect('self_join_was' in meta || 'self_join_now' in meta).toBe(true);

    // Restore to empty allowlist so subsequent tests are not affected.
    await as(p, 'tenant_owner').rpc('update_tenant_access', {
      p_tenant_id: p.org.tenantId,
      p_settings: {
        email_domain_allowlist: [],
        email_self_join_enabled: false,
      },
    });
  });
});

// ---------------------------------------------------------------------------
// create_space: emits space.created
// ---------------------------------------------------------------------------

describe('create_space emits space.created', () => {
  let scratch: Awaited<ReturnType<typeof createScratchSpace>>;

  afterAll(async () => {
    if (scratch) await scratch.cleanup();
  });

  it('emits space.created with space_id scope', async () => {
    scratch = await createScratchSpace(p);
    const { spaceId } = scratch;

    const row = await findAuditEvent('space.created', { space_id: spaceId });
    expect(row, 'expected a space.created audit row').not.toBeNull();
    expect(row!['source']).toBe('rpc');
    expect(row!['space_id']).toBe(spaceId);
  });
});

// ---------------------------------------------------------------------------
// delete_space: emits space.deleted
// ---------------------------------------------------------------------------

describe('delete_space emits space.deleted', () => {
  it('emits space.deleted after calling delete_space as space_owner', async () => {
    // Create a scratch space, call delete_space, then verify the audit row.
    // The scratch helper would fail to clean up because the space is already
    // deleted; we handle cleanup manually.
    const scratch = await createScratchSpace(p);
    const { spaceId } = scratch;

    // delete_space requires has_space_access(space_id, ['owner']). createScratchSpace
    // creates the space as tenant_owner (the create_space RPC adds the caller as owner),
    // so tenant_owner holds the space owner role here.
    const r = await as(p, 'tenant_owner').rpc('delete_space', { p_space_id: spaceId });
    expectOk(r);

    // Query audit_events for space.deleted. space_id FK was set null on delete,
    // so we filter by resource_id instead.
    const { data, error } = await svc
      .from('audit_events')
      .select('*')
      .eq('action', 'space.deleted')
      .eq('resource_id', spaceId)
      .order('occurred_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(`query space.deleted: ${error.message}`);
    const row = data?.[0] as Record<string, unknown> | undefined;
    expect(row, 'expected a space.deleted audit row').not.toBeNull();
    expect(row!['source']).toBe('rpc');
  });
});

// ---------------------------------------------------------------------------
// register_custom_domain: emits custom_domain.registered
// ---------------------------------------------------------------------------

describe('register_custom_domain emits custom_domain.registered', () => {
  let tenantId: string;
  let cleanup: () => Promise<void>;

  afterAll(async () => {
    if (cleanup) await cleanup();
    // Remove domain registration from the tenant so cleanup succeeds.
  });

  it('emits custom_domain.registered with the registered domain in metadata', async () => {
    const scratch = await createScratchTenant(p);
    tenantId = scratch.tenantId;
    cleanup = scratch.cleanup;

    const domain = `emission-${tenantId.slice(0, 8)}.example.invalid`;
    const r = await as(p, 'platform_admin').rpc('register_custom_domain', {
      p_tenant_id: tenantId,
      p_custom_domain: domain,
    });
    expectOk(r);

    const { data, error } = await svc
      .from('audit_events')
      .select('*')
      .eq('action', 'custom_domain.registered')
      .eq('resource_id', tenantId)
      .order('occurred_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(`query custom_domain.registered: ${error.message}`);
    const row = data?.[0] as Record<string, unknown> | undefined;
    expect(row, 'expected a custom_domain.registered audit row').not.toBeNull();
    expect(row!['source']).toBe('rpc');
    const meta = row!['metadata'] as Record<string, unknown>;
    // The instrumentation uses key 'domain' (not 'custom_domain') per
    // jsonb_build_object('domain', p_custom_domain) in the migration.
    expect(meta['domain']).toBe(domain);
  });
});

// ---------------------------------------------------------------------------
// tenant_invites INSERT trigger: emits tenant_invite.issued
// ---------------------------------------------------------------------------

describe('tenant_invites INSERT trigger emits tenant_invite.issued', () => {
  it('fires tenant_invite.issued via trigger on direct INSERT', async () => {
    const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
    let inviteId: string | undefined;
    try {
      await pg.connect();
      // Set suppress_trigger to empty so the safety-net trigger is NOT suppressed.
      await pg.query(`select set_config('audit.suppress_trigger', '', false)`);
      await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [p.ids.tenant_owner]);

      const { rows } = await pg.query<{ id: string }>(
        `insert into public.tenant_invites (tenant_id, email, role, invite_code, created_by)
         values ($1, 'trigger-test-tenant@emission.invalid', 'owner', $2, $3)
         returning id`,
        [p.org.tenantId, `trigger-tenant-${Date.now()}`, p.ids.tenant_owner],
      );
      inviteId = rows[0].id;
    } finally {
      await pg.end();
    }

    expect(inviteId).toBeTruthy();

    const { data, error } = await svc
      .from('audit_events')
      .select('*')
      .eq('action', 'tenant_invite.issued')
      .eq('resource_id', inviteId!)
      .limit(1);
    if (error) throw new Error(`query tenant_invite.issued: ${error.message}`);
    const row = data?.[0] as Record<string, unknown> | undefined;
    expect(row, 'expected a tenant_invite.issued audit row').not.toBeNull();
    expect(row!['source']).toBe('trigger');
    expect(row!['tenant_id']).toBe(p.org.tenantId);

    const meta = row!['metadata'] as Record<string, unknown>;
    expect(meta['invited_email']).toBe('trigger-test-tenant@emission.invalid');

    // Cleanup.
    const pg2 = new PgClient({ connectionString: SUPABASE_DB_URL });
    try {
      await pg2.connect();
      await pg2.query(`delete from public.tenant_invites where id = $1`, [inviteId]);
      await pg2.query(`delete from public.audit_events where resource_id = $1`, [inviteId]);
    } finally {
      await pg2.end();
    }
  });
});

// ---------------------------------------------------------------------------
// space_invites INSERT trigger: emits space_invite.issued
// ---------------------------------------------------------------------------

describe('space_invites INSERT trigger emits space_invite.issued', () => {
  it('fires space_invite.issued via trigger on direct INSERT', async () => {
    const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
    let inviteId: string | undefined;
    try {
      await pg.connect();
      await pg.query(`select set_config('audit.suppress_trigger', '', false)`);
      await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [p.ids.space_owner]);

      const { rows } = await pg.query<{ id: string }>(
        `insert into public.space_invites (space_id, email, role, invite_code, created_by)
         values ($1, 'trigger-test-space@emission.invalid', 'viewer', $2, $3)
         returning id`,
        [p.org.spaceId, `trigger-space-${Date.now()}`, p.ids.space_owner],
      );
      inviteId = rows[0].id;
    } finally {
      await pg.end();
    }

    expect(inviteId).toBeTruthy();

    const { data, error } = await svc
      .from('audit_events')
      .select('*')
      .eq('action', 'space_invite.issued')
      .eq('resource_id', inviteId!)
      .limit(1);
    if (error) throw new Error(`query space_invite.issued: ${error.message}`);
    const row = data?.[0] as Record<string, unknown> | undefined;
    expect(row, 'expected a space_invite.issued audit row').not.toBeNull();
    expect(row!['source']).toBe('trigger');
    expect(row!['space_id']).toBe(p.org.spaceId);

    const meta = row!['metadata'] as Record<string, unknown>;
    expect(meta['invited_email']).toBe('trigger-test-space@emission.invalid');

    // Cleanup.
    const pg2 = new PgClient({ connectionString: SUPABASE_DB_URL });
    try {
      await pg2.connect();
      await pg2.query(`delete from public.space_invites where id = $1`, [inviteId]);
      await pg2.query(`delete from public.audit_events where resource_id = $1`, [inviteId]);
    } finally {
      await pg2.end();
    }
  });
});

// ---------------------------------------------------------------------------
// platform_admins INSERT trigger: emits platform_admin.granted
// ---------------------------------------------------------------------------

describe('platform_admins INSERT trigger emits platform_admin.granted', () => {
  it('fires platform_admin.granted via trigger on direct INSERT', async () => {
    // Use no_memberships persona as the target -- they have no platform_admin row yet.
    const targetId = p.ids.no_memberships;

    const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
    try {
      await pg.connect();
      await pg.query(`select set_config('audit.suppress_trigger', '', false)`);
      await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [p.ids.platform_admin]);
      await pg.query(`insert into public.platform_admins (user_id) values ($1)`, [targetId]);
    } finally {
      await pg.end();
    }

    const { data, error } = await svc
      .from('audit_events')
      .select('*')
      .eq('action', 'platform_admin.granted')
      .eq('resource_id', targetId)
      .order('occurred_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(`query platform_admin.granted: ${error.message}`);
    const row = data?.[0] as Record<string, unknown> | undefined;
    expect(row, 'expected a platform_admin.granted audit row').not.toBeNull();
    expect(row!['source']).toBe('trigger');

    // Cleanup: remove the promoted row so persona graph is restored.
    const pg2 = new PgClient({ connectionString: SUPABASE_DB_URL });
    try {
      await pg2.connect();
      await pg2.query(`delete from public.platform_admins where user_id = $1`, [targetId]);
      await pg2.query(
        `delete from public.audit_events where action = 'platform_admin.granted' and resource_id = $1`,
        [targetId],
      );
    } finally {
      await pg2.end();
    }
  });
});
