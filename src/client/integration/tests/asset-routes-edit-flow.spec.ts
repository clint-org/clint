/**
 * Asset-routes edit flow against real Supabase.
 *
 * Sibling spec to asset-mechanisms-edit-flow.spec.ts. Locks in the contract
 * for update_asset_routes (migration 20260528130300), which replaces
 * AssetService.setRoutes()'s DELETE-then-INSERT with an atomic
 * insert-then-prune RPC.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectCode, expectOk } from '../harness/as';

let p: Personas;
let admin: SupabaseClient;
let companyId: string;

const assetIds: string[] = [];
const roaIds: string[] = [];

beforeAll(async () => {
  p = await buildPersonas();
  admin = adminClient();

  const { data: co } = await admin
    .from('companies')
    .insert({
      space_id: p.org.spaceId,
      name: 'Asset ROA Co',
      created_by: p.ids.contributor,
    })
    .select('id')
    .single();
  companyId = co!.id as string;
}, 120_000);

afterAll(async () => {
  if (assetIds.length > 0) await admin.from('assets').delete().in('id', assetIds);
  if (roaIds.length > 0) await admin.from('routes_of_administration').delete().in('id', roaIds);
  if (companyId) await admin.from('companies').delete().eq('id', companyId);
});

async function createAsset(name: string): Promise<string> {
  const { data, error } = await admin
    .from('assets')
    .insert({
      space_id: p.org.spaceId,
      company_id: companyId,
      name,
      created_by: p.ids.contributor,
    })
    .select('id')
    .single();
  if (error) throw new Error(`createAsset: ${error.message}`);
  const id = data!.id as string;
  assetIds.push(id);
  return id;
}

async function createRoa(name: string): Promise<string> {
  const { data, error } = await admin
    .from('routes_of_administration')
    .insert({
      space_id: p.org.spaceId,
      name,
      created_by: p.ids.contributor,
    })
    .select('id')
    .single();
  if (error) throw new Error(`createRoa: ${error.message}`);
  const id = data!.id as string;
  roaIds.push(id);
  return id;
}

async function seedAssignment(assetId: string, roaId: string): Promise<void> {
  const { error } = await admin
    .from('asset_routes_of_administration')
    .insert({ asset_id: assetId, roa_id: roaId });
  if (error) throw new Error(`seedAssignment: ${error.message}`);
}

async function readRoaIds(assetId: string): Promise<string[]> {
  const { data } = await admin
    .from('asset_routes_of_administration')
    .select('roa_id')
    .eq('asset_id', assetId);
  return ((data ?? []) as { roa_id: string }[]).map((r) => r.roa_id).sort();
}

describe('update_asset_routes RPC', () => {
  it('swaps the sole ROA assignment', async () => {
    const asset = await createAsset('roa-swap');
    const roaA = await createRoa('roa-swap-a');
    const roaB = await createRoa('roa-swap-b');
    await seedAssignment(asset, roaA);

    const r = await as(p, 'contributor').rpc('update_asset_routes', {
      p_asset_id: asset,
      p_roa_ids: [roaB],
    });
    expectOk(r);

    expect(await readRoaIds(asset)).toEqual([roaB].sort());
  });

  it('handles add/remove diffs', async () => {
    const asset = await createAsset('roa-diff');
    const roaA = await createRoa('roa-diff-a');
    const roaB = await createRoa('roa-diff-b');
    const roaC = await createRoa('roa-diff-c');
    await seedAssignment(asset, roaA);
    await seedAssignment(asset, roaB);

    const r = await as(p, 'contributor').rpc('update_asset_routes', {
      p_asset_id: asset,
      p_roa_ids: [roaB, roaC],
    });
    expectOk(r);

    expect(await readRoaIds(asset)).toEqual([roaB, roaC].sort());
  });

  it('is idempotent', async () => {
    const asset = await createAsset('roa-idemp');
    const roaA = await createRoa('roa-idemp-a');
    await seedAssignment(asset, roaA);

    const r = await as(p, 'contributor').rpc('update_asset_routes', {
      p_asset_id: asset,
      p_roa_ids: [roaA],
    });
    expectOk(r);

    expect(await readRoaIds(asset)).toEqual([roaA]);
  });

  it('accepts empty as clear-all and leaves the asset intact', async () => {
    const asset = await createAsset('roa-clear');
    const roaA = await createRoa('roa-clear-a');
    await seedAssignment(asset, roaA);

    const r = await as(p, 'contributor').rpc('update_asset_routes', {
      p_asset_id: asset,
      p_roa_ids: [],
    });
    expectOk(r);

    expect(await readRoaIds(asset)).toEqual([]);
    const { data: a } = await admin.from('assets').select('id').eq('id', asset).maybeSingle();
    expect(a?.id).toBe(asset);
  });

  it('rejects a viewer with 42501 and leaves assignments intact', async () => {
    const asset = await createAsset('roa-viewer');
    const roaA = await createRoa('roa-viewer-a');
    const roaB = await createRoa('roa-viewer-b');
    await seedAssignment(asset, roaA);

    const r = await as(p, 'reader').rpc('update_asset_routes', {
      p_asset_id: asset,
      p_roa_ids: [roaB],
    });
    expectCode(r, '42501');

    expect(await readRoaIds(asset)).toEqual([roaA]);
  });
});
