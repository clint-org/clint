/**
 * End-to-end re-import idempotency test.
 *
 * Exercises the full SNAPSHOT -> MATCH -> COMMIT chain with the unified
 * events contract (migration 20260629050100):
 *
 *   1. First commit_source_import: creates a trial + 5 unified events
 *      (3 trial-anchored Topline Data + 2 company-anchored Regulatory Filing).
 *      All land in public.events; the commit returns created.events with 5 ids.
 *   2. get_space_inventory_snapshot: reads back the event ids from the
 *      live snapshot's unified `events` array (not from the commit result
 *      directly -- this mimics the AI extraction validator flow).
 *   3. Second commit_source_import: 3 trial-anchored events and 1
 *      company-anchored event carry match:{kind:'existing', id} resolved from
 *      the snapshot; 1 new trial-anchored and 1 new company-anchored event
 *      serve as regression guards.
 *   4. Assertions: skipped.events contains all 4 matched ids; created.events
 *      contains only the 2 new ones; the matched event rows are not duplicated
 *      (still exactly 1 row each in public.events).
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

describe('re-import is idempotent for events', () => {
  it(
    'skips matched events and only creates the genuinely new ones',
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
        events: [
          // Three trial-anchored Topline Data events (was markers block).
          {
            event_type: 'Topline Data',
            title: `Readout A ${suffix()}`,
            event_date: '2026-07-01',
            significance: 'high',
            anchor: { level: 'trial', ref: 0 },
          },
          {
            event_type: 'Topline Data',
            title: `Readout B ${suffix()}`,
            event_date: '2026-08-01',
            significance: 'high',
            anchor: { level: 'trial', ref: 0 },
          },
          {
            event_type: 'Topline Data',
            title: `Readout C ${suffix()}`,
            event_date: '2026-09-01',
            significance: 'high',
            anchor: { level: 'trial', ref: 0 },
          },
          // Two company-anchored Regulatory Filing events (was events block).
          {
            event_type: 'Regulatory Filing',
            title: `Filing X ${suffix()}`,
            event_date: '2026-10-01',
            significance: 'high',
            anchor: { level: 'company', ref: 0 },
          },
          {
            event_type: 'Regulatory Filing',
            title: `Filing Y ${suffix()}`,
            event_date: '2026-11-01',
            significance: 'low',
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
      // 5 unified events: 3 trial-anchored (Topline Data) + 2 company-anchored (Regulatory Filing).
      expect(created1.events).toHaveLength(5);

      // Capture ids by position: first 3 are trial-anchored, next 2 are company-anchored.
      const trialAnchoredIds = created1.events.slice(0, 3) as string[];
      const firstCompanyEventId = created1.events[3] as string;

      // ------------------------------------------------------------------
      // Step 2: call get_space_inventory_snapshot and resolve event ids from
      // the unified `events` array. Use these ids for the second proposal --
      // this mirrors the AI extraction validator flow: ids come from the
      // snapshot, not from the commit result directly.
      // ------------------------------------------------------------------
      const snapR2 = await as(p, 'contributor').rpc('get_space_inventory_snapshot', {
        p_space_id: p.org.spaceId,
      });
      const snap2 = expectOk(snapR2) as Record<string, unknown>;
      const snapHash2 = snap2.hash as string;

      const snapEvents = snap2['events'] as Array<Record<string, unknown>>;
      expect(Array.isArray(snapEvents)).toBe(true);

      // Every trial-anchored event from the first commit must appear in the snapshot.
      const snappedMarkerIds = trialAnchoredIds.map((id) => {
        const found = snapEvents.find((m) => m['id'] === id);
        expect(found, `trial-anchored event ${id} must appear in snapshot`).toBeTruthy();
        return found!['id'] as string;
      });
      expect(snappedMarkerIds).toHaveLength(3);

      // The first company-anchored event from the first commit must appear too.
      const firstEventInSnapshot = snapEvents.find((e) => e['id'] === firstCompanyEventId);
      expect(firstEventInSnapshot, 'first company-anchored event must appear in snapshot').toBeTruthy();
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
        events: [
          // Three matched trial-anchored events resolved from snapshot: must be skipped.
          {
            event_type: 'Topline Data',
            title: 'Existing readout A (skip)',
            event_date: '2026-07-01',
            significance: 'high',
            anchor: { level: 'trial', ref: 0 },
            match: { kind: 'existing', id: snappedMarkerIds[0] },
          },
          {
            event_type: 'Topline Data',
            title: 'Existing readout B (skip)',
            event_date: '2026-08-01',
            significance: 'high',
            anchor: { level: 'trial', ref: 0 },
            match: { kind: 'existing', id: snappedMarkerIds[1] },
          },
          {
            event_type: 'Topline Data',
            title: 'Existing readout C (skip)',
            event_date: '2026-09-01',
            significance: 'high',
            anchor: { level: 'trial', ref: 0 },
            match: { kind: 'existing', id: snappedMarkerIds[2] },
          },
          // One genuinely new trial-anchored event: must be created.
          {
            event_type: 'Topline Data',
            title: newMarkerTitle,
            event_date: '2026-12-01',
            significance: 'high',
            anchor: { level: 'trial', ref: 0 },
          },
          // One matched company-anchored event resolved from snapshot: must be skipped.
          {
            event_type: 'Regulatory Filing',
            title: 'Existing filing X (skip)',
            event_date: '2026-10-01',
            significance: 'high',
            anchor: { level: 'company', ref: 0 },
            match: { kind: 'existing', id: matchedEventId },
          },
          // One genuinely new company-anchored event: must be created.
          {
            event_type: 'Regulatory Filing',
            title: newEventTitle,
            event_date: '2027-01-01',
            significance: 'low',
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

      // skipped.events must contain all 4 matched ids (3 trial-anchored + 1 company-anchored).
      const skipped = result2['skipped'] as Record<string, string[]>;
      expect(skipped, 'result must include a skipped field').toBeTruthy();
      expect(skipped.events, 'skipped.events must be present').toBeTruthy();
      expect(skipped.events).toHaveLength(4);
      for (const id of snappedMarkerIds) {
        expect(skipped.events, `skipped.events must contain ${id}`).toContain(id);
      }
      expect(skipped.events).toContain(matchedEventId);

      // created.events must contain exactly the 2 new events (1 trial-anchored + 1 company-anchored).
      const created2 = result2.created as Record<string, string[]>;
      expect(created2.events).toHaveLength(2);
      expect(created2.events).not.toContain(snappedMarkerIds[0]);
      expect(created2.events).not.toContain(snappedMarkerIds[1]);
      expect(created2.events).not.toContain(snappedMarkerIds[2]);
      expect(created2.events).not.toContain(matchedEventId);

      // DB-level: the matched trial-anchored events each still have exactly 1 row.
      for (const id of snappedMarkerIds) {
        const { count } = await admin
          .from('events')
          .select('*', { count: 'exact', head: true })
          .eq('id', id);
        expect(count, `trial-anchored event ${id} must have exactly 1 DB row`).toBe(1);
      }

      // DB-level: the new trial-anchored event was created with the correct
      // title and is trial-anchored (anchor.level='trial', ref=0).
      const { data: newMarkerRow } = await admin
        .from('events')
        .select('title, anchor_type')
        .eq('id', created2.events[0])
        .single();
      expect(newMarkerRow!.title).toBe(newMarkerTitle);
      expect(newMarkerRow!.anchor_type).toBe('trial');

      // DB-level: the matched company-anchored event still has exactly 1 row.
      const { count: eventCount } = await admin
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('id', matchedEventId);
      expect(eventCount, 'matched event must have exactly 1 DB row').toBe(1);

      // DB-level: the new company-anchored event was created with the correct
      // title and is company-anchored (anchor.level='company', ref=0).
      const { data: newEventRow } = await admin
        .from('events')
        .select('title, anchor_type')
        .eq('id', created2.events[1])
        .single();
      expect(newEventRow!.title).toBe(newEventTitle);
      expect(newEventRow!.anchor_type).toBe('company');
    },
    120_000,
  );
});
