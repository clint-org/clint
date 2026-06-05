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

// Reads a trial's asset references as a raw array. A trial can test multiple
// assets (a master-protocol NCT), so the source of truth is `asset_refs`. The
// legacy scalar `asset_ref` is still accepted so older proposals keep working.
function rawAssetRefs(trial: Entity): unknown[] {
  const refs = trial['asset_refs'];
  if (Array.isArray(refs)) return refs;
  const single = trial['asset_ref'];
  return single == null ? [] : [single];
}

function isValidIndex(v: unknown, assetCount: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < assetCount;
}

// A trial that resolved to an existing record is never "missing an asset";
// otherwise it must carry at least one asset reference. This is the single
// source of truth: ReviewPageComponent.trialMissingAsset delegates here so the
// grid's no-asset flag and the commit gate cannot disagree.
export function trialMissingAsset(trial: Entity): boolean {
  if (isExistingMatch(trial)) return false;
  return rawAssetRefs(trial).length === 0;
}

// All valid, in-range, de-duplicated parent-asset indices for a trial, in order.
// The grouped grid nests the trial under EACH of these assets; a trial that
// resolves to an empty list has no place in the company -> asset -> trial tree
// and is surfaced in the "Unlinked trials" section instead of disappearing.
export function resolveTrialAssetIndexes(trial: Entity, assetCount: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const r of rawAssetRefs(trial)) {
    if (isValidIndex(r, assetCount) && !seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  return out;
}

// The primary (headline) asset index for a trial: primary_asset_ref when it is
// valid and among the resolved refs, else the first resolved ref, else null.
export function resolveTrialPrimaryAssetIndex(trial: Entity, assetCount: number): number | null {
  const refs = resolveTrialAssetIndexes(trial, assetCount);
  if (refs.length === 0) return null;
  const p = trial['primary_asset_ref'];
  if (isValidIndex(p, assetCount) && refs.includes(p)) return p;
  return refs[0];
}

// True when a trial tests more than one asset (a master protocol). The review
// grid uses this to keep multi-asset trials expandable: their primary/membership
// must always be editable via the row detail, even when the trial resolved
// cleanly and would otherwise have no flags or editable fields.
export function trialIsMultiAsset(trial: Entity, assetCount: number): boolean {
  return resolveTrialAssetIndexes(trial, assetCount).length > 1;
}

// Back-compat single-index resolver (the trial's primary asset). Retained for
// callers that need one owning asset; multi-asset nesting uses
// resolveTrialAssetIndexes.
export function resolveTrialAssetIndex(trial: Entity, assetCount: number): number | null {
  return resolveTrialPrimaryAssetIndex(trial, assetCount);
}

// Indices of trials that do not nest under any asset (zero valid asset refs).
// The tree builder and orphanTrialIndexes both delegate to
// resolveTrialAssetIndexes so nesting and orphan-detection cannot disagree.
export function orphanTrialIndexes(trials: Entity[], assetCount: number): number[] {
  const out: number[] = [];
  trials.forEach((t, i) => {
    if (resolveTrialAssetIndexes(t, assetCount).length === 0) out.push(i);
  });
  return out;
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

export interface EntityLink {
  href: string;
  external: boolean;
}

// Resolves the click target for a review-grid entity value:
// - an existing company/asset/trial -> its in-app /manage record (internal nav)
// - a new trial -> its ClinicalTrials.gov study page (external, new tab)
// - a new company/asset -> null (no record to point at yet, render plain text)
// The entity type doubles as the /manage route segment. Pure so the grid and the
// orphan entityRow sections resolve links identically.
export function resolveEntityLink(params: {
  type: 'companies' | 'assets' | 'trials';
  matchKind: string | undefined;
  matchId: string | undefined;
  nctId?: string | null;
  manageBase: string;
}): EntityLink | null {
  const { type, matchKind, matchId, nctId, manageBase } = params;
  if (matchKind === 'existing' && matchId) {
    return { href: `${manageBase}/${type}/${matchId}`, external: false };
  }
  if (type === 'trials' && nctId) {
    return { href: `https://clinicaltrials.gov/study/${nctId}`, external: true };
  }
  return null;
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
