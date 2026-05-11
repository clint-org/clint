/**
 * audit-redaction.spec.ts
 *
 * GDPR redact_user_pii() tests:
 *   1. Non-platform-admin call raises 42501.
 *   2. Platform admin call scrubs actor_email, actor_ip, actor_user_agent.
 *   3. Known PII keys in metadata (email, user_email, display_name, etc.) are removed.
 *   4. Non-PII metadata keys (value, seq) are preserved.
 *   5. action and resource_type are preserved.
 *   6. A compliance.user_pii_redacted event is emitted with metadata.row_count.
 *
 * Setup: a synthetic auth.users row is created via the service-role admin API
 * so redact_user_pii has a real user to target. Direct pg INSERT seeds two
 * audit rows with PII fields. Cleanup removes the synthetic user (which
 * on-delete-sets-null on actor_user_id; we delete the audit rows first).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPersonas, Personas, adminClient } from '../fixtures/personas';
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
  const { data, error } = await svc.auth.admin.createUser({
    email: `gdpr-subject-${Date.now()}@redaction.invalid`,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser for redaction subject: ${error.message}`);
  subjectUserId = data.user!.id;

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
}, 60_000);

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
