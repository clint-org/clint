/**
 * Destructive RPCs. The original motivation for the scratch fixture: the
 * delete_space prod regression slipped through because the integration suite
 * had explicitly skipped destructive ops as out-of-scope.
 *
 * After cascade-safety (T5), the canonical space lifecycle is
 *   archive_space -> restore_space -> permanently_delete_space.
 * Deeper role-matrix coverage of the new RPCs lives in
 * rpc-cascade-safety.spec.ts (T13); the smoke describes here exist to catch
 * regressions in the gate wiring without duplicating that file.
 *
 * After cascade-safety (T1), delete_material's return shape no longer
 * includes file_path -- the AFTER DELETE trigger on materials enqueues the
 * path into public.r2_pending_deletes for the cloudflare worker to drain.
 * Tests below assert both the new return shape and the queue side-effect.
 */

import { Client as PgClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPersonas, Personas, adminClient } from '../fixtures/personas';
import { createScratchAgency, createScratchSpace } from '../fixtures/scratch';
import { as, expectOk, expectCode } from '../harness/as';
import { SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_DB_URL =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let p: Personas;
let svc: SupabaseClient;

beforeAll(async () => {
  p = await buildPersonas();
  svc = adminClient();
}, 120_000);

// ============================================================================
// archive_space / restore_space / permanently_delete_space (T5)
//
// Smoke-level coverage of the new space lifecycle RPCs. Deep role-matrix
// coverage lives in rpc-cascade-safety.spec.ts (T13); these tests catch
// gate-wiring regressions without duplicating the matrix.
// ============================================================================

describe('rpc archive_space (smoke)', () => {
  it('tenant_owner: ok (implicit space-owner via tenant ownership)', async () => {
    const scratch = await createScratchSpace(p);
    try {
      const r = await as(p, 'tenant_owner').rpc('archive_space', {
        p_space_id: scratch.spaceId,
      });
      expectOk(r);
    } finally {
      await scratch.cleanup();
    }
  });

  it('contributor: 42501 (no owner role on the scratch space)', async () => {
    const scratch = await createScratchSpace(p);
    try {
      const r = await as(p, 'contributor').rpc('archive_space', {
        p_space_id: scratch.spaceId,
      });
      expectCode(r, '42501');
    } finally {
      await scratch.cleanup();
    }
  });

  it('reader: 42501 (no owner role on the scratch space)', async () => {
    const scratch = await createScratchSpace(p);
    try {
      const r = await as(p, 'reader').rpc('archive_space', {
        p_space_id: scratch.spaceId,
      });
      expectCode(r, '42501');
    } finally {
      await scratch.cleanup();
    }
  });
});

describe('rpc restore_space (smoke)', () => {
  it('tenant_owner: ok on archived space', async () => {
    const scratch = await createScratchSpace(p);
    try {
      // archive first so restore has something to invert.
      expectOk(await as(p, 'tenant_owner').rpc('archive_space', { p_space_id: scratch.spaceId }));
      const r = await as(p, 'tenant_owner').rpc('restore_space', { p_space_id: scratch.spaceId });
      expectOk(r);
    } finally {
      await scratch.cleanup();
    }
  });

  it('contributor: 42501', async () => {
    const scratch = await createScratchSpace(p);
    try {
      expectOk(await as(p, 'tenant_owner').rpc('archive_space', { p_space_id: scratch.spaceId }));
      const r = await as(p, 'contributor').rpc('restore_space', { p_space_id: scratch.spaceId });
      expectCode(r, '42501');
    } finally {
      await scratch.cleanup();
    }
  });

  it('reader: 42501', async () => {
    const scratch = await createScratchSpace(p);
    try {
      expectOk(await as(p, 'tenant_owner').rpc('archive_space', { p_space_id: scratch.spaceId }));
      const r = await as(p, 'reader').rpc('restore_space', { p_space_id: scratch.spaceId });
      expectCode(r, '42501');
    } finally {
      await scratch.cleanup();
    }
  });
});

describe('rpc permanently_delete_space (smoke)', () => {
  it('tenant_owner on archived space: ok', async () => {
    const scratch = await createScratchSpace(p);
    try {
      expectOk(await as(p, 'tenant_owner').rpc('archive_space', { p_space_id: scratch.spaceId }));
      const r = await as(p, 'tenant_owner').rpc('permanently_delete_space', {
        p_space_id: scratch.spaceId,
      });
      expectOk(r);
    } finally {
      // Idempotent: scratch.cleanup is a no-op when the RPC already wiped the
      // space row (the helper just runs delete-where-id which matches zero rows).
      await scratch.cleanup();
    }
  });

  it('tenant_owner on non-archived space: 42501 (must archive first)', async () => {
    const scratch = await createScratchSpace(p);
    try {
      const r = await as(p, 'tenant_owner').rpc('permanently_delete_space', {
        p_space_id: scratch.spaceId,
      });
      expectCode(r, '42501');
    } finally {
      await scratch.cleanup();
    }
  });

  it('reader: 42501', async () => {
    const scratch = await createScratchSpace(p);
    try {
      // Even if the space were archived, reader is not a tenant owner and not a
      // platform admin -- the gate rejects before the archive check.
      const r = await as(p, 'reader').rpc('permanently_delete_space', {
        p_space_id: scratch.spaceId,
      });
      expectCode(r, '42501');
    } finally {
      await scratch.cleanup();
    }
  });
});

describe('rpc delete_agency', () => {
  it('platform_admin: gate accepts (RPC requires empty agency, scratch has a tenant)', async () => {
    // createScratchAgency provisions a tenant + space under the agency, so
    // delete_agency raises 23503 ("still has N tenants") -- a clear signal
    // the gate accepted us and the RPC's empty-agency precondition fired.
    // 42501 here would be the failure mode (gate wrongly rejects platform_admin).
    const scratch = await createScratchAgency(p);
    try {
      const r = await as(p, 'platform_admin').rpc('delete_agency', {
        p_agency_id: scratch.agencyId,
      });
      if (r.error?.code === '42501') {
        throw new Error('platform_admin denied at gate; expected accept-then-precondition');
      }
    } finally {
      await scratch.cleanup();
    }
  });

  it('agency_only: denied (not their agency)', async () => {
    const scratch = await createScratchAgency(p);
    try {
      const r = await as(p, 'agency_only').rpc('delete_agency', {
        p_agency_id: scratch.agencyId,
      });
      if (r.error?.code !== '42501' && r.error?.code !== 'P0001') {
        throw new Error(`expected denial, got ${r.error?.code}: ${r.error?.message}`);
      }
    } finally {
      await scratch.cleanup();
    }
  });
});

describe('rpc delete_material', () => {
  it('reader: 42501 / P0001', async () => {
    const r = await as(p, 'reader').rpc('delete_material', {
      p_id: '00000000-0000-0000-0000-000000000000',
    });
    if (r.error?.code !== '42501' && r.error?.code !== 'P0001' && r.error?.code !== 'P0002') {
      throw new Error(`expected denial, got ${r.error?.code}: ${r.error?.message}`);
    }
  });

  it('space_owner: error for non-existent material (gate accepts, then 404)', async () => {
    const r = await as(p, 'space_owner').rpc('delete_material', {
      p_id: '00000000-0000-0000-0000-000000000000',
    });
    if (!r.error) throw new Error('expected error for non-existent material');
    // Should NOT be 42501 -- that would mean the gate wrongly rejected
    // space_owner. Any other error is fine (P0002 not-found, etc).
    if (r.error.code === '42501') {
      throw new Error('space_owner unexpectedly denied at gate');
    }
  });

  // After T1: delete_material returns { material_id } only (file_path dropped),
  // and the AFTER DELETE trigger enqueues a row into public.r2_pending_deletes.
  describe('return shape + r2_pending_deletes enqueue (T1)', () => {
    // Build a real material owned by tenant_owner (uploaded_by must equal the
    // caller, and the caller must hold owner/editor access on the space).
    let materialId: string;
    let filePath: string;
    let scratch: Awaited<ReturnType<typeof createScratchSpace>>;

    beforeAll(async () => {
      scratch = await createScratchSpace(p);
      materialId = '00000000-0000-0000-0000-000000000000';
      filePath = '';

      // Insert the material via direct pg as the postgres role so RLS doesn't
      // get in the way. uploaded_by must be tenant_owner so the RPC's
      // (uploaded_by = auth.uid()) check passes when called as tenant_owner.
      const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
      try {
        await pg.connect();
        const { rows } = await pg.query<{ id: string; file_path: string }>(
          `insert into public.materials
             (space_id, uploaded_by, file_path, file_name, file_size_bytes,
              mime_type, material_type, title)
           values
             ($1::uuid, $2::uuid,
              'materials/' || $1::text || '/r2-queue-smoke/' || gen_random_uuid() || '/test.pdf',
              'test.pdf', 1024, 'application/pdf', 'briefing', 'r2-queue-smoke')
           returning id, file_path`,
          [scratch.spaceId, p.ids.tenant_owner],
        );
        materialId = rows[0].id;
        filePath = rows[0].file_path;
      } finally {
        await pg.end();
      }
    });

    afterAll(async () => {
      // Sweep the queue row this test inserted so subsequent runs don't see
      // accumulated noise. Space-cascade cleanup is handled by scratch.cleanup.
      const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
      try {
        await pg.connect();
        if (filePath) {
          await pg.query(`delete from public.r2_pending_deletes where file_path = $1`, [filePath]);
        }
      } finally {
        await pg.end();
      }
      if (scratch) await scratch.cleanup();
    });

    it('returns { material_id } only -- no file_path key', async () => {
      const r = await as(p, 'tenant_owner').rpc('delete_material', { p_id: materialId });
      const data = expectOk(r) as Record<string, unknown>;
      expect(data['material_id']).toBe(materialId);
      // T1 explicitly dropped this key; assert it is gone.
      expect('file_path' in data).toBe(false);
    });

    it('enqueues one public.r2_pending_deletes row with the deleted file_path', async () => {
      // The previous `it` performed the delete; the AFTER DELETE trigger should
      // have left exactly one row in r2_pending_deletes carrying our file_path.
      const { data, error } = await svc
        .from('r2_pending_deletes')
        .select('file_path, succeeded_at')
        .eq('file_path', filePath);
      if (error) throw new Error(`query r2_pending_deletes: ${error.message}`);
      expect(data?.length).toBe(1);
      // succeeded_at is null because the worker hasn't drained yet (test env).
      expect((data![0] as { succeeded_at: string | null }).succeeded_at).toBeNull();
    });
  });
});

describe('rpc delete_primary_intelligence', () => {
  // Both personas hit the RPC with a non-existent uuid. The RPC silently
  // no-ops on missing ids (no error, no data), so gate-level denial would
  // surface as 42501. Anything else means the RPC was reachable.
  it('tenant_owner: gate-level denial or silent no-op (not 5xx)', async () => {
    const r = await as(p, 'tenant_owner').rpc('delete_primary_intelligence', {
      p_id: '00000000-0000-0000-0000-000000000000',
    });
    if (r.error && r.error.code?.startsWith('5')) {
      throw new Error(`unexpected server error: ${r.error.code}: ${r.error.message}`);
    }
  });

  it('agency_only: gate-level denial or silent no-op', async () => {
    const r = await as(p, 'agency_only').rpc('delete_primary_intelligence', {
      p_id: '00000000-0000-0000-0000-000000000000',
    });
    if (r.error && r.error.code?.startsWith('5')) {
      throw new Error(`unexpected server error: ${r.error.code}: ${r.error.message}`);
    }
  });
});
