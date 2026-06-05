/**
 * Content-create authorization + marker/trial space isolation.
 *
 * Covers two gaps closed by migration 20260605130000:
 *
 * 1. Viewer-write escalation. The shared entity-create RPCs (create_company,
 *    create_marker, create_event, ...) are SECURITY DEFINER and granted to
 *    `authenticated`, so they bypass table RLS. Before the fix they gated only
 *    on has_space_access(space_id) with no role array, letting a space viewer
 *    (read-only) create content. After the fix they require owner/editor.
 *
 * 2. Cross-space marker->trial assignment. create_marker and
 *    update_marker_assignments must reject any trial that does not live in the
 *    marker's space, even for an editor who happens to belong to both spaces.
 *
 * Mirrors role-access.spec.ts conventions: "as <persona>, do <op>, expect
 * <observable>", server-side surface only.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectCode, expectOk } from '../harness/as';

let p: Personas;

// 'Leadership' system event category seeded by migration 20260413120000.
const LEADERSHIP_CATEGORY_ID = 'e0000000-0000-0000-0000-000000000001';

let markerTypeId: string;

// Space A is the persona org space (contributor is an editor here).
let trialAId: string;
// Space B is a second space under the same tenant; contributor is NOT a member.
let spaceBId: string;
let trialBId: string;

beforeAll(async () => {
  p = await buildPersonas();
  const admin = adminClient();
  const userId = p.ids.tenant_owner;

  const { data: mt } = await admin
    .from('marker_types')
    .select('id')
    .is('space_id', null)
    .limit(1)
    .single();
  markerTypeId = mt!.id;

  // Space A entity graph (company -> asset -> trial A).
  const { data: companyA } = await admin
    .from('companies')
    .insert({ space_id: p.org.spaceId, name: 'Authz Co A', created_by: userId })
    .select('id')
    .single();
  const { data: assetA } = await admin
    .from('assets')
    .insert({ space_id: p.org.spaceId, company_id: companyA!.id, name: 'AuthzMab A', created_by: userId })
    .select('id')
    .single();
  const { data: trialA } = await admin
    .from('trials')
    .insert({
      space_id: p.org.spaceId,
      asset_id: assetA!.id,
      name: 'Authz Trial A',
      identifier: 'NCT-AUTHZ-A',
      created_by: userId,
    })
    .select('id')
    .single();
  trialAId = trialA!.id;

  // Space B under the SAME tenant. contributor has no space_members row here.
  const { data: spaceB } = await admin
    .from('spaces')
    .insert({ tenant_id: p.org.tenantId, name: 'Authz Space B', created_by: userId })
    .select('id')
    .single();
  spaceBId = spaceB!.id;
  const { data: companyB } = await admin
    .from('companies')
    .insert({ space_id: spaceBId, name: 'Authz Co B', created_by: userId })
    .select('id')
    .single();
  const { data: assetB } = await admin
    .from('assets')
    .insert({ space_id: spaceBId, company_id: companyB!.id, name: 'AuthzMab B', created_by: userId })
    .select('id')
    .single();
  const { data: trialB } = await admin
    .from('trials')
    .insert({
      space_id: spaceBId,
      asset_id: assetB!.id,
      name: 'Authz Trial B',
      identifier: 'NCT-AUTHZ-B',
      created_by: userId,
    })
    .select('id')
    .single();
  trialBId = trialB!.id;
}, 120_000);

// ============================================================================
// Viewer cannot write via the SECURITY DEFINER create_* RPCs.
// (role-access.spec only covers direct table inserts; these go through the RPCs
//  that bypass RLS, which is exactly where the escalation lived.)
// ============================================================================

describe('reader (space viewer): create_* RPCs denied', () => {
  it('rpc create_company: 42501', async () => {
    const r = await as(p, 'reader').rpc('create_company', {
      p_space_id: p.org.spaceId,
      p_name: 'viewer-should-not-create',
    });
    expectCode(r, '42501');
  });

  it('rpc create_marker: 42501', async () => {
    const r = await as(p, 'reader').rpc('create_marker', {
      p_space_id: p.org.spaceId,
      p_marker_type_id: markerTypeId,
      p_title: 'viewer-should-not-create',
      p_projection: 'actual',
      p_event_date: '2026-05-01',
    });
    expectCode(r, '42501');
  });

  it('rpc create_event: 42501', async () => {
    const r = await as(p, 'reader').rpc('create_event', {
      p_space_id: p.org.spaceId,
      p_category_id: LEADERSHIP_CATEGORY_ID,
      p_title: 'viewer-should-not-create',
      p_event_date: '2026-05-01',
    });
    expectCode(r, '42501');
  });
});

// ============================================================================
// Editor (contributor) write path: same-space allowed, cross-space rejected.
// ============================================================================

describe('contributor (space editor): marker/trial space isolation', () => {
  it('rpc create_marker pinned to a same-space trial: ok', async () => {
    const r = await as(p, 'contributor').rpc('create_marker', {
      p_space_id: p.org.spaceId,
      p_marker_type_id: markerTypeId,
      p_title: 'editor same-space marker',
      p_projection: 'actual',
      p_event_date: '2026-05-01',
      p_trial_ids: [trialAId],
    });
    const id = expectOk(r);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rpc create_marker pinned to a cross-space trial: 42501', async () => {
    const r = await as(p, 'contributor').rpc('create_marker', {
      p_space_id: p.org.spaceId,
      p_marker_type_id: markerTypeId,
      p_title: 'editor cross-space marker',
      p_projection: 'actual',
      p_event_date: '2026-05-01',
      p_trial_ids: [trialBId],
    });
    expectCode(r, '42501');
  });

  it('rpc update_marker_assignments to a cross-space trial: 42501, original assignment intact', async () => {
    // Create a legit same-space marker first.
    const created = await as(p, 'contributor').rpc('create_marker', {
      p_space_id: p.org.spaceId,
      p_marker_type_id: markerTypeId,
      p_title: 'editor swap-target marker',
      p_projection: 'actual',
      p_event_date: '2026-05-01',
      p_trial_ids: [trialAId],
    });
    const markerId = expectOk(created) as string;

    // Attempt to swap its assignment to a trial in space B.
    const r = await as(p, 'contributor').rpc('update_marker_assignments', {
      p_marker_id: markerId,
      p_trial_ids: [trialBId],
    });
    expectCode(r, '42501');

    // The original same-space assignment must be untouched.
    const admin = adminClient();
    const { data: rows } = await admin
      .from('marker_assignments')
      .select('trial_id')
      .eq('marker_id', markerId);
    const trialIds = (rows ?? []).map((row) => row.trial_id as string);
    expect(trialIds).toEqual([trialAId]);
  });

  it('rpc update_marker_assignments to a same-space trial: ok (happy path intact)', async () => {
    const created = await as(p, 'contributor').rpc('create_marker', {
      p_space_id: p.org.spaceId,
      p_marker_type_id: markerTypeId,
      p_title: 'editor same-space swap marker',
      p_projection: 'actual',
      p_event_date: '2026-05-01',
      p_trial_ids: [trialAId],
    });
    const markerId = expectOk(created) as string;

    const r = await as(p, 'contributor').rpc('update_marker_assignments', {
      p_marker_id: markerId,
      p_trial_ids: [trialAId],
    });
    expectOk(r);
  });
});
