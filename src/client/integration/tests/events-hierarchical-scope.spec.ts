/**
 * events-hierarchical-scope.spec.ts
 *
 * Verifies that get_events_page_data rolls up events through trial -> product
 * -> company when scoped at product or company level. Trial-scope queries
 * remain direct-match only. Markers half is unchanged.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPersonas, Personas, adminClient } from '../fixtures/personas';
import { createScratchAgency } from '../fixtures/scratch';
import { SupabaseClient } from '@supabase/supabase-js';

let p: Personas;
let svc: SupabaseClient;
let spaceId: string;
let companyId: string;
let productId: string;
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

  // Seed: 1 company > 1 product > 1 trial.
  const { data: company, error: companyErr } = await svc
    .from('companies')
    .insert({ space_id: spaceId, name: 'Co1', created_by: createdBy })
    .select('id')
    .single();
  if (companyErr) throw new Error(`insert company: ${companyErr.message}`);
  companyId = company!.id;

  const { data: product, error: productErr } = await svc
    .from('products')
    .insert({
      space_id: spaceId,
      company_id: companyId,
      name: 'Prod1',
      created_by: createdBy,
    })
    .select('id')
    .single();
  if (productErr) throw new Error(`insert product: ${productErr.message}`);
  productId = product!.id;

  // Trials require a therapeutic area.
  const { data: ta, error: taErr } = await svc
    .from('therapeutic_areas')
    .insert({ space_id: spaceId, name: 'Test TA', created_by: createdBy })
    .select('id')
    .single();
  if (taErr) throw new Error(`insert therapeutic_area: ${taErr.message}`);

  const { data: trial, error: trialErr } = await svc
    .from('trials')
    .insert({
      space_id: spaceId,
      product_id: productId,
      therapeutic_area_id: ta!.id,
      name: 'Trial1',
      created_by: createdBy,
    })
    .select('id')
    .single();
  if (trialErr) throw new Error(`insert trial: ${trialErr.message}`);
  trialId = trial!.id;

  // Pick any system event_category.
  const { data: categoryRow, error: catErr } = await svc
    .from('event_categories')
    .select('id')
    .limit(1)
    .single();
  if (catErr) throw new Error(`fetch event_categories: ${catErr.message}`);
  const categoryId = categoryRow!.id;

  // Seed one event at each entity level.
  const { error: evErr } = await svc.from('events').insert([
    {
      space_id: spaceId,
      company_id: companyId,
      category_id: categoryId,
      title: 'Company event',
      event_date: '2026-01-01',
    },
    {
      space_id: spaceId,
      product_id: productId,
      category_id: categoryId,
      title: 'Product event',
      event_date: '2026-01-02',
    },
    {
      space_id: spaceId,
      trial_id: trialId,
      category_id: categoryId,
      title: 'Trial event',
      event_date: '2026-01-03',
    },
  ]);
  if (evErr) throw new Error(`insert events: ${evErr.message}`);
}, 60_000);

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
  return (data as Array<{ title: string }>).map((r) => r.title).sort();
}

describe('get_events_page_data hierarchical scope', () => {
  it('trial scope returns only the trial-level event (no rollup needed)', async () => {
    expect(await listEventsScopedTo('trial', trialId)).toEqual(['Trial event']);
  });

  it('product scope returns the product-level event PLUS the trial event under it', async () => {
    expect(await listEventsScopedTo('product', productId)).toEqual(
      ['Product event', 'Trial event'].sort(),
    );
  });

  it('company scope returns every event under the company subtree', async () => {
    expect(await listEventsScopedTo('company', companyId)).toEqual(
      ['Company event', 'Product event', 'Trial event'].sort(),
    );
  });

  it('product scope does not leak events on a sibling product', async () => {
    // Create a second product under the same company with its own event.
    const { data: p2, error: p2Err } = await svc
      .from('products')
      .insert({
        space_id: spaceId,
        company_id: companyId,
        name: 'Prod2',
        created_by: p.ids.tenant_owner,
      })
      .select('id')
      .single();
    if (p2Err) throw new Error(`insert sibling product: ${p2Err.message}`);

    const { data: catRow, error: catErr } = await svc
      .from('event_categories')
      .select('id')
      .limit(1)
      .single();
    if (catErr) throw new Error(`fetch event_categories: ${catErr.message}`);

    const { error: sibEvErr } = await svc.from('events').insert({
      space_id: spaceId,
      product_id: p2!.id,
      category_id: catRow!.id,
      title: 'Sibling event',
      event_date: '2026-01-04',
    });
    if (sibEvErr) throw new Error(`insert sibling event: ${sibEvErr.message}`);

    // Original product scope must NOT include the sibling's event.
    expect(await listEventsScopedTo('product', productId)).toEqual(
      ['Product event', 'Trial event'].sort(),
    );
  });
});
