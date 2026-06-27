/**
 * source_duplicate_check RPC -- the pre-extraction duplicate guard.
 *
 * The source-extract worker calls this with the worker secret BEFORE spending a
 * Claude call, so an exact (byte-identical) re-import can short-circuit with a
 * duplicate_source response instead of re-extracting. This spec pins:
 *   - a match on (space_id, text_hash) returns the existing source_documents.id
 *   - an absent hash returns null (no false positive -> no wasted guard)
 *   - the lookup is space-scoped
 *   - a bad worker secret is rejected
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const WORKER_SECRET = 'local-dev-extract-source-secret';

let p: Personas;
let anon: SupabaseClient;
let admin: ReturnType<typeof adminClient>;

const createdDocIds: string[] = [];

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function insertSourceDoc(spaceId: string, textHash: string): Promise<string> {
  const { data, error } = await admin
    .from('source_documents')
    .insert({
      space_id: spaceId,
      source_kind: 'text',
      source_text: `dup-check fixture ${suffix()}`,
      text_hash: textHash,
      fetch_outcome: 'paste',
      created_by: p.ids.contributor,
    })
    .select('id')
    .single();
  if (error) throw new Error(`insertSourceDoc failed: ${error.message}`);
  const id = (data as { id: string }).id;
  createdDocIds.push(id);
  return id;
}

beforeAll(async () => {
  p = await buildPersonas();
  anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  admin = adminClient();
}, 120_000);

afterAll(async () => {
  for (const id of createdDocIds) {
    await admin.from('source_documents').delete().eq('id', id);
  }
});

describe('source_duplicate_check', () => {
  it('returns the existing source_documents id for a matching (space_id, text_hash)', async () => {
    const hash = `dupcheck-match-${suffix()}`;
    const docId = await insertSourceDoc(p.org.spaceId, hash);

    const { data, error } = await anon.rpc('source_duplicate_check', {
      p_secret: WORKER_SECRET,
      p_space_id: p.org.spaceId,
      p_text_hash: hash,
    });

    expect(error).toBeNull();
    expect(data).toBe(docId);
  });

  it('returns null for a hash that was never committed', async () => {
    const { data, error } = await anon.rpc('source_duplicate_check', {
      p_secret: WORKER_SECRET,
      p_space_id: p.org.spaceId,
      p_text_hash: `dupcheck-absent-${suffix()}`,
    });

    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('is space-scoped (a hash in one space does not match another space)', async () => {
    const hash = `dupcheck-scoped-${suffix()}`;
    await insertSourceDoc(p.org.spaceId, hash);

    // A different (unrelated) space id holds no such row.
    const otherSpace = '00000000-0000-0000-0000-000000000000';
    const { data, error } = await anon.rpc('source_duplicate_check', {
      p_secret: WORKER_SECRET,
      p_space_id: otherSpace,
      p_text_hash: hash,
    });

    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('rejects a bad worker secret', async () => {
    const { error } = await anon.rpc('source_duplicate_check', {
      p_secret: 'not-the-secret',
      p_space_id: p.org.spaceId,
      p_text_hash: 'whatever',
    });

    expect(error).toBeTruthy();
  });
});
