/**
 * Import-provenance RPC integration tests.
 *
 * Covers get_source_document: the read-only drill from an AI-imported entity
 * back to the source_documents row it landed from. Gated to space owners and
 * editors (viewers and non-members are rejected); platform admin keeps its
 * support read bypass via has_space_access.
 *
 * Setup mirrors source-import-rpc.spec.ts: open + close an ai_call as the
 * worker (anon + shared secret), then commit_source_import as the contributor
 * (editor) to produce a source_documents row and entities stamped with its id.
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

// One committed import shared across the matrix.
let sourceDocId: string;
let aiCallId: string;
const SOURCE_TITLE = 'Pfizer Q2 press release';
const SOURCE_TEXT = `Integration provenance content ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const MODEL = 'claude-sonnet-4-6';

const createdAiCallIds: string[] = [];
const createdSourceDocIds: string[] = [];

beforeAll(async () => {
  p = await buildPersonas();
  anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  admin = adminClient();

  // 1. Open + close an ai_call as the worker, attributed to the contributor.
  const { data: callId } = await anon.rpc('ai_call_open', {
    p_secret: WORKER_SECRET,
    p_tenant_id: p.org.tenantId,
    p_space_id: p.org.spaceId,
    p_user_id: p.ids.contributor,
    p_model: MODEL,
    p_feature: 'source_extract',
  });
  aiCallId = callId as string;
  createdAiCallIds.push(aiCallId);
  await anon.rpc('ai_call_close', {
    p_secret: WORKER_SECRET,
    p_ai_call_id: aiCallId,
    p_outcome: 'success',
    p_prompt_tokens: 100,
    p_completion_tokens: 50,
  });

  // 2. Commit the import as the contributor (editor on the test space).
  const snap = await as(p, 'contributor').rpc('get_space_inventory_snapshot', {
    p_space_id: p.org.spaceId,
  });
  const snapHash = expectOk(snap).hash as string;

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const r = await as(p, 'contributor').rpc('commit_source_import', {
    p_space_id: p.org.spaceId,
    p_ai_call_id: aiCallId,
    p_source_document: {
      source_kind: 'text',
      source_text: SOURCE_TEXT,
      text_hash: `prov-hash-${suffix}`,
      source_title: SOURCE_TITLE,
      fetch_outcome: 'paste',
    },
    p_proposal: {
      companies: [{ match: { kind: 'new', name: `Prov Pharma ${suffix}` } }],
      assets: [
        {
          match: { kind: 'new', name: `Prov Drug ${suffix}` },
          company_ref: 0,
          moas: [],
          roas: [],
        },
      ],
      trials: [
        {
          match: { kind: 'new', name: `PROV-${suffix}` },
          asset_ref: 0,
          phase: 'P2',
          status: 'Active',
        },
      ],
    },
    p_inventory_snapshot_hash: snapHash,
  });
  const result = expectOk(r) as Record<string, unknown>;
  sourceDocId = result.source_doc_id as string;
  createdSourceDocIds.push(sourceDocId);
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
});

describe('get_source_document', () => {
  it('returns the full provenance payload for a space owner', async () => {
    const r = await as(p, 'space_owner').rpc('get_source_document', {
      p_source_doc_id: sourceDocId,
    });
    const doc = expectOk(r) as Record<string, unknown>;
    expect(doc.source_doc_id).toBe(sourceDocId);
    expect(doc.source_title).toBe(SOURCE_TITLE);
    expect(doc.source_kind).toBe('text');
    expect(doc.source_text).toBe(SOURCE_TEXT);
    expect(doc.fetch_outcome).toBe('paste');
    // Importer identity resolved from auth.users via the definer context.
    expect(doc.imported_by_email).toBe('contributor@personas.test');
    // AI model resolved from the linked ai_calls row.
    expect(doc.ai_model).toBe(MODEL);
    expect(doc.created_at).toBeTruthy();
  });

  it('returns the payload for a space editor (contributor)', async () => {
    const r = await as(p, 'contributor').rpc('get_source_document', {
      p_source_doc_id: sourceDocId,
    });
    const doc = expectOk(r) as Record<string, unknown>;
    expect(doc.source_doc_id).toBe(sourceDocId);
  });

  it('rejects a viewer (reader) with 42501', async () => {
    const r = await as(p, 'reader').rpc('get_source_document', {
      p_source_doc_id: sourceDocId,
    });
    expectCode(r, '42501');
  });

  it('rejects a non-member with 42501', async () => {
    const r = await as(p, 'no_memberships').rpc('get_source_document', {
      p_source_doc_id: sourceDocId,
    });
    expectCode(r, '42501');
  });

  it('returns null for an unknown source document', async () => {
    const r = await as(p, 'space_owner').rpc('get_source_document', {
      p_source_doc_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(expectOk(r)).toBeNull();
  });
});
