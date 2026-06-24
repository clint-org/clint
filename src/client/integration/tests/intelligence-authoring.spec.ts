/**
 * Fix C -- primary intelligence authoring for space editors/owners.
 *
 * Before: authoring (upsert/withdraw/delete/purge) was gated on
 * is_agency_member_of_space, and drafts were visible only to agency members.
 * After: space editors and owners (and agency members) can
 * draft/publish/modify/withdraw, and see drafts. PURGE stays owners + agency
 * only -- editors are excluded.
 */

import { randomUUID } from 'node:crypto';
import { Client as PgClient } from 'pg';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildPersonas, Personas } from '../fixtures/personas';
import { as, expectOk, expectCode } from '../harness/as';

const SUPABASE_DB_URL =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let p: Personas;

beforeAll(async () => {
  p = await buildPersonas();
}, 120_000);

afterEach(async () => {
  const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
  try {
    await pg.connect();
    await pg.query(`delete from public.primary_intelligence where space_id = $1`, [p.org.spaceId]);
  } finally {
    await pg.end();
  }
});

/** upsert a row anchored to a fresh entity_id so tests don't collide. */
function upsert(
  persona: 'contributor' | 'space_owner' | 'reader',
  opts: { id?: string | null; entityId: string; state: 'draft' | 'published'; headline: string; changeNote?: string | null },
) {
  return as(p, persona).rpc('upsert_primary_intelligence', {
    p_id: opts.id ?? null,
    p_space_id: p.org.spaceId,
    p_entity_type: 'space',
    p_entity_id: opts.entityId,
    p_headline: opts.headline,
    p_summary_md: 'Summary body.',
    p_implications_md: 'Implications body.',
    p_state: opts.state,
    p_change_note: opts.changeNote ?? null,
    p_links: null,
  });
}

describe('primary intelligence authoring (Fix C)', () => {
  it('editor can create a draft', async () => {
    const r = await upsert('contributor', { entityId: randomUUID(), state: 'draft', headline: 'Editor draft' });
    const id = expectOk(r) as string;
    expect(id).toBeTruthy();
  });

  it('editor can publish then withdraw', async () => {
    const entityId = randomUUID();
    const id = expectOk(
      await upsert('contributor', { entityId, state: 'published', headline: 'Editor published' }),
    ) as string;

    const w = await as(p, 'contributor').rpc('withdraw_primary_intelligence', {
      p_id: id,
      p_change_note: 'Superseded by newer read.',
    });
    expectOk(w);
  });

  it('editor is denied purge (42501)', async () => {
    const entityId = randomUUID();
    const id = expectOk(
      await upsert('contributor', { entityId, state: 'published', headline: 'Purge target' }),
    ) as string;

    const r = await as(p, 'contributor').rpc('purge_primary_intelligence', {
      p_id: id,
      p_confirmation: 'Purge target',
      p_purge_anchor: false,
    });
    expectCode(r, '42501');
  });

  it('owner can purge', async () => {
    const entityId = randomUUID();
    const id = expectOk(
      await upsert('contributor', { entityId, state: 'published', headline: 'Owner purge ok' }),
    ) as string;

    const r = await as(p, 'space_owner').rpc('purge_primary_intelligence', {
      p_id: id,
      p_confirmation: 'Owner purge ok',
      p_purge_anchor: false,
    });
    expectOk(r);
  });

  it('editor and owner can read a draft; viewer cannot', async () => {
    const entityId = randomUUID();
    const id = expectOk(
      await upsert('contributor', { entityId, state: 'draft', headline: 'Draft visibility' }),
    ) as string;

    // editor (author) sees their draft
    const editorRead = await as(p, 'contributor').from('primary_intelligence').select('id').eq('id', id);
    expect(editorRead.data?.length).toBe(1);

    // owner sees the draft
    const ownerRead = await as(p, 'space_owner').from('primary_intelligence').select('id').eq('id', id);
    expect(ownerRead.data?.length).toBe(1);

    // viewer cannot see the draft (RLS filters it out)
    const readerRead = await as(p, 'reader').from('primary_intelligence').select('id').eq('id', id);
    expect(readerRead.data?.length).toBe(0);
  });
});
