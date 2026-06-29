/**
 * Integration proof: unified commit_source_import + event dedup no-regression.
 *
 * Verifies two behaviours introduced by migration 20260629050100:
 *
 *   1. A proposal carrying a single `events` item with `event_type: 'Topline Data'`,
 *      a trial anchor, and `significance: 'high'` lands in public.events with the
 *      correct event_type_id (system UUID), anchor_type='trial', and
 *      significance='high'.
 *
 *   2. Re-committing the same event with `match.kind='existing'` (id resolved from
 *      get_space_inventory_snapshot) is skipped -- it lands in skipped.events and
 *      creates no new DB row. This guards the dedup behaviour from PRs #132/#135.
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

// System UUID for the 'Topline Data' event type (seeded in 20260628071012_event_types.sql).
const TOPLINE_DATA_EVENT_TYPE_ID = 'a0000000-0000-0000-0000-000000000013';

let p: Personas;
let anon: SupabaseClient;
let admin: ReturnType<typeof adminClient>;

const createdSourceDocIds: string[] = [];
const createdAiCallIds: string[] = [];

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

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
// Spec
// ---------------------------------------------------------------------------

describe('unified commit_source_import: trial-anchored event + dedup', () => {
  it(
    'creates a trial-anchored Topline Data event then skips it on re-commit',
    async () => {
      // Enable AI for this tenant so commit_source_import does not gate-fail.
      await admin.from('ai_config').upsert({
        tenant_id: p.org.tenantId,
        ai_enabled: true,
        daily_token_cap: 10_000_000,
        per_user_rate_per_min: 600,
        per_user_rate_per_hour: 6000,
      });

      const aiCall1 = await openAndCloseCall();
      const snapHash1 = await freshSnapHash();

      const companyName = `Unified Pharma ${suffix()}`;
      const assetName = `Unified Drug ${suffix()}`;
      const trialName = `UNIFIED-${suffix()}`;
      const eventTitle = `Topline Readout ${suffix()}`;

      // ------------------------------------------------------------------
      // Step 1: first commit -- one company + asset + trial + one unified event.
      // The events block uses event_type (not category) and significance (not
      // priority). Anchor level 'trial' resolves to ref index 0.
      // ------------------------------------------------------------------
      const r1 = await as(p, 'contributor').rpc('commit_source_import', {
        p_space_id: p.org.spaceId,
        p_ai_call_id: aiCall1,
        p_source_document: {
          source_kind: 'text',
          source_text: `Unified import test 1 ${suffix()}`,
          text_hash: `unified-hash-1-${suffix()}`,
          source_title: 'Unified Test Doc 1',
          fetch_outcome: 'paste',
        },
        p_proposal: {
          companies: [{ match: { kind: 'new', name: companyName } }],
          assets: [
            {
              match: { kind: 'new', name: assetName },
              generic_name: 'unifieddrug',
              company_ref: 0,
              moas: [],
              roas: [],
            },
          ],
          // trials must be inserted before asset_indications to avoid
          // trg_auto_derive nulling development_status (not relevant here since
          // no indications are used, but the ordering rule stands).
          trials: [
            {
              match: { kind: 'new', name: trialName },
              asset_ref: 0,
              phase: 'P3',
              status: 'Active',
            },
          ],
          events: [
            {
              event_type: 'Topline Data',
              title: eventTitle,
              event_date: '2026-07-15',
              significance: 'high',
              anchor: { level: 'trial', ref: 0 },
            },
          ],
        },
        p_inventory_snapshot_hash: snapHash1,
      });

      const result1 = expectOk(r1) as Record<string, unknown>;
      expect(result1.source_doc_id).toBeTruthy();
      createdSourceDocIds.push(result1.source_doc_id as string);

      const created1 = result1.created as Record<string, string[]>;

      // 1a: exactly one event created in the return envelope.
      expect(created1.events).toHaveLength(1);

      const createdEventId = created1.events[0];
      expect(createdEventId).toBeTruthy();

      // 1b: DB row carries the correct event_type_id, anchor_type, and significance.
      const { data: evRow } = await admin
        .from('events')
        .select('event_type_id, anchor_type, significance')
        .eq('id', createdEventId)
        .single();

      expect(evRow, 'event row must exist in DB').toBeTruthy();
      expect(evRow!.event_type_id).toBe(TOPLINE_DATA_EVENT_TYPE_ID);
      expect(evRow!.anchor_type).toBe('trial');
      expect(evRow!.significance).toBe('high');

      // ------------------------------------------------------------------
      // Step 2: read get_space_inventory_snapshot and resolve the event id
      // from the unified events array. This mirrors the AI extraction validator
      // flow -- ids come from the snapshot, not directly from the commit result.
      // ------------------------------------------------------------------
      const snapR2 = await as(p, 'contributor').rpc('get_space_inventory_snapshot', {
        p_space_id: p.org.spaceId,
      });
      const snap2 = expectOk(snapR2) as Record<string, unknown>;
      const snapHash2 = snap2.hash as string;

      const snapEvents = snap2['events'] as Array<Record<string, unknown>>;
      expect(Array.isArray(snapEvents)).toBe(true);

      const snappedEvent = snapEvents.find((e) => e['id'] === createdEventId);
      expect(snappedEvent, `event ${createdEventId} must appear in the snapshot`).toBeTruthy();
      const existingEventId = snappedEvent!['id'] as string;

      // ------------------------------------------------------------------
      // Step 3: re-commit the same event with match.kind='existing'.
      // The RPC must skip it (dedup) and emit it in skipped.events.
      // ------------------------------------------------------------------
      const aiCall2 = await openAndCloseCall();

      const r2 = await as(p, 'contributor').rpc('commit_source_import', {
        p_space_id: p.org.spaceId,
        p_ai_call_id: aiCall2,
        p_source_document: {
          source_kind: 'text',
          source_text: `Unified import test 2 ${suffix()}`,
          text_hash: `unified-hash-2-${suffix()}`,
          source_title: 'Unified Test Doc 2',
          fetch_outcome: 'paste',
        },
        p_proposal: {
          companies: [{ match: { kind: 'new', name: `Unified Pharma 2 ${suffix()}` } }],
          assets: [
            {
              match: { kind: 'new', name: `Unified Drug 2 ${suffix()}` },
              generic_name: 'unifieddrug2',
              company_ref: 0,
              moas: [],
              roas: [],
            },
          ],
          trials: [
            {
              match: { kind: 'new', name: `UNIFIED2-${suffix()}` },
              asset_ref: 0,
              phase: 'P2',
              status: 'Active',
            },
          ],
          events: [
            {
              event_type: 'Topline Data',
              title: eventTitle,
              event_date: '2026-07-15',
              significance: 'high',
              anchor: { level: 'trial', ref: 0 },
              match: { kind: 'existing', id: existingEventId },
            },
          ],
        },
        p_inventory_snapshot_hash: snapHash2,
      });

      const result2 = expectOk(r2) as Record<string, unknown>;
      expect(result2.source_doc_id).toBeTruthy();
      createdSourceDocIds.push(result2.source_doc_id as string);

      // ------------------------------------------------------------------
      // Step 4: dedup assertions.
      // ------------------------------------------------------------------
      const skipped2 = result2['skipped'] as Record<string, string[]>;
      const created2 = result2['created'] as Record<string, string[]>;

      // skipped.events must contain the matched event id.
      expect(skipped2.events, 'skipped.events must be present').toBeTruthy();
      expect(skipped2.events).toContain(existingEventId);

      // No new events created.
      expect(created2.events).toHaveLength(0);

      // DB-level: exactly one row for the original event (no duplicate).
      const { count } = await admin
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('id', existingEventId);
      expect(count, 'matched event must have exactly 1 DB row after re-commit').toBe(1);
    },
    120_000,
  );
});
