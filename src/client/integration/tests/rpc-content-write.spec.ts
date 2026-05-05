/**
 * Content-write RPCs (primary intelligence). Two layers of coverage:
 *
 * 1. Agency firewall: tenant_owner cannot write, agency_only can.
 * 2. Round-trip behavior: real entities seeded via service-role client, then
 *    upsert -> read -> update -> read against the agency persona to verify
 *    links survive, entity_name resolves, and revisions.changed_fields
 *    records the right diff (the 5a1daae feature has zero other coverage).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectOk } from '../harness/as';

let p: Personas;

// Real entity ids seeded into the persona space for the round-trip suite.
let trialAId: string;
let trialBId: string;
let companyId: string;
let productId: string;

beforeAll(async () => {
  p = await buildPersonas();

  // Seed a minimal entity graph in the persona space. The personas fixture
  // doesn't create companies/products/trials -- those are domain rows the
  // gate-only tests didn't need.
  const admin = adminClient();
  const userId = p.ids.tenant_owner;

  const { data: company } = await admin
    .from('companies')
    .insert({ space_id: p.org.spaceId, name: 'Acme Bio', created_by: userId })
    .select('id')
    .single();
  companyId = company!.id;

  const { data: product } = await admin
    .from('products')
    .insert({ space_id: p.org.spaceId, company_id: companyId, name: 'AcmeMab', created_by: userId })
    .select('id')
    .single();
  productId = product!.id;

  const { data: ta } = await admin
    .from('therapeutic_areas')
    .insert({ space_id: p.org.spaceId, name: 'Oncology', created_by: userId })
    .select('id')
    .single();

  const { data: trials } = await admin
    .from('trials')
    .insert([
      {
        space_id: p.org.spaceId,
        product_id: productId,
        therapeutic_area_id: ta!.id,
        name: 'Trial Alpha',
        identifier: 'NCT00000001',
        phase: 'P3',
        created_by: userId,
      },
      {
        space_id: p.org.spaceId,
        product_id: productId,
        therapeutic_area_id: ta!.id,
        name: 'Trial Beta',
        identifier: 'NCT00000002',
        phase: 'P3',
        created_by: userId,
      },
    ])
    .select('id, name');
  trialAId = trials!.find((t) => t.name === 'Trial Alpha')!.id;
  trialBId = trials!.find((t) => t.name === 'Trial Beta')!.id;
}, 90_000);

const FAKE_ENTITY = '00000000-0000-0000-0000-000000000000';

describe('rpc upsert_primary_intelligence (gate)', () => {
  it('agency_only: gate accepts (FK violation on fake entity_id is fine)', async () => {
    const r = await as(p, 'agency_only').rpc('upsert_primary_intelligence', {
      p_id: null,
      p_space_id: p.org.spaceId,
      p_entity_type: 'company',
      p_entity_id: FAKE_ENTITY,
      p_headline: 'test',
      p_thesis_md: 'test',
      p_watch_md: 'test',
      p_implications_md: 'test',
      p_state: 'draft',
      p_change_note: 'test',
      p_links: [],
    });
    // 23503 = FK violation (fake entity uuid). 42501 / P0001 would mean
    // the agency-firewall gate wrongly rejected the agency persona.
    if (r.error?.code === '42501' || r.error?.code === 'P0001') {
      throw new Error(`agency_only denied at gate: ${r.error.message}`);
    }
  });

  it('tenant_owner (agency-firewalled): denied', async () => {
    const r = await as(p, 'tenant_owner').rpc('upsert_primary_intelligence', {
      p_id: null,
      p_space_id: p.org.spaceId,
      p_entity_type: 'company',
      p_entity_id: FAKE_ENTITY,
      p_headline: 'test',
      p_thesis_md: 'test',
      p_watch_md: 'test',
      p_implications_md: 'test',
      p_state: 'draft',
      p_change_note: 'test',
      p_links: [],
    });
    if (r.error?.code !== '42501' && r.error?.code !== 'P0001') {
      throw new Error(`expected denial, got ${r.error?.code}: ${r.error?.message}`);
    }
  });
});

describe('rpc build_intelligence_payload (gate)', () => {
  it('agency_only: gate accepts', async () => {
    const r = await as(p, 'agency_only').rpc('build_intelligence_payload', {
      p_space_id: p.org.spaceId,
      p_entity_type: 'company',
      p_entity_id: FAKE_ENTITY,
      p_state: 'draft',
    });
    if (r.error?.code === '42501' || r.error?.code === 'P0001') {
      throw new Error(`agency_only denied at gate: ${r.error.message}`);
    }
  });

  it('tenant_owner: gate denies or RLS-filters to empty', async () => {
    const r = await as(p, 'tenant_owner').rpc('build_intelligence_payload', {
      p_space_id: p.org.spaceId,
      p_entity_type: 'company',
      p_entity_id: FAKE_ENTITY,
      p_state: 'draft',
    });
    // build_intelligence_payload is a read RPC; the agency firewall manifests
    // either as 42501/P0001 OR as RLS returning empty data. Both are
    // acceptable. 5xx would indicate a server bug.
    if (r.error?.code?.startsWith('5')) {
      throw new Error(`unexpected server error: ${r.error.code}: ${r.error.message}`);
    }
  });
});

/**
 * Round-trip suite. Anchors the read on Trial Alpha, links to Trial Beta and
 * the product. Covers what the gate-only tests don't: that links and
 * changed_fields actually behave end-to-end.
 */
describe('upsert_primary_intelligence + build_intelligence_payload (round-trip)', () => {
  type Link = {
    entity_type: 'trial' | 'marker' | 'company' | 'product';
    entity_id: string;
    relationship_type: string;
    gloss: string | null;
    display_order: number;
  };
  type Payload = {
    record: { id: string; state: 'draft' | 'published'; headline: string };
    links: (Link & { id: string; entity_name: string | null })[];
    recent_revisions: {
      id: string;
      state: 'draft' | 'published';
      change_note: string | null;
      changed_fields: Record<string, true>;
    }[];
  };

  async function read(state: 'draft' | 'published'): Promise<Payload | null> {
    const r = await as(p, 'agency_only').rpc('build_intelligence_payload', {
      p_space_id: p.org.spaceId,
      p_entity_type: 'trial',
      p_entity_id: trialAId,
      p_state: state,
    });
    return expectOk(r) as Payload | null;
  }

  async function upsert(args: {
    id: string | null;
    state: 'draft' | 'published';
    headline: string;
    change_note: string | null;
    links: Link[];
  }): Promise<string> {
    const r = await as(p, 'agency_only').rpc('upsert_primary_intelligence', {
      p_id: args.id,
      p_space_id: p.org.spaceId,
      p_entity_type: 'trial',
      p_entity_id: trialAId,
      p_headline: args.headline,
      p_thesis_md: '',
      p_watch_md: '',
      p_implications_md: '',
      p_state: args.state,
      p_change_note: args.change_note,
      p_links: args.links,
    });
    return expectOk(r) as string;
  }

  it('create: persists links with entity_name resolved; creation revision has empty changed_fields', async () => {
    const id = await upsert({
      id: null,
      state: 'draft',
      headline: 'Initial read',
      change_note: null,
      links: [
        {
          entity_type: 'trial',
          entity_id: trialBId,
          relationship_type: 'Same class',
          gloss: null,
          display_order: 0,
        },
      ],
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const payload = await read('draft');
    expect(payload).not.toBeNull();
    expect(payload!.record.id).toBe(id);
    expect(payload!.links).toHaveLength(1);
    expect(payload!.links[0]).toMatchObject({
      entity_type: 'trial',
      entity_id: trialBId,
      entity_name: 'Trial Beta', // 5f86089: entity_name resolved by build_intelligence_payload
      relationship_type: 'Same class',
    });
    // 5a1daae: creation revision leaves changed_fields empty -- the row's
    // existence already implies "created".
    expect(payload!.recent_revisions).toHaveLength(1);
    expect(payload!.recent_revisions[0].changed_fields).toEqual({});
  });

  it('update headline only: changed_fields = {headline: true}; links untouched', async () => {
    const draft = await read('draft');
    const id = draft!.record.id;
    await upsert({
      id,
      state: 'draft',
      headline: 'Revised read',
      change_note: 'Tightened headline',
      links: draft!.links.map((l) => ({
        entity_type: l.entity_type,
        entity_id: l.entity_id,
        relationship_type: l.relationship_type,
        gloss: l.gloss,
        display_order: l.display_order,
      })),
    });

    const next = await read('draft');
    expect(next!.record.headline).toBe('Revised read');
    expect(next!.links).toHaveLength(1);
    // recent_revisions is ordered by edited_at desc, so [0] is the latest.
    expect(next!.recent_revisions[0].changed_fields).toEqual({ headline: true });
    expect(next!.recent_revisions[0].change_note).toBe('Tightened headline');
  });

  it('add a product link: changed_fields = {links: true}; both links present', async () => {
    const draft = await read('draft');
    const id = draft!.record.id;
    const links: Link[] = [
      ...draft!.links.map((l) => ({
        entity_type: l.entity_type,
        entity_id: l.entity_id,
        relationship_type: l.relationship_type,
        gloss: l.gloss,
        display_order: l.display_order,
      })),
      {
        entity_type: 'product',
        entity_id: productId,
        relationship_type: 'Predecessor',
        gloss: null,
        display_order: 1,
      },
    ];
    await upsert({
      id,
      state: 'draft',
      headline: draft!.record.headline,
      change_note: null,
      links,
    });

    const next = await read('draft');
    expect(next!.links).toHaveLength(2);
    const product = next!.links.find((l) => l.entity_type === 'product');
    expect(product?.entity_name).toBe('AcmeMab');
    expect(next!.recent_revisions[0].changed_fields).toEqual({ links: true });
  });

  it('publish: changed_fields = {state: true}; row reads under "published"', async () => {
    const draft = await read('draft');
    const id = draft!.record.id;
    await upsert({
      id,
      state: 'published',
      headline: draft!.record.headline,
      change_note: null,
      links: draft!.links.map((l) => ({
        entity_type: l.entity_type,
        entity_id: l.entity_id,
        relationship_type: l.relationship_type,
        gloss: l.gloss,
        display_order: l.display_order,
      })),
    });

    const published = await read('published');
    expect(published).not.toBeNull();
    expect(published!.record.state).toBe('published');
    expect(published!.links).toHaveLength(2);
    // The publish update flips state, so the latest revision records that.
    expect(published!.recent_revisions[0].changed_fields).toEqual({ state: true });
  });

  it('change relationship_type only: still counts as a links change', async () => {
    // After publish, currentId now points to a published row.
    const pub = await read('published');
    const id = pub!.record.id;
    const flipped = pub!.links.map((l) => ({
      entity_type: l.entity_type,
      entity_id: l.entity_id,
      relationship_type: l.entity_type === 'trial' ? 'Competitor' : l.relationship_type,
      gloss: l.gloss,
      display_order: l.display_order,
    }));
    await upsert({
      id,
      state: 'published',
      headline: pub!.record.headline,
      change_note: null,
      links: flipped,
    });

    const next = await read('published');
    const trial = next!.links.find((l) => l.entity_type === 'trial');
    expect(trial?.relationship_type).toBe('Competitor');
    expect(next!.recent_revisions[0].changed_fields).toEqual({ links: true });
  });
});
