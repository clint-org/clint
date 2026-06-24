/**
 * Fix B -- material delete by any space editor/owner, and audited.
 *
 * Before: delete_material rejected non-uploaders (uploaded_by <> auth.uid())
 * and recorded no audit event. After: any space editor/owner can delete a
 * teammate's material, and the delete writes a 'material.deleted' audit row.
 * Viewers are still denied.
 */

import { Client as PgClient } from 'pg';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildPersonas, Personas, adminClient } from '../fixtures/personas';
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

afterEach(async () => {
  const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
  try {
    await pg.connect();
    await pg.query(`delete from public.materials where space_id = $1`, [p.org.spaceId]);
  } finally {
    await pg.end();
  }
});

/** Register + finalize a material as the given persona; returns its id. */
async function createMaterial(persona: 'contributor' | 'space_owner'): Promise<string> {
  const reg = await as(p, persona).rpc('register_material', {
    p_space_id: p.org.spaceId,
    p_file_path: `materials/${p.org.spaceId}/del/delete-test.pdf`,
    p_file_name: 'delete-test.pdf',
    p_file_size_bytes: 2048,
    p_mime_type: 'application/pdf',
    p_material_type: 'briefing',
    p_title: 'Delete audit test',
    p_links: null,
  });
  const id = expectOk(reg) as string;
  expectOk(await as(p, persona).rpc('finalize_material', { p_material_id: id }));
  return id;
}

async function materialExists(id: string): Promise<boolean> {
  const { data, error } = await svc.from('materials').select('id').eq('id', id);
  if (error) throw new Error(`materials lookup: ${error.message}`);
  return (data?.length ?? 0) === 1;
}

describe('rpc delete_material editor + audit (Fix B)', () => {
  it("editor (non-uploader) deletes a teammate's material", async () => {
    // space_owner uploads; contributor (editor, NOT the uploader) deletes.
    const id = await createMaterial('space_owner');

    const r = await as(p, 'contributor').rpc('delete_material', { p_id: id });
    expectOk(r);

    expect(await materialExists(id)).toBe(false);
  });

  it("writes a 'material.deleted' audit row with scope + metadata", async () => {
    const id = await createMaterial('space_owner');
    expectOk(await as(p, 'contributor').rpc('delete_material', { p_id: id }));

    const { data, error } = await svc
      .from('audit_events')
      .select('action, resource_type, resource_id, agency_id, tenant_id, space_id, metadata')
      .eq('action', 'material.deleted')
      .eq('resource_id', id);
    if (error) throw new Error(`audit_events lookup: ${error.message}`);

    expect(data?.length).toBe(1);
    const row = data![0] as Record<string, unknown>;
    expect(row['resource_type']).toBe('material');
    expect(row['space_id']).toBe(p.org.spaceId);
    expect(row['tenant_id']).toBe(p.org.tenantId);
    expect(row['agency_id']).toBe(p.org.agencyId);
    const meta = row['metadata'] as Record<string, unknown>;
    expect(meta['material_type']).toBe('briefing');
    expect(meta['uploaded_by']).toBe(p.ids.space_owner);
    expect(meta['title']).toBe('Delete audit test');
  });

  it('viewer cannot delete (42501)', async () => {
    const id = await createMaterial('space_owner');
    const r = await as(p, 'reader').rpc('delete_material', { p_id: id });
    expectCode(r, '42501');
    expect(await materialExists(id)).toBe(true);
  });

  it('uploader (editor) can still delete their own material', async () => {
    const id = await createMaterial('contributor');
    expectOk(await as(p, 'contributor').rpc('delete_material', { p_id: id }));
    expect(await materialExists(id)).toBe(false);
  });
});
