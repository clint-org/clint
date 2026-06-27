/**
 * Integration tests: get_space_inventory_snapshot emits marker/event instances.
 *
 * Verifies that the snapshot RPC includes `markers` (with trial linkage via
 * marker_assignments) and `events` (with an anchor derived from company/asset/trial_id)
 * in the returned jsonb, scoped to the given space.
 *
 * These two new fields are used by the AI extraction validator (Task 4) to
 * detect duplicate markers/events across re-imports.
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
let markerId: string;
let markerAssignmentId: string;
let eventId: string;

// System fixture ids (from seed.sql).
const TOPLINE_DATA_TYPE_ID = 'a0000000-0000-0000-0000-000000000013';
const REGULATORY_CATEGORY_ID = 'e0000000-0000-0000-0000-000000000002';

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

  // Insert marker using the system "Topline Data" type.
  const { data: marker, error: markerErr } = await admin
    .from('markers')
    .insert({
      space_id: p.org.spaceId,
      marker_type_id: TOPLINE_DATA_TYPE_ID,
      title: 'Phase 2 Topline Readout',
      event_date: '2026-09-15',
      created_by: p.ids.contributor,
    })
    .select('id')
    .single();
  if (markerErr) throw new Error(`markers insert: ${markerErr.message}`);
  markerId = marker.id;

  // Link the marker to the trial via marker_assignments.
  const { data: assignment, error: assignErr } = await admin
    .from('marker_assignments')
    .insert({ marker_id: markerId, trial_id: trialId })
    .select('id')
    .single();
  if (assignErr) throw new Error(`marker_assignments insert: ${assignErr.message}`);
  markerAssignmentId = assignment.id;

  // Insert event anchored to the trial.
  const { data: event, error: eventErr } = await admin
    .from('events')
    .insert({
      space_id: p.org.spaceId,
      trial_id: trialId,
      category_id: REGULATORY_CATEGORY_ID,
      title: 'IND Filing for SNAPSHOT-001',
      event_date: '2026-10-01',
      priority: 'high',
      created_by: p.ids.contributor,
    })
    .select('id')
    .single();
  if (eventErr) throw new Error(`events insert: ${eventErr.message}`);
  eventId = event.id;
}, 120_000);

afterAll(async () => {
  if (markerAssignmentId) {
    await admin.from('marker_assignments').delete().eq('id', markerAssignmentId);
  }
  if (markerId) {
    await admin.from('markers').delete().eq('id', markerId);
  }
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

describe('get_space_inventory_snapshot includes marker and event instances', () => {
  it('returns markers array with id, trial_id, marker_type, title, event_date', async () => {
    const r = await as(p, 'contributor').rpc('get_space_inventory_snapshot', {
      p_space_id: p.org.spaceId,
    });
    const snapshot = expectOk(r) as Record<string, unknown>;

    expect(Array.isArray(snapshot['markers'])).toBe(true);

    const markers = snapshot['markers'] as Array<Record<string, unknown>>;
    const found = markers.find((m) => m['id'] === markerId);
    expect(found).toBeTruthy();
    expect(found!['trial_id']).toBe(trialId);
    expect(found!['marker_type']).toBe('Topline Data');
    expect(found!['title']).toBe('Phase 2 Topline Readout');
    expect(found!['event_date']).toBe('2026-09-15');
  });

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
    expect(found!['category']).toBe('Regulatory');
    expect(found!['title']).toBe('IND Filing for SNAPSHOT-001');
    expect(found!['event_date']).toBe('2026-10-01');
  });

  it('markers and events are included in the hash (hash changes when instances change)', async () => {
    // Get hash before inserting an extra marker.
    const r1 = await as(p, 'contributor').rpc('get_space_inventory_snapshot', {
      p_space_id: p.org.spaceId,
    });
    const hash1 = (expectOk(r1) as Record<string, unknown>)['hash'] as string;

    // Insert a second marker with a trial assignment (markers without assignments
    // are excluded from the CTE and would not change the hash).
    const { data: m2, error: m2err } = await admin
      .from('markers')
      .insert({
        space_id: p.org.spaceId,
        marker_type_id: TOPLINE_DATA_TYPE_ID,
        title: 'Extra Marker For Hash Test',
        event_date: '2026-11-01',
        created_by: p.ids.contributor,
      })
      .select('id')
      .single();
    if (m2err) throw new Error(`extra marker insert: ${m2err.message}`);

    const { error: aErr } = await admin
      .from('marker_assignments')
      .insert({ marker_id: m2.id, trial_id: trialId });
    if (aErr) throw new Error(`extra marker assignment insert: ${aErr.message}`);

    try {
      const r2 = await as(p, 'contributor').rpc('get_space_inventory_snapshot', {
        p_space_id: p.org.spaceId,
      });
      const hash2 = (expectOk(r2) as Record<string, unknown>)['hash'] as string;
      expect(hash2).not.toBe(hash1);
    } finally {
      await admin.from('marker_assignments').delete().eq('marker_id', m2.id);
      await admin.from('markers').delete().eq('id', m2.id);
    }
  });
});
