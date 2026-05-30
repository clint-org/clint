// Pure review-decision logic for the import-review grouped grid.
// No Angular imports: unit-tested via vitest (npm run test:units).

export type EntityState = 'new' | 'existing';
export type FlagTier = 'blocking' | 'attention' | 'info';

export interface ReviewFlag {
  id: string;
  tier: FlagTier;
  label: string;
}

type Entity = Record<string, unknown>;

export function entityState(entity: Entity): EntityState {
  return entity['match'] || entity['existing_id'] ? 'existing' : 'new';
}

function trialMissingAsset(trial: Entity): boolean {
  return trial['asset_ref'] == null && trial['existing_id'] == null && trial['asset_match'] == null;
}

function isObservational(trial: Entity): boolean {
  const t = String(trial['study_type'] ?? '').toLowerCase();
  return t.includes('observational');
}

export function deriveTrialFlags(trial: Entity): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  if (trialMissingAsset(trial)) {
    flags.push({ id: 'no-asset', tier: 'blocking', label: 'No asset' });
  }
  if (!trial['indication']) {
    flags.push({ id: 'no-indication', tier: 'attention', label: 'No indication' });
  }
  if (isObservational(trial)) {
    flags.push({ id: 'observational', tier: 'attention', label: 'Observational' });
  }
  if (!trial['phase'] || !trial['status']) {
    flags.push({ id: 'missing-phase-status', tier: 'attention', label: 'Missing phase/status' });
  }
  return flags;
}

export function deriveAssetFlags(asset: Entity): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  const moa = asset['moa'];
  const roa = asset['roa'];
  const empty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
  if (empty(moa) && empty(roa)) {
    flags.push({ id: 'no-moa-roa', tier: 'attention', label: 'No MOA/ROA' });
  }
  return flags;
}
