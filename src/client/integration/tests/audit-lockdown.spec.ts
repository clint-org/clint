/**
 * audit-lockdown.spec.ts
 *
 * Locked write path negative tests. Verifies that INSERT, UPDATE, and DELETE
 * on public.audit_events are denied for both authenticated personas and the
 * anon role, and that the sanctioned path (record_audit_event RPC) succeeds
 * for authenticated callers.
 *
 * Service-role via PostgREST: The GRANT was revoked from service_role in
 * migration 20260510000100_audit_events_table.sql:
 *   revoke insert, update, delete on public.audit_events from authenticated, anon, service_role;
 * PostgREST forwards the service_role JWT but the SQL-level GRANT has been
 * revoked, so service_role via PostgREST also gets a permission denied. This
 * test verifies that behavior; if it ever changes (e.g. a migration re-grants),
 * the test will fail and surface the gap.
 *
 * Sanctioned path:
 *   record_audit_event is SECURITY DEFINER and is granted to authenticated and
 *   service_role (see migration 20260510000400_record_audit_event.sql). Calling
 *   it as any authenticated persona should succeed and return a UUID.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPersonas, Personas, adminClient } from '../fixtures/personas';
import { as, expectCode, expectOk } from '../harness/as';
import { SupabaseClient } from '@supabase/supabase-js';
import { Client as PgClient } from 'pg';

const SUPABASE_DB_URL =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let p: Personas;
let svc: SupabaseClient;

// We need a seed row to attempt UPDATE and DELETE against.
// Seeded via record_audit_event (sanctioned path) as platform_admin.
let seedRowId: string;

beforeAll(async () => {
  p = await buildPersonas();
  svc = adminClient();

  // Seed one row via the sanctioned RPC so UPDATE/DELETE tests have a target.
  const r = await as(p, 'platform_admin').rpc('record_audit_event', {
    p_action: 'lockdown.seed',
    p_source: 'system',
    p_resource_type: 'test',
    p_resource_id: null,
    p_agency_id: null,
    p_tenant_id: null,
    p_space_id: null,
    p_metadata: { test_file: 'audit-lockdown.spec.ts' },
  });
  seedRowId = expectOk(r) as string;
  expect(typeof seedRowId).toBe('string');
}, 60_000);

afterAll(async () => {
  // Cleanup via direct pg (superuser bypasses revoked GRANTs).
  const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
  try {
    await pg.connect();
    await pg.query(`delete from public.audit_events where action like 'lockdown.%'`);
  } finally {
    await pg.end();
  }
});

// ---------------------------------------------------------------------------
// Sanctioned write path: record_audit_event succeeds for authenticated personas
// ---------------------------------------------------------------------------

describe('record_audit_event (sanctioned path)', () => {
  it('tenant_owner can call record_audit_event and receives a UUID', async () => {
    const r = await as(p, 'tenant_owner').rpc('record_audit_event', {
      p_action: 'lockdown.sanctioned',
      p_source: 'rpc',
      p_resource_type: 'test',
      p_resource_id: null,
      p_agency_id: null,
      p_tenant_id: p.org.tenantId,
      p_space_id: null,
      p_metadata: {},
    });
    const id = expectOk(r) as string;
    expect(typeof id).toBe('string');
    // Validate UUID shape (8-4-4-4-12 hex).
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('space_owner can call record_audit_event and receives a UUID', async () => {
    const r = await as(p, 'space_owner').rpc('record_audit_event', {
      p_action: 'lockdown.sanctioned',
      p_source: 'rpc',
      p_resource_type: 'test',
      p_resource_id: null,
      p_agency_id: null,
      p_tenant_id: null,
      p_space_id: p.org.spaceId,
      p_metadata: {},
    });
    const id = expectOk(r) as string;
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

// ---------------------------------------------------------------------------
// Direct INSERT denied for authenticated personas
// ---------------------------------------------------------------------------

describe('direct INSERT on audit_events is denied', () => {
  it('tenant_owner INSERT raises 42501', async () => {
    const r = await as(p, 'tenant_owner')
      .from('audit_events')
      .insert({ action: 'lockdown.direct-insert', source: 'system', resource_type: 'test' });
    expectCode(r, '42501');
  });

  it('space_owner INSERT raises 42501', async () => {
    const r = await as(p, 'space_owner')
      .from('audit_events')
      .insert({ action: 'lockdown.direct-insert', source: 'system', resource_type: 'test' });
    expectCode(r, '42501');
  });

  it('reader INSERT raises 42501', async () => {
    const r = await as(p, 'reader')
      .from('audit_events')
      .insert({ action: 'lockdown.direct-insert', source: 'system', resource_type: 'test' });
    expectCode(r, '42501');
  });

  it('no_memberships INSERT raises 42501', async () => {
    const r = await as(p, 'no_memberships')
      .from('audit_events')
      .insert({ action: 'lockdown.direct-insert', source: 'system', resource_type: 'test' });
    expectCode(r, '42501');
  });

  it('anon INSERT raises 42501', async () => {
    const r = await as(p, 'anon')
      .from('audit_events')
      .insert({ action: 'lockdown.direct-insert', source: 'system', resource_type: 'test' });
    expectCode(r, '42501');
  });

  it('service-role via PostgREST INSERT raises 42501 (GRANT revoked from service_role)', async () => {
    // svc uses the service_role JWT via PostgREST.
    // The SQL GRANT revokes INSERT from service_role, so this should fail.
    const r = await svc
      .from('audit_events')
      .insert({ action: 'lockdown.direct-insert', source: 'system', resource_type: 'test' });
    if (r.error) {
      // Expected: permission denied. Accept either 42501 or PGRST error code.
      const code = r.error.code ?? '';
      const msg = (r.error.message ?? '').toLowerCase();
      const isDenied = code === '42501' || msg.includes('permission') || msg.includes('denied');
      expect(isDenied, `expected permission denial, got ${code}: ${r.error.message}`).toBe(true);
    } else {
      // If service_role succeeded, this is a gap: document it rather than
      // silently pass. Fail with an informative message.
      throw new Error(
        'GAP: service_role via PostgREST succeeded on direct INSERT into audit_events. ' +
        'The GRANT revocation from 20260510000100 may not be effective for service_role ' +
        'in the current Supabase version. Audit this configuration.',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Direct UPDATE denied for authenticated personas
// ---------------------------------------------------------------------------

describe('direct UPDATE on audit_events is denied', () => {
  it('tenant_owner UPDATE raises 42501', async () => {
    const r = await as(p, 'tenant_owner')
      .from('audit_events')
      .update({ actor_email: 'tamper@evil.test' })
      .eq('id', seedRowId);
    expectCode(r, '42501');
  });

  it('space_owner UPDATE raises 42501', async () => {
    const r = await as(p, 'space_owner')
      .from('audit_events')
      .update({ actor_email: 'tamper@evil.test' })
      .eq('id', seedRowId);
    expectCode(r, '42501');
  });

  it('anon UPDATE raises 42501', async () => {
    const r = await as(p, 'anon')
      .from('audit_events')
      .update({ actor_email: 'tamper@evil.test' })
      .eq('id', seedRowId);
    expectCode(r, '42501');
  });

  it('service-role via PostgREST UPDATE raises 42501 (GRANT revoked from service_role)', async () => {
    const r = await svc
      .from('audit_events')
      .update({ actor_email: 'tamper@evil.test' })
      .eq('id', seedRowId);
    if (r.error) {
      const code = r.error.code ?? '';
      const msg = (r.error.message ?? '').toLowerCase();
      const isDenied = code === '42501' || msg.includes('permission') || msg.includes('denied');
      expect(isDenied, `expected permission denial, got ${code}: ${r.error.message}`).toBe(true);
    } else {
      throw new Error(
        'GAP: service_role via PostgREST succeeded on direct UPDATE of audit_events. ' +
        'The GRANT revocation from 20260510000100 may not be effective for service_role. ' +
        'Audit this configuration.',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Direct DELETE denied for authenticated personas
// ---------------------------------------------------------------------------

describe('direct DELETE on audit_events is denied', () => {
  it('tenant_owner DELETE raises 42501', async () => {
    const r = await as(p, 'tenant_owner')
      .from('audit_events')
      .delete()
      .eq('id', seedRowId);
    expectCode(r, '42501');
  });

  it('space_owner DELETE raises 42501', async () => {
    const r = await as(p, 'space_owner')
      .from('audit_events')
      .delete()
      .eq('id', seedRowId);
    expectCode(r, '42501');
  });

  it('anon DELETE raises 42501', async () => {
    const r = await as(p, 'anon')
      .from('audit_events')
      .delete()
      .eq('id', seedRowId);
    expectCode(r, '42501');
  });

  it('service-role via PostgREST DELETE raises 42501 (GRANT revoked from service_role)', async () => {
    const r = await svc
      .from('audit_events')
      .delete()
      .eq('id', seedRowId);
    if (r.error) {
      const code = r.error.code ?? '';
      const msg = (r.error.message ?? '').toLowerCase();
      const isDenied = code === '42501' || msg.includes('permission') || msg.includes('denied');
      expect(isDenied, `expected permission denial, got ${code}: ${r.error.message}`).toBe(true);
    } else {
      throw new Error(
        'GAP: service_role via PostgREST succeeded on direct DELETE from audit_events. ' +
        'The GRANT revocation from 20260510000100 may not be effective for service_role. ' +
        'Audit this configuration.',
      );
    }
  });
});
