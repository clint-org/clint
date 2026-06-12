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
  const { data: company } = await admin
    .from('companies')
    .insert({ space_id: p.org.spaceId, name: 'Zentech Bio', created_by: p.ids.tenant_owner })
    .select('id')
    .single();

  // Trials for the phase-label cases: one with only the raw CT.gov string
  // ("Phase 3", the input that used to render "PhPhase 3") and one with the
  // canonical phase_type enum.
  const { data: asset } = await admin
    .from('assets')
    .insert({
      space_id: p.org.spaceId,
      company_id: company!.id,
      name: 'Zentide',
      created_by: p.ids.tenant_owner,
    })
    .select('id')
    .single();
  await admin.from('trials').insert([
    {
      space_id: p.org.spaceId,
      asset_id: asset!.id,
      name: 'ZENITH-RAWPHASE',
      phase: 'Phase 3',
      created_by: p.ids.tenant_owner,
    },
    {
      space_id: p.org.spaceId,
      asset_id: asset!.id,
      name: 'ZENITH-TYPED',
      phase_type: 'P2',
      created_by: p.ids.tenant_owner,
    },
  ]);
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

  it('formats the raw CT.gov phase string without doubling the prefix', async () => {
    const r = await as(p, 'reader').rpc('search_palette', {
      p_space_id: p.org.spaceId,
      p_query: 'ZENITH-RAWPHASE',
      p_kind: 'trial',
    });
    const rows = expectOk(r) as PaletteRow[];
    const trial = rows.find((row) => row.name === 'ZENITH-RAWPHASE');
    expect(trial).toBeDefined();
    expect(trial!.secondary).toContain('Ph 3');
    expect(trial!.secondary).not.toContain('PhPhase');
  });

  it('formats phase_type via the canonical enum mapping', async () => {
    const r = await as(p, 'reader').rpc('search_palette', {
      p_space_id: p.org.spaceId,
      p_query: 'ZENITH-TYPED',
      p_kind: 'trial',
    });
    const rows = expectOk(r) as PaletteRow[];
    const trial = rows.find((row) => row.name === 'ZENITH-TYPED');
    expect(trial).toBeDefined();
    expect(trial!.secondary).toContain('Ph 2');
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
