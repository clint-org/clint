/**
 * Shared types for the landscape bullseye feature.
 *
 * The bullseye shows a per-therapeutic-area competitive landscape. Each dot
 * is a product, positioned at the development phase it has reached within
 * the selected TA. Companies sit on spokes around the perimeter.
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

export type BullseyeDimension = 'therapeutic-area' | 'company' | 'moa' | 'roa';

export type SpokeMode = 'grouped' | 'products';

export interface BullseyeScope {
  id: string;
  name: string;
  abbreviation?: string | null;
}

export interface BullseyeTherapeuticArea {
  id: string;
  name: string;
  abbreviation: string | null;
}

export interface BullseyeTrial {
  id: string;
  name: string;
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
}

export interface BullseyeMarker {
  id: string;
  event_date: string;
  marker_type_name: string;
  icon: string | null;
  shape: MarkerShape;
  color: string;
  projection: string;
  category_name: string;
}

export interface BullseyeProduct {
  id: string;
  name: string;
  generic_name: string | null;
  logo_url: string | null;
  company_id: string;
  company_name: string;
  highest_phase: RingPhase;
  highest_phase_rank: number;
  trials: BullseyeTrial[];
  recent_markers: BullseyeMarker[];
  moas: { id: string; name: string }[];
  roas: { id: string; name: string; abbreviation: string | null }[];
}

export interface BullseyeSpoke {
  id: string;
  name: string;
  display_order: number;
  highest_phase_rank: number;
  products: BullseyeProduct[];
}

export interface BullseyeData {
  dimension: BullseyeDimension;
  scope: BullseyeScope;
  ring_order: RingPhase[];
  spokes: BullseyeSpoke[];
  spoke_label: string;
}

export interface LandscapeFilters {
  companyIds: string[];
  productIds: string[];
  therapeuticAreaIds: string[];
  mechanismOfActionIds: string[];
  routeOfAdministrationIds: string[];
  phases: RingPhase[];
  recruitmentStatuses: string[];
  studyTypes: string[];
  markerCategoryIds: string[];
}

export const EMPTY_LANDSCAPE_FILTERS: LandscapeFilters = {
  companyIds: [],
  productIds: [],
  therapeuticAreaIds: [],
  mechanismOfActionIds: [],
  routeOfAdministrationIds: [],
  phases: [],
  recruitmentStatuses: [],
  studyTypes: [],
  markerCategoryIds: [],
};

export interface LandscapeIndexEntry {
  entity: BullseyeScope;
  product_count: number;
  secondary_count: number;
  secondary_label: string;
  highest_phase_present: RingPhase | null;
  products_missing_phase: number;
}

export type ViewMode = 'timeline' | 'bullseye' | 'positioning' | 'catalysts';

export const VIEW_MODE_OPTIONS: { label: string; value: ViewMode }[] = [
  { label: 'Timeline', value: 'timeline' },
  { label: 'Bullseye', value: 'bullseye' },
  { label: 'Positioning', value: 'positioning' },
  { label: 'Future Catalysts', value: 'catalysts' },
];

export const DIMENSION_OPTIONS: { label: string; value: BullseyeDimension }[] = [
  { label: 'Therapy Area', value: 'therapeutic-area' },
  { label: 'Company', value: 'company' },
  { label: 'Mechanism of Action', value: 'moa' },
  { label: 'Route of Administration', value: 'roa' },
];

export function dimensionToSegment(dim: BullseyeDimension): string {
  const map: Record<BullseyeDimension, string> = {
    'therapeutic-area': 'by-therapy-area',
    company: 'by-company',
    moa: 'by-moa',
    roa: 'by-roa',
  };
  return map[dim];
}

export function segmentToDimension(segment: string): BullseyeDimension {
  const map: Record<string, BullseyeDimension> = {
    'by-therapy-area': 'therapeutic-area',
    'by-company': 'company',
    'by-moa': 'moa',
    'by-roa': 'roa',
  };
  return map[segment] ?? 'therapeutic-area';
}

// --- Competitive Positioning types ---

export type PositioningGrouping =
  | 'moa'
  | 'therapeutic-area'
  | 'moa+therapeutic-area'
  | 'company'
  | 'roa';

export type CountUnit = 'products' | 'trials' | 'companies';

export interface PositioningProduct {
  id: string;
  name: string;
  generic_name: string | null;
  company_id: string;
  company_name: string;
  highest_phase: RingPhase;
  highest_phase_rank: number;
  trial_count: number;
}

export interface PositioningBubble {
  label: string;
  group_keys: Record<string, string>;
  competitor_count: number;
  highest_phase: RingPhase;
  highest_phase_rank: number;
  unit_count: number;
  products: PositioningProduct[];
}

export interface PositioningData {
  grouping: PositioningGrouping;
  count_unit: CountUnit;
  bubbles: PositioningBubble[];
}

export const POSITIONING_GROUPING_OPTIONS: { label: string; value: PositioningGrouping }[] = [
  { label: 'Mechanism of Action', value: 'moa' },
  { label: 'Therapy Area', value: 'therapeutic-area' },
  { label: 'MOA + Therapy Area', value: 'moa+therapeutic-area' },
  { label: 'Company', value: 'company' },
  { label: 'Route of Administration', value: 'roa' },
];

export function groupingToSegment(g: PositioningGrouping): string {
  const map: Record<PositioningGrouping, string> = {
    moa: 'by-moa',
    'therapeutic-area': 'by-therapy-area',
    'moa+therapeutic-area': 'by-moa-therapy-area',
    company: 'by-company',
    roa: 'by-roa',
  };
  return map[g];
}

export function segmentToGrouping(segment: string): PositioningGrouping {
  const map: Record<string, PositioningGrouping> = {
    'by-moa': 'moa',
    'by-therapy-area': 'therapeutic-area',
    'by-moa-therapy-area': 'moa+therapeutic-area',
    'by-company': 'company',
    'by-roa': 'roa',
  };
  return map[segment] ?? 'moa';
}

export const POSITIONING_SEGMENTS = [
  'by-moa',
  'by-therapy-area',
  'by-moa-therapy-area',
  'by-company',
  'by-roa',
] as const;

export const COUNT_UNIT_OPTIONS: { label: string; value: CountUnit }[] = [
  { label: 'Products', value: 'products' },
  { label: 'Trials', value: 'trials' },
  { label: 'Companies', value: 'companies' },
];
