/**
 * Asset-mechanisms edit flow against real Supabase.
 *
 * Locks in the user-facing contract for update_asset_mechanisms (migration
 * 20260528130200). The RPC replaces AssetService.setMechanisms()'s two-step
 * DELETE-then-INSERT against asset_mechanisms_of_action with a single
 * insert-then-prune transaction. Migration smoke covers the simulated-
 * trigger regression contract; this spec covers happy path + auth.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectCode, expectOk } from '../harness/as';

let p: Personas;
let admin: SupabaseClient;
let companyId: string;

const assetIds: string[] = [];
const moaIds: string[] = [];

beforeAll(async () => {
  p = await buildPersonas();
  admin = adminClient();

  const { data: co } = await admin
    .from('companies')
    .insert({
      space_id: p.org.spaceId,
      name: 'Asset MOA Co',
      created_by: p.ids.contributor,
    })
    .select('id')
    .single();
  companyId = co!.id as string;
}, 120_000);

afterAll(async () => {
  if (assetIds.length > 0) await admin.from('assets').delete().in('id', assetIds);
  if (moaIds.length > 0) await admin.from('mechanisms_of_action').delete().in('id', moaIds);
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

async function createMoa(name: string): Promise<string> {
  const { data, error } = await admin
    .from('mechanisms_of_action')
    .insert({
      space_id: p.org.spaceId,
      name,
      created_by: p.ids.contributor,
    })
    .select('id')
    .single();
  if (error) throw new Error(`createMoa: ${error.message}`);
  const id = data!.id as string;
  moaIds.push(id);
  return id;
}

async function seedAssignment(assetId: string, moaId: string): Promise<void> {
  const { error } = await admin
    .from('asset_mechanisms_of_action')
    .insert({ asset_id: assetId, moa_id: moaId });
  if (error) throw new Error(`seedAssignment: ${error.message}`);
}

async function readMoaIds(assetId: string): Promise<string[]> {
  const { data } = await admin
    .from('asset_mechanisms_of_action')
    .select('moa_id')
    .eq('asset_id', assetId);
  return ((data ?? []) as { moa_id: string }[]).map((r) => r.moa_id).sort();
}

describe('update_asset_mechanisms RPC', () => {
  it('swaps the sole MOA assignment', async () => {
    const asset = await createAsset('mech-swap');
    const moaA = await createMoa('mech-swap-a');
    const moaB = await createMoa('mech-swap-b');
    await seedAssignment(asset, moaA);

    const r = await as(p, 'contributor').rpc('update_asset_mechanisms', {
      p_asset_id: asset,
      p_moa_ids: [moaB],
    });
    expectOk(r);

    expect(await readMoaIds(asset)).toEqual([moaB].sort());
  });

  it('handles add/remove diffs', async () => {
    const asset = await createAsset('mech-diff');
    const moaA = await createMoa('mech-diff-a');
    const moaB = await createMoa('mech-diff-b');
    const moaC = await createMoa('mech-diff-c');
    await seedAssignment(asset, moaA);
    await seedAssignment(asset, moaB);

    const r = await as(p, 'contributor').rpc('update_asset_mechanisms', {
      p_asset_id: asset,
      p_moa_ids: [moaB, moaC],
    });
    expectOk(r);

    expect(await readMoaIds(asset)).toEqual([moaB, moaC].sort());
  });

  it('is idempotent', async () => {
    const asset = await createAsset('mech-idemp');
    const moaA = await createMoa('mech-idemp-a');
    await seedAssignment(asset, moaA);

    const r = await as(p, 'contributor').rpc('update_asset_mechanisms', {
      p_asset_id: asset,
      p_moa_ids: [moaA],
    });
    expectOk(r);

    expect(await readMoaIds(asset)).toEqual([moaA]);
  });

  it('accepts empty as clear-all and leaves the asset intact', async () => {
    const asset = await createAsset('mech-clear');
    const moaA = await createMoa('mech-clear-a');
    await seedAssignment(asset, moaA);

    const r = await as(p, 'contributor').rpc('update_asset_mechanisms', {
      p_asset_id: asset,
      p_moa_ids: [],
    });
    expectOk(r);

    expect(await readMoaIds(asset)).toEqual([]);
    const { data: a } = await admin.from('assets').select('id').eq('id', asset).maybeSingle();
    expect(a?.id).toBe(asset);
  });

  it('rejects a viewer with 42501 and leaves assignments intact', async () => {
    const asset = await createAsset('mech-viewer');
    const moaA = await createMoa('mech-viewer-a');
    const moaB = await createMoa('mech-viewer-b');
    await seedAssignment(asset, moaA);

    const r = await as(p, 'reader').rpc('update_asset_mechanisms', {
      p_asset_id: asset,
      p_moa_ids: [moaB],
    });
    expectCode(r, '42501');

    expect(await readMoaIds(asset)).toEqual([moaA]);
  });
});
