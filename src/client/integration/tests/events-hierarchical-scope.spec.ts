/**
 * events-hierarchical-scope.spec.ts
 *
 * Verifies that get_events_page_data rolls up events through trial -> asset
 * -> company when scoped at product or company level. Trial-scope queries
 * remain direct-match only. Markers half is unchanged.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPersonas, Personas, adminClient } from '../fixtures/personas';
import { createScratchAgency } from '../fixtures/scratch';
import { SupabaseClient } from '@supabase/supabase-js';

// 'Leadership Change' system event_type (seeded by the event_types migration).
const LEADERSHIP_TYPE_ID = 'a0000000-0000-0000-0000-000000000050';

let p: Personas;
let svc: SupabaseClient;
let spaceId: string;
let companyId: string;
let assetId: string;
let trialId: string;
let agencyCleanup: () => Promise<void>;

beforeAll(async () => {
  p = await buildPersonas();
  svc = adminClient();

  // Create a scratch agency + tenant + space.
  const scratch = await createScratchAgency(p);
  spaceId = scratch.spaceId;
  agencyCleanup = scratch.cleanup;

  // Use the tenant_owner persona as the creator for seeded entities.
  const createdBy = p.ids.tenant_owner;

  // Seed: 1 company > 1 asset > 1 trial.
  const { data: company, error: companyErr } = await svc
    .from('companies')
    .insert({ space_id: spaceId, name: 'Co1', created_by: createdBy })
    .select('id')
    .single();
  if (companyErr) throw new Error(`insert company: ${companyErr.message}`);
  companyId = company!.id;

  const { data: asset, error: assetErr } = await svc
    .from('assets')
    .insert({
      space_id: spaceId,
      company_id: companyId,
      name: 'Prod1',
      created_by: createdBy,
    })
    .select('id')
    .single();
  if (assetErr) throw new Error(`insert asset: ${assetErr.message}`);
  assetId = asset!.id;

  const { data: trial, error: trialErr } = await svc
    .from('trials')
    .insert({
      space_id: spaceId,
      asset_id: assetId,
      name: 'Trial1',
      created_by: createdBy,
    })
    .select('id')
    .single();
  if (trialErr) throw new Error(`insert trial: ${trialErr.message}`);
  trialId = trial!.id;

  // Seed one event at each entity level using the unified events shape
  // (event_type_id + anchor_type/anchor_id). These are service-role inserts,
  // which bypass trg_events_set_created_by's auth.uid(), so created_by is set
  // explicitly.
  const { error: evErr } = await svc.from('events').insert([
    {
      space_id: spaceId,
      event_type_id: LEADERSHIP_TYPE_ID,
      anchor_type: 'company',
      anchor_id: companyId,
      title: 'Company event',
      event_date: '2026-01-01',
      created_by: createdBy,
    },
    {
      space_id: spaceId,
      event_type_id: LEADERSHIP_TYPE_ID,
      anchor_type: 'asset',
      anchor_id: assetId,
      title: 'Product event',
      event_date: '2026-01-02',
      created_by: createdBy,
    },
    {
      space_id: spaceId,
      event_type_id: LEADERSHIP_TYPE_ID,
      anchor_type: 'trial',
      anchor_id: trialId,
      title: 'Trial event',
      event_date: '2026-01-03',
      created_by: createdBy,
    },
  ]);
  if (evErr) throw new Error(`insert events: ${evErr.message}`);
}, 120_000);

afterAll(async () => {
  if (agencyCleanup) await agencyCleanup();
});

async function listEventsScopedTo(
  level: 'trial' | 'product' | 'company',
  id: string,
): Promise<string[]> {
  const { data, error } = await svc.rpc('get_events_page_data', {
    p_space_id: spaceId,
    p_entity_level: level,
    p_entity_id: id,
    p_source_type: 'event',
    p_limit: 50,
    p_offset: 0,
  });
  if (error) throw new Error(`get_events_page_data(${level}): ${error.message}`);
  const result = data as { items: { title: string }[]; total: number };
  return result.items.map((r) => r.title).sort();
}

describe('get_events_page_data hierarchical scope', () => {
  it('trial scope returns only the trial-level event (no rollup needed)', async () => {
    expect(await listEventsScopedTo('trial', trialId)).toEqual(['Trial event']);
  });

  it('product scope returns the product-level event PLUS the trial event under it', async () => {
    expect(await listEventsScopedTo('product', assetId)).toEqual(
      ['Product event', 'Trial event'].sort(),
    );
  });

  it('company scope returns every event under the company subtree', async () => {
    expect(await listEventsScopedTo('company', companyId)).toEqual(
      ['Company event', 'Product event', 'Trial event'].sort(),
    );
  });

  it('product scope does not leak events on a sibling product', async () => {
    // Create a second asset under the same company with its own event.
    const { data: p2, error: p2Err } = await svc
      .from('assets')
      .insert({
        space_id: spaceId,
        company_id: companyId,
        name: 'Prod2',
        created_by: p.ids.tenant_owner,
      })
      .select('id')
      .single();
    if (p2Err) throw new Error(`insert sibling asset: ${p2Err.message}`);

    const { error: sibEvErr } = await svc.from('events').insert({
      space_id: spaceId,
      event_type_id: LEADERSHIP_TYPE_ID,
      anchor_type: 'asset',
      anchor_id: p2!.id,
      title: 'Sibling event',
      event_date: '2026-01-04',
      created_by: p.ids.tenant_owner,
    });
    if (sibEvErr) throw new Error(`insert sibling event: ${sibEvErr.message}`);

    // Original product scope must NOT include the sibling's event.
    expect(await listEventsScopedTo('product', assetId)).toEqual(
      ['Product event', 'Trial event'].sort(),
    );
  });
});
