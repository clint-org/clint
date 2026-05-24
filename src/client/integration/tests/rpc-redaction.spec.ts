/**
 * rpc-redaction.spec.ts
 *
 * End-to-end coverage for the redact_user RPC introduced by migration
 * 20260521120100_user_redaction_rpc. Builds a single hermetic fixture
 * (synthetic auth.users target with a known password, plus a scratch
 * agency/tenant/space and authorship rows on spaces / markers / materials /
 * primary_intelligence) once in beforeAll. After the happy-path call in
 * test #1, the target user is redacted for the remainder of the file; the
 * subsequent tests assert downstream effects (login failure, audit metadata
 * sweep) and the idempotent-second-call / non-existent-user paths run against
 * the post-redaction state.
 *
 * Cleanup in afterAll runs under the clint.member_guard_cascade bypass GUC
 * so the member-self-protection triggers don't block teardown.
 *
 * Maps to design doc section "#6 User redaction" and spec task T14.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Client as PgClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { buildPersonas, Personas, adminClient, createAuthUser } from '../fixtures/personas';
import { as, expectOk, expectCode } from '../harness/as';

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_DB_URL =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const TARGET_PASSWORD = 'redact-spec-password-Aa1!-' + randomUUID().slice(0, 8);

let p: Personas;
let svc: SupabaseClient;

// Synthetic target user + scratch graph created once in beforeAll. All ids
// are captured so afterAll can clean up regardless of which test failed.
let targetUserId: string;
let targetEmail: string;
let agencyId: string;
let tenantId: string;
let spaceId: string;
let markerId: string;
let materialId: string;
let piId: string;

/**
 * Resolve a global (space_id is null) marker_type that we can attach the
 * authorship marker to. Falls back to a clear error if the seed shape
 * has drifted.
 */
async function pickGlobalMarkerType(pg: PgClient): Promise<string> {
  const { rows } = await pg.query<{ id: string }>(
    `select id from public.marker_types where space_id is null limit 1`,
  );
  if (rows.length === 0) {
    throw new Error('rpc-redaction.spec: no global marker_type available in seed');
  }
  return rows[0].id;
}

beforeAll(async () => {
  p = await buildPersonas();
  svc = adminClient();

  // ---- 1. synthesize the target auth.users row with a known password so a
  //         downstream signInWithPassword attempt has something to push against.
  //         The @clint.local suffix is one of three patterns that the
  //         auto_join_demo_tenant_local trigger explicitly skips, which keeps
  //         the target's pre-redact membership graph exactly the four rows we
  //         insert below (no auto-joined demo memberships).
  targetEmail = `redact-target-${Date.now()}-${randomUUID().slice(0, 8)}@clint.local`;
  const created = await createAuthUser(svc, { email: targetEmail, password: TARGET_PASSWORD });
  targetUserId = created.id;

  // ---- 2. build the scratch graph and authorship rows via direct pg. Doing
  //         this through the supabase-js client would require switching
  //         impersonation between owner identities for each row; pg is faster
  //         and the test owns its own cleanup.
  agencyId = randomUUID();
  tenantId = randomUUID();
  spaceId = randomUUID();
  markerId = randomUUID();
  materialId = randomUUID();
  piId = randomUUID();

  const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
  try {
    await pg.connect();
    await pg.query('begin');

    const markerTypeId = await pickGlobalMarkerType(pg);

    // Agency under the target as owner so agency_members gets a row.
    await pg.query(
      `insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        agencyId,
        `RedactTarget Agency ${randomUUID().slice(0, 8)}`,
        `pftest-tx-redact-${randomUUID().slice(0, 8)}`,
        `pftest-tx-redact-${randomUUID().slice(0, 8)}`,
        'RedactTarget',
        targetEmail,
      ],
    );
    await pg.query(
      `insert into public.agency_members (agency_id, user_id, role)
       values ($1, $2, 'owner')`,
      [agencyId, targetUserId],
    );

    // Tenant + tenant_members. role 'owner' is the only valid non-member role
    // per CLAUDE.md tenant constraint.
    await pg.query(
      `insert into public.tenants (id, name, slug, subdomain, agency_id)
       values ($1, $2, $3, $4, $5)`,
      [
        tenantId,
        `RedactTarget Tenant ${randomUUID().slice(0, 8)}`,
        `pftest-tx-rt-${randomUUID().slice(0, 8)}`,
        `pftest-tx-rt-${randomUUID().slice(0, 8)}`,
        agencyId,
      ],
    );
    await pg.query(
      `insert into public.tenant_members (tenant_id, user_id, role)
       values ($1, $2, 'owner')`,
      [tenantId, targetUserId],
    );

    // Space whose created_by is the target. Membership row also added so
    // space_members will have something to wipe.
    await pg.query(
      `insert into public.spaces (id, tenant_id, name, created_by)
       values ($1, $2, $3, $4)`,
      [spaceId, tenantId, 'RedactTarget Space', targetUserId],
    );
    await pg.query(
      `insert into public.space_members (space_id, user_id, role)
       values ($1, $2, 'owner')`,
      [spaceId, targetUserId],
    );

    // Promote the target to platform_admin so the platform_admins row is in
    // scope of the wipe. The persona graph already has its own platform_admin;
    // adding the target is independent.
    await pg.query(`insert into public.platform_admins (user_id) values ($1)`, [targetUserId]);

    // ---- authorship rows that must survive the redaction.
    // The markers BEFORE INSERT trigger requires a valid auth.uid() for
    // changed_by. Set request.jwt.claim.sub to the target for the duration
    // of these inserts, then reset.
    await pg.query(`select set_config('request.jwt.claim.sub', $1, true)`, [targetUserId]);

    await pg.query(
      `insert into public.markers
         (id, space_id, marker_type_id, title, event_date, projection, created_by)
       values ($1, $2, $3, $4, current_date, 'actual', $5)`,
      [markerId, spaceId, markerTypeId, 'redact-spec marker', targetUserId],
    );

    await pg.query(
      `insert into public.materials
         (id, space_id, uploaded_by, file_path, file_name, file_size_bytes,
          mime_type, material_type, title)
       values ($1, $2, $3, $4, 'r.pdf', 1, 'application/pdf', 'briefing', 'redact-spec material')`,
      [
        materialId,
        spaceId,
        targetUserId,
        `materials/${spaceId}/${materialId}/r.pdf`,
      ],
    );

    await pg.query(
      `insert into public.primary_intelligence
         (id, space_id, entity_type, entity_id, state, headline, last_edited_by)
       values ($1, $2, 'marker', $3, 'draft', 'redact-spec pi', $4)`,
      [piId, spaceId, markerId, targetUserId],
    );

    // ---- seed an audit_events row attributed to the target with both pii
    //      (email, full_name) and non-pii (note) metadata. The redact_user
    //      sweep should strip the pii keys and keep the rest.
    await pg.query(
      `insert into public.audit_events
         (action, source, resource_type, actor_user_id, actor_email, metadata)
       values
         ('redact-spec.preflight', 'system', 'test', $1::uuid, $2::text,
          jsonb_build_object('email', $2::text, 'full_name', 'RedactTarget Person', 'note', 'keep me'))`,
      [targetUserId, targetEmail],
    );

    await pg.query('commit');
  } catch (err) {
    try {
      await pg.query('rollback');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    await pg.end();
  }
}, 120_000);

afterAll(async () => {
  if (!targetUserId) return;

  // Cleanup runs under the cascade bypass GUC so the membership-protection
  // triggers don't fire on the leftover rows. The redact_user call in test #1
  // already wiped the membership rows for the target; this teardown handles
  // the scratch graph and any audit rows that weren't part of the redaction.
  const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
  try {
    await pg.connect();
    await pg.query('begin');
    await pg.query(`set local clint.member_guard_cascade = 'on'`);

    // Audit rows attributed to or about the target.
    await pg.query(
      `delete from public.audit_events
       where actor_user_id = $1
          or resource_id = $1
          or action = 'redact-spec.preflight'`,
      [targetUserId],
    );

    // Authorship rows + space cascade. Order mirrors the delete_space RPC:
    // primary_intelligence and markers go first so trigger inserts have a
    // valid parent space until the parent is deleted last.
    await pg.query(`delete from public.primary_intelligence where id = $1`, [piId]);
    await pg.query(`delete from public.materials where id = $1`, [materialId]);
    await pg.query(`delete from public.markers where id = $1`, [markerId]);
    await pg.query(`delete from public.space_members where space_id = $1`, [spaceId]);
    await pg.query(`delete from public.spaces where id = $1`, [spaceId]);
    await pg.query(`delete from public.tenant_members where tenant_id = $1`, [tenantId]);
    await pg.query(`delete from public.tenants where id = $1`, [tenantId]);
    await pg.query(`delete from public.agency_members where agency_id = $1`, [agencyId]);
    await pg.query(`delete from public.agencies where id = $1`, [agencyId]);
    await pg.query(`delete from public.user_redactions where user_id = $1`, [targetUserId]);
    await pg.query(`delete from public.platform_admins where user_id = $1`, [targetUserId]);

    await pg.query('commit');
  } catch (err) {
    try {
      await pg.query('rollback');
    } catch {
      /* ignore */
    }
    // Swallow during teardown so the original test failure surfaces.
    // eslint-disable-next-line no-console
    console.error('rpc-redaction afterAll cleanup error:', err);
  } finally {
    await pg.end();
  }

  // Auth user goes last; the public-schema FKs (user_redactions on cascade,
  // platform_admins already deleted) no longer block the auth.users delete.
  await svc.auth.admin.deleteUser(targetUserId).catch(() => {
    /* swallow during teardown */
  });
});

// ---------------------------------------------------------------------------
// Case 1: happy path -- platform_admin redacts a user with content authored.
// All subsequent tests in this file run AFTER this redaction.
// ---------------------------------------------------------------------------

describe('rpc redact_user', () => {
  it('platform_admin can redact a user with content authored', async () => {
    const r = await as(p, 'platform_admin').rpc('redact_user', { p_user_id: targetUserId });
    const result = expectOk(r) as Record<string, unknown>;

    // Return shape: redacted_user_id + four per-table counts.
    expect(result['redacted_user_id']).toBe(targetUserId);
    expect(result['tenant_members_removed']).toBe(1);
    expect(result['space_members_removed']).toBe(1);
    expect(result['agency_members_removed']).toBe(1);
    expect(result['platform_admins_removed']).toBe(1);

    // ---- All four membership tables clean for the target.
    const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
    try {
      await pg.connect();
      for (const table of [
        'tenant_members',
        'space_members',
        'agency_members',
        'platform_admins',
      ]) {
        const { rows } = await pg.query<{ count: string }>(
          `select count(*)::text as count from public.${table} where user_id = $1`,
          [targetUserId],
        );
        expect(rows[0].count, `${table} should be empty for redacted user`).toBe('0');
      }

      // ---- auth.users row still exists, email mangled, meta cleared.
      const { rows: userRows } = await pg.query<{
        email: string | null;
        raw_user_meta_data: Record<string, unknown> | null;
        raw_app_meta_data: Record<string, unknown> | null;
      }>(
        `select email, raw_user_meta_data, raw_app_meta_data
         from auth.users where id = $1`,
        [targetUserId],
      );
      expect(userRows.length).toBe(1);
      expect(userRows[0].email).toBe(`redacted-${targetUserId}@invalid`);
      expect(userRows[0].raw_user_meta_data ?? {}).toEqual({});
      expect(userRows[0].raw_app_meta_data ?? {}).toEqual({});

      // ---- user_redactions marker present.
      const { rows: redactionRows } = await pg.query<{ count: string }>(
        `select count(*)::text as count from public.user_redactions where user_id = $1`,
        [targetUserId],
      );
      expect(redactionRows[0].count).toBe('1');

      // ---- Authorship rows still point at the target.
      const { rows: spaceRows } = await pg.query<{ created_by: string }>(
        `select created_by from public.spaces where id = $1`,
        [spaceId],
      );
      expect(spaceRows[0]?.created_by).toBe(targetUserId);

      const { rows: markerRows } = await pg.query<{ created_by: string }>(
        `select created_by from public.markers where id = $1`,
        [markerId],
      );
      expect(markerRows[0]?.created_by).toBe(targetUserId);

      const { rows: materialRows } = await pg.query<{ uploaded_by: string }>(
        `select uploaded_by from public.materials where id = $1`,
        [materialId],
      );
      expect(materialRows[0]?.uploaded_by).toBe(targetUserId);

      const { rows: piRows } = await pg.query<{ last_edited_by: string }>(
        `select last_edited_by from public.primary_intelligence where id = $1`,
        [piId],
      );
      expect(piRows[0]?.last_edited_by).toBe(targetUserId);
    } finally {
      await pg.end();
    }

    // ---- compliance.user_pii_redacted audit row with resource_id = target.
    const { data: auditRows, error: auditErr } = await svc
      .from('audit_events')
      .select('*')
      .eq('action', 'compliance.user_pii_redacted')
      .eq('resource_id', targetUserId)
      .order('occurred_at', { ascending: false });
    if (auditErr) throw new Error(`query compliance audit row: ${auditErr.message}`);
    expect((auditRows ?? []).length).toBeGreaterThanOrEqual(1);
    const auditRow = auditRows![0] as Record<string, unknown>;
    expect(auditRow['source']).toBe('rpc');
    const meta = auditRow['metadata'] as Record<string, unknown>;
    expect(meta['tenant_members_removed']).toBe(1);
    expect(meta['space_members_removed']).toBe(1);
    expect(meta['agency_members_removed']).toBe(1);
    expect(meta['platform_admins_removed']).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Case 2: login fails after redact.
  // -------------------------------------------------------------------------

  it('login attempts with the original email fail after redaction', async () => {
    const anonAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anonAuth.auth.signInWithPassword({
      email: targetEmail,
      password: TARGET_PASSWORD,
    });
    // Either an explicit error or a null session is acceptable as long as
    // no working session is handed back.
    if (!error) {
      expect(data.session).toBeNull();
    } else {
      expect(error.message.toLowerCase()).toMatch(/invalid|not.?found|credential|user/);
    }
  });

  // -------------------------------------------------------------------------
  // Case 3: non-platform-admin personas cannot redact.
  // -------------------------------------------------------------------------

  describe('access gate', () => {
    // Use the persona graph's platform_admin id as the redaction target for
    // these negative cases. Calls are expected to fail at the gate before
    // any mutation happens; the persona graph stays intact.
    //
    // Authenticated non-admin personas hit the in-function is_platform_admin()
    // check and raise 42501. anon doesn't even get to the function body: the
    // migration revokes EXECUTE from anon, so PostgREST returns 42501
    // ("permission denied for function redact_user") at the grant layer
    // before the auth.uid() null branch can raise 28000.
    const negativePersonas: Array<{ name: Parameters<typeof as>[1]; expectedCode: string }> = [
      { name: 'tenant_owner', expectedCode: '42501' },
      { name: 'space_owner', expectedCode: '42501' },
      { name: 'contributor', expectedCode: '42501' },
      { name: 'reader', expectedCode: '42501' },
      { name: 'anon', expectedCode: '42501' },
    ];

    for (const persona of negativePersonas) {
      it(`${persona.name} cannot call redact_user`, async () => {
        const r = await as(p, persona.name).rpc('redact_user', {
          p_user_id: p.ids.platform_admin,
        });
        expectCode(r, persona.expectedCode);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Case 4: idempotent on already-redacted.
  //
  // The migration's design notes that on_conflict do nothing preserves the
  // first redaction's timestamp, and all four membership delete blocks become
  // zero-row no-ops the second time. The function does not raise; it returns
  // a result jsonb with all counts at zero (the membership rows are already
  // gone) but emits a fresh compliance.user_pii_redacted audit row.
  // -------------------------------------------------------------------------

  it('second call on an already-redacted user is idempotent', async () => {
    // Snapshot the user_redactions.redacted_at so we can confirm it survived.
    const pgPre = new PgClient({ connectionString: SUPABASE_DB_URL });
    let originalRedactedAt: string;
    try {
      await pgPre.connect();
      const { rows } = await pgPre.query<{ redacted_at: string }>(
        `select redacted_at::text as redacted_at from public.user_redactions where user_id = $1`,
        [targetUserId],
      );
      expect(rows.length).toBe(1);
      originalRedactedAt = rows[0].redacted_at;
    } finally {
      await pgPre.end();
    }

    const r = await as(p, 'platform_admin').rpc('redact_user', { p_user_id: targetUserId });
    const result = expectOk(r) as Record<string, unknown>;
    expect(result['redacted_user_id']).toBe(targetUserId);
    // Membership tables were emptied on the first call; the second call's
    // counts are all zero.
    expect(result['tenant_members_removed']).toBe(0);
    expect(result['space_members_removed']).toBe(0);
    expect(result['agency_members_removed']).toBe(0);
    expect(result['platform_admins_removed']).toBe(0);

    // The first call's user_redactions.redacted_at timestamp is preserved
    // (on conflict do nothing). The auth.users row stays mangled.
    const pgPost = new PgClient({ connectionString: SUPABASE_DB_URL });
    try {
      await pgPost.connect();
      const { rows } = await pgPost.query<{ redacted_at: string }>(
        `select redacted_at::text as redacted_at from public.user_redactions where user_id = $1`,
        [targetUserId],
      );
      expect(rows.length).toBe(1);
      expect(rows[0].redacted_at).toBe(originalRedactedAt);

      const { rows: userRows } = await pgPost.query<{ email: string | null }>(
        `select email from auth.users where id = $1`,
        [targetUserId],
      );
      expect(userRows[0]?.email).toBe(`redacted-${targetUserId}@invalid`);
    } finally {
      await pgPost.end();
    }
  });

  // -------------------------------------------------------------------------
  // Case 5: non-existent user raises P0002.
  // -------------------------------------------------------------------------

  it('redact_user on a random uuid raises P0002', async () => {
    const ghostId = randomUUID();
    const r = await as(p, 'platform_admin').rpc('redact_user', { p_user_id: ghostId });
    expectCode(r, 'P0002');
  });

  // -------------------------------------------------------------------------
  // Case 6: audit metadata pii stripped, non-pii preserved.
  //
  // The seeded redact-spec.preflight audit row had { email, full_name, note }
  // metadata. After the happy-path redact in case 1, the sweep should have
  // dropped email and full_name and preserved note. Re-asserting it here
  // keeps the audit-metadata expectation distinct from the happy-path
  // membership / authorship checks.
  // -------------------------------------------------------------------------

  it('audit_events metadata PII keys are stripped, non-PII preserved', async () => {
    const { data, error } = await svc
      .from('audit_events')
      .select('metadata')
      .eq('actor_user_id', targetUserId)
      .eq('action', 'redact-spec.preflight')
      .limit(1);
    if (error) throw new Error(`query redact-spec.preflight: ${error.message}`);
    expect((data ?? []).length).toBe(1);
    const meta = (data![0] as { metadata: Record<string, unknown> }).metadata;
    expect('email' in meta).toBe(false);
    expect('full_name' in meta).toBe(false);
    expect(meta['note']).toBe('keep me');
  });
});
