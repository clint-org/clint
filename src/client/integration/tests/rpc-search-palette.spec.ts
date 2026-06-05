/**
 * search_palette regression coverage.
 *
 * Guards the pg_trgm schema-qualification bug: 20260509120300 moved pg_trgm
 * from `public` to the `extensions` schema, then 20260524120500 recreated
 * search_palette with `set search_path = ''` while leaving similarity() and the
 * `%` operator unqualified. Every palette search then threw
 *   42883 function similarity(character varying, text) does not exist
 * 20260605120000 fixes it by qualifying the trgm references. Before that fix
 * the "returns matches" case below fails with 42883.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectOk } from '../harness/as';

let p: Personas;

type PaletteRow = {
  kind: string;
  id: string;
  name: string;
  secondary: string | null;
  score: number;
  pinned: boolean;
  recent_at: string | null;
};

beforeAll(async () => {
  p = await buildPersonas();

  // A company whose name is a clean trgm match target for the search below.
  const admin = adminClient();
  await admin
    .from('companies')
    .insert({ space_id: p.org.spaceId, name: 'Zentech Bio', created_by: p.ids.tenant_owner })
    .select('id')
    .single();
}, 90_000);

describe('rpc search_palette', () => {
  it('returns matches without a trgm schema-resolution error', async () => {
    const r = await as(p, 'reader').rpc('search_palette', {
      p_space_id: p.org.spaceId,
      p_query: 'Zent',
    });
    // Pre-fix this is `42883 function similarity(...) does not exist`.
    const rows = expectOk(r) as PaletteRow[];
    const company = rows.find((row) => row.kind === 'company' && row.name === 'Zentech Bio');
    expect(company).toBeDefined();
    expect(company!.score).toBeGreaterThan(0);
  });

  it('kind filter narrows to the requested entity type', async () => {
    const r = await as(p, 'reader').rpc('search_palette', {
      p_space_id: p.org.spaceId,
      p_query: 'Zent',
      p_kind: 'company',
    });
    const rows = expectOk(r) as PaletteRow[];
    expect(rows.every((row) => row.kind === 'company')).toBe(true);
  });

  it('short queries (< 2 chars) return empty without error', async () => {
    const r = await as(p, 'reader').rpc('search_palette', {
      p_space_id: p.org.spaceId,
      p_query: 'Z',
    });
    const rows = expectOk(r) as PaletteRow[];
    expect(rows).toHaveLength(0);
  });
});
