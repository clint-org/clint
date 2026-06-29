/**
 * Content-create authorization: viewer-write escalation via SECURITY DEFINER RPCs.
 *
 * Repointed from the pre-cutover version (migration 20260605130000) that also
 * covered cross-space marker->trial assignment (Part 2). That coverage is
 * retired here because create_marker, update_marker_assignments, marker_assignments,
 * and marker_types are all dropped in the event-model cutover.
 *
 * What remains (Part 1) is a LIVE security contract:
 *   The shared entity-create RPCs (create_company, create_event) are SECURITY
 *   DEFINER and granted to `authenticated`, so they bypass table RLS. These
 *   tests verify that a space viewer (read-only role) is denied via the
 *   explicit has_space_access(..., ['owner','editor']) check inside the RPC.
 *
 * Decision: REPOINT not RETIRE. role-access.spec.ts only covers direct
 * PostgREST table inserts (events INSERT -> 42501 via RLS). It does NOT
 * call the SECURITY DEFINER create_* RPCs that bypass RLS. These two tests
 * are therefore non-redundant and must stay.
 *
 * Mirrors role-access.spec.ts conventions: "as <persona>, do <op>, expect
 * <observable>", server-side surface only.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectCode } from '../harness/as';

let p: Personas;
let systemEventTypeId: string;

beforeAll(async () => {
  p = await buildPersonas();
  const admin = adminClient();

  // Fetch a system event_type to satisfy create_event's event_type_id arg.
  // The 42501 fires before arg validation, but using a real id is safer.
  const { data: et } = await admin
    .from('event_types')
    .select('id')
    .is('space_id', null)
    .limit(1)
    .single();
  systemEventTypeId = et!.id;
}, 120_000);

// ============================================================================
// Viewer cannot write via the SECURITY DEFINER create_* RPCs.
// (role-access.spec only covers direct table inserts; these go through RPCs
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

  // create_marker is dropped (event-model cutover). create_event is the live equivalent.

  it('rpc create_event: 42501', async () => {
    const r = await as(p, 'reader').rpc('create_event', {
      p_space_id: p.org.spaceId,
      p_event_type_id: systemEventTypeId,
      p_title: 'viewer-should-not-create',
      p_event_date: '2026-05-01',
      p_anchor_type: 'space',
    });
    expectCode(r, '42501');
  });
});

// contributor (space editor): marker/trial space isolation describe block removed.
// create_marker, update_marker_assignments, and marker_assignments are dropped
// in the event-model cutover. The events equivalent (create_event anchor
// isolation) is covered by event-anchor-crud integration tests (Stage C).
