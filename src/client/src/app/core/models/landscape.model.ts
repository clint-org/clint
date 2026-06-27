/**
 * Shared types for the landscape bullseye feature.
 *
 * The bullseye shows a per-indication competitive landscape. Each dot
 * is a product, positioned at the development phase it has reached within
 * the selected indication. Companies sit on spokes around the perimeter.
 */

import type { MarkerShape } from './marker.model';

export type RingPhase = 'PRECLIN' | 'P1' | 'P2' | 'P3' | 'P4' | 'APPROVED' | 'LAUNCHED';

/**
 * Phases in development order: PRECLIN (earliest research) through
 * LAUNCHED (commercial launch). The bullseye renders LAUNCHED at the
 * center and PRECLIN at the outer rim, so the render layer inverts
 * these into ring positions; see `bullseye-geometry.ts`.
 */
export const RING_ORDER: readonly RingPhase[] = [
  'PRECLIN',
  'P1',
  'P2',
  'P3',
  'P4',
  'APPROVED',
  'LAUNCHED',
];

/**
 * Ring order narrowed for a space's preclinical setting. When a space does not
 * track preclinical (the default), PRECLIN is dropped so the bullseye omits the
 * outer preclinical ring and phase bars omit its segment. The server enforces
 * exclusion of preclinical records regardless; this only controls what the UI
 * renders. See SpaceSettingsService and core/models/phase-colors.ts.
 */
export function visibleRingOrder(showPreclinical: boolean): readonly RingPhase[] {
  return showPreclinical ? RING_ORDER : RING_ORDER.filter((p) => p !== 'PRECLIN');
}

/**
 * Map of phase → development rank. Used when comparing "who has gone
 * furthest" and when projecting a phase onto a ring radius.
 */
export const RING_DEV_RANK: Record<RingPhase, number> = {
  PRECLIN: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
  APPROVED: 5,
  LAUNCHED: 6,
};

/**
 * Phase color palette used by both the bullseye chart (dots, ring labels)
 * and the side detail panel (ring histogram). Steps in saturation from
 * slate (early) through teal/violet (mid) to emerald (launched) so a
 * single glance encodes the phase by hue as well as position.
 */
export const PHASE_COLOR: Record<RingPhase, string> = {
  PRECLIN: '#94a3b8', // slate-400
  P1: '#64748b', // slate-500
  P2: '#0891b2', // cyan-600
  P3: '#0d9488', // teal-600 (brand hero color, pivotal phase)
  P4: '#7c3aed', // violet-600
  APPROVED: '#6d28d9', // violet-700
  LAUNCHED: '#059669', // emerald-600 (distinct hue for "the goal")
};

export type BullseyeDimension = 'indication' | 'company' | 'moa' | 'roa';

export type SpokeMode = 'grouped' | 'assets';

export type SpokeGrouping = 'company' | 'indication' | 'moa' | 'roa' | 'asset';

export const SPOKE_GROUPING_OPTIONS: { label: string; value: SpokeGrouping }[] = [
  { label: 'Company', value: 'company' },
  { label: 'Indication', value: 'indication' },
  { label: 'Mechanism of Action', value: 'moa' },
  { label: 'Route of Administration', value: 'roa' },
  { label: 'Asset', value: 'asset' },
];

/**
 * Domain noun for what a bullseye "spoke" represents under the active grouping.
 * A spoke is a company / indication / mechanism / route / asset group, so STATS
 * names the real thing instead of the internal "spokes" term. `count` selects
 * singular vs plural.
 */
export function spokeGroupingNoun(grouping: SpokeGrouping, count: number): string {
  const nouns: Record<SpokeGrouping, [singular: string, plural: string]> = {
    company: ['company', 'companies'],
    indication: ['indication', 'indications'],
    moa: ['mechanism', 'mechanisms'],
    roa: ['route', 'routes'],
    asset: ['asset', 'assets'],
  };
  const [singular, plural] = nouns[grouping];
  return count === 1 ? singular : plural;
}

export interface BullseyeScope {
  id: string;
  name: string;
  abbreviation?: string | null;
}

export interface BullseyeTrial {
  id: string;
  name: string;
  acronym: string | null;
  identifier: string | null;
  status: string | null;
  recruitment_status: string | null;
  study_type: string | null;
  /** The trial's own highest phase (may be OBS if that's all the trial has). */
  phase: RingPhase | 'OBS' | null;
  /**
   * Change-feed badge fields. Optional because get_bullseye_data has not
   * been extended with these yet; the ChangeBadgeComponent treats an
   * absent count as zero and hides itself.
   */
  recent_changes_count?: number;
  most_recent_change_type?: string | null;
  most_recent_change_event_id?: string | null;
}

export interface BullseyeMarker {
  id: string;
  event_date: string;
  marker_type_name: string;
  shape: MarkerShape;
  color: string;
  projection: string;
  category_name: string;
}

export interface BullseyeAsset {
  id: string;
  name: string;
  generic_name: string | null;
  logo_url: string | null;
  company_id: string;
  company_name: string;
  /** The owning company's logo (companies.logo_url), for the company tile. */
  company_logo_url: string | null;
  highest_phase: RingPhase;
  highest_phase_rank: number;
  trials: BullseyeTrial[];
  recent_markers: BullseyeMarker[];
  moas: { id: string; name: string }[];
  roas: { id: string; name: string; abbreviation: string | null }[];
  indications: { id: string; name: string; abbreviation: string | null }[];
  intelligence_count: number;
  has_recent_activity: boolean;
  recent_changes_count: number;
  most_recent_change_type: string | null;
  most_recent_change_event_id: string | null;
}

export interface BullseyeSpoke {
  id: string;
  name: string;
  display_order: number;
  highest_phase_rank: number;
  products: BullseyeAsset[];
  has_intelligence?: boolean;
}

export interface BullseyeData {
  dimension: BullseyeDimension;
  scope: BullseyeScope;
  ring_order: RingPhase[];
  spokes: BullseyeSpoke[];
  spoke_label: string;
}

export type Quarter = 1 | 2 | 3 | 4;

/**
 * Time window for the landscape time period filter. Each boundary is a year
 * with an optional quarter. A null quarter means the boundary covers the
 * whole year (Q1 on the From side, Q4 on the To side). A null year leaves
 * that side open-ended.
 */
export interface TimePeriodFilter {
  startYear: number | null;
  startQuarter: Quarter | null;
  endYear: number | null;
  endQuarter: Quarter | null;
}

export interface LandscapeFilters {
  companyIds: string[];
  assetIds: string[];
  trialIds: string[];
  indicationIds: string[];
  mechanismOfActionIds: string[];
  routeOfAdministrationIds: string[];
  phases: RingPhase[];
  recruitmentStatuses: string[];
  studyTypes: string[];
  markerCategoryIds: string[];
  timePeriod: TimePeriodFilter | null;
}

export const EMPTY_LANDSCAPE_FILTERS: LandscapeFilters = {
  companyIds: [],
  assetIds: [],
  trialIds: [],
  indicationIds: [],
  mechanismOfActionIds: [],
  routeOfAdministrationIds: [],
  phases: [],
  recruitmentStatuses: [],
  studyTypes: [],
  markerCategoryIds: [],
  timePeriod: null,
};

/**
 * True when any landscape filter narrows the result set. Used to decide
 * whether a surface should say "Filtered" vs report the unfiltered truth.
 * Every list field counts as active when non-empty; timePeriod counts when set.
 *
 * `opts.ignoreTimePeriod` excludes the period from the check for surfaces that
 * ignore it (the bullseye's get_bullseye_assets has no period parameter), so a
 * leftover period from another view does not falsely mark the bullseye as
 * filtered.
 */
export function hasActiveLandscapeFilters(
  filters: LandscapeFilters,
  opts: { ignoreTimePeriod?: boolean } = {}
): boolean {
  return (
    filters.companyIds.length > 0 ||
    filters.assetIds.length > 0 ||
    filters.trialIds.length > 0 ||
    filters.indicationIds.length > 0 ||
    filters.mechanismOfActionIds.length > 0 ||
    filters.routeOfAdministrationIds.length > 0 ||
    filters.phases.length > 0 ||
    filters.recruitmentStatuses.length > 0 ||
    filters.studyTypes.length > 0 ||
    filters.markerCategoryIds.length > 0 ||
    (!opts.ignoreTimePeriod && filters.timePeriod !== null)
  );
}

/** ISO date bounds derived from a TimePeriodFilter. Null bound = open-ended. */
export interface TimePeriodRange {
  start: string | null;
  end: string | null;
}

const QUARTER_START: Record<Quarter, string> = { 1: '01-01', 2: '04-01', 3: '07-01', 4: '10-01' };
const QUARTER_END: Record<Quarter, string> = { 1: '03-31', 2: '06-30', 3: '09-30', 4: '12-31' };

/**
 * Converts a time period to inclusive ISO date bounds. The From boundary
 * maps to the first day of its quarter (whole year = Jan 1); the To boundary
 * maps to the last day of its quarter (whole year = Dec 31).
 */
export function timePeriodToRange(tp: TimePeriodFilter | null): TimePeriodRange {
  if (!tp) return { start: null, end: null };
  return {
    start: tp.startYear === null ? null : `${tp.startYear}-${QUARTER_START[tp.startQuarter ?? 1]}`,
    end: tp.endYear === null ? null : `${tp.endYear}-${QUARTER_END[tp.endQuarter ?? 4]}`,
  };
}

/**
 * Inclusive interval overlap on ISO date strings (YYYY-MM-DD compares
 * correctly as plain strings). Null span or range bounds are open-ended.
 */
export function spanOverlapsRange(
  spanStart: string | null,
  spanEnd: string | null,
  range: TimePeriodRange
): boolean {
  if (range.start !== null && spanEnd !== null && spanEnd < range.start) return false;
  if (range.end !== null && spanStart !== null && spanStart > range.end) return false;
  return true;
}

/**
 * If From is after To, clamps To up to From so the window is never
 * empty-by-construction. Open-ended periods pass through unchanged.
 */
export function clampTimePeriod(tp: TimePeriodFilter): TimePeriodFilter {
  if (tp.startYear === null || tp.endYear === null) return tp;
  const startKey = tp.startYear * 4 + ((tp.startQuarter ?? 1) - 1);
  const endKey = tp.endYear * 4 + ((tp.endQuarter ?? 4) - 1);
  if (startKey <= endKey) return tp;
  return { ...tp, endYear: tp.startYear, endQuarter: tp.startQuarter };
}

/** Compact chip label, e.g. "Q2 2025 - Q4 2026", "From 2025", "Through Q2 2027". */
export function formatTimePeriod(tp: TimePeriodFilter): string {
  const label = (year: number, quarter: Quarter | null) =>
    quarter ? `Q${quarter} ${year}` : `${year}`;
  const from = tp.startYear === null ? null : label(tp.startYear, tp.startQuarter);
  const to = tp.endYear === null ? null : label(tp.endYear, tp.endQuarter);
  if (from && to) return `${from} - ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Through ${to}`;
  return '';
}

export interface LandscapeIndexEntry {
  entity: BullseyeScope;
  product_count: number;
  secondary_count: number;
  secondary_label: string;
  highest_phase_present: RingPhase | null;
  products_missing_phase: number;
}

export type ViewMode = 'timeline' | 'bullseye' | 'heatmap' | 'catalysts';

export const VIEW_MODE_OPTIONS: { label: string; value: ViewMode }[] = [
  { label: 'Timeline', value: 'timeline' },
  { label: 'Bullseye', value: 'bullseye' },
  { label: 'Heatmap', value: 'heatmap' },
  { label: 'Future Catalysts', value: 'catalysts' },
];

export const DIMENSION_OPTIONS: { label: string; value: BullseyeDimension }[] = [
  { label: 'Indication', value: 'indication' },
  { label: 'Company', value: 'company' },
  { label: 'Mechanism of Action', value: 'moa' },
  { label: 'Route of Administration', value: 'roa' },
];

export function dimensionToSegment(dim: BullseyeDimension): string {
  const map: Record<BullseyeDimension, string> = {
    indication: 'by-indication',
    company: 'by-company',
    moa: 'by-moa',
    roa: 'by-roa',
  };
  return map[dim];
}

export function segmentToDimension(segment: string): BullseyeDimension {
  const map: Record<string, BullseyeDimension> = {
    'by-indication': 'indication',
    'by-company': 'company',
    'by-moa': 'moa',
    'by-roa': 'roa',
  };
  return map[segment] ?? 'indication';
}

// --- Spoke grouping utility ---

export interface GroupedSpokesResult {
  spokes: BullseyeSpoke[];
  duplicatedAssetIds: Set<string>;
}

/**
 * Groups a flat list of assets into spokes by the selected dimension.
 * For multi-valued dimensions (indication, moa, roa), an asset may appear
 * in multiple spokes. The returned `duplicatedAssetIds` tracks those assets.
 */
export function groupAssetsIntoSpokes(
  assets: BullseyeAsset[],
  grouping: SpokeGrouping,
  companiesWithIntelligence: ReadonlySet<string> = new Set(),
): GroupedSpokesResult {
  const groups = new Map<string, { name: string; assets: BullseyeAsset[] }>();
  const assetSpokeCount = new Map<string, number>();

  for (const asset of assets) {
    const keys = getSpokeKeys(asset, grouping);
    for (const key of keys) {
      const existing = groups.get(key.id);
      if (existing) {
        existing.assets.push(asset);
      } else {
        groups.set(key.id, { name: key.name, assets: [asset] });
      }
      assetSpokeCount.set(asset.id, (assetSpokeCount.get(asset.id) ?? 0) + 1);
    }
  }

  const duplicatedAssetIds = new Set<string>();
  for (const [id, count] of assetSpokeCount) {
    if (count > 1) {
      duplicatedAssetIds.add(id);
    }
  }

  const spokes: BullseyeSpoke[] = [...groups.entries()].map(([id, group]) => ({
    id,
    name: group.name,
    display_order: 0,
    highest_phase_rank: Math.max(...group.assets.map((a) => a.highest_phase_rank)),
    products: group.assets,
    has_intelligence: grouping === 'company' && companiesWithIntelligence.has(id),
  }));

  spokes.sort((a, b) => {
    const phaseCompare = b.highest_phase_rank - a.highest_phase_rank;
    if (phaseCompare !== 0) return phaseCompare;
    return b.products.length - a.products.length;
  });

  return { spokes, duplicatedAssetIds };
}

function getSpokeKeys(
  asset: BullseyeAsset,
  grouping: SpokeGrouping
): { id: string; name: string }[] {
  switch (grouping) {
    case 'company':
      return [{ id: asset.company_id, name: asset.company_name }];
    case 'indication':
      return asset.indications.map((ind) => ({ id: ind.id, name: ind.name }));
    case 'moa':
      return asset.moas.map((m) => ({ id: m.id, name: m.name }));
    case 'roa':
      return asset.roas.map((r) => ({ id: r.id, name: r.name }));
    case 'asset':
      return [{ id: asset.id, name: asset.name }];
  }
}

// --- Heatmap types ---

export type HeatmapGrouping = 'moa' | 'indication' | 'moa+indication' | 'company' | 'roa';

export type CountUnit = 'assets' | 'trials' | 'companies';

export interface HeatmapAsset {
  id: string;
  name: string;
  generic_name: string | null;
  company_id: string;
  company_name: string;
  /** The owning company's logo (companies.logo_url), for the company tile. */
  company_logo_url: string | null;
  highest_phase: RingPhase;
  highest_phase_rank: number;
  trial_count: number;
  /** True when this asset owns published primary intelligence (entity_type=product). */
  has_intelligence?: boolean;
}

export interface HeatmapBubble {
  label: string;
  group_keys: Record<string, string>;
  competitor_count: number;
  highest_phase: RingPhase;
  highest_phase_rank: number;
  unit_count: number;
  /** Count of assets in this group that own published primary intelligence. */
  intelligence_count?: number;
  // company-anchored intelligence presence; set by get_positioning_data only when
  // grouped by company. Distinct from intelligence_count (assets-with-intelligence).
  has_intelligence?: boolean;
  phase_counts: Partial<Record<RingPhase, number>>;
  products: HeatmapAsset[];
}

export interface HeatmapData {
  grouping: HeatmapGrouping;
  count_unit: CountUnit;
  latest_event_date: string | null;
  bubbles: HeatmapBubble[];
}

export const HEATMAP_GROUPING_OPTIONS: { label: string; value: HeatmapGrouping }[] = [
  { label: 'Mechanism of Action', value: 'moa' },
  { label: 'Indication', value: 'indication' },
  { label: 'MOA + Indication', value: 'moa+indication' },
  { label: 'Company', value: 'company' },
  { label: 'Route of Administration', value: 'roa' },
];

export function groupingToSegment(g: HeatmapGrouping): string {
  const map: Record<HeatmapGrouping, string> = {
    moa: 'by-moa',
    indication: 'by-indication',
    'moa+indication': 'by-moa-indication',
    company: 'by-company',
    roa: 'by-roa',
  };
  return map[g];
}

export function segmentToGrouping(segment: string): HeatmapGrouping {
  const map: Record<string, HeatmapGrouping> = {
    'by-moa': 'moa',
    'by-indication': 'indication',
    'by-moa-indication': 'moa+indication',
    'by-company': 'company',
    'by-roa': 'roa',
  };
  return map[segment] ?? 'moa';
}

export const HEATMAP_SEGMENTS = [
  'by-moa',
  'by-indication',
  'by-moa-indication',
  'by-company',
  'by-roa',
] as const;

export const COUNT_UNIT_OPTIONS: { label: string; value: CountUnit }[] = [
  { label: 'Assets', value: 'assets' },
  { label: 'Trials', value: 'trials' },
  { label: 'Companies', value: 'companies' },
];
