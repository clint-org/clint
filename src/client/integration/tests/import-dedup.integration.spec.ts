/**
 * End-to-end re-import idempotency test.
 *
 * Exercises the full SNAPSHOT -> MATCH -> COMMIT chain:
 *
 *   1. First commit_source_import: creates a trial + 3 markers + 2 events.
 *   2. get_space_inventory_snapshot: reads back the marker/event ids from
 *      the live snapshot (not from the commit result directly -- this mimics
 *      the AI extraction validator flow).
 *   3. Second commit_source_import: 3 markers and 1 event carry
 *      match:{kind:'existing', id} resolved from the snapshot; 1 new marker
 *      and 1 new event serve as regression guards.
 *   4. Assertions: skipped contains the 3 matched marker ids and the 1 matched
 *      event id; created contains only the new ones; the DB row count for the
 *      trial's markers increased by exactly 1.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectOk } from '../harness/as';

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const WORKER_SECRET = 'local-dev-extract-source-secret';

let p: Personas;
let anon: SupabaseClient;
let admin: ReturnType<typeof adminClient>;

// Source doc ids created during this spec, used for cleanup.
const createdSourceDocIds: string[] = [];
const createdAiCallIds: string[] = [];

beforeAll(async () => {
  p = await buildPersonas();
  anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  admin = adminClient();
}, 120_000);

afterAll(async () => {
  for (const docId of createdSourceDocIds) {
    await admin.from('marker_assignments').delete().eq('marker_id', docId); // no-op: marker_id is uuid, not doc
    await admin.from('markers').delete().eq('source_doc_id', docId);
    await admin.from('events').delete().eq('source_doc_id', docId);
    await admin.from('trials').delete().eq('source_doc_id', docId);
    await admin.from('assets').delete().eq('source_doc_id', docId);
    await admin.from('companies').delete().eq('source_doc_id', docId);
    await admin.from('source_documents').delete().eq('id', docId);
  }
  for (const id of createdAiCallIds) {
    await admin.from('ai_calls').delete().eq('id', id);
  }
  await admin.from('ai_config').delete().eq('tenant_id', p.org.tenantId);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function openAndCloseCall(): Promise<string> {
  const { data: callId } = await anon.rpc('ai_call_open', {
    p_secret: WORKER_SECRET,
    p_tenant_id: p.org.tenantId,
    p_space_id: p.org.spaceId,
    p_user_id: p.ids.contributor,
    p_model: 'claude-sonnet-4-6',
    p_feature: 'source_extract',
  });
  createdAiCallIds.push(callId as string);
  await anon.rpc('ai_call_close', {
    p_secret: WORKER_SECRET,
    p_ai_call_id: callId,
    p_outcome: 'success',
    p_prompt_tokens: 100,
    p_completion_tokens: 50,
  });
  return callId as string;
}

async function freshSnapHash(): Promise<string> {
  const r = await as(p, 'contributor').rpc('get_space_inventory_snapshot', {
    p_space_id: p.org.spaceId,
  });
  return (expectOk(r) as Record<string, unknown>).hash as string;
}

// ---------------------------------------------------------------------------
// Core idempotency spec
// ---------------------------------------------------------------------------

describe('re-import is idempotent for markers and events', () => {
  it(
    'skips matched markers/events and only creates the genuinely new ones',
    async () => {
      // ------------------------------------------------------------------
      // Step 1: first commit -- creates trial + 3 markers + 2 events.
      // ------------------------------------------------------------------
      await admin.from('ai_config').upsert({
        tenant_id: p.org.tenantId,
        ai_enabled: true,
        daily_token_cap: 10_000_000,
        per_user_rate_per_min: 600,
        per_user_rate_per_hour: 6000,
      });

      const aiCall1 = await openAndCloseCall();
      const snapHash1 = await freshSnapHash();

      const companyName = `Dedup Pharma ${suffix()}`;
      const assetName = `Dedup Drug ${suffix()}`;
      const trialName = `DEDUP-${suffix()}`;

      const firstProposal = {
        companies: [{ match: { kind: 'new', name: companyName } }],
        assets: [
          {
            match: { kind: 'new', name: assetName },
            generic_name: 'dedupdrug',
            company_ref: 0,
            moas: [],
            roas: [],
          },
        ],
        // trials inserted via commit_source_import which calls create_trial
        // internally -- ordering relative to asset_indications is handled by
        // the RPC, no manual sequencing needed here.
        trials: [
          {
            match: { kind: 'new', name: trialName },
            asset_ref: 0,
            phase: 'P2',
            status: 'Active',
          },
        ],
        markers: [
          {
            marker_type: 'Topline Data',
            title: `Readout A ${suffix()}`,
            event_date: '2026-07-01',
            projection: 'company',
            trial_refs: [0],
          },
          {
            marker_type: 'Topline Data',
            title: `Readout B ${suffix()}`,
            event_date: '2026-08-01',
            projection: 'company',
            trial_refs: [0],
          },
          {
            marker_type: 'Topline Data',
            title: `Readout C ${suffix()}`,
            event_date: '2026-09-01',
            projection: 'company',
            trial_refs: [0],
          },
        ],
        events: [
          {
            category: 'Regulatory',
            title: `Filing X ${suffix()}`,
            event_date: '2026-10-01',
            priority: 'high',
            tags: [],
            anchor: { level: 'company', ref: 0 },
          },
          {
            category: 'Regulatory',
            title: `Filing Y ${suffix()}`,
            event_date: '2026-11-01',
            priority: 'low',
            tags: [],
            anchor: { level: 'company', ref: 0 },
          },
        ],
      };

      const r1 = await as(p, 'contributor').rpc('commit_source_import', {
        p_space_id: p.org.spaceId,
        p_ai_call_id: aiCall1,
        p_source_document: {
          source_kind: 'text',
          source_text: `First dedup test ${suffix()}`,
          text_hash: `dedup-hash-1-${suffix()}`,
          source_title: 'Dedup Test Doc 1',
          fetch_outcome: 'paste',
        },
        p_proposal: firstProposal,
        p_inventory_snapshot_hash: snapHash1,
      });

      const result1 = expectOk(r1) as Record<string, unknown>;
      expect(result1.source_doc_id).toBeTruthy();
      createdSourceDocIds.push(result1.source_doc_id as string);

      const created1 = result1.created as Record<string, string[]>;
      expect(created1.markers).toHaveLength(3);
      expect(created1.events).toHaveLength(2);

      // Capture the IDs from the commit result for later comparison.
      const firstCommitMarkerIds = created1.markers as string[];
      const firstCommitEventIds = created1.events as string[];

      // ------------------------------------------------------------------
      // Step 2: call get_space_inventory_snapshot and read the marker/event
      // instances it now returns. Use THESE ids for the second proposal --
      // this is the key difference: we resolve ids from the snapshot exactly
      // as the AI extraction validator would, not from the commit result.
      // ------------------------------------------------------------------
      const snapR2 = await as(p, 'contributor').rpc('get_space_inventory_snapshot', {
        p_space_id: p.org.spaceId,
      });
      const snap2 = expectOk(snapR2) as Record<string, unknown>;
      const snapHash2 = snap2.hash as string;

      const snapMarkers = snap2['markers'] as Array<Record<string, unknown>>;
      const snapEvents = snap2['events'] as Array<Record<string, unknown>>;

      expect(Array.isArray(snapMarkers)).toBe(true);
      expect(Array.isArray(snapEvents)).toBe(true);

      // Every marker from the first commit must appear in the snapshot.
      const snappedMarkerIds = firstCommitMarkerIds.map((id) => {
        const found = snapMarkers.find((m) => m['id'] === id);
        expect(found, `marker ${id} must appear in snapshot`).toBeTruthy();
        return found!['id'] as string;
      });
      expect(snappedMarkerIds).toHaveLength(3);

      // At least 1 event from the first commit must appear in the snapshot.
      const firstEventInSnapshot = snapEvents.find((e) => e['id'] === firstCommitEventIds[0]);
      expect(firstEventInSnapshot, 'first event must appear in snapshot').toBeTruthy();
      const matchedEventId = firstEventInSnapshot!['id'] as string;

      // ------------------------------------------------------------------
      // Step 3: second commit -- 3 matched markers, 1 matched event, plus 1
      // genuinely new marker and 1 genuinely new event as regression guards.
      // ------------------------------------------------------------------
      const newMarkerTitle = `New Marker Regression Guard ${suffix()}`;
      const newEventTitle = `New Event Regression Guard ${suffix()}`;

      const aiCall2 = await openAndCloseCall();

      const secondProposal = {
        companies: [{ match: { kind: 'new', name: `Dedup Pharma 2 ${suffix()}` } }],
        assets: [
          {
            match: { kind: 'new', name: `Dedup Drug 2 ${suffix()}` },
            generic_name: 'dedupdrug2',
            company_ref: 0,
            moas: [],
            roas: [],
          },
        ],
        trials: [
          {
            match: { kind: 'new', name: `DEDUP2-${suffix()}` },
            asset_ref: 0,
            phase: 'P2',
            status: 'Active',
          },
        ],
        markers: [
          // Three matched markers resolved from the snapshot: must be skipped.
          {
            marker_type: 'Topline Data',
            title: 'Existing readout A (skip)',
            event_date: '2026-07-01',
            projection: 'company',
            match: { kind: 'existing', id: snappedMarkerIds[0] },
          },
          {
            marker_type: 'Topline Data',
            title: 'Existing readout B (skip)',
            event_date: '2026-08-01',
            projection: 'company',
            match: { kind: 'existing', id: snappedMarkerIds[1] },
          },
          {
            marker_type: 'Topline Data',
            title: 'Existing readout C (skip)',
            event_date: '2026-09-01',
            projection: 'company',
            match: { kind: 'existing', id: snappedMarkerIds[2] },
          },
          // One genuinely new marker: must be created.
          {
            marker_type: 'Topline Data',
            title: newMarkerTitle,
            event_date: '2026-12-01',
            projection: 'company',
            trial_refs: [0],
          },
        ],
        events: [
          // One matched event resolved from the snapshot: must be skipped.
          {
            category: 'Regulatory',
            title: 'Existing filing X (skip)',
            event_date: '2026-10-01',
            priority: 'high',
            tags: [],
            anchor: { level: 'company', ref: 0 },
            match: { kind: 'existing', id: matchedEventId },
          },
          // One genuinely new event: must be created.
          {
            category: 'Regulatory',
            title: newEventTitle,
            event_date: '2027-01-01',
            priority: 'low',
            tags: [],
            anchor: { level: 'company', ref: 0 },
          },
        ],
      };

      const r2 = await as(p, 'contributor').rpc('commit_source_import', {
        p_space_id: p.org.spaceId,
        p_ai_call_id: aiCall2,
        p_source_document: {
          source_kind: 'text',
          source_text: `Second dedup test ${suffix()}`,
          text_hash: `dedup-hash-2-${suffix()}`,
          source_title: 'Dedup Test Doc 2',
          fetch_outcome: 'paste',
        },
        p_proposal: secondProposal,
        p_inventory_snapshot_hash: snapHash2,
      });

      const result2 = expectOk(r2) as Record<string, unknown>;
      expect(result2.source_doc_id).toBeTruthy();
      createdSourceDocIds.push(result2.source_doc_id as string);

      // ------------------------------------------------------------------
      // Step 4: assertions.
      // ------------------------------------------------------------------

      // skipped.markers must contain all 3 matched ids.
      const skipped = result2['skipped'] as Record<string, string[]>;
      expect(skipped, 'result must include a skipped field').toBeTruthy();
      expect(skipped.markers, 'skipped.markers must be present').toBeTruthy();
      expect(skipped.markers).toHaveLength(3);
      for (const id of snappedMarkerIds) {
        expect(skipped.markers, `skipped.markers must contain ${id}`).toContain(id);
      }

      // created.markers must contain exactly the 1 new marker.
      const created2 = result2.created as Record<string, string[]>;
      expect(created2.markers).toHaveLength(1);
      expect(created2.markers).not.toContain(snappedMarkerIds[0]);
      expect(created2.markers).not.toContain(snappedMarkerIds[1]);
      expect(created2.markers).not.toContain(snappedMarkerIds[2]);

      // skipped.events must contain the 1 matched event.
      expect(skipped.events, 'skipped.events must be present').toBeTruthy();
      expect(skipped.events).toContain(matchedEventId);

      // created.events must contain exactly the 1 new event.
      expect(created2.events).toHaveLength(1);
      expect(created2.events).not.toContain(matchedEventId);

      // DB-level: the matched marker ids each still have exactly 1 row (no
      // duplicate was inserted).
      for (const id of snappedMarkerIds) {
        const { count } = await admin
          .from('markers')
          .select('*', { count: 'exact', head: true })
          .eq('id', id);
        expect(count, `marker ${id} must have exactly 1 DB row`).toBe(1);
      }

      // DB-level: the new marker was created with the correct title.
      const { data: newMarkerRow } = await admin
        .from('markers')
        .select('title')
        .eq('id', created2.markers[0])
        .single();
      expect(newMarkerRow!.title).toBe(newMarkerTitle);

      // DB-level: the matched event still has exactly 1 row.
      const { count: eventCount } = await admin
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('id', matchedEventId);
      expect(eventCount, 'matched event must have exactly 1 DB row').toBe(1);

      // DB-level: the new event was created with the correct title.
      const { data: newEventRow } = await admin
        .from('events')
        .select('title')
        .eq('id', created2.events[0])
        .single();
      expect(newEventRow!.title).toBe(newEventTitle);
    },
    120_000,
  );
});
