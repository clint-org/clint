/**
 * Source-import RPC integration tests.
 *
 * Covers the ai_call lifecycle (open/preflight/close) and the
 * commit_source_import RPC against real local Supabase.
 *
 * Worker-callable RPCs (ai_call_open, preflight, close) run as anon with a
 * shared secret. commit_source_import runs as an authenticated user.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectCode, expectOk } from '../harness/as';

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const WORKER_SECRET = 'local-dev-extract-source-secret';

let p: Personas;
let anon: SupabaseClient;
let admin: SupabaseClient;

// Track ids created during tests for cleanup.
const createdAiCallIds: string[] = [];
const createdSourceDocIds: string[] = [];

beforeAll(async () => {
  p = await buildPersonas();
  anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  admin = adminClient();
}, 120_000);

afterAll(async () => {
  // Reverse order: source_documents FK on ai_calls, entities FK on source_documents.
  // Delete entities that reference source docs first.
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
// ai_call_open
// ---------------------------------------------------------------------------

describe('ai_call_open', () => {
  it('succeeds with correct secret and returns uuid', async () => {
    const { data, error } = await anon.rpc('ai_call_open', {
      p_secret: WORKER_SECRET,
      p_tenant_id: p.org.tenantId,
      p_space_id: p.org.spaceId,
      p_user_id: p.ids.agency_owner,
      p_model: 'claude-sonnet-4-6',
      p_feature: 'source_extract',
    });
    expect(error).toBeNull();
    expect(typeof data).toBe('string');
    expect(data).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    createdAiCallIds.push(data as string);

    const { data: row } = await admin
      .from('ai_calls')
      .select('outcome, model, feature')
      .eq('id', data as string)
      .single();
    expect(row!.outcome).toBe('pending');
    expect(row!.model).toBe('claude-sonnet-4-6');
    expect(row!.feature).toBe('source_extract');
  });

  it('captures p_request on open and surfaces request + full output in the rollup', async () => {
    const request = {
      kind: 'nct',
      input: { nct_ids: ['NCT03548935', 'NCT04184622'] },
      prompt: 'Resolve these NCT studies into companies and assets.',
      params: { model: 'claude-opus-4-8', max_tokens: 8192 },
    };
    const { data: callId, error } = await anon.rpc('ai_call_open', {
      p_secret: WORKER_SECRET,
      p_tenant_id: p.org.tenantId,
      p_space_id: p.org.spaceId,
      p_user_id: p.ids.contributor,
      p_model: 'claude-opus-4-8',
      p_feature: 'source_extract',
      p_input_hash: 'capture-test-1',
      p_request: request,
    });
    expect(error).toBeNull();
    createdAiCallIds.push(callId as string);

    // request is persisted on the row
    const { data: openedRow } = await admin
      .from('ai_calls')
      .select('request')
      .eq('id', callId as string)
      .single();
    expect(openedRow!.request).toMatchObject({
      kind: 'nct',
      input: { nct_ids: ['NCT03548935', 'NCT04184622'] },
    });

    // close with full (untruncated) output
    const bigRaw = 'FULL RAW MODEL OUTPUT '.repeat(500); // > 5000 chars
    const close = await anon.rpc('ai_call_close', {
      p_secret: WORKER_SECRET,
      p_ai_call_id: callId,
      p_outcome: 'success',
      p_prompt_tokens: 100,
      p_completion_tokens: 50,
      p_output: { proposals: [], dropped: [], raw: bigRaw },
    });
    expect(close.error).toBeNull();

    // rollup space scope surfaces request + output for the super-admin drill
    const r = await as(p, 'platform_admin').rpc('get_ai_usage_rollup', {
      p_scope: 'space',
      p_id: p.org.spaceId,
      p_window: '7 days',
    });
    const payload = expectOk(r) as { data: Record<string, unknown>[] };
    const detail = payload.data.find((x) => x['ai_call_id'] === callId);
    expect(detail).toBeTruthy();
    // list row is light: just the import mode
    expect(detail!['import_kind']).toBe('nct');

    // full request + (untruncated) output fetched on expand, platform-admin only
    const d = await as(p, 'platform_admin').rpc('get_ai_call_detail', {
      p_ai_call_id: callId,
    });
    const full = expectOk(d) as {
      request: { kind: string; input: { nct_ids: string[] } };
      output: { raw?: string };
    };
    expect(full.request).toMatchObject({
      kind: 'nct',
      input: { nct_ids: ['NCT03548935', 'NCT04184622'] },
    });
    expect(full.output.raw?.length).toBeGreaterThan(5000);

    // non-admin cannot read call detail
    const denied = await as(p, 'contributor').rpc('get_ai_call_detail', {
      p_ai_call_id: callId,
    });
    expectCode(denied, '42501');
  });

  it('rejects wrong secret with 42501', async () => {
    const r = await anon.rpc('ai_call_open', {
      p_secret: 'wrong-secret',
      p_tenant_id: p.org.tenantId,
      p_space_id: p.org.spaceId,
      p_user_id: p.ids.agency_owner,
      p_model: 'claude-sonnet-4-6',
      p_feature: 'source_extract',
    });
    expectCode(r, '42501');
  });
});

// ---------------------------------------------------------------------------
// ai_call_preflight
// ---------------------------------------------------------------------------

describe('ai_call_preflight', () => {
  it('returns not allowed when no ai_config row exists', async () => {
    // Ensure clean slate: no ai_config for this tenant.
    await admin.from('ai_config').delete().eq('tenant_id', p.org.tenantId);

    const { data, error } = await anon.rpc('ai_call_preflight', {
      p_secret: WORKER_SECRET,
      p_tenant_id: p.org.tenantId,
      p_user_id: p.ids.agency_owner,
    });
    expect(error).toBeNull();
    expect(data.allowed).toBe(false);
    expect(data.reason).toBe('ai_disabled');
  });

  it('returns allowed (with a resolved model) when ai_enabled=true', async () => {
    await admin.from('ai_config').upsert({
      tenant_id: p.org.tenantId,
      ai_enabled: true,
      daily_token_cap: 1000000,
      per_user_rate_per_min: 60,
      per_user_rate_per_hour: 600,
    });

    const { data, error } = await anon.rpc('ai_call_preflight', {
      p_secret: WORKER_SECRET,
      p_tenant_id: p.org.tenantId,
      p_user_id: p.ids.agency_owner,
    });
    expect(error).toBeNull();
    expect(data.allowed).toBe(true);
    expect(typeof data.model).toBe('string');
    expect(data.model.length).toBeGreaterThan(0);
  });

  it('enforces the daily token cap', async () => {
    await admin.from('ai_config').upsert({
      tenant_id: p.org.tenantId,
      ai_enabled: true,
      daily_token_cap: 100, // very low cap
      per_user_rate_per_min: 60,
      per_user_rate_per_hour: 600,
    });

    // Seed ai_calls whose token counts blow past the cap (3 x 50 = 150 > 100).
    for (let i = 0; i < 3; i++) {
      const { data: callId } = await anon.rpc('ai_call_open', {
        p_secret: WORKER_SECRET,
        p_tenant_id: p.org.tenantId,
        p_space_id: p.org.spaceId,
        p_user_id: p.ids.agency_owner,
        p_model: 'claude-sonnet-4-6',
        p_feature: 'source_extract',
      });
      createdAiCallIds.push(callId as string);
      await anon.rpc('ai_call_close', {
        p_secret: WORKER_SECRET,
        p_ai_call_id: callId,
        p_outcome: 'success',
        p_prompt_tokens: 50,
        p_completion_tokens: 0,
      });
    }

    const { data, error } = await anon.rpc('ai_call_preflight', {
      p_secret: WORKER_SECRET,
      p_tenant_id: p.org.tenantId,
      p_user_id: p.ids.agency_owner,
    });
    expect(error).toBeNull();
    expect(data.allowed).toBe(false);
    expect(data.reason).toBe('daily_token_cap');
  });

  it('enforces the per-user per-minute rate limit', async () => {
    await admin.from('ai_config').upsert({
      tenant_id: p.org.tenantId,
      ai_enabled: true,
      daily_token_cap: 100000000,
      per_user_rate_per_min: 2,
      per_user_rate_per_hour: 600,
    });
    // Two opens in the last minute reach the per-minute limit (count-based).
    for (let i = 0; i < 2; i++) {
      const { data: callId } = await anon.rpc('ai_call_open', {
        p_secret: WORKER_SECRET,
        p_tenant_id: p.org.tenantId,
        p_space_id: p.org.spaceId,
        p_user_id: p.ids.contributor,
        p_model: 'claude-sonnet-4-6',
        p_feature: 'source_extract',
      });
      createdAiCallIds.push(callId as string);
    }
    const { data } = await anon.rpc('ai_call_preflight', {
      p_secret: WORKER_SECRET,
      p_tenant_id: p.org.tenantId,
      p_user_id: p.ids.contributor,
    });
    expect(data.allowed).toBe(false);
    expect(data.reason).toBe('rate_limited_minute');
  });

  it('enforces the per-user per-hour rate limit', async () => {
    await admin.from('ai_config').upsert({
      tenant_id: p.org.tenantId,
      ai_enabled: true,
      daily_token_cap: 100000000,
      per_user_rate_per_min: 100, // high so the minute limit does not trip first
      per_user_rate_per_hour: 2,
    });
    for (let i = 0; i < 2; i++) {
      const { data: callId } = await anon.rpc('ai_call_open', {
        p_secret: WORKER_SECRET,
        p_tenant_id: p.org.tenantId,
        p_space_id: p.org.spaceId,
        p_user_id: p.ids.reader,
        p_model: 'claude-sonnet-4-6',
        p_feature: 'source_extract',
      });
      createdAiCallIds.push(callId as string);
    }
    const { data } = await anon.rpc('ai_call_preflight', {
      p_secret: WORKER_SECRET,
      p_tenant_id: p.org.tenantId,
      p_user_id: p.ids.reader,
    });
    expect(data.allowed).toBe(false);
    expect(data.reason).toBe('rate_limited_hour');
  });
});

describe('ai_call cost is computed server-side from the model price', () => {
  it('stamps the configured model and computes cost from tokens, ignoring worker cost', async () => {
    await admin.from('ai_config').upsert({
      tenant_id: p.org.tenantId,
      ai_enabled: true,
      ai_model: 'claude-opus-4-8',
      daily_token_cap: 100000000,
      per_user_rate_per_min: 60,
      per_user_rate_per_hour: 600,
    });

    const { data: callId } = await anon.rpc('ai_call_open', {
      p_secret: WORKER_SECRET,
      p_tenant_id: p.org.tenantId,
      p_space_id: p.org.spaceId,
      p_user_id: p.ids.space_owner,
      p_model: 'claude-sonnet-4-6', // worker default; server resolves to the configured Opus
      p_feature: 'source_extract',
    });
    createdAiCallIds.push(callId as string);

    await anon.rpc('ai_call_close', {
      p_secret: WORKER_SECRET,
      p_ai_call_id: callId,
      p_outcome: 'success',
      p_prompt_tokens: 1000,
      p_completion_tokens: 500,
      p_cost_cents: 999, // must be ignored
    });

    const { data: row } = await admin
      .from('ai_calls')
      .select('model, cost_estimate_cents')
      .eq('id', callId as string)
      .single();
    expect(row!.model).toBe('claude-opus-4-8');
    // Opus 1000/500: 1000/1e6*500 + 500/1e6*2500 = 1.75 cents
    expect(Number(row!.cost_estimate_cents)).toBeCloseTo(1.75, 4);
  });
});

// ---------------------------------------------------------------------------
// ai_call_close
// ---------------------------------------------------------------------------

describe('ai_call_close', () => {
  it('finalizes a pending call', async () => {
    const { data: callId } = await anon.rpc('ai_call_open', {
      p_secret: WORKER_SECRET,
      p_tenant_id: p.org.tenantId,
      p_space_id: p.org.spaceId,
      p_user_id: p.ids.agency_owner,
      p_model: 'claude-sonnet-4-6',
      p_feature: 'source_extract',
    });
    createdAiCallIds.push(callId as string);

    const closeResult = await anon.rpc('ai_call_close', {
      p_secret: WORKER_SECRET,
      p_ai_call_id: callId,
      p_outcome: 'success',
      p_prompt_tokens: 100,
      p_completion_tokens: 50,
      p_cost_cents: 0.015,
      p_duration_ms: 3200,
    });
    expect(closeResult.error).toBeNull();

    const { data: row } = await admin
      .from('ai_calls')
      .select('outcome, prompt_tokens, completion_tokens, closed_at')
      .eq('id', callId as string)
      .single();
    expect(row!.outcome).toBe('success');
    expect(row!.prompt_tokens).toBe(100);
    expect(row!.completion_tokens).toBe(50);
    expect(row!.closed_at).not.toBeNull();
  });

  it('rejects double close with 22023', async () => {
    const { data: callId } = await anon.rpc('ai_call_open', {
      p_secret: WORKER_SECRET,
      p_tenant_id: p.org.tenantId,
      p_space_id: p.org.spaceId,
      p_user_id: p.ids.agency_owner,
      p_model: 'claude-sonnet-4-6',
      p_feature: 'source_extract',
    });
    createdAiCallIds.push(callId as string);

    await anon.rpc('ai_call_close', {
      p_secret: WORKER_SECRET,
      p_ai_call_id: callId,
      p_outcome: 'success',
    });

    const r = await anon.rpc('ai_call_close', {
      p_secret: WORKER_SECRET,
      p_ai_call_id: callId,
      p_outcome: 'success',
    });
    expectCode(r, '22023');
  });
});

// ---------------------------------------------------------------------------
// commit_source_import
// ---------------------------------------------------------------------------

describe('commit_source_import', () => {
  const uniqueSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  function makeSourceDoc(textHash?: string) {
    return {
      source_kind: 'text',
      source_text: `Integration test content ${uniqueSuffix()}`,
      source_url: `https://example.com/import-${uniqueSuffix()}`,
      text_hash: textHash ?? `hash-${uniqueSuffix()}`,
      source_title: 'Test Document',
      fetch_outcome: 'paste',
    };
  }

  function makeProposal(overrides: Record<string, unknown> = {}) {
    return {
      companies: [
        {
          match: { kind: 'new', name: `Test Pharma ${uniqueSuffix()}` },
        },
      ],
      assets: [
        {
          match: { kind: 'new', name: `Test Drug ${uniqueSuffix()}` },
          generic_name: 'testdrug',
          company_ref: 0,
          moas: [],
          roas: [],
        },
      ],
      trials: [
        {
          match: { kind: 'new', name: `TEST-${uniqueSuffix()}` },
          asset_ref: 0,
          phase: 'P2',
          status: 'Active',
        },
      ],
      events: [
        {
          event_type: 'Topline Data',
          title: `Test readout ${uniqueSuffix()}`,
          event_date: '2026-06-01',
          significance: 'high',
          anchor: { level: 'trial', ref: 0 },
        },
        {
          event_type: 'Regulatory Filing',
          title: `Test filing ${uniqueSuffix()}`,
          event_date: '2026-06-15',
          significance: 'high',
          anchor: { level: 'company', ref: 0 },
        },
      ],
      ...overrides,
    };
  }

  async function openAndCloseAiCall(): Promise<string> {
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
      p_cost_cents: 0.015,
      p_duration_ms: 1500,
    });
    return callId as string;
  }

  it('creates entities in correct order with provenance', async () => {
    const aiCallId = await openAndCloseAiCall();

    // Get current inventory hash for the snapshot param.
    // commit_source_import uses has_space_access() which requires an explicit
    // space_members row. contributor has editor role on the test space.
    const snapResult = await as(p, 'contributor').rpc('get_space_inventory_snapshot', {
      p_space_id: p.org.spaceId,
    });
    const snapHash = expectOk(snapResult).hash as string;

    const sourceDoc = makeSourceDoc();
    const proposal = makeProposal();

    const r = await as(p, 'contributor').rpc('commit_source_import', {
      p_space_id: p.org.spaceId,
      p_ai_call_id: aiCallId,
      p_source_document: sourceDoc,
      p_proposal: proposal,
      p_inventory_snapshot_hash: snapHash,
    });
    const result = expectOk(r) as Record<string, unknown>;
    expect(result.source_doc_id).toBeTruthy();
    createdSourceDocIds.push(result.source_doc_id as string);

    const created = result.created as Record<string, string[]>;
    expect(created.companies.length).toBe(1);
    expect(created.assets.length).toBe(1);
    expect(created.trials.length).toBe(1);
    // Unified events: one trial-anchored (Topline Data) and one company-anchored
    // (Regulatory Filing), both in created.events.
    expect(created.events.length).toBe(2);

    // Verify source_doc_id provenance on each entity.
    const docId = result.source_doc_id as string;
    const { data: company } = await admin
      .from('companies')
      .select('source_doc_id')
      .eq('id', created.companies[0])
      .single();
    expect(company!.source_doc_id).toBe(docId);

    const { data: asset } = await admin
      .from('assets')
      .select('source_doc_id')
      .eq('id', created.assets[0])
      .single();
    expect(asset!.source_doc_id).toBe(docId);

    const { data: trial } = await admin
      .from('trials')
      .select('source_doc_id')
      .eq('id', created.trials[0])
      .single();
    expect(trial!.source_doc_id).toBe(docId);

    // First event: Topline Data, trial-anchored.
    const { data: trialEvent } = await admin
      .from('events')
      .select('source_doc_id, anchor_type')
      .eq('id', created.events[0])
      .single();
    expect(trialEvent!.source_doc_id).toBe(docId);
    expect(trialEvent!.anchor_type).toBe('trial');

    // Second event: Regulatory Filing, company-anchored.
    const { data: companyEvent } = await admin
      .from('events')
      .select('source_doc_id, anchor_type')
      .eq('id', created.events[1])
      .single();
    expect(companyEvent!.source_doc_id).toBe(docId);
    expect(companyEvent!.anchor_type).toBe('company');

    // Source citation path: the imported document's source_url lands as one
    // event_sources row on each created event (via create_event p_sources).
    for (const eventId of [created.events[0], created.events[1]]) {
      const { data: srcRows } = await admin
        .from('event_sources')
        .select('url')
        .eq('event_id', eventId);
      expect(srcRows, `event ${eventId} must have a source citation`).toHaveLength(1);
      expect(srcRows![0].url).toBe(sourceDoc.source_url);
    }

    // Verify source_documents row.
    const { data: srcDoc } = await admin
      .from('source_documents')
      .select('text_hash, source_kind, space_id')
      .eq('id', docId)
      .single();
    expect(srcDoc!.text_hash).toBe(sourceDoc.text_hash);
    expect(srcDoc!.source_kind).toBe('text');
    expect(srcDoc!.space_id).toBe(p.org.spaceId);

    // Verify ai_calls row updated with source_doc_id.
    const { data: aiRow } = await admin
      .from('ai_calls')
      .select('source_doc_id')
      .eq('id', aiCallId)
      .single();
    expect(aiRow!.source_doc_id).toBe(docId);
  });

  it('persists multiple indications per trial via indications[]', async () => {
    const aiCallId = await openAndCloseAiCall();

    const snapResult = await as(p, 'contributor').rpc('get_space_inventory_snapshot', {
      p_space_id: p.org.spaceId,
    });
    const snapHash = expectOk(snapResult).hash as string;

    const indA = `Indication A ${uniqueSuffix()}`;
    const indB = `Indication B ${uniqueSuffix()}`;
    const proposal = makeProposal({
      trials: [
        {
          match: { kind: 'new', name: `TEST-MI-${uniqueSuffix()}` },
          asset_ref: 0,
          phase: 'P2',
          status: 'Active',
          indications: [indA, indB],
        },
      ],
    });

    const r = await as(p, 'contributor').rpc('commit_source_import', {
      p_space_id: p.org.spaceId,
      p_ai_call_id: aiCallId,
      p_source_document: makeSourceDoc(),
      p_proposal: proposal,
      p_inventory_snapshot_hash: snapHash,
    });
    const result = expectOk(r) as Record<string, unknown>;
    createdSourceDocIds.push(result.source_doc_id as string);
    const created = result.created as Record<string, string[]>;
    const trialId = created.trials[0];
    const assetId = created.assets[0];

    // Two trial_conditions rows (one per indication name).
    const { count: condCount } = await admin
      .from('trial_conditions')
      .select('*', { count: 'exact', head: true })
      .eq('trial_id', trialId);
    expect(condCount).toBe(2);

    // Two asset_indications rows for the primary asset.
    const { count: aiCount } = await admin
      .from('asset_indications')
      .select('*', { count: 'exact', head: true })
      .eq('asset_id', assetId);
    expect(aiCount).toBe(2);

    // Both indication names exist in the space.
    const { data: inds } = await admin
      .from('indications')
      .select('name')
      .eq('space_id', p.org.spaceId)
      .in('name', [indA, indB]);
    expect(inds!.map((i) => i.name).sort()).toEqual([indA, indB].sort());
  });

  it('returns duplicate_source on same text_hash', async () => {
    const aiCallId1 = await openAndCloseAiCall();
    const aiCallId2 = await openAndCloseAiCall();

    const sharedHash = `dup-hash-${uniqueSuffix()}`;

    const snapResult = await as(p, 'contributor').rpc('get_space_inventory_snapshot', {
      p_space_id: p.org.spaceId,
    });
    const snapHash = expectOk(snapResult).hash as string;

    // First commit succeeds.
    const r1 = await as(p, 'contributor').rpc('commit_source_import', {
      p_space_id: p.org.spaceId,
      p_ai_call_id: aiCallId1,
      p_source_document: makeSourceDoc(sharedHash),
      p_proposal: makeProposal(),
      p_inventory_snapshot_hash: snapHash,
    });
    const result1 = expectOk(r1) as Record<string, unknown>;
    expect(result1.source_doc_id).toBeTruthy();
    createdSourceDocIds.push(result1.source_doc_id as string);

    // Refetch snapshot hash since inventory changed.
    const snap2 = await as(p, 'contributor').rpc('get_space_inventory_snapshot', {
      p_space_id: p.org.spaceId,
    });
    const snapHash2 = expectOk(snap2).hash as string;

    // Second commit with same text_hash returns duplicate_source.
    const r2 = await as(p, 'contributor').rpc('commit_source_import', {
      p_space_id: p.org.spaceId,
      p_ai_call_id: aiCallId2,
      p_source_document: makeSourceDoc(sharedHash),
      p_proposal: makeProposal(),
      p_inventory_snapshot_hash: snapHash2,
    });
    const result2 = expectOk(r2) as Record<string, unknown>;
    expect(result2.code).toBe('duplicate_source');
    expect(result2.existing_id).toBe(result1.source_doc_id);
  });

  it('reports inventory_drift when snapshot hash is stale', async () => {
    const aiCallId = await openAndCloseAiCall();

    // Use a deliberately wrong hash.
    const staleHash = 'stale-hash-that-does-not-match';
    const sourceDoc = makeSourceDoc();
    const proposal = makeProposal();

    const r = await as(p, 'contributor').rpc('commit_source_import', {
      p_space_id: p.org.spaceId,
      p_ai_call_id: aiCallId,
      p_source_document: sourceDoc,
      p_proposal: proposal,
      p_inventory_snapshot_hash: staleHash,
    });
    const result = expectOk(r) as Record<string, unknown>;
    expect(result.source_doc_id).toBeTruthy();
    createdSourceDocIds.push(result.source_doc_id as string);
    expect((result.warnings as string[]).includes('inventory_drift')).toBe(true);
  });

  it('skips existing-matched events; reports them in skipped.events', async () => {
    // First commit: create baseline entities including two unified events.
    const aiCallId1 = await openAndCloseAiCall();
    const snap1 = await as(p, 'contributor').rpc('get_space_inventory_snapshot', {
      p_space_id: p.org.spaceId,
    });
    const snapHash1 = expectOk(snap1).hash as string;
    const r1 = await as(p, 'contributor').rpc('commit_source_import', {
      p_space_id: p.org.spaceId,
      p_ai_call_id: aiCallId1,
      p_source_document: makeSourceDoc(),
      p_proposal: makeProposal(),
      p_inventory_snapshot_hash: snapHash1,
    });
    const result1 = expectOk(r1) as Record<string, unknown>;
    createdSourceDocIds.push(result1.source_doc_id as string);
    const created1 = result1.created as Record<string, string[]>;
    // After unified contract: events[0] is the trial-anchored Topline Data event,
    // events[1] is the company-anchored Regulatory Filing event.
    const existingEventId1 = created1.events[0]; // trial-anchored
    const existingEventId2 = created1.events[1]; // company-anchored

    // Second commit: one trial-anchored and one company-anchored event match
    // existing rows; one new event of each type serves as a regression guard.
    const aiCallId2 = await openAndCloseAiCall();
    const snap2 = await as(p, 'contributor').rpc('get_space_inventory_snapshot', {
      p_space_id: p.org.spaceId,
    });
    const snapHash2 = expectOk(snap2).hash as string;
    const newMarkerTitle = `New marker dedup ${uniqueSuffix()}`;
    const newEventTitle = `New event dedup ${uniqueSuffix()}`;

    const proposal2 = makeProposal({
      events: [
        // Matched to existing trial-anchored event: should be skipped.
        {
          event_type: 'Topline Data',
          title: 'Existing readout (skip me)',
          event_date: '2026-06-01',
          significance: 'high',
          anchor: { level: 'trial', ref: 0 },
          match: { kind: 'existing', id: existingEventId1 },
        },
        // New trial-anchored event: should be created.
        {
          event_type: 'Topline Data',
          title: newMarkerTitle,
          event_date: '2026-07-01',
          significance: 'high',
          anchor: { level: 'trial', ref: 0 },
        },
        // Matched to existing company-anchored event: should be skipped.
        {
          event_type: 'Regulatory Filing',
          title: 'Existing filing (skip me)',
          event_date: '2026-06-15',
          significance: 'high',
          anchor: { level: 'company', ref: 0 },
          match: { kind: 'existing', id: existingEventId2 },
        },
        // New company-anchored event: should be created.
        {
          event_type: 'Regulatory Filing',
          title: newEventTitle,
          event_date: '2026-08-01',
          significance: 'low',
          anchor: { level: 'company', ref: 0 },
        },
      ],
    });

    const r2 = await as(p, 'contributor').rpc('commit_source_import', {
      p_space_id: p.org.spaceId,
      p_ai_call_id: aiCallId2,
      p_source_document: makeSourceDoc(),
      p_proposal: proposal2,
      p_inventory_snapshot_hash: snapHash2,
    });
    const result2 = expectOk(r2) as Record<string, unknown>;
    createdSourceDocIds.push(result2.source_doc_id as string);

    // skipped.events lists both bypassed event ids.
    const skipped = result2['skipped'] as Record<string, string[]>;
    expect(skipped, 'skipped field must exist in result').toBeTruthy();
    expect(skipped.events).toContain(existingEventId1);
    expect(skipped.events).toContain(existingEventId2);

    // created lists only the genuinely new events (one trial-anchored, one company-anchored).
    const created2 = result2.created as Record<string, string[]>;
    expect(created2.events).toHaveLength(2);
    expect(created2.events).not.toContain(existingEventId1);
    expect(created2.events).not.toContain(existingEventId2);

    // DB check: no duplicate row for the existing trial-anchored event.
    const { count: markerCount } = await admin
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('id', existingEventId1);
    expect(markerCount).toBe(1);

    // Regression guard: the genuinely new trial-anchored event was created with
    // the correct title and anchor type.
    const { data: newMarkerRow } = await admin
      .from('events')
      .select('title, anchor_type')
      .eq('id', created2.events[0])
      .single();
    expect(newMarkerRow!.title).toBe(newMarkerTitle);
    expect(newMarkerRow!.anchor_type).toBe('trial');
  });
});

// ---------------------------------------------------------------------------
// get_space_inventory_snapshot
// ---------------------------------------------------------------------------

describe('get_space_inventory_snapshot', () => {
  it('returns hash and entity arrays', async () => {
    const r = await as(p, 'contributor').rpc('get_space_inventory_snapshot', {
      p_space_id: p.org.spaceId,
    });
    const data = expectOk(r) as Record<string, unknown>;
    expect(typeof data.hash).toBe('string');
    expect(Array.isArray(data.companies)).toBe(true);
    expect(Array.isArray(data.assets)).toBe(true);
    expect(Array.isArray(data.trials)).toBe(true);
    expect(Array.isArray(data.indications)).toBe(true);
  });
});
