/**
 * Destructive RPCs. The original motivation for the scratch fixture: the
 * delete_space prod regression slipped through because the integration suite
 * had explicitly skipped destructive ops as out-of-scope.
 */

import { beforeAll, describe, it } from 'vitest';
import { buildPersonas, Personas } from '../fixtures/personas';
import { createScratchAgency, createScratchSpace } from '../fixtures/scratch';
import { as, expectOk, expectCode } from '../harness/as';

let p: Personas;
beforeAll(async () => {
  p = await buildPersonas();
}, 60_000);

describe('rpc delete_space', () => {
  it('tenant_owner: ok (their own scratch space)', async () => {
    const scratch = await createScratchSpace(p);
    try {
      const r = await as(p, 'tenant_owner').rpc('delete_space', {
        p_space_id: scratch.spaceId,
      });
      expectOk(r);
    } finally {
      await scratch.cleanup();
    }
  });

  it('contributor: 42501 (not a space owner)', async () => {
    const scratch = await createScratchSpace(p);
    try {
      const r = await as(p, 'contributor').rpc('delete_space', {
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
      const r = await as(p, 'reader').rpc('delete_space', {
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
    // Should NOT be 42501 — that would mean the gate wrongly rejected
    // space_owner. Any other error is fine (P0002 not-found, etc).
    if (r.error.code === '42501') {
      throw new Error('space_owner unexpectedly denied at gate');
    }
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
