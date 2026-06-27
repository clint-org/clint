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

  // ------------------------------------------------------------------
  // Task 5: detail bundle RPCs return briefs[] instead of published/draft
  // ------------------------------------------------------------------

  it('get_trial_detail_with_intelligence returns briefs[] + referenced_in (no published key)', async () => {
    const trialId = await createTrial();
    await rpcUpsert({
      anchorId: null,
      id: null,
      entityType: 'trial',
      entityId: trialId,
      state: 'published',
      headline: 'X',
      changeNote: null,
    });
    await rpcUpsert({
      anchorId: null,
      id: null,
      entityType: 'trial',
      entityId: trialId,
      state: 'published',
      headline: 'Y',
      changeNote: null,
    });

    const res = await as(p, 'agency_only')
      .rpc('get_trial_detail_with_intelligence', { p_trial_id: trialId })
      .throwOnError();
    const bundle = res.data as any;

    expect(bundle.entity_type).toBe('trial');
    expect(bundle.briefs).toHaveLength(2);
    expect(Array.isArray(bundle.referenced_in)).toBe(true);
    expect(bundle).not.toHaveProperty('published'); // old shape removed
    expect(bundle).not.toHaveProperty('draft');     // old shape removed
  });

  it('published brief contributors exclude draft-only editors (metadata-leak fix)', async () => {
    const trialId = await createTrial();

    // Create a published anchor -- agency_only becomes the editor/contributor.
    await rpcUpsert({
      anchorId: null,
      id: null,
      entityType: 'trial',
      entityId: trialId,
      state: 'published',
      headline: 'Published',
      changeNote: null,
    });

    const admin = adminClient();
    const { data: anchorRow } = await admin
      .from('primary_intelligence_anchors')
      .select('id')
      .eq('entity_id', trialId)
      .eq('is_lead', true)
      .single();
    const anchorId: string = anchorRow!.id;

    // Insert a draft row to the SAME anchor via pg, attributing it to the
    // reader persona -- simulating a "draft-only editor" whose identity must
    // not leak into the published brief's contributors.
    const draftEditorId: string = p.ids.reader;
    const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
    try {
      await pg.connect();
      await pg.query(
        `insert into public.primary_intelligence
           (anchor_id, space_id, state, headline, summary_md, implications_md, last_edited_by)
         values ($1, $2, 'draft', 'Draft Revision', '', '', $3)`,
        [anchorId, p.org.spaceId, draftEditorId],
      );
    } finally {
      await pg.end();
    }

    // Reader calls the detail RPC -- they have space access and can see the
    // published anchor but must NOT see the draft editor's identity.
    const res = await as(p, 'reader')
      .rpc('get_trial_detail_with_intelligence', { p_trial_id: trialId })
      .throwOnError();
    const bundle = res.data as any;

    expect(bundle.briefs).toHaveLength(1);
    const publishedBrief = bundle.briefs[0].published;
    expect(publishedBrief).toBeTruthy();

    const contributors: string[] = publishedBrief.contributors ?? [];
    const authorKeys: string[] = Object.keys(publishedBrief.authors ?? {});

    // The draft-only editor must not appear in contributors or authors.
    expect(contributors).not.toContain(draftEditorId);
    expect(authorKeys).not.toContain(draftEditorId);
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

// ---------------------------------------------------------------------------
// Task 6: per-anchor history + lead auto-promotion + anchor cleanup
// ---------------------------------------------------------------------------

describe('history, lifecycle, and lead promotion (anchor-keyed)', () => {
  it('withdrawing the lead\'s only published version auto-promotes the next published anchor', async () => {
    const trialId = await createTrial();
    const v1 = await rpcUpsert({
      anchorId: null, id: null, entityType: 'trial', entityId: trialId,
      state: 'published', headline: 'Lead', changeNote: null,
    });
    const v2 = await rpcUpsert({
      anchorId: null, id: null, entityType: 'trial', entityId: trialId,
      state: 'published', headline: 'Other', changeNote: null,
    });
    const admin = adminClient();
    const { data: row1 } = await admin.from('primary_intelligence').select('anchor_id').eq('id', v1).single();
    const { data: row2 } = await admin.from('primary_intelligence').select('anchor_id').eq('id', v2).single();
    const leadAnchor: string = row1!.anchor_id;
    const otherAnchor: string = row2!.anchor_id;

    // Precondition: the FIRST brief's anchor is the entity's lead before withdraw.
    // Without this, the test could pass trivially if upsert made the other anchor lead.
    const { data: pre } = await admin
      .from('primary_intelligence_anchors')
      .select('id,is_lead')
      .eq('entity_id', trialId);
    expect(pre!.filter((a: any) => a.is_lead).map((a: any) => a.id)).toEqual([leadAnchor]);

    await as(p, 'agency_only')
      .rpc('withdraw_primary_intelligence', { p_id: v1, p_change_note: 'pulled' })
      .throwOnError();

    const { data: anchors } = await admin
      .from('primary_intelligence_anchors')
      .select('id,is_lead')
      .eq('entity_id', trialId);

    expect(anchors!.filter((a: any) => a.is_lead).map((a: any) => a.id)).toEqual([otherAnchor]);
  });

  it('deleting a fresh draft removes its anchor', async () => {
    const trialId = await createTrial();
    const d = await rpcUpsert({
      anchorId: null, id: null, entityType: 'trial', entityId: trialId,
      state: 'draft', headline: 'Solo draft', changeNote: null,
    });
    const admin = adminClient();
    const { data: piRow } = await admin.from('primary_intelligence').select('anchor_id').eq('id', d).single();
    const aId: string = piRow!.anchor_id;

    await as(p, 'agency_only').rpc('delete_primary_intelligence', { p_id: d }).throwOnError();

    const { data: left } = await admin.from('primary_intelligence_anchors').select('id').eq('id', aId);
    expect(left).toHaveLength(0);
  });

  it('purge with p_purge_anchor removes the whole anchor (and its versions)', async () => {
    const trialId = await createTrial();
    const headline = 'Purge Me';
    const d = await rpcUpsert({
      anchorId: null, id: null, entityType: 'trial', entityId: trialId,
      state: 'draft', headline, changeNote: null,
    });
    const admin = adminClient();
    const { data: piRow } = await admin.from('primary_intelligence').select('anchor_id').eq('id', d).single();
    const aId: string = piRow!.anchor_id;

    // purge requires p_confirmation to match the brief's headline.
    await as(p, 'agency_only')
      .rpc('purge_primary_intelligence', { p_id: d, p_confirmation: headline, p_purge_anchor: true })
      .throwOnError();

    const { data: anchorLeft } = await admin
      .from('primary_intelligence_anchors')
      .select('id')
      .eq('id', aId);
    expect(anchorLeft).toHaveLength(0);

    const { data: versionsLeft } = await admin
      .from('primary_intelligence')
      .select('id')
      .eq('anchor_id', aId);
    expect(versionsLeft).toHaveLength(0);
  });

  it('get_primary_intelligence_history is scoped to one anchor', async () => {
    const trialId = await createTrial();
    const v1 = await rpcUpsert({
      anchorId: null, id: null, entityType: 'trial', entityId: trialId,
      state: 'published', headline: 'A', changeNote: null,
    });
    await rpcUpsert({
      anchorId: null, id: null, entityType: 'trial', entityId: trialId,
      state: 'published', headline: 'B', changeNote: null,
    });
    const admin = adminClient();
    const { data: piRow } = await admin.from('primary_intelligence').select('anchor_id').eq('id', v1).single();
    const aId: string = piRow!.anchor_id;

    const hist = await as(p, 'agency_only')
      .rpc('get_primary_intelligence_history', { p_anchor_id: aId })
      .throwOnError();
    expect((hist.data as any).versions).toHaveLength(1); // only anchor A's versions
  });
});

// ---------------------------------------------------------------------------
// Task 7: feed is_lead + landscape presence (multi-anchor)
// ---------------------------------------------------------------------------

/**
 * Traverse the get_dashboard_data payload shape:
 *   companies[] -> assets[] -> indications[] -> trials[]
 * and return the trial node matching trialId, or null if absent.
 */
function findTrial(payload: any, trialId: string): any {
  if (!Array.isArray(payload)) return null;
  for (const company of payload) {
    for (const asset of (company.assets ?? [])) {
      for (const indication of (asset.indications ?? [])) {
        for (const trial of (indication.trials ?? [])) {
          if (trial.id === trialId) return trial;
        }
      }
    }
  }
  return null;
}

describe('landscape presence: has_intelligence + headline + count (multi-anchor)', () => {
  let indicationId: string;
  let conditionId: string;

  beforeAll(async () => {
    const admin = adminClient();
    const userId = p.ids.tenant_owner;

    // Create a fresh indication + condition + asset_indication so trials
    // created in this describe block appear in get_dashboard_data.
    const { data: ind } = await admin
      .from('indications')
      .insert({
        space_id: p.org.spaceId,
        name: `DashInd-${Date.now()}`,
        abbreviation: 'DSHI',
        created_by: userId,
      })
      .select('id')
      .single();
    indicationId = ind!.id;

    const { data: cond } = await admin
      .from('conditions')
      .insert({ space_id: p.org.spaceId, name: `DashCond-${Date.now()}`, source: 'analyst' })
      .select('id')
      .single();
    conditionId = cond!.id;

    await admin.from('condition_indication_map').insert({
      condition_id: conditionId,
      indication_id: indicationId,
    });
    await admin.from('asset_indications').insert({
      asset_id: assetId,
      indication_id: indicationId,
      space_id: p.org.spaceId,
      development_status: 'P3',
      created_by: userId,
    });
  }, 60_000);

  it('reflects lead headline and counts two published anchors in get_dashboard_data', async () => {
    const trialId = await createTrial();
    const admin = adminClient();
    // Wire the trial into the indication hierarchy so it appears in the dashboard.
    await admin.from('trial_conditions').insert({ trial_id: trialId, condition_id: conditionId });

    // First upsert: creates the lead anchor (is_lead=true).
    await rpcUpsert({
      anchorId: null,
      id: null,
      entityType: 'trial',
      entityId: trialId,
      state: 'published',
      headline: 'Lead headline',
      changeNote: null,
    });
    // Second upsert: creates a non-lead sibling anchor.
    await rpcUpsert({
      anchorId: null,
      id: null,
      entityType: 'trial',
      entityId: trialId,
      state: 'published',
      headline: 'Second',
      changeNote: null,
    });

    const dash = await as(p, 'reader')
      .rpc('get_dashboard_data', { p_space_id: p.org.spaceId })
      .throwOnError();
    const trialNode = findTrial(dash.data as any[], trialId);
    expect(trialNode, `trial ${trialId} not found in dashboard payload`).toBeTruthy();
    expect(trialNode.has_intelligence).toBe(true);
    expect(trialNode.intelligence_headline).toBe('Lead headline');
    expect(trialNode.intelligence_count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Task 8: RLS on primary_intelligence_anchors (direct table access)
//
// The policy "primary_intelligence_anchors read" (20260627130000) allows:
//   - agency members: all anchors in their space
//   - space members: only anchors with at least one published version
// So a viewer (space member, non-agency) cannot see a draft-only anchor,
// and a non-member sees nothing at all.
//
// The list_intelligence_for_entity test (Task 4, above) already covers viewer
// visibility via the RPC. These tests pin the RLS policy on the TABLE directly,
// which is distinct from the DEFINER RPC path.
// ---------------------------------------------------------------------------

describe('RLS: primary_intelligence_anchors (direct table)', () => {
  it('viewer cannot see a draft-only anchor; non-member sees nothing', async () => {
    const trialId = await createTrial();

    // Agency creates a draft-only brief (no published version).
    await rpcUpsert({
      anchorId: null,
      id: null,
      entityType: 'trial',
      entityId: trialId,
      state: 'draft',
      headline: 'Hidden draft anchor',
      changeNote: null,
    });

    // viewer (space member, non-agency): the RLS policy requires a published
    // version on the anchor, so a draft-only anchor is invisible.
    const viewerAnchors = await as(p, 'reader')
      .from('primary_intelligence_anchors')
      .select('id')
      .eq('entity_id', trialId);
    expect(viewerAnchors.data ?? []).toHaveLength(0);

    // non-member: no space access at all, so nothing is visible.
    const strangerAnchors = await as(p, 'no_memberships')
      .from('primary_intelligence_anchors')
      .select('id')
      .eq('entity_id', trialId);
    expect(strangerAnchors.data ?? []).toHaveLength(0);
  });

  it('viewer can see an anchor once it has a published version', async () => {
    const trialId = await createTrial();

    await rpcUpsert({
      anchorId: null,
      id: null,
      entityType: 'trial',
      entityId: trialId,
      state: 'published',
      headline: 'Visible to viewer',
      changeNote: null,
    });

    const viewerAnchors = await as(p, 'reader')
      .from('primary_intelligence_anchors')
      .select('id, is_lead')
      .eq('entity_id', trialId);
    expect(viewerAnchors.data ?? []).toHaveLength(1);
    expect(viewerAnchors.data![0].is_lead).toBe(true);
  });
});
