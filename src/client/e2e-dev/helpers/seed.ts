/**
 * Lean fixture seeding via the real create_* RPCs (owner identity). Real DB
 * writes into the scratch space; everything is torn down with the world.
 *
 * seedBasics() creates one company -> asset -> Phase 3 trial and a clinical
 * event on the trial, enough to make the timeline, bullseye, heatmap, profiles
 * and intelligence surfaces render populated instead of empty.
 */
import { apiAs, type ScratchWorld } from './scratch-world';

/** create_* RPCs variously return a bare uuid, a row {id}, or [{id}]. */
function idOf(data: unknown): string {
  if (typeof data === 'string') return data;
  const row = Array.isArray(data) ? data[0] : data;
  const id = (row as { id?: string } | null)?.id;
  if (!id) throw new Error(`expected an id in RPC result, got: ${JSON.stringify(data)}`);
  return id;
}

export interface SeedIds {
  companyId: string;
  assetId: string;
  trialId: string;
  eventId: string;
  companyName: string;
  assetName: string;
  trialName: string;
}

export async function seedBasics(world: ScratchWorld): Promise<SeedIds> {
  const api = apiAs(world, 'owner');
  const companyName = `Acme Pharma ${world.id}`;
  const assetName = `AcmeMab ${world.id}`;
  const trialName = `ACME-301 ${world.id}`;

  const company = await api.rpc('create_company', {
    p_space_id: world.spaceId,
    p_name: companyName,
  });
  if (company.error) throw new Error(`seed create_company: ${company.error.message}`);
  const companyId = idOf(company.data);

  const asset = await api.rpc('create_asset', {
    p_space_id: world.spaceId,
    p_company_id: companyId,
    p_name: assetName,
    p_generic_name: 'acmemab',
    p_moa_names: ['GLP-1 receptor agonist'],
    p_roa_names: ['Subcutaneous'],
  });
  if (asset.error) throw new Error(`seed create_asset: ${asset.error.message}`);
  const assetId = idOf(asset.data);

  const trial = await api.rpc('create_trial', {
    p_space_id: world.spaceId,
    p_asset_id: assetId,
    p_name: trialName,
    p_identifier: 'NCT09999999',
    p_status: 'Recruiting',
    p_phase_type: 'P3',
    p_phase_start_date: '2024-01-01',
    p_phase_end_date: '2026-12-31',
    p_indication_name: 'Obesity',
  });
  if (trial.error) throw new Error(`seed create_trial: ${trial.error.message}`);
  const trialId = idOf(trial.data);

  // clinical event on the trial (look the system event type up by name)
  const ty = await api
    .from('event_types')
    .select('id')
    .eq('name', 'Topline Data')
    .is('space_id', null)
    .single();
  if (ty.error) throw new Error(`seed event_type lookup: ${ty.error.message}`);

  const event = await api.rpc('create_event', {
    p_space_id: world.spaceId,
    p_event_type_id: idOf(ty.data),
    p_title: 'Topline readout',
    p_event_date: '2025-06-01',
    p_anchor_type: 'trial',
    p_anchor_id: trialId,
  });
  if (event.error) throw new Error(`seed create_event: ${event.error.message}`);
  const eventId = idOf(event.data);

  return { companyId, assetId, trialId, eventId, companyName, assetName, trialName };
}

/**
 * Seed the "unreflected approval" state for the bullseye/asset-profile stage-lift
 * diagnostic (issue #159): a P3-trial asset (status rank 3) that ALSO carries an
 * actual, asset-anchored Approval event with NO indication mapped. Because the
 * approval has no indication_id, `_recompute_asset_indication_status` cannot lift
 * the asset past P3, so `get_bullseye_*` flags `has_unreflected_approval = true`
 * and both the asset profile and the bullseye side panel render the amber
 * "approval not reflected in stage" diagnostic. Reuses seedBasics for the asset.
 */
export async function seedUnreflectedApproval(world: ScratchWorld): Promise<SeedIds> {
  const api = apiAs(world, 'owner');
  const ids = await seedBasics(world);

  const approvalTy = await api
    .from('event_types')
    .select('id')
    .eq('name', 'Approval')
    .is('space_id', null)
    .single();
  if (approvalTy.error) throw new Error(`seed Approval type lookup: ${approvalTy.error.message}`);

  const approval = await api.rpc('create_event', {
    p_space_id: world.spaceId,
    p_event_type_id: idOf(approvalTy.data),
    p_title: 'FDA approval (indication unmapped)',
    p_event_date: '2025-12-01',
    p_anchor_type: 'asset',
    p_anchor_id: ids.assetId,
    p_projection: 'actual',
    p_indication_id: null,
  });
  if (approval.error) throw new Error(`seed approval create_event: ${approval.error.message}`);

  return ids;
}
