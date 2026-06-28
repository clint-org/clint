/**
 * Fix A -- discard_pending_material rollback RPC.
 *
 * The materials upload flow registers a row (finalized_at NULL) before the
 * file lands in R2. If a later step fails, the orphan row lingers. The new
 * RPC lets the uploader roll back their own un-finalized row -- and ONLY
 * that: a finalized row or another user's row must be untouched.
 */

import { Client as PgClient } from 'pg';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildPersonas, Personas, adminClient } from '../fixtures/personas';
import { as, expectOk } from '../harness/as';
import { SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_DB_URL =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let p: Personas;
let svc: SupabaseClient;

beforeAll(async () => {
  p = await buildPersonas();
  svc = adminClient();
}, 120_000);

afterEach(async () => {
  // Sweep any materials left in the shared persona space so each test starts
  // from a clean slate (these tests register rows in the persona space).
  const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
  try {
    await pg.connect();
    await pg.query(`delete from public.materials where space_id = $1`, [p.org.spaceId]);
  } finally {
    await pg.end();
  }
});

/** Register an un-finalized material as the given persona; returns its id. */
async function registerPending(persona: 'contributor' | 'space_owner'): Promise<string> {
  const r = await as(p, persona).rpc('register_material', {
    p_space_id: p.org.spaceId,
    p_file_path: `materials/${p.org.spaceId}/pending/discard-test.pdf`,
    p_file_name: 'discard-test.pdf',
    p_file_size_bytes: 1024,
    p_mime_type: 'application/pdf',
    p_material_type: 'briefing',
    p_title: 'Discard test',
    p_links: null,
  });
  return expectOk(r) as string;
}

async function materialExists(id: string): Promise<boolean> {
  const { data, error } = await svc.from('materials').select('id').eq('id', id);
  if (error) throw new Error(`materials lookup: ${error.message}`);
  return (data?.length ?? 0) === 1;
}

describe('rpc discard_pending_material (Fix A)', () => {
  it('uploader: deletes their own un-finalized row', async () => {
    const id = await registerPending('contributor');
    expect(await materialExists(id)).toBe(true);

    expectOk(await as(p, 'contributor').rpc('discard_pending_material', { p_material_id: id }));

    expect(await materialExists(id)).toBe(false);
  });

  it('uploader: leaves a finalized row untouched (no-op)', async () => {
    const id = await registerPending('contributor');
    expectOk(await as(p, 'contributor').rpc('finalize_material', { p_material_id: id }));

    // Discard must NOT remove a finalized row.
    expectOk(await as(p, 'contributor').rpc('discard_pending_material', { p_material_id: id }));

    expect(await materialExists(id)).toBe(true);
  });

  it("non-uploader: cannot discard another user's pending row (no-op)", async () => {
    const id = await registerPending('contributor');

    // space_owner is an owner on the space but did not upload this row.
    expectOk(await as(p, 'space_owner').rpc('discard_pending_material', { p_material_id: id }));

    expect(await materialExists(id)).toBe(true);
  });
});
