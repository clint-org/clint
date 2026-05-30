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

// The AI parser stamps every entity with a `match` object whose `kind` is
// 'new' or 'existing' (see ReviewPageComponent.isNew). An entity counts as
// existing only when match.kind === 'existing'; a bare existing_id is treated
// the same way. Note: `match` is ALWAYS a truthy object, so never test it for
// truthiness.
function isExistingMatch(entity: Entity): boolean {
  const match = entity['match'] as { kind?: string } | undefined;
  return match?.kind === 'existing' || entity['existing_id'] != null;
}

export function entityState(entity: Entity): EntityState {
  return isExistingMatch(entity) ? 'existing' : 'new';
}

// Mirrors ReviewPageComponent.trialMissingAsset: a trial that resolved to an
// existing record is never "missing an asset"; otherwise it must carry an
// asset_ref.
function trialMissingAsset(trial: Entity): boolean {
  if (isExistingMatch(trial)) return false;
  return trial['asset_ref'] == null;
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

export function duplicateTrialIndexes(trials: Entity[]): Set<number> {
  const seen = new Map<string, number[]>();
  trials.forEach((t, idx) => {
    const id = String(t['identifier'] ?? '').trim();
    if (!id) return;
    const arr = seen.get(id) ?? [];
    arr.push(idx);
    seen.set(id, arr);
  });
  const dupes = new Set<number>();
  for (const arr of seen.values()) {
    if (arr.length > 1) arr.forEach((i) => dupes.add(i));
  }
  return dupes;
}

export function deriveCtgovFlag(candidateCount: number): ReviewFlag | null {
  return candidateCount > 1
    ? { id: 'ctgov-pick', tier: 'attention', label: 'CT.gov: pick match' }
    : null;
}

export function deriveFuzzyFlag(alternateCount: number): ReviewFlag | null {
  return alternateCount > 0
    ? { id: 'fuzzy', tier: 'attention', label: 'Uncertain match' }
    : null;
}

export interface SelectionCounts {
  companies: number; assets: number; trials: number; markers: number; events: number;
}

const LABELS: Record<keyof SelectionCounts, [string, string]> = {
  companies: ['company', 'companies'],
  assets: ['asset', 'assets'],
  trials: ['trial', 'trials'],
  markers: ['marker', 'markers'],
  events: ['event', 'events'],
};

export function readableSummary(counts: SelectionCounts): string {
  const parts: string[] = [];
  (Object.keys(LABELS) as (keyof SelectionCounts)[]).forEach((k) => {
    const n = counts[k];
    if (n > 0) parts.push(`${n} ${n === 1 ? LABELS[k][0] : LABELS[k][1]}`);
  });
  return parts.length ? parts.join(', ') : 'nothing selected';
}

export function blockingReason(b: { noAsset: number; duplicates: number }): string | null {
  if (b.noAsset > 0) {
    return `${b.noAsset} ${b.noAsset === 1 ? 'trial needs' : 'trials need'} an asset`;
  }
  if (b.duplicates > 0) {
    return `${b.duplicates} duplicate ${b.duplicates === 1 ? 'trial' : 'trials'} in this batch`;
  }
  return null;
}
