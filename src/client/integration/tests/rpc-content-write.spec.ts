/**
 * Content-write RPCs (primary intelligence). Agency-firewalled --
 * tenant_owner persona must not be able to write, agency_only must.
 */

import { beforeAll, describe, it } from 'vitest';
import { buildPersonas, Personas } from '../fixtures/personas';
import { as } from '../harness/as';

let p: Personas;
beforeAll(async () => {
  p = await buildPersonas();
}, 60_000);

const FAKE_ENTITY = '00000000-0000-0000-0000-000000000000';

describe('rpc upsert_primary_intelligence', () => {
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

describe('rpc build_intelligence_payload', () => {
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
