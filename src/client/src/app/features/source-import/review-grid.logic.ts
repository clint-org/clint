// Pure review-decision logic for the import-review grouped grid.
// No Angular imports: unit-tested via vitest (npm run test:units).
import type { MarkerShape, FillStyle, InnerMark } from '../../core/models/marker.model';

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

// A trial carries an indication when either the multi-value indications[] array
// has entries or the legacy scalar indication is set.
function trialHasIndication(trial: Entity): boolean {
  const many = trial['indications'];
  if (Array.isArray(many) && many.some((i) => typeof i === 'string' && i.length > 0)) return true;
  return typeof trial['indication'] === 'string' && (trial['indication'] as string).length > 0;
}

export function deriveTrialFlags(trial: Entity): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  if (trialMissingAsset(trial)) {
    flags.push({ id: 'no-asset', tier: 'blocking', label: 'No asset' });
  }
  if (!trialHasIndication(trial)) {
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
  return alternateCount > 0 ? { id: 'fuzzy', tier: 'attention', label: 'Uncertain match' } : null;
}

// Display fields for an event leaf row in the review grid. Events have no place
// in the trial-shaped columns (phase, MOA/ROA, indication), so their identity is
// carried in the entity cell: a category chip and a date.
export interface LeafDisplay {
  category: string | null;
  date: string | null;
}

function cleanText(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 ? s : null;
}

// The visual fields the review grid needs to render an event's real glyph
// (app-marker-icon), a structural subset of MarkerType. The glyph primitive types
// (MarkerShape, FillStyle, InnerMark) are still sourced from marker.model since
// "Marker" survives as the glyph primitive after the event-model cutover.
export interface EventTypeLite {
  name: string;
  shape: MarkerShape;
  color: string;
  fill_style: FillStyle;
  inner_mark: InnerMark;
  is_system: boolean;
  display_order: number;
}

// Space-scoped types win over the system defaults of the same name (commit
// orders `space_id nulls last`, i.e. is_system last).
function preferSpaceScoped(matches: EventTypeLite[]): EventTypeLite {
  return [...matches].sort((a, b) => Number(a.is_system) - Number(b.is_system))[0];
}

// Resolve a proposal event's `event_type` name to the event type whose glyph it
// will actually receive on commit, mirroring commit_source_import: exact name
// match, then case-insensitive, then the lowest-ordered system default. Returns
// null only when no types are loaded yet (the caller falls back to an icon).
export function pickEventType(name: string | null, types: EventTypeLite[]): EventTypeLite | null {
  if (types.length === 0) return null;
  if (name) {
    const exact = types.filter((t) => t.name === name);
    if (exact.length > 0) return preferSpaceScoped(exact);
    const lower = name.toLowerCase();
    const ci = types.filter((t) => t.name.toLowerCase() === lower);
    if (ci.length > 0) return preferSpaceScoped(ci);
  }
  const systemDefaults = types
    .filter((t) => t.is_system)
    .sort((a, b) => a.display_order - b.display_order);
  return systemDefaults[0] ?? types[0];
}

// An event's category chip is its event_type name; its date is event_date.
export function eventLeafDisplay(event: Entity): LeafDisplay {
  return { category: cleanText(event['event_type']), date: cleanText(event['event_date']) };
}

export interface SelectionCounts {
  companies: number;
  assets: number;
  trials: number;
  events: number;
}

const LABELS: Record<keyof SelectionCounts, [string, string]> = {
  companies: ['company', 'companies'],
  assets: ['asset', 'assets'],
  trials: ['trial', 'trials'],
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

export interface FilterCounts {
  all: number;
  flagged: number;
  new: number;
}

// A minimal shape matching the PrimeNG TreeNode tree the review grid renders:
// each node carries a row in `data` and may have nested `children`. `data` is
// optional to stay structurally compatible with PrimeNG's TreeNode.
interface CountableNode {
  data?: { flags: ReviewFlag[]; state: EntityState };
  children?: CountableNode[];
}

// Counts how many rows across the whole tree match each grid filter, so the
// tabs can show "Needs review (N)" / "New (N)" before the user clicks. Mirrors
// the keep() predicate in the component's filteredNodes computed.
export function countFilterMatches(nodes: CountableNode[]): FilterCounts {
  const counts: FilterCounts = { all: 0, flagged: 0, new: 0 };
  const walk = (node: CountableNode): void => {
    counts.all += 1;
    if ((node.data?.flags?.length ?? 0) > 0) counts.flagged += 1;
    if (node.data?.state === 'new') counts.new += 1;
    (node.children ?? []).forEach(walk);
  };
  nodes.forEach(walk);
  return counts;
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

// Event rows are leaf nodes attached to parent entities. When a leaf is already
// matched to an existing record, re-importing it is a no-op, so these rows
// default to deselected. Parent entities (companies, assets, trials) remain
// selected even when matched because the commit needs the full hierarchy to
// attach leaf rows.
const LEAF_ENTITY_TYPES = new Set(['events']);

// Produce the initial Record<key, boolean> that backs the selections signal.
// Keys follow the pattern `${type}_${index}`. Matched events are
// set to false; everything else is set to true. Non-array fields (source_summary,
// source_title, source_date) are silently skipped.
export function defaultSelections(proposals: Record<string, unknown>): Record<string, boolean> {
  const sel: Record<string, boolean> = {};
  for (const [type, items] of Object.entries(proposals)) {
    if (!Array.isArray(items)) continue;
    const isLeaf = LEAF_ENTITY_TYPES.has(type);
    for (let i = 0; i < items.length; i++) {
      sel[`${type}_${i}`] = isLeaf ? entityState(items[i] as Entity) !== 'existing' : true;
    }
  }
  return sel;
}
