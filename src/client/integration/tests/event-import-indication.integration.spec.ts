/**
 * Integration proof: commit_source_import resolves an event's indication NAME
 * to an indication_id, passes it to create_event (p_indication_id), and the
 * APPROVED/LAUNCHED status lift flows through the events trigger.
 *
 * Verifies the behaviour introduced by migration
 * 20260630120200_commit_source_import_event_indication:
 *
 *   1. A proposal carrying a single `events` item with event_type 'Approval',
 *      an ASSET anchor, projection 'actual', and `indication: 'Import Lift
 *      Indication'` (a NAME matching a pre-seeded indication) lands in
 *      public.events with indication_id = that indication's id. The events
 *      trigger then ensures the (asset, indication) asset_indications row exists
 *      and _recompute_asset_indication_status lifts development_status to
 *      'APPROVED' (event_types.lifts_development_status drives this).
 *
 *   2. A second event whose indication name is a CASE VARIANT of the existing
 *      one resolves to the SAME existing indication id -- no duplicate
 *      indications row is minted (case-insensitive match in the events loop).
 *
 * Model: src/client/integration/tests/event-import-unified.integration.spec.ts
 * (same harness: buildPersonas, adminClient, `as`, ai_call open/close, proposal
 * -> commit_source_import). Company + asset + indication are seeded directly via
 * the admin client; the proposal references the existing asset.
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

// System UUID for the 'Approval' event type (lifts_development_status = APPROVED).
const APPROVAL_EVENT_TYPE_ID = 'a0000000-0000-0000-0000-000000000035';

// The indication seeded for the space. The second case drives a case variant.
const INDICATION_NAME = 'Import Lift Indication';
const INDICATION_NAME_VARIANT = 'import lift indication';

let p: Personas;
let anon: SupabaseClient;
let admin: ReturnType<typeof adminClient>;

let companyId: string;
let assetId: string;
let indicationId: string;

const createdSourceDocIds: string[] = [];
const createdAiCallIds: string[] = [];

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

beforeAll(async () => {
  p = await buildPersonas();
  anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  admin = adminClient();

  // Enable AI for this tenant so commit_source_import does not gate-fail.
  await admin.from('ai_config').upsert({
    tenant_id: p.org.tenantId,
    ai_enabled: true,
    daily_token_cap: 10_000_000,
    per_user_rate_per_min: 600,
    per_user_rate_per_hour: 6000,
  });

  // Seed a company + asset in the persona space, plus an indication by NAME.
  const { data: company, error: companyErr } = await admin
    .from('companies')
    .insert({
      space_id: p.org.spaceId,
      name: `Indication Pharma ${suffix()}`,
      created_by: p.ids.contributor,
    })
    .select()
    .single();
  if (companyErr) throw new Error(`companies insert: ${companyErr.message}`);
  companyId = company.id as string;

  const { data: asset, error: assetErr } = await admin
    .from('assets')
    .insert({
      space_id: p.org.spaceId,
      company_id: companyId,
      name: `Indication Drug ${suffix()}`,
      created_by: p.ids.contributor,
    })
    .select()
    .single();
  if (assetErr) throw new Error(`assets insert: ${assetErr.message}`);
  assetId = asset.id as string;

  const { data: indication, error: indErr } = await admin
    .from('indications')
    .insert({
      space_id: p.org.spaceId,
      name: INDICATION_NAME,
      created_by: p.ids.contributor,
    })
    .select()
    .single();
  if (indErr) throw new Error(`indications insert: ${indErr.message}`);
  indicationId = indication.id as string;
}, 120_000);

afterAll(async () => {
  // Events first (FK + audit trigger ordering), then the program rows, then the
  // entity graph, then the source docs / ai calls / ai config.
  for (const docId of createdSourceDocIds) {
    await admin.from('events').delete().eq('source_doc_id', docId);
  }
  await admin.from('events').delete().eq('anchor_id', assetId);
  await admin.from('asset_indications').delete().eq('asset_id', assetId);
  // Any indication minted into this space whose name belongs to the test family
  // (defensive -- the resolver should NOT mint a duplicate, but clean regardless).
  await admin
    .from('indications')
    .delete()
    .eq('space_id', p.org.spaceId)
    .ilike('name', INDICATION_NAME);
  await admin.from('assets').delete().eq('id', assetId);
  await admin.from('companies').delete().eq('id', companyId);
  for (const docId of createdSourceDocIds) {
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

/** Commit one asset-anchored event item against the seeded existing asset. */
async function commitEvent(indicationField: string): Promise<string> {
  const aiCall = await openAndCloseCall();
  const snapHash = await freshSnapHash();

  const r = await as(p, 'contributor').rpc('commit_source_import', {
    p_space_id: p.org.spaceId,
    p_ai_call_id: aiCall,
    p_source_document: {
      source_kind: 'text',
      source_text: `Indication import test ${suffix()}`,
      text_hash: `indication-hash-${suffix()}`,
      source_title: 'Indication Test Doc',
      fetch_outcome: 'paste',
    },
    p_proposal: {
      // Existing asset at ref 0 so the event anchor resolves to it.
      assets: [{ match: { kind: 'existing', id: assetId } }],
      events: [
        {
          event_type: 'Approval',
          title: `Approval ${suffix()}`,
          event_date: '2025-06-01',
          // 'actual' (not the default 'company') is required for the
          // development_status lift in _recompute_asset_indication_status.
          projection: 'actual',
          indication: indicationField,
          anchor: { level: 'asset', ref: 0 },
        },
      ],
    },
    p_inventory_snapshot_hash: snapHash,
  });

  const result = expectOk(r) as Record<string, unknown>;
  expect(result.source_doc_id).toBeTruthy();
  createdSourceDocIds.push(result.source_doc_id as string);

  const created = result.created as Record<string, string[]>;
  expect(created.events).toHaveLength(1);
  const eventId = created.events[0];
  expect(eventId).toBeTruthy();
  return eventId;
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

describe('commit_source_import: event indication resolution + status lift', () => {
  it(
    'resolves indication NAME to id, sets events.indication_id, and lifts development_status to APPROVED',
    async () => {
      const eventId = await commitEvent(INDICATION_NAME);

      // The created event row carries the resolved indication_id + correct anchor.
      const { data: evRow } = await admin
        .from('events')
        .select('event_type_id, anchor_type, anchor_id, indication_id, projection')
        .eq('id', eventId)
        .single();

      expect(evRow, 'event row must exist in DB').toBeTruthy();
      expect(evRow!.event_type_id).toBe(APPROVAL_EVENT_TYPE_ID);
      expect(evRow!.anchor_type).toBe('asset');
      expect(evRow!.anchor_id).toBe(assetId);
      expect(evRow!.projection).toBe('actual');
      expect(evRow!.indication_id, 'events.indication_id must resolve to the seeded indication').toBe(
        indicationId,
      );

      // The trigger created the (asset, indication) program row and lifted it.
      const { data: aiRow } = await admin
        .from('asset_indications')
        .select('development_status')
        .eq('asset_id', assetId)
        .eq('indication_id', indicationId)
        .single();

      expect(aiRow, 'asset_indications row must exist for (asset, indication)').toBeTruthy();
      expect(aiRow!.development_status, 'Approval event must lift status to APPROVED').toBe(
        'APPROVED',
      );
    },
    120_000,
  );

  it(
    'resolves a CASE VARIANT indication name to the SAME existing id without minting a duplicate',
    async () => {
      const eventId = await commitEvent(INDICATION_NAME_VARIANT);

      // Same existing indication id -- no new indication minted from the variant.
      const { data: evRow } = await admin
        .from('events')
        .select('indication_id')
        .eq('id', eventId)
        .single();

      expect(evRow, 'event row must exist in DB').toBeTruthy();
      expect(
        evRow!.indication_id,
        'case-variant indication name must resolve to the existing id',
      ).toBe(indicationId);

      // Exactly one indication for this name family in the space (no duplicate).
      const { count } = await admin
        .from('indications')
        .select('*', { count: 'exact', head: true })
        .eq('space_id', p.org.spaceId)
        .ilike('name', INDICATION_NAME);

      expect(count, 'no duplicate indication may be minted for a case variant').toBe(1);
    },
    120_000,
  );
});
