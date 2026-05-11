/**
 * audit-list-export.spec.ts
 *
 * list_audit_events and export_audit_events_csv RPC tests.
 *
 * Setup: four audit rows are seeded across two tenants (tenant_a = personas.org.tenantId,
 * tenant_b = a scratch tenant). Rows vary by action and actor so that filter tests
 * are meaningful. All assertions use real PostgREST behavior (no direct SQL for reads).
 * Cleanup deletes seeded rows and the scratch tenant in afterAll.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPersonas, Personas, adminClient } from '../fixtures/personas';
import { createScratchTenant } from '../fixtures/scratch';
import { as, expectOk } from '../harness/as';
import { SupabaseClient } from '@supabase/supabase-js';
import { Client as PgClient } from 'pg';

const SUPABASE_DB_URL =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const ACTION_ALPHA = '11vit-list.alpha';
const ACTION_BETA  = '11vit-list.beta';
const ACTION_GAMMA = '11vit-list.gamma';
const CSV_ACTION   = '12vit-csv.seed';

let p: Personas;
let svc: SupabaseClient;

// Scratch tenant B (distinct from personas.org.tenantId = tenant A).
let scratchTenantB: Awaited<ReturnType<typeof createScratchTenant>>;

// Actor X: a synthetic user we seed two rows under to test actor filter.
let actorXId: string;

beforeAll(async () => {
  p = await buildPersonas();
  svc = adminClient();

  // Create actor X via admin API.
  const { data: axData, error: axErr } = await svc.auth.admin.createUser({
    email: `actor-x-${Date.now()}@list-test.invalid`,
    email_confirm: true,
  });
  if (axErr) throw new Error(`createUser actor-x: ${axErr.message}`);
  actorXId = axData.user!.id;

  // Scratch tenant B (under personas.org.agencyId).
  scratchTenantB = await createScratchTenant(p);

  const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
  try {
    await pg.connect();

    // Seed: tenant_a rows (actor = actorX)
    // Use is_local=false (session-level) so the GUC persists across separate
    // query() calls in the same pg session (is_local=true is transaction-scoped
    // and resets after each auto-committed statement).
    await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [actorXId]);
    await pg.query(
      `select public.record_audit_event($1,'system','test',null,null,$2,null,'{}')`,
      [ACTION_ALPHA, p.org.tenantId],
    );
    await pg.query(
      `select public.record_audit_event($1,'system','test',null,null,$2,null,'{}')`,
      [ACTION_BETA, p.org.tenantId],
    );

    // Seed: tenant_b rows (actor = tenant_owner persona)
    await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [p.ids.tenant_owner]);
    await pg.query(
      `select public.record_audit_event($1,'system','test',null,null,$2,null,'{}')`,
      [ACTION_ALPHA, scratchTenantB.tenantId],
    );
    await pg.query(
      `select public.record_audit_event($1,'system','test',null,null,$2,null,'{}')`,
      [ACTION_GAMMA, scratchTenantB.tenantId],
    );

    // CSV test rows (3 platform-scoped rows for the CSV export test)
    await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [p.ids.platform_admin]);
    for (let i = 0; i < 3; i++) {
      await pg.query(
        `select public.record_audit_event($1,'system','test',null,null,null,null,'{}')`,
        [CSV_ACTION],
      );
    }
  } finally {
    await pg.end();
  }
}, 60_000);

afterAll(async () => {
  const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
  try {
    await pg.connect();
    await pg.query(
      `delete from public.audit_events where action like '11vit-list.%' or action like '12vit-csv.%'`,
    );
  } finally {
    await pg.end();
  }

  if (scratchTenantB) await scratchTenantB.cleanup();
  if (actorXId) await svc.auth.admin.deleteUser(actorXId);
});

// ---------------------------------------------------------------------------
// list_audit_events: basic scope
// ---------------------------------------------------------------------------

describe('list_audit_events scope filter', () => {
  it('platform_admin with scope=platform sees all 4 seeded rows', async () => {
    const r = await as(p, 'platform_admin').rpc('list_audit_events', {
      p_scope_kind: 'platform',
      p_scope_id: null,
    });
    const rows = expectOk(r) as { action: string }[];
    const seeded = rows.filter((row) => row.action.startsWith('11vit-list.'));
    expect(seeded.length).toBeGreaterThanOrEqual(4);
  });

  it('tenant_owner sees only their tenant rows (tenant_a rows)', async () => {
    // tenant_owner owns personas.org.tenantId (tenant_a).
    const r = await as(p, 'tenant_owner').rpc('list_audit_events', {
      p_scope_kind: 'tenant',
      p_scope_id: p.org.tenantId,
    });
    const rows = expectOk(r) as { action: string }[];
    const seeded = rows.filter((row) => row.action.startsWith('11vit-list.'));
    expect(seeded.length).toBe(2);
  });

  it('tenant_owner calling list_audit_events for tenant_b gets zero rows (RLS denies)', async () => {
    const r = await as(p, 'tenant_owner').rpc('list_audit_events', {
      p_scope_kind: 'tenant',
      p_scope_id: scratchTenantB.tenantId,
    });
    const rows = expectOk(r) as { action: string }[];
    const seeded = rows.filter((row) => row.action.startsWith('11vit-list.'));
    expect(seeded.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// list_audit_events: action filter
// ---------------------------------------------------------------------------

describe('list_audit_events action filter', () => {
  it('p_action filter narrows to exact matching action only', async () => {
    // Two rows across both tenants have action = '11vit-list.alpha'.
    const r = await as(p, 'platform_admin').rpc('list_audit_events', {
      p_scope_kind: 'platform',
      p_scope_id: null,
      p_action: ACTION_ALPHA,
    });
    const rows = expectOk(r) as { action: string }[];
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.action).toBe(ACTION_ALPHA);
    }
  });

  it('p_action filter with no match returns empty array', async () => {
    const r = await as(p, 'platform_admin').rpc('list_audit_events', {
      p_scope_kind: 'platform',
      p_scope_id: null,
      p_action: '11vit-list.does-not-exist',
    });
    const rows = expectOk(r) as unknown[];
    expect(rows.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// list_audit_events: actor filter
// ---------------------------------------------------------------------------

describe('list_audit_events actor filter', () => {
  it('p_actor_user_id filter returns only that actor\'s rows', async () => {
    // actorX emitted 2 rows (both tenant_a rows).
    const r = await as(p, 'platform_admin').rpc('list_audit_events', {
      p_scope_kind: 'platform',
      p_scope_id: null,
      p_actor_user_id: actorXId,
    });
    const rows = expectOk(r) as { action: string; actor_user_id: string }[];
    const seeded = rows.filter((row) => row.action.startsWith('11vit-list.'));
    expect(seeded.length).toBe(2);
    for (const row of seeded) {
      expect(row.actor_user_id).toBe(actorXId);
    }
  });
});

// ---------------------------------------------------------------------------
// list_audit_events: date-range filter
// ---------------------------------------------------------------------------

describe('list_audit_events date-range filter', () => {
  it('p_from in the far future returns empty array', async () => {
    const r = await as(p, 'platform_admin').rpc('list_audit_events', {
      p_scope_kind: 'platform',
      p_scope_id: null,
      p_from: '2099-01-01T00:00:00Z',
    });
    const rows = expectOk(r) as unknown[];
    expect(rows.length).toBe(0);
  });

  it('p_to in the far past returns empty array', async () => {
    const r = await as(p, 'platform_admin').rpc('list_audit_events', {
      p_scope_kind: 'platform',
      p_scope_id: null,
      p_to: '2000-01-01T00:00:00Z',
    });
    const rows = expectOk(r) as unknown[];
    expect(rows.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// list_audit_events: pagination
// ---------------------------------------------------------------------------

describe('list_audit_events pagination', () => {
  it('p_limit=1 returns at most 1 row', async () => {
    const r = await as(p, 'platform_admin').rpc('list_audit_events', {
      p_scope_kind: 'platform',
      p_scope_id: null,
      p_limit: 1,
    });
    const rows = expectOk(r) as unknown[];
    expect(rows.length).toBeLessThanOrEqual(1);
  });

  it('p_offset skips rows (offset beyond count returns empty)', async () => {
    const r = await as(p, 'platform_admin').rpc('list_audit_events', {
      p_scope_kind: 'platform',
      p_scope_id: null,
      p_action: ACTION_ALPHA,
      p_offset: 1000,
    });
    const rows = expectOk(r) as unknown[];
    expect(rows.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// export_audit_events_csv: header and row count
// ---------------------------------------------------------------------------

const CSV_HEADER =
  'occurred_at,action,source,rpc_name,actor_user_id,actor_email,actor_role,actor_ip,actor_user_agent,request_id,agency_id,tenant_id,space_id,resource_type,resource_id,metadata';

describe('export_audit_events_csv', () => {
  it('returns a string starting with the CSV header', async () => {
    const r = await as(p, 'platform_admin').rpc('export_audit_events_csv', {
      p_scope_kind: 'platform',
      p_scope_id: null,
      p_action: CSV_ACTION,
    });
    const csv = expectOk(r) as string;
    expect(typeof csv).toBe('string');
    expect(csv.startsWith(CSV_HEADER)).toBe(true);
  });

  it('returns header-only when zero rows match', async () => {
    const r = await as(p, 'platform_admin').rpc('export_audit_events_csv', {
      p_scope_kind: 'platform',
      p_scope_id: null,
      p_action: '12vit-csv.no-match',
    });
    const csv = expectOk(r) as string;
    const lines = csv.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBe(1); // header only
    expect(lines[0]).toBe(CSV_HEADER);
  });

  it('returns header + 3 data rows matching the seeded CSV_ACTION', async () => {
    const r = await as(p, 'platform_admin').rpc('export_audit_events_csv', {
      p_scope_kind: 'platform',
      p_scope_id: null,
      p_action: CSV_ACTION,
    });
    const csv = expectOk(r) as string;
    const lines = csv.split('\n').filter((l) => l.length > 0 && l !== CSV_HEADER);
    expect(lines.length).toBe(3);
  });

  it('tenant_owner sees zero CSV rows for a scope they don\'t own', async () => {
    // tenant_owner calling export for scratch tenant_b (which they don't own) returns header only.
    const r = await as(p, 'tenant_owner').rpc('export_audit_events_csv', {
      p_scope_kind: 'tenant',
      p_scope_id: scratchTenantB.tenantId,
    });
    const csv = expectOk(r) as string;
    const lines = csv.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBe(1); // header only
  });
});
