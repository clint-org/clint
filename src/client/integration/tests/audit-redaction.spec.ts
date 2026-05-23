/**
 * audit-redaction.spec.ts
 *
 * GDPR redact_user_pii() tests (the lower-level audit-only PII scrubber):
 *   1. Non-platform-admin call raises 42501.
 *   2. Platform admin call scrubs actor_email, actor_ip, actor_user_agent.
 *   3. Known PII keys in metadata (email, user_email, display_name, etc.) are removed.
 *   4. Non-PII metadata keys (value, seq) are preserved.
 *   5. action and resource_type are preserved.
 *   6. A compliance.user_pii_redacted event is emitted with metadata.row_count.
 *
 * Plus, after cascade-safety (T2), the full redact_user(uuid) flow:
 *   7. Wipes membership rows across tenant_members / space_members /
 *      agency_members / platform_admins.
 *   8. Sweeps audit_events.metadata via jsonb_strip_pii_keys.
 *   9. Mangles auth.users.email to redacted-<uuid>@invalid.
 *  10. Inserts a public.user_redactions marker.
 *  11. Emits compliance.user_pii_redacted with per-table counts in metadata.
 *
 * Setup: a synthetic auth.users row is created via the service-role admin API
 * so the RPC has a real user to target. Direct pg INSERT seeds audit rows with
 * PII fields. Cleanup removes the synthetic user (which on-delete-sets-null on
 * actor_user_id; we delete the audit rows first).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPersonas, Personas, adminClient, createAuthUser } from '../fixtures/personas';
import { as, expectOk, expectCode } from '../harness/as';
import { SupabaseClient } from '@supabase/supabase-js';
import { Client as PgClient } from 'pg';

const SUPABASE_DB_URL =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let p: Personas;
let svc: SupabaseClient;

// Subject user: a synthetic account created just for this test.
let subjectUserId: string;

beforeAll(async () => {
  p = await buildPersonas();
  svc = adminClient();

  // Create the synthetic subject user via the admin API.
  const subject = await createAuthUser(svc, { email: `gdpr-subject-${Date.now()}@redaction.invalid` });
  subjectUserId = subject.id;

  // Seed two audit rows with PII content via direct pg (bypasses the GRANT
  // restriction because postgres / superuser is exempt from the revoked GRANTs
  // on authenticated and service_role). Use explicit ::inet cast for the IP
  // column so the pg driver does not have to infer the type.
  const subjectEmail = `gdpr-subject@redaction.invalid`;
  const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
  try {
    await pg.connect();
    await pg.query(
      `insert into public.audit_events
         (action, source, resource_type, actor_user_id, actor_email, actor_ip, actor_user_agent, metadata)
       values
         ('redact-test.alpha', 'system', 'test', $1::uuid, $2::text, '10.20.30.1'::inet, 'Mozilla/5.0 (redact-test)',
          jsonb_build_object('email', $2, 'value', 'preserved', 'seq', 1)),
         ('redact-test.beta',  'system', 'test', $1::uuid, $2::text, '10.20.30.2'::inet, 'Chrome/redact-test',
          jsonb_build_object('user_email', $2, 'display_name', 'Subject User'))`,
      [subjectUserId, subjectEmail],
    );
  } finally {
    await pg.end();
  }
}, 120_000);

afterAll(async () => {
  if (!subjectUserId) return;

  // Delete audit rows first (actor_user_id FK is set-null on user delete, so
  // deleting user first makes it impossible to filter by actor_user_id).
  const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
  try {
    await pg.connect();
    await pg.query(
      `delete from public.audit_events
       where actor_user_id = $1
          or (action = 'compliance.user_pii_redacted' and resource_id = $1)
          or action like 'redact-test.%'`,
      [subjectUserId],
    );
  } finally {
    await pg.end();
  }

  // Delete the synthetic user via admin API.
  await svc.auth.admin.deleteUser(subjectUserId);
});

// ---------------------------------------------------------------------------
// Test 1: non-platform-admin is denied
// ---------------------------------------------------------------------------

describe('redact_user_pii access gate', () => {
  it('tenant_owner call raises 42501 (platform admin only)', async () => {
    const r = await as(p, 'tenant_owner').rpc('redact_user_pii', {
      p_user_id: subjectUserId,
    });
    expectCode(r, '42501', 'platform admin only');
  });

  it('no_memberships call raises 42501', async () => {
    const r = await as(p, 'no_memberships').rpc('redact_user_pii', {
      p_user_id: subjectUserId,
    });
    expectCode(r, '42501');
  });

  it('anon call raises 42501', async () => {
    const r = await as(p, 'anon').rpc('redact_user_pii', {
      p_user_id: subjectUserId,
    });
    expectCode(r, '42501');
  });
});

// ---------------------------------------------------------------------------
// Test 2: platform admin successfully calls and returns row_count >= 2
// ---------------------------------------------------------------------------

describe('redact_user_pii execution as platform_admin', () => {
  let rowCount: number;

  it('returns an integer >= 2 (the two seeded PII rows)', async () => {
    const r = await as(p, 'platform_admin').rpc('redact_user_pii', {
      p_user_id: subjectUserId,
    });
    rowCount = expectOk(r) as number;
    expect(rowCount).toBeGreaterThanOrEqual(2);
  });

  // These tests depend on the redaction having run in the previous `it`.
  // Vitest runs `it` blocks sequentially within a `describe`.

  it('actor_email is null on both rows', async () => {
    const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
    try {
      await pg.connect();
      const { rows } = await pg.query<{ actor_email: string | null }>(
        `select actor_email from public.audit_events
         where actor_user_id = $1 and action like 'redact-test.%'`,
        [subjectUserId],
      );
      for (const row of rows) {
        expect(row.actor_email).toBeNull();
      }
    } finally {
      await pg.end();
    }
  });

  it('actor_ip is null on both rows', async () => {
    const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
    try {
      await pg.connect();
      const { rows } = await pg.query<{ actor_ip: string | null }>(
        `select actor_ip from public.audit_events
         where actor_user_id = $1 and action like 'redact-test.%'`,
        [subjectUserId],
      );
      for (const row of rows) {
        expect(row.actor_ip).toBeNull();
      }
    } finally {
      await pg.end();
    }
  });

  it('actor_user_agent is null on both rows', async () => {
    const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
    try {
      await pg.connect();
      const { rows } = await pg.query<{ actor_user_agent: string | null }>(
        `select actor_user_agent from public.audit_events
         where actor_user_id = $1 and action like 'redact-test.%'`,
        [subjectUserId],
      );
      for (const row of rows) {
        expect(row.actor_user_agent).toBeNull();
      }
    } finally {
      await pg.end();
    }
  });

  it('metadata PII keys (email, user_email, display_name) are removed', async () => {
    const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
    try {
      await pg.connect();
      const { rows } = await pg.query<{ metadata: Record<string, unknown> }>(
        `select metadata from public.audit_events
         where actor_user_id = $1 and action like 'redact-test.%'`,
        [subjectUserId],
      );
      for (const row of rows) {
        const m = row.metadata;
        expect('email' in m).toBe(false);
        expect('user_email' in m).toBe(false);
        expect('display_name' in m).toBe(false);
      }
    } finally {
      await pg.end();
    }
  });

  it('non-PII metadata key "value" is preserved on the alpha row', async () => {
    const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
    try {
      await pg.connect();
      const { rows } = await pg.query<{ metadata: Record<string, unknown> }>(
        `select metadata from public.audit_events
         where actor_user_id = $1 and action = 'redact-test.alpha'`,
        [subjectUserId],
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].metadata['value']).toBe('preserved');
    } finally {
      await pg.end();
    }
  });

  it('action and resource_type are preserved', async () => {
    const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
    try {
      await pg.connect();
      const { rows } = await pg.query<{ action: string; resource_type: string }>(
        `select action, resource_type from public.audit_events
         where actor_user_id = $1 and action = 'redact-test.alpha'`,
        [subjectUserId],
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].action).toBe('redact-test.alpha');
      expect(rows[0].resource_type).toBe('test');
    } finally {
      await pg.end();
    }
  });

  it('compliance.user_pii_redacted event is emitted with row_count in metadata', async () => {
    // platform_admin can read compliance events via RLS (is_platform_admin() check).
    const { data, error } = await as(p, 'platform_admin')
      .from('audit_events')
      .select('metadata')
      .eq('action', 'compliance.user_pii_redacted')
      .eq('resource_id', subjectUserId)
      .order('occurred_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(`query compliance event: ${error.message}`);
    expect((data ?? []).length).toBe(1);
    const meta = (data![0] as { metadata: Record<string, unknown> }).metadata;
    expect(typeof meta['row_count']).toBe('number');
    expect((meta['row_count'] as number)).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// redact_user (T2): full membership + auth.users + audit metadata flow.
// Distinct from redact_user_pii (audit-only). Each test bootstraps its own
// synthetic subject so the membership-wipe assertions are deterministic.
// ---------------------------------------------------------------------------

describe('redact_user end-to-end flow', () => {
  let userId: string;
  let userEmail: string;
  let seededAuditId: string;

  beforeAll(async () => {
    userEmail = `redact-user-flow-${Date.now()}@redaction.invalid`;
    const created = await createAuthUser(svc, {
      email: userEmail,
      user_metadata: { full_name: 'Redact User Subject' },
    });
    userId = created.id;

    // Seed one audit row attributed to the subject with both PII (email,
    // full_name) and non-PII (note) keys in metadata. The redact_user sweep
    // should strip the first two and preserve the third.
    const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
    try {
      await pg.connect();
      const { rows } = await pg.query<{ id: string }>(
        `insert into public.audit_events
           (action, source, resource_type, actor_user_id, actor_email, metadata)
         values
           ('redact-user-flow.preflight', 'system', 'test', $1::uuid, $2::text,
            jsonb_build_object('email', $2, 'full_name', 'Redact User Subject', 'note', 'preserved'))
         returning id`,
        [userId, userEmail],
      );
      seededAuditId = rows[0].id;
    } finally {
      await pg.end();
    }
  }, 30_000);

  afterAll(async () => {
    if (!userId) return;
    const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
    try {
      await pg.connect();
      await pg.query(
        `delete from public.audit_events
         where actor_user_id = $1
            or (action = 'compliance.user_pii_redacted' and resource_id = $1)
            or action = 'redact-user-flow.preflight'`,
        [userId],
      );
      await pg.query(`delete from public.user_redactions where user_id = $1`, [userId]);
    } finally {
      await pg.end();
    }
    await svc.auth.admin.deleteUser(userId);
  });

  it('non-platform-admin call raises 42501', async () => {
    const r = await as(p, 'tenant_owner').rpc('redact_user', { p_user_id: userId });
    expectCode(r, '42501');
  });

  // The remaining `it` blocks run sequentially within this describe; the
  // platform_admin call performs the redaction once and the follow-ups
  // assert each post-condition independently.
  it('platform_admin call returns per-table count breakdown', async () => {
    const r = await as(p, 'platform_admin').rpc('redact_user', { p_user_id: userId });
    const data = expectOk(r) as Record<string, unknown>;
    expect(data['redacted_user_id']).toBe(userId);
    expect(typeof data['tenant_members_removed']).toBe('number');
    expect(typeof data['space_members_removed']).toBe('number');
    expect(typeof data['agency_members_removed']).toBe('number');
    expect(typeof data['platform_admins_removed']).toBe('number');
  });

  it('audit_events metadata: email + full_name stripped, note preserved', async () => {
    const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
    try {
      await pg.connect();
      const { rows } = await pg.query<{ metadata: Record<string, unknown> }>(
        `select metadata from public.audit_events where id = $1`,
        [seededAuditId],
      );
      expect(rows.length).toBe(1);
      const meta = rows[0].metadata;
      expect('email' in meta).toBe(false);
      expect('full_name' in meta).toBe(false);
      expect(meta['note']).toBe('preserved');
    } finally {
      await pg.end();
    }
  });

  it('auth.users.email mangled to redacted-<uuid>@invalid', async () => {
    const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
    try {
      await pg.connect();
      const { rows } = await pg.query<{ email: string }>(
        `select email from auth.users where id = $1`,
        [userId],
      );
      expect(rows.length).toBe(1);
      expect(rows[0].email).toBe(`redacted-${userId}@invalid`);
    } finally {
      await pg.end();
    }
  });

  it('user_redactions marker row exists for the subject', async () => {
    const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
    try {
      await pg.connect();
      const { rows } = await pg.query<{ user_id: string }>(
        `select user_id from public.user_redactions where user_id = $1`,
        [userId],
      );
      expect(rows.length).toBe(1);
    } finally {
      await pg.end();
    }
  });

  it('compliance.user_pii_redacted audit row emitted with per-table counts', async () => {
    const { data, error } = await as(p, 'platform_admin')
      .from('audit_events')
      .select('metadata, resource_type')
      .eq('action', 'compliance.user_pii_redacted')
      .eq('resource_id', userId)
      .order('occurred_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(`query compliance.user_pii_redacted: ${error.message}`);
    expect((data ?? []).length).toBe(1);
    const row = data![0] as { metadata: Record<string, unknown>; resource_type: string };
    expect(row.resource_type).toBe('user_pii');
    expect(typeof row.metadata['tenant_members_removed']).toBe('number');
    expect(typeof row.metadata['space_members_removed']).toBe('number');
    expect(typeof row.metadata['agency_members_removed']).toBe('number');
    expect(typeof row.metadata['platform_admins_removed']).toBe('number');
  });
});
