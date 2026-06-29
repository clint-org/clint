/**
 * Marker edit flow against real Supabase.
 *
 * Locks in the contract that backstops the bug we hit in dev: editing a marker
 * with a single assignment used to lose the marker because the Angular client
 * issued DELETE-then-INSERT against marker_assignments in two separate
 * PostgREST transactions, and the AFTER DELETE _cleanup_orphan_marker trigger
 * (migration 20260521120300) drops the parent marker the moment its last
 * assignment row is removed. The next INSERT then fails RLS WITH CHECK
 * because the EXISTS subquery on public.markers comes up empty -- the user
 * sees "violates row-level security policy for table marker_assignments" --
 * and any subsequent edit attempt returns 0 rows from UPDATE markers, which
 * PostgREST's .single() surfaces as "Cannot coerce the result to a single
 * JSON object".
 *
 * The fix is migration 20260528100000_update_marker_assignments_rpc.sql:
 * a SECURITY DEFINER RPC that inserts new assignments first and then prunes
 * the stale ones in a single transaction, so the marker keeps at least one
 * live assignment at all times and the orphan trigger never fires the
 * parent-marker delete during an edit.
 *
 * Spec covers:
 *   - happy path: single-assignment swap survives via the RPC.
 *   - regression contract: the OLD direct DELETE-then-INSERT pattern still
 *     deletes the marker. If that fails, someone changed the trigger and
 *     this RPC may no longer be necessary. Read 20260521120300 before
 *     deciding.
 *   - add/remove diff.
 *   - empty array rejected with 22023.
 *   - viewer role rejected with 42501.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectCode, expectOk } from '../harness/as';

let p: Personas;
let admin: SupabaseClient;
let systemMarkerTypeId: string;
let companyId: string;
let assetId: string;

// Track per-test rows for explicit cleanup (the marker-changes audit FK
// makes a blanket "delete from markers where space_id = X" the cleanest
// teardown; we keep ids around so we can be precise.)
const trialIds: string[] = [];
const markerIds: string[] = [];

beforeAll(async () => {
  p = await buildPersonas();
  admin = adminClient();

  // Resolve a system marker_type once. The seed has plenty; any one works.
  const { data: mt } = await admin
    .from('marker_types')
    .select('id')
    .eq('is_system', true)
    .limit(1)
    .single();
  systemMarkerTypeId = mt!.id as string;

  // Shared company + asset under the personas space. Trials are per-test.
  const { data: co } = await admin
    .from('companies')
    .insert({
      space_id: p.org.spaceId,
      name: 'Marker Edit Co',
      created_by: p.ids.contributor,
    })
    .select('id')
    .single();
  companyId = co!.id as string;

  const { data: asset } = await admin
    .from('assets')
    .insert({
      space_id: p.org.spaceId,
      company_id: companyId,
      name: 'Marker Edit Asset',
      created_by: p.ids.contributor,
    })
    .select('id')
    .single();
  assetId = asset!.id as string;
}, 120_000);

afterAll(async () => {
  // markers before space-scoped cleanup so the marker_changes audit FK to
  // spaces is satisfied (the BEFORE DELETE trigger writes audit rows while
  // the space row is still present). Same ordering rule as
  // permanently_delete_space().
  if (markerIds.length > 0) {
    await admin.from('markers').delete().in('id', markerIds);
  }
  if (trialIds.length > 0) {
    await admin.from('trials').delete().in('id', trialIds);
  }
  if (assetId) await admin.from('assets').delete().eq('id', assetId);
  if (companyId) await admin.from('companies').delete().eq('id', companyId);
});

async function createTrial(suffix: string): Promise<string> {
  const { data, error } = await admin
    .from('trials')
    .insert({
      space_id: p.org.spaceId,
      asset_id: assetId,
      name: `Marker Edit Trial ${suffix}`,
      identifier: `NCT-MEF-${suffix}`,
      created_by: p.ids.contributor,
    })
    .select('id')
    .single();
  if (error) throw new Error(`createTrial: ${error.message}`);
  trialIds.push(data!.id as string);
  return data!.id as string;
}

async function createMarkerWithAssignments(
  title: string,
  assignedTrials: string[]
): Promise<string> {
  const { data: marker, error: markerErr } = await admin
    .from('markers')
    .insert({
      space_id: p.org.spaceId,
      marker_type_id: systemMarkerTypeId,
      title,
      event_date: '2026-06-01',
      projection: 'actual',
      created_by: p.ids.contributor,
    })
    .select('id')
    .single();
  if (markerErr) throw new Error(`createMarker: ${markerErr.message}`);
  const markerId = marker!.id as string;
  markerIds.push(markerId);

  if (assignedTrials.length > 0) {
    const { error: assignErr } = await admin
      .from('marker_assignments')
      .insert(assignedTrials.map((trial_id) => ({ marker_id: markerId, trial_id })));
    if (assignErr) throw new Error(`createMarker.assign: ${assignErr.message}`);
  }
  return markerId;
}

// RETIRED: marker_assignments and _cleanup_orphan_marker trigger are dropped in the
// event-model cutover (migration set C2). Events carry a single inline anchor
// (anchor_type/anchor_id -- no join table, no orphan-cleanup trigger), so the
// two-transaction orphan bug this spec was locking in is structurally impossible
// under the new model. Kept for history. Stage-5 may add an equivalent
// create_event/update_event anchor isolation spec.
describe.skip('update_marker_assignments RPC', () => {
  it('swaps the sole assignment without orphaning the marker', async () => {
    const trialA = await createTrial('swap-a');
    const trialB = await createTrial('swap-b');
    const markerId = await createMarkerWithAssignments('swap', [trialA]);

    const r = await as(p, 'contributor').rpc('update_marker_assignments', {
      p_marker_id: markerId,
      p_trial_ids: [trialB],
    });
    expectOk(r);

    // Marker still present.
    const { data: stillThere } = await admin
      .from('markers')
      .select('id')
      .eq('id', markerId)
      .maybeSingle();
    expect(stillThere?.id).toBe(markerId);

    // Assignments reflect the new set exactly.
    const { data: rows } = await admin
      .from('marker_assignments')
      .select('trial_id')
      .eq('marker_id', markerId);
    expect(rows?.map((r) => r.trial_id).sort()).toEqual([trialB].sort());
  });

  it('handles add/remove diffs', async () => {
    const trialA = await createTrial('diff-a');
    const trialB = await createTrial('diff-b');
    const trialC = await createTrial('diff-c');
    const markerId = await createMarkerWithAssignments('diff', [trialA, trialB]);

    const r = await as(p, 'contributor').rpc('update_marker_assignments', {
      p_marker_id: markerId,
      p_trial_ids: [trialB, trialC],
    });
    expectOk(r);

    const { data: rows } = await admin
      .from('marker_assignments')
      .select('trial_id')
      .eq('marker_id', markerId);
    expect(rows?.map((r) => r.trial_id).sort()).toEqual([trialB, trialC].sort());
  });

  it('is idempotent when called with the same assignments', async () => {
    const trialA = await createTrial('idemp-a');
    const markerId = await createMarkerWithAssignments('idemp', [trialA]);

    // Re-asserting the same set should be a no-op rather than a unique-key
    // collision (ON CONFLICT DO NOTHING in the RPC body).
    const r = await as(p, 'contributor').rpc('update_marker_assignments', {
      p_marker_id: markerId,
      p_trial_ids: [trialA],
    });
    expectOk(r);

    const { data: rows } = await admin
      .from('marker_assignments')
      .select('trial_id')
      .eq('marker_id', markerId);
    expect(rows?.map((r) => r.trial_id)).toEqual([trialA]);
  });

  it('rejects an empty trial set with 22023 and leaves the marker intact', async () => {
    const trialA = await createTrial('empty-a');
    const markerId = await createMarkerWithAssignments('empty', [trialA]);

    const r = await as(p, 'contributor').rpc('update_marker_assignments', {
      p_marker_id: markerId,
      p_trial_ids: [],
    });
    expectCode(r, '22023');

    const { data: marker } = await admin
      .from('markers')
      .select('id')
      .eq('id', markerId)
      .maybeSingle();
    expect(marker?.id).toBe(markerId);

    const { data: rows } = await admin
      .from('marker_assignments')
      .select('trial_id')
      .eq('marker_id', markerId);
    expect(rows?.map((r) => r.trial_id)).toEqual([trialA]);
  });

  it('rejects a viewer with 42501 and leaves the marker intact', async () => {
    const trialA = await createTrial('viewer-a');
    const trialB = await createTrial('viewer-b');
    const markerId = await createMarkerWithAssignments('viewer', [trialA]);

    const r = await as(p, 'reader').rpc('update_marker_assignments', {
      p_marker_id: markerId,
      p_trial_ids: [trialB],
    });
    expectCode(r, '42501');

    const { data: rows } = await admin
      .from('marker_assignments')
      .select('trial_id')
      .eq('marker_id', markerId);
    expect(rows?.map((r) => r.trial_id)).toEqual([trialA]);
  });
});

describe.skip('orphan-cleanup trigger (regression contract for the bug we fixed)', () => {
  // These tests fail loudly if a future change weakens _cleanup_orphan_marker.
  // If they fail, update_marker_assignments may no longer be necessary --
  // re-read migration 20260521120300 before removing it.
  it('direct DELETE on the sole assignment drops the parent marker', async () => {
    const trialA = await createTrial('legacy-a');
    const markerId = await createMarkerWithAssignments('legacy', [trialA]);

    const del = await as(p, 'contributor')
      .from('marker_assignments')
      .delete()
      .eq('marker_id', markerId);
    expectOk(del);

    const { data: marker } = await admin
      .from('markers')
      .select('id')
      .eq('id', markerId)
      .maybeSingle();
    expect(marker).toBeNull();
  });

  it('client-side DELETE-then-INSERT pattern fails RLS on re-insert', async () => {
    const trialA = await createTrial('legacy2-a');
    const trialB = await createTrial('legacy2-b');
    const markerId = await createMarkerWithAssignments('legacy2', [trialA]);
    const contributor = as(p, 'contributor');

    const del = await contributor.from('marker_assignments').delete().eq('marker_id', markerId);
    expectOk(del);

    // Marker is already gone via the orphan trigger; the INSERT's WITH CHECK
    // does EXISTS (SELECT 1 FROM markers m WHERE m.id = marker_id AND
    // has_space_access(...)) -- no row, so EXISTS is false, INSERT fails 42501.
    const ins = await contributor
      .from('marker_assignments')
      .insert([{ marker_id: markerId, trial_id: trialB }]);
    expectCode(ins, '42501');
  });
});
