/**
 * Integration coverage for the per-space "track preclinical" setting.
 *
 * Proves the server-side enforcement end to end against local Supabase:
 *  - spaces.show_preclinical defaults false and the analytic RPCs read it via
 *    space_shows_preclinical(), so preclinical records are excluded when off and
 *    reappear when on.
 *  - the trial-list PostgREST filter (.or phase_type null/neq PRECLIN) drops
 *    preclinical trials while keeping null-phase rows.
 *  - update_space_show_preclinical is owner-only (editors/viewers/anon get 42501).
 *
 * Seeds a controlled dataset (one indication, a PRECLIN-only asset + a P2 asset,
 * a PRECLIN trial + a P2 trial) via the service-role client. The _set_created_by
 * trigger coalesces auth.uid() with the provided created_by, so passing the space
 * owner's id satisfies the audit columns under service role.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectCode, expectOk } from '../harness/as';

let p: Personas;
let svc: SupabaseClient;
let space: string;
let companyId: string;
let indicationId: string;
let assetPreId: string;
let assetP2Id: string;
let preclinTrialId: string;
let p2TrialId: string;

async function insertOne(
  table: string,
  row: Record<string, unknown>
): Promise<string> {
  const { data } = await svc.from(table).insert(row).select('id').single().throwOnError();
  return (data as { id: string }).id;
}

function landscapeRowForIndication(data: unknown): { product_count: number; highest_phase_present: number } | undefined {
  return (data as { entity: { id: string }; product_count: number; highest_phase_present: number }[]).find(
    (r) => r.entity?.id === indicationId
  );
}

beforeAll(async () => {
  p = await buildPersonas();
  svc = adminClient();
  space = p.org.spaceId;
  const owner = p.ids.space_owner;
  const suffix = Date.now();

  companyId = await insertOne('companies', {
    space_id: space,
    name: `Preclin Co ${suffix}`,
    created_by: owner,
  });
  indicationId = await insertOne('indications', {
    space_id: space,
    name: `Preclin Indication ${suffix}`,
    created_by: owner,
  });
  assetPreId = await insertOne('assets', {
    space_id: space,
    company_id: companyId,
    name: `Asset PRECLIN ${suffix}`,
    created_by: owner,
  });
  assetP2Id = await insertOne('assets', {
    space_id: space,
    company_id: companyId,
    name: `Asset P2 ${suffix}`,
    created_by: owner,
  });
  // Insert trials FIRST. The AFTER-INSERT trg_auto_derive_asset_indication on
  // trials recomputes asset_indications.development_status from trial->condition
  // ->indication mappings; our trials carry no conditions, so deriving runs on an
  // empty state here. Seeding asset_indications afterward keeps our explicit
  // development_status (nothing re-derives it).
  preclinTrialId = await insertOne('trials', {
    space_id: space,
    asset_id: assetPreId,
    name: `Trial PRECLIN ${suffix}`,
    phase_type: 'PRECLIN',
    created_by: owner,
  });
  p2TrialId = await insertOne('trials', {
    space_id: space,
    asset_id: assetP2Id,
    name: `Trial P2 ${suffix}`,
    phase_type: 'P2',
    created_by: owner,
  });
  await svc
    .from('asset_indications')
    .insert([
      { space_id: space, asset_id: assetPreId, indication_id: indicationId, development_status: 'PRECLIN', created_by: owner },
      { space_id: space, asset_id: assetP2Id, indication_id: indicationId, development_status: 'P2', created_by: owner },
    ])
    .throwOnError();

  // Start from the default (off) regardless of prior runs against this space.
  await svc.from('spaces').update({ show_preclinical: false }).eq('id', space).throwOnError();
}, 120_000);

afterAll(async () => {
  // Best-effort teardown so reruns against a reused space stay clean.
  await svc.from('trials').delete().in('id', [preclinTrialId, p2TrialId]);
  await svc.from('asset_indications').delete().eq('indication_id', indicationId);
  await svc.from('assets').delete().in('id', [assetPreId, assetP2Id]);
  await svc.from('indications').delete().eq('id', indicationId);
  await svc.from('companies').delete().eq('id', companyId);
  await svc.from('spaces').update({ show_preclinical: false }).eq('id', space);
});

describe('analytic RPCs exclude preclinical when the space does not track it (default)', () => {
  it('get_landscape_index: preclinical asset is not counted and does not set the highest phase', async () => {
    const data = expectOk(await as(p, 'space_owner').rpc('get_landscape_index', { p_space_id: space }));
    const row = landscapeRowForIndication(data);
    expect(row).toBeTruthy();
    expect(row?.product_count).toBe(1); // only the P2 asset
    expect(row?.highest_phase_present).toBe(2); // P2 rank; PRECLIN (0) excluded
  });

  it('get_bullseye_assets: the preclinical-only asset drops out entirely', async () => {
    const data = expectOk(
      await as(p, 'space_owner').rpc('get_bullseye_assets', {
        p_space_id: space,
        p_indication_ids: [indicationId],
      })
    ) as { assets: { id: string }[] };
    const ids = (data.assets ?? []).map((a) => a.id);
    expect(ids).toContain(assetP2Id);
    expect(ids).not.toContain(assetPreId);
  });

  it('trial-list .or filter: preclinical trial excluded, others kept', async () => {
    const data = expectOk(
      await as(p, 'space_owner')
        .from('trials')
        .select('id, phase_type')
        .eq('space_id', space)
        .or('phase_type.is.null,phase_type.neq.PRECLIN')
    ) as { id: string }[];
    const ids = data.map((t) => t.id);
    expect(ids).toContain(p2TrialId);
    expect(ids).not.toContain(preclinTrialId);
  });
});

describe('enabling the setting brings preclinical records back', () => {
  it('owner enables it and the preclinical asset reappears in the analytic RPCs', async () => {
    expectOk(
      await as(p, 'space_owner').rpc('update_space_show_preclinical', { p_space_id: space, p_show: true })
    );

    const idx = landscapeRowForIndication(
      expectOk(await as(p, 'space_owner').rpc('get_landscape_index', { p_space_id: space }))
    );
    expect(idx?.product_count).toBe(2); // both assets now counted

    const ba = expectOk(
      await as(p, 'space_owner').rpc('get_bullseye_assets', {
        p_space_id: space,
        p_indication_ids: [indicationId],
      })
    ) as { assets: { id: string }[] };
    expect(ba.assets.map((a) => a.id)).toContain(assetPreId);

    // Reset to the default so later assertions/reruns are not contaminated.
    expectOk(
      await as(p, 'space_owner').rpc('update_space_show_preclinical', { p_space_id: space, p_show: false })
    );
  });
});

describe('update_space_show_preclinical is owner-only', () => {
  it('viewer is rejected with 42501', async () => {
    expectCode(
      await as(p, 'reader').rpc('update_space_show_preclinical', { p_space_id: space, p_show: true }),
      '42501'
    );
  });

  it('editor is rejected with 42501 (owner-only, not editor)', async () => {
    expectCode(
      await as(p, 'contributor').rpc('update_space_show_preclinical', { p_space_id: space, p_show: true }),
      '42501'
    );
  });

  it('anon is rejected', async () => {
    const r = await as(p, 'anon').rpc('update_space_show_preclinical', { p_space_id: space, p_show: true });
    if (!r.error) throw new Error('expected anon to be rejected');
  });
});
