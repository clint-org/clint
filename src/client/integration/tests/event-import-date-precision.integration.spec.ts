/**
 * Integration proof for #189: commit_source_import threads a proposal event's
 * `date_precision` / `end_date_precision` through to create_event and normalizes
 * the stored date to the period MIDPOINT the app uses for fuzzy markers, instead
 * of hard-coding 'exact'.
 *
 * A month-only source phrase ("available in July") reaches commit as
 * date_precision='month' with any day inside July; the committed event must land
 * with date_precision='month' and event_date on the 15th (the month midpoint,
 * matching marker-date-precision.ts precisionMidpointISO). A quarter phrase lands
 * on the 15th of the quarter's middle month. An 'exact' date passes through
 * unchanged.
 *
 * Model: event-import-indication.integration.spec.ts (same harness: buildPersonas,
 * adminClient, `as`, ai_call open/close, proposal -> commit_source_import).
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

let companyId: string;
let assetId: string;

const createdSourceDocIds: string[] = [];
const createdAiCallIds: string[] = [];

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

beforeAll(async () => {
  p = await buildPersonas();
  anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  admin = adminClient();

  await admin.from('ai_config').upsert({
    tenant_id: p.org.tenantId,
    ai_enabled: true,
    daily_token_cap: 10_000_000,
    per_user_rate_per_min: 600,
    per_user_rate_per_hour: 6000,
  });

  const { data: company, error: companyErr } = await admin
    .from('companies')
    .insert({
      space_id: p.org.spaceId,
      name: `Precision Pharma ${suffix()}`,
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
      name: `Precision Drug ${suffix()}`,
      created_by: p.ids.contributor,
    })
    .select()
    .single();
  if (assetErr) throw new Error(`assets insert: ${assetErr.message}`);
  assetId = asset.id as string;
}, 120_000);

afterAll(async () => {
  for (const docId of createdSourceDocIds) {
    await admin.from('events').delete().eq('source_doc_id', docId);
  }
  await admin.from('events').delete().eq('anchor_id', assetId);
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

/** Commit one asset-anchored event carrying the given date fields. */
async function commitEvent(fields: Record<string, unknown>): Promise<string> {
  const aiCall = await openAndCloseCall();
  const snapHash = await freshSnapHash();

  const r = await as(p, 'contributor').rpc('commit_source_import', {
    p_space_id: p.org.spaceId,
    p_ai_call_id: aiCall,
    p_source_document: {
      source_kind: 'text',
      source_text: `Precision import test ${suffix()}`,
      text_hash: `precision-hash-${suffix()}`,
      source_title: 'Precision Test Doc',
      fetch_outcome: 'paste',
    },
    p_proposal: {
      assets: [{ match: { kind: 'existing', id: assetId } }],
      events: [
        {
          event_type: 'Topline Data',
          title: `Readout ${suffix()}`,
          anchor: { level: 'asset', ref: 0 },
          ...fields,
        },
      ],
    },
    p_inventory_snapshot_hash: snapHash,
  });

  const result = expectOk(r) as Record<string, unknown>;
  createdSourceDocIds.push(result.source_doc_id as string);
  const created = result.created as Record<string, string[]>;
  expect(created.events).toHaveLength(1);
  return created.events[0];
}

async function readEventDate(
  eventId: string,
): Promise<{ event_date: string; date_precision: string }> {
  const { data } = await admin
    .from('events')
    .select('event_date, date_precision')
    .eq('id', eventId)
    .single();
  expect(data, 'event row must exist').toBeTruthy();
  return data as { event_date: string; date_precision: string };
}

describe('commit_source_import: fuzzy date precision (#189)', () => {
  it(
    "stores a month-only phrase as date_precision='month' on the month midpoint (the 15th)",
    async () => {
      // Source said "available in July"; the model emits any July day.
      const eventId = await commitEvent({ event_date: '2026-07-03', date_precision: 'month' });
      const row = await readEventDate(eventId);
      expect(row.date_precision).toBe('month');
      expect(row.event_date).toBe('2026-07-15');
    },
    120_000,
  );

  it(
    "stores a quarter phrase as date_precision='quarter' on the middle month's 15th",
    async () => {
      // "in Q4 2026"; middle month of Q4 is November.
      const eventId = await commitEvent({ event_date: '2026-10-05', date_precision: 'quarter' });
      const row = await readEventDate(eventId);
      expect(row.date_precision).toBe('quarter');
      expect(row.event_date).toBe('2026-11-15');
    },
    120_000,
  );

  it(
    'passes an exact date through unchanged and defaults to exact when precision is omitted',
    async () => {
      const exactId = await commitEvent({ event_date: '2026-07-14', date_precision: 'exact' });
      const exactRow = await readEventDate(exactId);
      expect(exactRow.date_precision).toBe('exact');
      expect(exactRow.event_date).toBe('2026-07-14');

      const defaultId = await commitEvent({ event_date: '2026-03-09' });
      const defaultRow = await readEventDate(defaultId);
      expect(defaultRow.date_precision).toBe('exact');
      expect(defaultRow.event_date).toBe('2026-03-09');
    },
    120_000,
  );
});
