/**
 * Integration tests: get_space_inventory_snapshot emits event instances.
 *
 * Repointed from the pre-cutover version that also tested markers/marker_assignments
 * (both dropped in the event-model cutover). The markers describe block is retired
 * below; this file now covers only the events half.
 *
 * Verifies that the snapshot RPC includes `events` (with anchor derived from
 * anchor_type/anchor_id) in the returned jsonb, scoped to the given space,
 * and that adding an event changes the hash.
 *
 * These fields are used by the AI extraction validator (Task 4) to detect
 * duplicate events across re-imports.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectOk } from '../harness/as';

let p: Personas;
let admin: ReturnType<typeof adminClient>;

// Ids created during setup, cleaned up in afterAll.
let companyId: string;
let assetId: string;
let trialId: string;
let eventId: string;

// 'Regulatory Filing' system event_type (category: Regulatory).
// category_id d0000000-0000-0000-0000-000000000003 => event_type_categories.name = 'Regulatory'
const REGULATORY_FILING_EVENT_TYPE_ID = 'a0000000-0000-0000-0000-000000000032';

beforeAll(async () => {
  p = await buildPersonas();
  admin = adminClient();

  // Insert company first.
  const { data: company, error: companyErr } = await admin
    .from('companies')
    .insert({ space_id: p.org.spaceId, name: 'Snapshot Test Pharma', created_by: p.ids.contributor })
    .select('id')
    .single();
  if (companyErr) throw new Error(`companies insert: ${companyErr.message}`);
  companyId = company.id;

  // Insert asset.
  const { data: asset, error: assetErr } = await admin
    .from('assets')
    .insert({ space_id: p.org.spaceId, company_id: companyId, name: 'Snapshot Test Drug', created_by: p.ids.contributor })
    .select('id')
    .single();
  if (assetErr) throw new Error(`assets insert: ${assetErr.message}`);
  assetId = asset.id;

  // Insert trial BEFORE asset_indications (trg_auto_derive seeding order constraint).
  const { data: trial, error: trialErr } = await admin
    .from('trials')
    .insert({ space_id: p.org.spaceId, asset_id: assetId, name: 'SNAPSHOT-001', phase_type: 'P2', created_by: p.ids.contributor })
    .select('id')
    .single();
  if (trialErr) throw new Error(`trials insert: ${trialErr.message}`);
  trialId = trial.id;

  // Insert event anchored to the trial using the new single-anchor model.
  // anchor_type: 'trial' + anchor_id mirrors the old trial_id column (dropped).
  // event_type_id replaces category_id; 'Regulatory Filing' maps to category 'Regulatory'.
  const { data: event, error: eventErr } = await admin
    .from('events')
    .insert({
      space_id: p.org.spaceId,
      event_type_id: REGULATORY_FILING_EVENT_TYPE_ID,
      anchor_type: 'trial',
      anchor_id: trialId,
      title: 'IND Filing for SNAPSHOT-001',
      event_date: '2026-10-01',
      created_by: p.ids.contributor,
    })
    .select('id')
    .single();
  if (eventErr) throw new Error(`events insert: ${eventErr.message}`);
  eventId = event.id;
}, 120_000);

afterAll(async () => {
  if (eventId) {
    await admin.from('events').delete().eq('id', eventId);
  }
  if (trialId) {
    await admin.from('trials').delete().eq('id', trialId);
  }
  if (assetId) {
    await admin.from('assets').delete().eq('id', assetId);
  }
  if (companyId) {
    await admin.from('companies').delete().eq('id', companyId);
  }
});

// markers describe block removed: markers/marker_assignments/marker_types are
// dropped in the event-model cutover (migration set C). The snapshot RPC no
// longer emits a 'markers' key. Stage-5 may add a dedicated snapshot-regression
// spec for the new taxonomy tables (event_types/event_type_categories).

describe('get_space_inventory_snapshot includes event instances', () => {
  it('returns events array with id, anchor (level + id), category, title, event_date', async () => {
    const r = await as(p, 'contributor').rpc('get_space_inventory_snapshot', {
      p_space_id: p.org.spaceId,
    });
    const snapshot = expectOk(r) as Record<string, unknown>;

    expect(Array.isArray(snapshot['events'])).toBe(true);

    const events = snapshot['events'] as Array<Record<string, unknown>>;
    const found = events.find((e) => e['id'] === eventId);
    expect(found).toBeTruthy();
    const anchor = found!['anchor'] as Record<string, unknown>;
    expect(anchor['level']).toBe('trial');
    expect(anchor['id']).toBe(trialId);
    // category is resolved via event_type_id -> event_types.category_id -> event_type_categories.name
    expect(found!['category']).toBe('Regulatory');
    expect(found!['title']).toBe('IND Filing for SNAPSHOT-001');
    expect(found!['event_date']).toBe('2026-10-01');
  });

  it('events are included in the hash (hash changes when a new event is added)', async () => {
    // Capture hash before inserting an extra event.
    const r1 = await as(p, 'contributor').rpc('get_space_inventory_snapshot', {
      p_space_id: p.org.spaceId,
    });
    const hash1 = (expectOk(r1) as Record<string, unknown>)['hash'] as string;

    // Insert a second event into the same space; it must shift the hash.
    const { data: e2, error: e2err } = await admin
      .from('events')
      .insert({
        space_id: p.org.spaceId,
        event_type_id: REGULATORY_FILING_EVENT_TYPE_ID,
        anchor_type: 'trial',
        anchor_id: trialId,
        title: 'Extra Event For Hash Test',
        event_date: '2026-11-01',
        created_by: p.ids.contributor,
      })
      .select('id')
      .single();
    if (e2err) throw new Error(`extra event insert: ${e2err.message}`);

    try {
      const r2 = await as(p, 'contributor').rpc('get_space_inventory_snapshot', {
        p_space_id: p.org.spaceId,
      });
      const hash2 = (expectOk(r2) as Record<string, unknown>)['hash'] as string;
      expect(hash2).not.toBe(hash1);
    } finally {
      await admin.from('events').delete().eq('id', e2.id);
    }
  });
});
