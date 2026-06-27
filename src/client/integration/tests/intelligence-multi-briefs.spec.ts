/**
 * Multi-intelligence briefs: one entity can own many PI anchors.
 * Verifies the anchor-aware upsert_primary_intelligence added in migration
 * 20260627130100_intelligence_upsert_anchor_aware.
 *
 * Each anchor is an independent brief (lead vs sibling, independent version
 * numbering, independent archive scope). The three tests cover:
 *   1. First brief becomes lead anchor; second is non-lead sibling.
 *   2. Two published versions can coexist when they belong to different anchors.
 *   3. Republishing one brief archives only that anchor's prior published row,
 *      and a change_note is required.
 */

import { Client as PgClient } from 'pg';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectCode, expectOk } from '../harness/as';

const SUPABASE_DB_URL =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let p: Personas;
let companyId: string;
let assetId: string;

beforeAll(async () => {
  p = await buildPersonas();

  const admin = adminClient();
  const userId = p.ids.tenant_owner;

  const { data: company } = await admin
    .from('companies')
    .insert({ space_id: p.org.spaceId, name: 'Anchor Test Bio', created_by: userId })
    .select('id')
    .single();
  companyId = company!.id;

  const { data: asset } = await admin
    .from('assets')
    .insert({ space_id: p.org.spaceId, company_id: companyId, name: 'AnchorMab', created_by: userId })
    .select('id')
    .single();
  assetId = asset!.id;
}, 120_000);

afterEach(async () => {
  const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
  try {
    await pg.connect();
    // Anchors are the parent; cascade deletes all primary_intelligence rows.
    await pg.query(`delete from public.primary_intelligence_anchors where space_id = $1`, [
      p.org.spaceId,
    ]);
  } finally {
    await pg.end();
  }
});

async function createTrial(): Promise<string> {
  const admin = adminClient();
  const { data: trial } = await admin
    .from('trials')
    .insert({
      space_id: p.org.spaceId,
      asset_id: assetId,
      name: `Trial-${Date.now()}`,
      identifier: `NCT${Date.now()}`,
      phase: 'P3',
      created_by: p.ids.tenant_owner,
    })
    .select('id')
    .single();
  return trial!.id;
}

type UpsertOpts = {
  anchorId: string | null;
  id: string | null;
  entityType: string;
  entityId: string;
  state: 'draft' | 'published';
  headline: string;
  changeNote: string | null;
};

/** Call upsert as the agency_only persona; throw on error. */
async function rpcUpsert(opts: UpsertOpts): Promise<string> {
  const r = await as(p, 'agency_only').rpc('upsert_primary_intelligence', {
    p_id: opts.id,
    p_anchor_id: opts.anchorId,
    p_space_id: p.org.spaceId,
    p_entity_type: opts.entityType,
    p_entity_id: opts.entityId,
    p_headline: opts.headline,
    p_summary_md: '',
    p_implications_md: '',
    p_state: opts.state,
    p_change_note: opts.changeNote,
    p_links: [],
  });
  return expectOk(r) as string;
}

describe('multi-intelligence briefs (anchor-aware upsert)', () => {
  it('first brief creates a lead anchor; second brief is a non-lead sibling', async () => {
    const trialId = await createTrial();

    await rpcUpsert({
      anchorId: null,
      id: null,
      entityType: 'trial',
      entityId: trialId,
      state: 'published',
      headline: 'First',
      changeNote: null,
    });
    await rpcUpsert({
      anchorId: null,
      id: null,
      entityType: 'trial',
      entityId: trialId,
      state: 'published',
      headline: 'Second',
      changeNote: null,
    });

    const admin = adminClient();
    const { data: anchors } = await admin
      .from('primary_intelligence_anchors')
      .select('id, is_lead, display_order')
      .eq('entity_id', trialId)
      .order('display_order');

    expect(anchors).toHaveLength(2);
    expect(anchors!.filter((a: { is_lead: boolean }) => a.is_lead)).toHaveLength(1);
    expect(anchors![0].is_lead).toBe(true); // first anchor stays lead
    expect(anchors![1].is_lead).toBe(false);
    expect(anchors![1].display_order).toBe(1);
  });

  it('two published briefs on the same entity are allowed (different anchors)', async () => {
    const trialId = await createTrial();

    await rpcUpsert({
      anchorId: null,
      id: null,
      entityType: 'trial',
      entityId: trialId,
      state: 'published',
      headline: 'First pub',
      changeNote: null,
    });
    await rpcUpsert({
      anchorId: null,
      id: null,
      entityType: 'trial',
      entityId: trialId,
      state: 'published',
      headline: 'Second pub',
      changeNote: null,
    });

    const admin = adminClient();
    const { data: pub } = await admin
      .from('primary_intelligence')
      .select('id, anchor_id, state, version_number')
      .eq('state', 'published')
      .eq('space_id', p.org.spaceId);

    expect(pub).toHaveLength(2);
    // Each anchor numbers versions independently starting at 1.
    expect(pub!.every((r: { version_number: number }) => r.version_number === 1)).toBe(true);
  });

  it('republishing archives only the same anchor; change_note required', async () => {
    const trialId = await createTrial();

    const v1Id = await rpcUpsert({
      anchorId: null,
      id: null,
      entityType: 'trial',
      entityId: trialId,
      state: 'published',
      headline: 'A v1',
      changeNote: null,
    });

    const admin = adminClient();
    const { data: v1Row } = await admin
      .from('primary_intelligence')
      .select('anchor_id')
      .eq('id', v1Id)
      .single();
    const anchorId: string = v1Row!.anchor_id;

    // Republish the same anchor without change_note must be rejected.
    const bad = await as(p, 'agency_only').rpc('upsert_primary_intelligence', {
      p_id: null,
      p_anchor_id: anchorId,
      p_space_id: p.org.spaceId,
      p_entity_type: 'trial',
      p_entity_id: trialId,
      p_headline: 'A v2',
      p_summary_md: '',
      p_implications_md: '',
      p_state: 'published',
      p_change_note: null,
      p_links: [],
    });
    expectCode(bad, '22023');

    // Republish with change_note succeeds.
    await rpcUpsert({
      anchorId,
      id: null,
      entityType: 'trial',
      entityId: trialId,
      state: 'published',
      headline: 'A v2',
      changeNote: 'revised analysis',
    });

    const { data: rows } = await admin
      .from('primary_intelligence')
      .select('state, version_number')
      .eq('anchor_id', anchorId)
      .order('version_number');

    expect(rows!.map((r: { state: string }) => r.state)).toEqual(['archived', 'published']);
    expect(rows!.map((r: { version_number: number }) => r.version_number)).toEqual([1, 2]);
  });
});
