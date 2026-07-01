/**
 * Lean fixture seeding via the real create_* RPCs (owner identity). Real DB
 * writes into the scratch space; everything is torn down with the world.
 *
 * seedBasics() creates one company -> asset -> Phase 3 trial and a clinical
 * event on the trial, enough to make the timeline, bullseye, heatmap, profiles
 * and intelligence surfaces render populated instead of empty.
 */
import { Client as PgClient } from 'pg';
import { apiAs, type ScratchWorld } from './scratch-world';
import { requirePoolerUrl } from './dev-env';

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

/**
 * Seed a single asset that spans two indications at DIFFERENT development stages
 * (issue #171): "Obesity" stays at P3 (from seedBasics' P3 trial) while a second
 * indication is lifted to APPROVED by an actual asset-anchored approval mapped to
 * it. In the by-indication bullseye the asset must then plot at P3 on one spoke
 * and APPROVED on the other -- before the fix it plotted at APPROVED (its max) on
 * both. Returns the seed ids plus the two indication ids/names.
 */
export interface DivergentSeedIds extends SeedIds {
  p3IndicationName: string;
  approvedIndicationId: string;
  approvedIndicationName: string;
}

export async function seedDivergentIndicationStatus(
  world: ScratchWorld,
): Promise<DivergentSeedIds> {
  const api = apiAs(world, 'owner');
  const ids = await seedBasics(world); // asset + P3 trial on "Obesity"
  const approvedIndicationName = `Severe HTG ${world.id}`;

  // A low-phase trial creates the second indication record (P1); the approval
  // below then lifts THAT indication to APPROVED, leaving "Obesity" at P3.
  const trialB = await api.rpc('create_trial', {
    p_space_id: world.spaceId,
    p_asset_id: ids.assetId,
    p_name: `ACME-IND-B ${world.id}`,
    p_identifier: 'NCT09999998',
    p_status: 'Recruiting',
    p_phase_type: 'P1',
    p_phase_start_date: '2024-01-01',
    p_phase_end_date: '2026-12-31',
    p_indication_name: approvedIndicationName,
  });
  if (trialB.error) throw new Error(`seed trial B: ${trialB.error.message}`);

  const indB = await api
    .from('indications')
    .select('id')
    .eq('space_id', world.spaceId)
    .eq('name', approvedIndicationName)
    .single();
  if (indB.error) throw new Error(`seed indication B lookup: ${indB.error.message}`);
  const approvedIndicationId = idOf(indB.data);

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
    p_title: `FDA approval (${approvedIndicationName})`,
    p_event_date: '2025-12-01',
    p_anchor_type: 'asset',
    p_anchor_id: ids.assetId,
    p_projection: 'actual',
    p_indication_id: approvedIndicationId,
  });
  if (approval.error) throw new Error(`seed approval create_event: ${approval.error.message}`);

  return {
    ...ids,
    p3IndicationName: 'Obesity',
    approvedIndicationId,
    approvedIndicationName,
  };
}

/**
 * Seed the Activity log (#192): a company -> asset -> trial plus a spread of
 * detected trial_change_events across every source (CT.gov / analyst / import)
 * and several change types, so the Activity page's Source and Type column
 * filters have something to narrow. trial_change_events has no create_* RPC and
 * its RLS exposes SELECT only, so the rows are inserted directly via the pooler.
 */
export async function seedActivityDetectedChanges(world: ScratchWorld): Promise<SeedIds> {
  const ids = await seedBasics(world);

  // Known spread so filter assertions are deterministic: 3 CT.gov / 2 analyst /
  // 1 import; 2 status_changed; and one intervention_changed whose drug name
  // lives ONLY in the payload (exercises the payload-search fix).
  const rows: { source: string; type: string; payload: Record<string, unknown>; day: string }[] = [
    { source: 'ctgov', type: 'status_changed', payload: { from: 'RECRUITING', to: 'ACTIVE_NOT_RECRUITING' }, day: '2026-02-01' },
    { source: 'ctgov', type: 'date_moved', payload: { which_date: 'primary_completion', direction: 'delay', days_diff: '120' }, day: '2026-02-05' },
    { source: 'ctgov', type: 'intervention_changed', payload: { added: [{ name: 'Tirzepatide 15mg', type: 'Experimental' }] }, day: '2026-02-09' },
    { source: 'analyst', type: 'status_changed', payload: { from: 'ACTIVE_NOT_RECRUITING', to: 'COMPLETED' }, day: '2026-02-12' },
    { source: 'analyst', type: 'phase_transitioned', payload: { from: 'PHASE2', to: 'PHASE3' }, day: '2026-02-15' },
    { source: 'source_import', type: 'enrollment_target_changed', payload: { from: '400', to: '650' }, day: '2026-02-18' },
  ];

  const pg = new PgClient({ connectionString: requirePoolerUrl() });
  await pg.connect();
  try {
    for (const r of rows) {
      await pg.query(
        `insert into public.trial_change_events
           (space_id, trial_id, source, event_type, payload, occurred_at, observed_at)
         values ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $6::timestamptz)`,
        [world.spaceId, ids.trialId, r.source, r.type, JSON.stringify(r.payload), `${r.day}T12:00:00Z`],
      );
    }
  } finally {
    await pg.end();
  }

  return ids;
}

export interface LogoCompany {
  companyId: string;
  assetId: string;
  companyName: string;
  logoUrl: string;
}

export interface SeedCompanyLogosResult {
  /** Correct-domain company (biogen.com): blank before the fix, real logo after. */
  biogen: LogoCompany;
  /** Wrong-domain company (arrowhead.com, from name-guessed import): blank before,
   *  lettermark after -- the residual data issue the domain correction addresses. */
  arrowhead: LogoCompany;
}

/**
 * Seed the issue-#194 repro: companies carrying a raw Brandfetch Logo Link URL
 * (`https://cdn.brandfetch.io/<domain>/symbol`) exactly as the importer stores
 * it. Each gets an asset + P3 Obesity trial so it plots on the bullseye and its
 * company tile renders in the asset detail panel. Rendered raw (pre-fix) the CDN
 * returns its blank hotlink-protection placeholder; routed through app-brand-logo
 * (post-fix) the client id + lettermark resolve a real logo (biogen.com) or a
 * clean lettermark (the wrong-domain arrowhead.com).
 */
export interface SeedCompanyLogosOptions {
  /**
   * When true, seed the *corrected* Brandfetch domains (the data half of the
   * #194 resolution): Arrowhead uses `arrowheadpharma.com/icon` instead of the
   * name-guessed `arrowhead.com`. Used for the "after" capture so the tile shows
   * the real logo. Default false reproduces the shipped-bad prod data.
   */
  fixDomains?: boolean;
}

export async function seedCompanyLogos(
  world: ScratchWorld,
  options: SeedCompanyLogosOptions = {}
): Promise<SeedCompanyLogosResult> {
  const api = apiAs(world, 'owner');
  const arrowheadLogo = options.fixDomains
    ? 'https://cdn.brandfetch.io/arrowheadpharma.com/icon'
    : 'https://cdn.brandfetch.io/arrowhead.com/symbol';

  async function makeCompanyWithAsset(
    name: string,
    logoUrl: string,
    assetName: string,
    genericName: string
  ): Promise<LogoCompany> {
    const company = await api.rpc('create_company', {
      p_space_id: world.spaceId,
      p_name: name,
      p_logo_url: logoUrl,
    });
    if (company.error) throw new Error(`seed create_company (${name}): ${company.error.message}`);
    const companyId = idOf(company.data);

    const asset = await api.rpc('create_asset', {
      p_space_id: world.spaceId,
      p_company_id: companyId,
      p_name: assetName,
      p_generic_name: genericName,
      p_moa_names: ['ANGPTL3 inhibitor'],
      p_roa_names: ['Subcutaneous'],
    });
    if (asset.error) throw new Error(`seed create_asset (${name}): ${asset.error.message}`);
    const assetId = idOf(asset.data);

    const trial = await api.rpc('create_trial', {
      p_space_id: world.spaceId,
      p_asset_id: assetId,
      p_name: `${assetName} P3 ${world.id}`,
      p_identifier: null,
      p_status: 'Recruiting',
      p_phase_type: 'P3',
      p_phase_start_date: '2024-01-01',
      p_phase_end_date: '2026-12-31',
      p_indication_name: 'Obesity',
    });
    if (trial.error) throw new Error(`seed create_trial (${name}): ${trial.error.message}`);

    return { companyId, assetId, companyName: name, logoUrl };
  }

  const biogen = await makeCompanyWithAsset(
    'Biogen',
    'https://cdn.brandfetch.io/biogen.com/symbol',
    `BIIB-ANG3 ${world.id}`,
    'biogen-ang3'
  );
  const arrowhead = await makeCompanyWithAsset(
    'Arrowhead Pharmaceuticals',
    arrowheadLogo,
    `ARO-ANG3 ${world.id}`,
    'aro-ang3'
  );

  return { biogen, arrowhead };
}
