/**
 * events-change-source-type-filter.spec.ts
 *
 * Verifies the Activity page column filters (#192): get_events_page_data narrows
 * the detected (trial_change_events) leg by change SOURCE (p_change_sources) and
 * change TYPE (p_change_event_types). Both predicates live post-union in the
 * `filtered` CTE, so they compose with each other and with p_source_type.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPersonas, Personas, adminClient } from '../fixtures/personas';
import { createScratchAgency } from '../fixtures/scratch';
import { SupabaseClient } from '@supabase/supabase-js';

let p: Personas;
let svc: SupabaseClient;
let spaceId: string;
let trialId: string;
let agencyCleanup: () => Promise<void>;

interface DetectedRow {
  change_source: string;
  change_event_type: string;
}

beforeAll(async () => {
  p = await buildPersonas();
  svc = adminClient();

  const scratch = await createScratchAgency(p);
  spaceId = scratch.spaceId;
  agencyCleanup = scratch.cleanup;

  const createdBy = p.ids.tenant_owner;

  // trials.asset_id is NOT NULL, so seed the company > asset > trial chain.
  const { data: company, error: companyErr } = await svc
    .from('companies')
    .insert({ space_id: spaceId, name: 'Filter Co', created_by: createdBy })
    .select('id')
    .single();
  if (companyErr) throw new Error(`insert company: ${companyErr.message}`);

  const { data: asset, error: assetErr } = await svc
    .from('assets')
    .insert({ space_id: spaceId, company_id: company!.id, name: 'Filter Asset', created_by: createdBy })
    .select('id')
    .single();
  if (assetErr) throw new Error(`insert asset: ${assetErr.message}`);

  const { data: trial, error: trialErr } = await svc
    .from('trials')
    .insert({ space_id: spaceId, asset_id: asset!.id, name: 'Filter Trial', created_by: createdBy })
    .select('id')
    .single();
  if (trialErr) throw new Error(`insert trial: ${trialErr.message}`);
  trialId = trial!.id;

  // Four detected changes spanning two sources x two types so every filter
  // combination has a distinct expected result.
  const { error: ceErr } = await svc.from('trial_change_events').insert([
    {
      space_id: spaceId,
      trial_id: trialId,
      source: 'ctgov',
      event_type: 'status_changed',
      payload: { from: 'RECRUITING', to: 'ACTIVE_NOT_RECRUITING' },
      occurred_at: '2026-01-01T00:00:00Z',
    },
    {
      space_id: spaceId,
      trial_id: trialId,
      source: 'ctgov',
      event_type: 'date_moved',
      payload: { which_date: 'primary_completion', direction: 'delay', days_diff: '90' },
      occurred_at: '2026-01-02T00:00:00Z',
    },
    {
      space_id: spaceId,
      trial_id: trialId,
      source: 'analyst',
      event_type: 'status_changed',
      payload: { from: 'ACTIVE_NOT_RECRUITING', to: 'COMPLETED' },
      occurred_at: '2026-01-03T00:00:00Z',
    },
    {
      space_id: spaceId,
      trial_id: trialId,
      source: 'source_import',
      event_type: 'phase_transitioned',
      payload: { from: 'PHASE2', to: 'PHASE3' },
      occurred_at: '2026-01-04T00:00:00Z',
    },
    {
      // The visible Change text (drug name) lives ONLY in the payload -- the
      // RPC title for this type is just "Intervention Changed". Search must
      // reach payload content so a query for what the user SEES matches.
      space_id: spaceId,
      trial_id: trialId,
      source: 'ctgov',
      event_type: 'intervention_changed',
      payload: { added: [{ name: 'Tirzepatide 15mg', type: 'Experimental' }] },
      occurred_at: '2026-01-05T00:00:00Z',
    },
  ]);
  if (ceErr) throw new Error(`insert change events: ${ceErr.message}`);
}, 120_000);

afterAll(async () => {
  if (agencyCleanup) await agencyCleanup();
});

async function listDetected(params: {
  sources?: string[];
  types?: string[];
  search?: string;
}): Promise<DetectedRow[]> {
  const { data, error } = await svc.rpc('get_events_page_data', {
    p_space_id: spaceId,
    p_source_type: 'detected',
    p_change_sources: params.sources ?? null,
    p_change_event_types: params.types ?? null,
    p_search: params.search ?? null,
    p_limit: 50,
    p_offset: 0,
  });
  if (error) throw new Error(`get_events_page_data: ${error.message}`);
  const result = data as { items: DetectedRow[] };
  return result.items.map((r) => ({
    change_source: r.change_source,
    change_event_type: r.change_event_type,
  }));
}

describe('get_events_page_data change-source / change-type filters', () => {
  it('returns all five detected rows when unfiltered', async () => {
    expect(await listDetected({})).toHaveLength(5);
  });

  it('filters by a single source', async () => {
    const rows = await listDetected({ sources: ['ctgov'] });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.change_source === 'ctgov')).toBe(true);
  });

  it('filters by multiple sources', async () => {
    const rows = await listDetected({ sources: ['analyst', 'source_import'] });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.change_source).sort()).toEqual(['analyst', 'source_import']);
  });

  it('filters by a single change type', async () => {
    const rows = await listDetected({ types: ['status_changed'] });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.change_event_type === 'status_changed')).toBe(true);
  });

  it('composes source AND type filters', async () => {
    const rows = await listDetected({ sources: ['ctgov'], types: ['status_changed'] });
    expect(rows).toEqual([{ change_source: 'ctgov', change_event_type: 'status_changed' }]);
  });

  it('treats an empty-array filter as no narrowing', async () => {
    // The RPC normalizes '{}' -> null, so an empty array must not exclude rows.
    expect(await listDetected({ sources: [] })).toHaveLength(5);
  });

  it('search matches text that lives only in the change payload (drug name)', async () => {
    // "Tirzepatide" appears only in the intervention_changed payload, not in the
    // RPC-composed title -- but it IS what the Change column renders. Search must
    // reach it, else querying for what the user sees returns nothing.
    const rows = await listDetected({ search: 'tirz' });
    expect(rows).toEqual([{ change_source: 'ctgov', change_event_type: 'intervention_changed' }]);
  });
});
