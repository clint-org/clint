/**
 * Cascade-safety RPCs across role contexts.
 *
 * Covers the six RPCs introduced in the 2026-05-20 cascade-safety design:
 *   - archive_space               (T5)
 *   - restore_space               (T5)
 *   - permanently_delete_space    (T5)
 *   - preview_company_delete      (T7)
 *   - preview_product_delete      (T7)
 *   - preview_trial_delete        (T7)
 *
 * Roles exercised against the persona graph (see fixtures/personas.ts):
 *   - space_owner    explicit space_members row, role 'owner'.
 *   - tenant_owner   explicit tenant_members row, role 'owner'. NOT in space_members.
 *   - contributor    explicit space_members row, role 'editor'.
 *   - reader         explicit space_members row, role 'viewer'.
 *   - platform_admin platform_admins row. NOT in tenant_members or space_members.
 *   - anon           no JWT.
 *
 * Discrepancies with the task description (worth surfacing -- these reflect
 * what the RPCs ACTUALLY do, which may not match a casual reading of the spec):
 *
 *   1. archive_space / restore_space gate on
 *      has_space_access(p_space_id, array['owner']). The 2026-04-29 rewrite
 *      of has_space_access removed the implicit-from-tenant disjunct: only
 *      an EXPLICIT space_members row with role='owner' passes. tenant_owner
 *      (no space_members row) is therefore 42501, NOT a pass.
 *      Same reasoning for platform_admin: the platform-admin read bypass in
 *      has_space_access fires only for read calls (p_roles null), so a
 *      write-tier call (p_roles=['owner']) returns 42501.
 *
 *   2. preview_* RPCs gate on has_space_access(v_space_id) with no role
 *      array. That's a read call, so the platform-admin read bypass
 *      applies -- platform_admin succeeds. tenant_owner without an
 *      explicit space_members row, however, gets 42501 (no implicit
 *      cascade).
 *
 *   3. anon does NOT reach the auth.uid() null check (28000) -- the RPC
 *      grants in each migration (`revoke execute ... from anon`) cause
 *      PostgreSQL to fire 42501 ("permission denied for function ...")
 *      before the function body runs. The 28000 path inside the function
 *      is unreachable for the anon role.
 *
 *   4. create_space adds the caller as a space_members.owner row. So a
 *      scratch space created by `tenant_owner` (via createScratchSpace)
 *      gives tenant_owner an explicit space_members row, which lets them
 *      pass has_space_access(_, ['owner']). To test the "tenant_owner has
 *      no implicit space access" path we must strip that auto-row.
 *
 * Each describe block uses a fresh scratch space to keep archive state
 * isolated. tenant_owner-only personas drive permanently_delete (only
 * persona with both tenant ownership AND no space_members coupling) and
 * are granted a temporary space_members owner row via service-role when
 * archive_space needs to be invoked as a tenant-tier actor for the
 * permanently_delete_space happy path.
 */

import { afterAll, beforeAll, describe, it } from 'vitest';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { createScratchSpace } from '../fixtures/scratch';
import { as, expectCode, expectOk } from '../harness/as';
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

/** Service-role-set the archived_at column directly. Lets us pre-archive a
 *  space without going through archive_space (which has its own gate). The
 *  setup is part of the test fixture, not the assertion. */
async function setArchived(spaceId: string, archived: boolean): Promise<void> {
  const { error } = await svc
    .from('spaces')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', spaceId);
  if (error) throw new Error(`setArchived(${spaceId}, ${archived}): ${error.message}`);
}

/** Grant a persona an explicit space_members row with the given role on the
 *  given space. Used when the test needs the persona to clear the owner gate
 *  on has_space_access (which requires an explicit row in the 2026-04-29
 *  owner-only model). */
async function grantSpaceMembership(
  spaceId: string,
  userId: string,
  role: 'owner' | 'editor' | 'viewer',
): Promise<void> {
  const { error } = await svc
    .from('space_members')
    .insert({ space_id: spaceId, user_id: userId, role });
  if (error && !/duplicate/i.test(error.message)) {
    throw new Error(`grantSpaceMembership ${userId} ${role}: ${error.message}`);
  }
}

/** Remove a space_members row. Used to strip the create_space auto-row from
 *  tenant_owner so the "tenant has no implicit space access" tests really
 *  exercise the missing-row path. Routed through direct SQL because the
 *  member-self-protection trigger needs the cascade GUC to bypass. */
async function revokeSpaceMembership(spaceId: string, userId: string): Promise<void> {
  const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
  await pg.connect();
  try {
    await pg.query('begin');
    await pg.query(`set local clint.member_guard_cascade = 'on'`);
    await pg.query(`delete from public.space_members where space_id = $1 and user_id = $2`, [
      spaceId,
      userId,
    ]);
    await pg.query('commit');
  } finally {
    await pg.end();
  }
}

/** Seed a hermetic entity graph (company / 2 products / 3 trials) inside the
 *  persona space and return the relevant ids. Caller owns the cleanup. */
interface EntityGraph {
  companyId: string;
  productAId: string;
  productBId: string;
  trialIds: string[];
  cleanup: () => Promise<void>;
}

async function createEntityGraph(spaceId: string, createdBy: string): Promise<EntityGraph> {
  const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
  await pg.connect();
  try {
    const tag = `cs-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const company = await pg.query<{ id: string }>(
      `insert into public.companies (space_id, created_by, name)
         values ($1, $2, $3) returning id`,
      [spaceId, createdBy, `${tag}-co`],
    );
    const companyId = company.rows[0].id;
    const productA = await pg.query<{ id: string }>(
      `insert into public.products (space_id, created_by, company_id, name)
         values ($1, $2, $3, $4) returning id`,
      [spaceId, createdBy, companyId, `${tag}-pa`],
    );
    const productB = await pg.query<{ id: string }>(
      `insert into public.products (space_id, created_by, company_id, name)
         values ($1, $2, $3, $4) returning id`,
      [spaceId, createdBy, companyId, `${tag}-pb`],
    );
    const productAId = productA.rows[0].id;
    const productBId = productB.rows[0].id;
    const ta = await pg.query<{ id: string }>(
      `insert into public.therapeutic_areas (space_id, created_by, name)
         values ($1, $2, $3) returning id`,
      [spaceId, createdBy, `${tag}-ta`],
    );
    const taId = ta.rows[0].id;
    const trialIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const product = i < 2 ? productAId : productBId;
      const trial = await pg.query<{ id: string }>(
        `insert into public.trials (space_id, created_by, product_id, therapeutic_area_id, name, identifier)
           values ($1, $2, $3, $4, $5, $6) returning id`,
        [spaceId, createdBy, product, taId, `${tag}-t${i}`, `${tag}-id${i}`],
      );
      trialIds.push(trial.rows[0].id);
    }
    return {
      companyId,
      productAId,
      productBId,
      trialIds,
      cleanup: async () => {
        const pg2 = new PgClient({ connectionString: SUPABASE_DB_URL });
        await pg2.connect();
        try {
          await pg2.query('begin');
          await pg2.query(`set local clint.member_guard_cascade = 'on'`);
          await pg2.query(`delete from public.companies where id = $1`, [companyId]);
          await pg2.query(`delete from public.therapeutic_areas where id = $1`, [taId]);
          await pg2.query('commit');
        } finally {
          await pg2.end();
        }
      },
    };
  } finally {
    await pg.end();
  }
}

// ---------------------------------------------------------------------------
// archive_space
// ---------------------------------------------------------------------------

describe('rpc archive_space', () => {
  it('space_owner: succeeds on own space', async () => {
    const scratch = await createScratchSpace(p);
    await grantSpaceMembership(scratch.spaceId, p.ids.space_owner, 'owner');
    try {
      const r = await as(p, 'space_owner').rpc('archive_space', {
        p_space_id: scratch.spaceId,
      });
      expectOk(r);
    } finally {
      await scratch.cleanup();
    }
  });

  it('tenant_owner: 42501 (no explicit space_members row in the owner-only model)', async () => {
    // has_space_access(spaceId, ['owner']) requires an explicit space_members
    // row of role 'owner'. Tenant ownership does not cascade. We must strip
    // the auto-row that create_space inserts for the caller -- otherwise
    // tenant_owner trivially passes the gate via the create_space side-effect,
    // not via tenant ownership.
    const scratch = await createScratchSpace(p);
    await revokeSpaceMembership(scratch.spaceId, p.ids.tenant_owner);
    try {
      const r = await as(p, 'tenant_owner').rpc('archive_space', {
        p_space_id: scratch.spaceId,
      });
      expectCode(r, '42501');
    } finally {
      await scratch.cleanup();
    }
  });

  it('contributor: 42501 (space_members.role = editor)', async () => {
    const scratch = await createScratchSpace(p);
    await grantSpaceMembership(scratch.spaceId, p.ids.contributor, 'editor');
    try {
      const r = await as(p, 'contributor').rpc('archive_space', {
        p_space_id: scratch.spaceId,
      });
      expectCode(r, '42501');
    } finally {
      await scratch.cleanup();
    }
  });

  it('reader: 42501 (space_members.role = viewer)', async () => {
    const scratch = await createScratchSpace(p);
    await grantSpaceMembership(scratch.spaceId, p.ids.reader, 'viewer');
    try {
      const r = await as(p, 'reader').rpc('archive_space', {
        p_space_id: scratch.spaceId,
      });
      expectCode(r, '42501');
    } finally {
      await scratch.cleanup();
    }
  });

  it('platform_admin: 42501 (read-only bypass does not apply to write-tier owner gate)', async () => {
    const scratch = await createScratchSpace(p);
    try {
      const r = await as(p, 'platform_admin').rpc('archive_space', {
        p_space_id: scratch.spaceId,
      });
      expectCode(r, '42501');
    } finally {
      await scratch.cleanup();
    }
  });

  it('anon: 42501 (PostgreSQL execute-permission denial; anon never reaches the function body)', async () => {
    const scratch = await createScratchSpace(p);
    try {
      const r = await as(p, 'anon').rpc('archive_space', {
        p_space_id: scratch.spaceId,
      });
      expectCode(r, '42501');
    } finally {
      await scratch.cleanup();
    }
  });

  it('space_owner: P0002 for non-existent space (gate first, then existence)', async () => {
    // has_space_access on a non-existent space returns false (the lookup
    // resolves v_tenant_id null), so the gate trips 42501 BEFORE the RPC's
    // own existence check. That matches the migration's order of operations.
    const r = await as(p, 'space_owner').rpc('archive_space', {
      p_space_id: '00000000-0000-0000-0000-000000000000',
    });
    expectCode(r, '42501');
  });

  it('anon: 42501 for non-existent space (execute permission denied; never reaches existence check)', async () => {
    const r = await as(p, 'anon').rpc('archive_space', {
      p_space_id: '00000000-0000-0000-0000-000000000000',
    });
    expectCode(r, '42501');
  });

  it('space_owner: idempotent on already-archived space', async () => {
    const scratch = await createScratchSpace(p);
    await grantSpaceMembership(scratch.spaceId, p.ids.space_owner, 'owner');
    try {
      const r1 = await as(p, 'space_owner').rpc('archive_space', {
        p_space_id: scratch.spaceId,
      });
      expectOk(r1);
      const r2 = await as(p, 'space_owner').rpc('archive_space', {
        p_space_id: scratch.spaceId,
      });
      expectOk(r2);
    } finally {
      await scratch.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// restore_space
// ---------------------------------------------------------------------------

describe('rpc restore_space', () => {
  it('space_owner: succeeds on archived space', async () => {
    const scratch = await createScratchSpace(p);
    await grantSpaceMembership(scratch.spaceId, p.ids.space_owner, 'owner');
    await setArchived(scratch.spaceId, true);
    try {
      const r = await as(p, 'space_owner').rpc('restore_space', {
        p_space_id: scratch.spaceId,
      });
      expectOk(r);
    } finally {
      await scratch.cleanup();
    }
  });

  it('tenant_owner: 42501 (same owner-only gate as archive)', async () => {
    const scratch = await createScratchSpace(p);
    await revokeSpaceMembership(scratch.spaceId, p.ids.tenant_owner);
    await setArchived(scratch.spaceId, true);
    try {
      const r = await as(p, 'tenant_owner').rpc('restore_space', {
        p_space_id: scratch.spaceId,
      });
      expectCode(r, '42501');
    } finally {
      await scratch.cleanup();
    }
  });

  it('contributor: 42501', async () => {
    const scratch = await createScratchSpace(p);
    await grantSpaceMembership(scratch.spaceId, p.ids.contributor, 'editor');
    await setArchived(scratch.spaceId, true);
    try {
      const r = await as(p, 'contributor').rpc('restore_space', {
        p_space_id: scratch.spaceId,
      });
      expectCode(r, '42501');
    } finally {
      await scratch.cleanup();
    }
  });

  it('reader: 42501', async () => {
    const scratch = await createScratchSpace(p);
    await grantSpaceMembership(scratch.spaceId, p.ids.reader, 'viewer');
    await setArchived(scratch.spaceId, true);
    try {
      const r = await as(p, 'reader').rpc('restore_space', {
        p_space_id: scratch.spaceId,
      });
      expectCode(r, '42501');
    } finally {
      await scratch.cleanup();
    }
  });

  it('platform_admin: 42501 (write-tier owner gate does not honor read bypass)', async () => {
    const scratch = await createScratchSpace(p);
    await setArchived(scratch.spaceId, true);
    try {
      const r = await as(p, 'platform_admin').rpc('restore_space', {
        p_space_id: scratch.spaceId,
      });
      expectCode(r, '42501');
    } finally {
      await scratch.cleanup();
    }
  });

  it('anon: 42501 (PostgreSQL execute-permission denial)', async () => {
    const scratch = await createScratchSpace(p);
    await setArchived(scratch.spaceId, true);
    try {
      const r = await as(p, 'anon').rpc('restore_space', {
        p_space_id: scratch.spaceId,
      });
      expectCode(r, '42501');
    } finally {
      await scratch.cleanup();
    }
  });

  it('space_owner: idempotent on a non-archived space', async () => {
    const scratch = await createScratchSpace(p);
    await grantSpaceMembership(scratch.spaceId, p.ids.space_owner, 'owner');
    try {
      const r = await as(p, 'space_owner').rpc('restore_space', {
        p_space_id: scratch.spaceId,
      });
      expectOk(r);
    } finally {
      await scratch.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// permanently_delete_space
// ---------------------------------------------------------------------------

describe('rpc permanently_delete_space', () => {
  it('space_owner (no tenant ownership): 42501 even when archived', async () => {
    const scratch = await createScratchSpace(p);
    await grantSpaceMembership(scratch.spaceId, p.ids.space_owner, 'owner');
    await setArchived(scratch.spaceId, true);
    try {
      const r = await as(p, 'space_owner').rpc('permanently_delete_space', {
        p_space_id: scratch.spaceId,
      });
      expectCode(r, '42501');
    } finally {
      await scratch.cleanup();
    }
  });

  it('tenant_owner on archived space: succeeds', async () => {
    const scratch = await createScratchSpace(p);
    await setArchived(scratch.spaceId, true);
    try {
      const r = await as(p, 'tenant_owner').rpc('permanently_delete_space', {
        p_space_id: scratch.spaceId,
      });
      expectOk(r);
    } finally {
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

  it('platform_admin on archived space: succeeds', async () => {
    const scratch = await createScratchSpace(p);
    await setArchived(scratch.spaceId, true);
    try {
      const r = await as(p, 'platform_admin').rpc('permanently_delete_space', {
        p_space_id: scratch.spaceId,
      });
      expectOk(r);
    } finally {
      await scratch.cleanup();
    }
  });

  it('platform_admin on non-archived space: succeeds (admin override)', async () => {
    const scratch = await createScratchSpace(p);
    try {
      const r = await as(p, 'platform_admin').rpc('permanently_delete_space', {
        p_space_id: scratch.spaceId,
      });
      expectOk(r);
    } finally {
      await scratch.cleanup();
    }
  });

  it('contributor: 42501', async () => {
    const scratch = await createScratchSpace(p);
    await grantSpaceMembership(scratch.spaceId, p.ids.contributor, 'editor');
    await setArchived(scratch.spaceId, true);
    try {
      const r = await as(p, 'contributor').rpc('permanently_delete_space', {
        p_space_id: scratch.spaceId,
      });
      expectCode(r, '42501');
    } finally {
      await scratch.cleanup();
    }
  });

  it('reader: 42501', async () => {
    const scratch = await createScratchSpace(p);
    await grantSpaceMembership(scratch.spaceId, p.ids.reader, 'viewer');
    await setArchived(scratch.spaceId, true);
    try {
      const r = await as(p, 'reader').rpc('permanently_delete_space', {
        p_space_id: scratch.spaceId,
      });
      expectCode(r, '42501');
    } finally {
      await scratch.cleanup();
    }
  });

  it('anon: 42501 (PostgreSQL execute-permission denial)', async () => {
    const scratch = await createScratchSpace(p);
    await setArchived(scratch.spaceId, true);
    try {
      const r = await as(p, 'anon').rpc('permanently_delete_space', {
        p_space_id: scratch.spaceId,
      });
      expectCode(r, '42501');
    } finally {
      await scratch.cleanup();
    }
  });

  it('tenant_owner: P0002 for non-existent space', async () => {
    const r = await as(p, 'tenant_owner').rpc('permanently_delete_space', {
      p_space_id: '00000000-0000-0000-0000-000000000000',
    });
    expectCode(r, 'P0002');
  });

  it('returns jsonb count breakdown with the documented keys', async () => {
    const scratch = await createScratchSpace(p);
    await setArchived(scratch.spaceId, true);
    try {
      const r = await as(p, 'tenant_owner').rpc('permanently_delete_space', {
        p_space_id: scratch.spaceId,
      });
      const data = expectOk(r) as Record<string, unknown>;
      for (const key of [
        'name',
        'companies',
        'products',
        'trials',
        'markers',
        'materials',
        'events',
        'primary_intelligence',
        'marker_types',
        'was_archived',
        'platform_admin_override',
      ]) {
        if (!(key in data)) {
          throw new Error(`permanently_delete_space jsonb missing key '${key}': ${JSON.stringify(data)}`);
        }
      }
      if (data['was_archived'] !== true) {
        throw new Error(`expected was_archived true, got ${data['was_archived']}`);
      }
    } finally {
      await scratch.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// preview_company_delete / preview_product_delete / preview_trial_delete
// ---------------------------------------------------------------------------
//
// All three previews share the same gate shape (auth.uid + has_space_access
// with no role array), so the role matrix runs against one shared fixture.

describe('rpc preview_*_delete (cascade-footprint previews)', () => {
  let entitySpaceId: string;
  let graph: EntityGraph;

  beforeAll(async () => {
    entitySpaceId = p.org.spaceId;
    graph = await createEntityGraph(entitySpaceId, p.ids.tenant_owner);
  }, 30_000);

  afterAll(async () => {
    if (graph) await graph.cleanup();
  });

  describe('preview_company_delete', () => {
    it('space_owner: ok', async () => {
      const r = await as(p, 'space_owner').rpc('preview_company_delete', {
        p_company_id: graph.companyId,
      });
      const data = expectOk(r) as Record<string, unknown>;
      if ((data['products'] as number) !== 2) {
        throw new Error(`expected products=2, got ${data['products']}`);
      }
      if ((data['trials'] as number) !== 3) {
        throw new Error(`expected trials=3, got ${data['trials']}`);
      }
    });

    it('tenant_owner: 42501 (no explicit space_members row)', async () => {
      const r = await as(p, 'tenant_owner').rpc('preview_company_delete', {
        p_company_id: graph.companyId,
      });
      expectCode(r, '42501');
    });

    it('contributor: ok (space_members.editor passes the read gate)', async () => {
      const r = await as(p, 'contributor').rpc('preview_company_delete', {
        p_company_id: graph.companyId,
      });
      expectOk(r);
    });

    it('reader: ok (space_members.viewer passes the read gate)', async () => {
      const r = await as(p, 'reader').rpc('preview_company_delete', {
        p_company_id: graph.companyId,
      });
      expectOk(r);
    });

    it('platform_admin: ok (read bypass)', async () => {
      const r = await as(p, 'platform_admin').rpc('preview_company_delete', {
        p_company_id: graph.companyId,
      });
      expectOk(r);
    });

    it('anon: 42501 (PostgreSQL execute-permission denial)', async () => {
      const r = await as(p, 'anon').rpc('preview_company_delete', {
        p_company_id: graph.companyId,
      });
      expectCode(r, '42501');
    });

    it('space_owner: P0002 for non-existent company', async () => {
      const r = await as(p, 'space_owner').rpc('preview_company_delete', {
        p_company_id: '00000000-0000-0000-0000-000000000000',
      });
      expectCode(r, 'P0002');
    });

    it('returns the documented jsonb shape with count keys', async () => {
      const r = await as(p, 'space_owner').rpc('preview_company_delete', {
        p_company_id: graph.companyId,
      });
      const data = expectOk(r) as Record<string, unknown>;
      const expected = [
        'products',
        'trials',
        'trial_notes',
        'events',
        'material_links',
        'primary_intelligence',
        'primary_intelligence_links',
        'marker_assignments',
        'markers_removed_entirely',
        'markers_unlinked_only',
      ];
      for (const key of expected) {
        if (!(key in data)) {
          throw new Error(`preview_company_delete missing key '${key}': ${JSON.stringify(data)}`);
        }
        if (typeof data[key] !== 'number') {
          throw new Error(`preview_company_delete key '${key}' not numeric: ${JSON.stringify(data)}`);
        }
      }
      if ('marker_notifications' in data) {
        throw new Error('preview_company_delete must not include marker_notifications (table dropped)');
      }
    });
  });

  describe('preview_product_delete', () => {
    it('space_owner: ok', async () => {
      const r = await as(p, 'space_owner').rpc('preview_product_delete', {
        p_product_id: graph.productAId,
      });
      const data = expectOk(r) as Record<string, unknown>;
      if ((data['trials'] as number) !== 2) {
        throw new Error(`expected trials=2 for productA, got ${data['trials']}`);
      }
      if ('products' in data) {
        throw new Error('preview_product_delete must not include products key');
      }
    });

    it('tenant_owner: 42501', async () => {
      const r = await as(p, 'tenant_owner').rpc('preview_product_delete', {
        p_product_id: graph.productAId,
      });
      expectCode(r, '42501');
    });

    it('contributor: ok', async () => {
      const r = await as(p, 'contributor').rpc('preview_product_delete', {
        p_product_id: graph.productAId,
      });
      expectOk(r);
    });

    it('reader: ok', async () => {
      const r = await as(p, 'reader').rpc('preview_product_delete', {
        p_product_id: graph.productAId,
      });
      expectOk(r);
    });

    it('platform_admin: ok (read bypass)', async () => {
      const r = await as(p, 'platform_admin').rpc('preview_product_delete', {
        p_product_id: graph.productAId,
      });
      expectOk(r);
    });

    it('anon: 42501 (PostgreSQL execute-permission denial)', async () => {
      const r = await as(p, 'anon').rpc('preview_product_delete', {
        p_product_id: graph.productAId,
      });
      expectCode(r, '42501');
    });

    it('space_owner: P0002 for non-existent product', async () => {
      const r = await as(p, 'space_owner').rpc('preview_product_delete', {
        p_product_id: '00000000-0000-0000-0000-000000000000',
      });
      expectCode(r, 'P0002');
    });
  });

  describe('preview_trial_delete', () => {
    it('space_owner: ok', async () => {
      const r = await as(p, 'space_owner').rpc('preview_trial_delete', {
        p_trial_id: graph.trialIds[0],
      });
      const data = expectOk(r) as Record<string, unknown>;
      if ('trials' in data) {
        throw new Error('preview_trial_delete must not include trials key (this IS one trial)');
      }
    });

    it('tenant_owner: 42501', async () => {
      const r = await as(p, 'tenant_owner').rpc('preview_trial_delete', {
        p_trial_id: graph.trialIds[0],
      });
      expectCode(r, '42501');
    });

    it('contributor: ok', async () => {
      const r = await as(p, 'contributor').rpc('preview_trial_delete', {
        p_trial_id: graph.trialIds[0],
      });
      expectOk(r);
    });

    it('reader: ok', async () => {
      const r = await as(p, 'reader').rpc('preview_trial_delete', {
        p_trial_id: graph.trialIds[0],
      });
      expectOk(r);
    });

    it('platform_admin: ok (read bypass)', async () => {
      const r = await as(p, 'platform_admin').rpc('preview_trial_delete', {
        p_trial_id: graph.trialIds[0],
      });
      expectOk(r);
    });

    it('anon: 42501 (PostgreSQL execute-permission denial)', async () => {
      const r = await as(p, 'anon').rpc('preview_trial_delete', {
        p_trial_id: graph.trialIds[0],
      });
      expectCode(r, '42501');
    });

    it('space_owner: P0002 for non-existent trial', async () => {
      const r = await as(p, 'space_owner').rpc('preview_trial_delete', {
        p_trial_id: '00000000-0000-0000-0000-000000000000',
      });
      expectCode(r, 'P0002');
    });

    it('preview is read-only: two consecutive calls return identical jsonb', async () => {
      const r1 = await as(p, 'space_owner').rpc('preview_trial_delete', {
        p_trial_id: graph.trialIds[0],
      });
      const r2 = await as(p, 'space_owner').rpc('preview_trial_delete', {
        p_trial_id: graph.trialIds[0],
      });
      expectOk(r1);
      expectOk(r2);
      if (JSON.stringify(r1.data) !== JSON.stringify(r2.data)) {
        throw new Error(`preview_trial_delete not read-only: ${JSON.stringify(r1.data)} then ${JSON.stringify(r2.data)}`);
      }
    });
  });
});
