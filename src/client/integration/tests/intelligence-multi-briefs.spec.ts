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

  it('set_intelligence_lead flips the lead and keeps exactly one', async () => {
    const trialId = await createTrial();
    await rpcUpsert({
      anchorId: null,
      id: null,
      entityType: 'trial',
      entityId: trialId,
      state: 'published',
      headline: 'A',
      changeNote: null,
    });
    const v2Id = await rpcUpsert({
      anchorId: null,
      id: null,
      entityType: 'trial',
      entityId: trialId,
      state: 'published',
      headline: 'B',
      changeNote: null,
    });

    const admin = adminClient();
    const { data: v2Row } = await admin
      .from('primary_intelligence')
      .select('anchor_id')
      .eq('id', v2Id)
      .single();
    const a2: string = v2Row!.anchor_id;

    await as(p, 'agency_only').rpc('set_intelligence_lead', { p_anchor_id: a2 }).throwOnError();

    const { data: anchors } = await admin
      .from('primary_intelligence_anchors')
      .select('id, is_lead')
      .eq('entity_id', trialId);

    expect(anchors!.filter((a: { is_lead: boolean }) => a.is_lead).map((a: { id: string }) => a.id)).toEqual([a2]);
  });

  it('set_intelligence_lead rejects a draft-only anchor', async () => {
    const trialId = await createTrial();
    const dId = await rpcUpsert({
      anchorId: null,
      id: null,
      entityType: 'trial',
      entityId: trialId,
      state: 'draft',
      headline: 'draft',
      changeNote: null,
    });

    const admin = adminClient();
    const { data: dRow } = await admin
      .from('primary_intelligence')
      .select('anchor_id')
      .eq('id', dId)
      .single();
    const aId: string = dRow!.anchor_id;

    const result = await as(p, 'agency_only').rpc('set_intelligence_lead', { p_anchor_id: aId });
    expect(result.error).toBeTruthy();
    expect(result.error!.message).toMatch(/no published version|not published/i);
  });

  it('list_intelligence_for_entity: lead first; viewer sees only published anchor; payload has record+links', async () => {
    const trialId = await createTrial();
    // A second trial to link from the lead brief; proves DEFINER entity_name
    // resolution works for the agency persona (which has no space_members row).
    const linkedTrialId = await createTrial();
    const { data: linkedTrial } = await adminClient()
      .from('trials')
      .select('name')
      .eq('id', linkedTrialId)
      .single();
    const linkedTrialName: string = linkedTrial!.name;

    // First upsert creates the lead anchor (published) WITH a link.
    await as(p, 'agency_only')
      .rpc('upsert_primary_intelligence', {
        p_id: null,
        p_anchor_id: null,
        p_space_id: p.org.spaceId,
        p_entity_type: 'trial',
        p_entity_id: trialId,
        p_headline: 'Lead Published',
        p_summary_md: '',
        p_implications_md: '',
        p_state: 'published',
        p_change_note: null,
        p_links: [
          {
            entity_type: 'trial',
            entity_id: linkedTrialId,
            relationship_type: 'related',
            gloss: '',
            display_order: 0,
          },
        ],
      })
      .throwOnError();
    // Second upsert creates a draft-only sibling anchor.
    await rpcUpsert({
      anchorId: null,
      id: null,
      entityType: 'trial',
      entityId: trialId,
      state: 'draft',
      headline: 'Draft Only',
      changeNote: null,
    });

    // Agency sees both anchors: lead (published) and sibling (draft-only).
    const agencyResult = await as(p, 'agency_only').rpc('list_intelligence_for_entity', {
      p_space_id: p.org.spaceId,
      p_entity_type: 'trial',
      p_entity_id: trialId,
    });
    const agencyRows = agencyResult.data as any[];
    expect(agencyRows).toHaveLength(2);
    expect(agencyRows[0].is_lead).toBe(true);
    // DEFINER name resolution: the lead brief's link carries a resolved
    // entity_name even though agency_only has no space_members row.
    expect(agencyRows[0].published.links[0].entity_name).toBe(linkedTrialName);

    // Add a draft to the SAME (lead, published) anchor so we can prove the
    // per-row guard hides drafts from viewers even on an anchor they can see.
    const admin = adminClient();
    const { data: leadAnchor } = await admin
      .from('primary_intelligence_anchors')
      .select('id')
      .eq('entity_id', trialId)
      .eq('is_lead', true)
      .single();
    await rpcUpsert({
      anchorId: leadAnchor!.id,
      id: null,
      entityType: 'trial',
      entityId: trialId,
      state: 'draft',
      headline: 'Lead Draft Revision',
      changeNote: null,
    });

    // Viewer sees only the published-bearing anchor.
    const viewerResult = await as(p, 'reader').rpc('list_intelligence_for_entity', {
      p_space_id: p.org.spaceId,
      p_entity_type: 'trial',
      p_entity_id: trialId,
    });
    const viewerRows = viewerResult.data as any[];
    expect(viewerRows).toHaveLength(1);
    // The one visible anchor carries a rich published payload.
    expect(viewerRows[0].published).toBeTruthy();
    expect(viewerRows[0].published.record).toBeTruthy();
    expect(viewerRows[0].published.links).toBeDefined();
    // No draft leak: the per-row DEFINER guard nulls the draft for a viewer
    // even though the anchor itself is visible (it has a published version).
    expect(viewerRows[0].draft).toBeNull();

    // Non-member: a user with no space_members row for this space gets [].
    const strangerResult = await as(p, 'no_memberships').rpc('list_intelligence_for_entity', {
      p_space_id: p.org.spaceId,
      p_entity_type: 'trial',
      p_entity_id: trialId,
    });
    const strangerRows = strangerResult.data as any[];
    expect(strangerRows).toHaveLength(0);
  });

  it('reorder_intelligence writes display_order and rejects a mismatched set', async () => {
    const trialId = await createTrial();
    await rpcUpsert({
      anchorId: null,
      id: null,
      entityType: 'trial',
      entityId: trialId,
      state: 'published',
      headline: 'A',
      changeNote: null,
    });
    await rpcUpsert({
      anchorId: null,
      id: null,
      entityType: 'trial',
      entityId: trialId,
      state: 'published',
      headline: 'B',
      changeNote: null,
    });

    const admin = adminClient();
    const { data: anchorRows } = await admin
      .from('primary_intelligence_anchors')
      .select('id')
      .eq('entity_id', trialId)
      .order('display_order');
    const ids = anchorRows!.map((a: { id: string }) => a.id);

    await as(p, 'agency_only')
      .rpc('reorder_intelligence', {
        p_space_id: p.org.spaceId,
        p_entity_type: 'trial',
        p_entity_id: trialId,
        p_anchor_ids: [ids[1], ids[0]],
      })
      .throwOnError();

    const { data: after } = await admin
      .from('primary_intelligence_anchors')
      .select('id, display_order')
      .eq('entity_id', trialId)
      .order('display_order');
    expect(after!.map((a: { id: string }) => a.id)).toEqual([ids[1], ids[0]]);

    // Mismatched set (only one anchor when two exist) must be rejected.
    const bad = await as(p, 'agency_only').rpc('reorder_intelligence', {
      p_space_id: p.org.spaceId,
      p_entity_type: 'trial',
      p_entity_id: trialId,
      p_anchor_ids: [ids[0]],
    });
    expect(bad.error).toBeTruthy();
    expect(bad.error!.message).toMatch(/anchor set/i);
  });
});
