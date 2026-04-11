/**
 * Shared types for the landscape bullseye feature.
 *
 * The bullseye shows a per-therapeutic-area competitive landscape. Each dot
 * is a product, positioned at the development phase it has reached within
 * the selected TA. Companies sit on spokes around the perimeter.
 */

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

export interface BullseyeTherapeuticArea {
  id: string;
  name: string;
  abbreviation: string | null;
}

export interface BullseyeTrial {
  id: string;
  name: string;
  identifier: string | null;
  sample_size: number | null;
  status: string | null;
  recruitment_status: string | null;
  study_type: string | null;
  /** The trial's own highest phase (may be OBS if that's all the trial has). */
  phase: RingPhase | 'OBS' | null;
}

export interface BullseyeMarker {
  id: string;
  event_date: string;
  marker_type_name: string;
  icon: string | null;
  shape: string;
  color: string;
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

export interface BullseyeCompany {
  id: string;
  name: string;
  display_order: number;
  highest_phase_rank: number;
  products: BullseyeProduct[];
}

export interface BullseyeData {
  therapeutic_area: BullseyeTherapeuticArea | null;
  ring_order: RingPhase[];
  companies: BullseyeCompany[];
}

export interface LandscapeIndexEntry {
  therapeutic_area: BullseyeTherapeuticArea;
  product_count: number;
  company_count: number;
  highest_phase_present: RingPhase | null;
  products_missing_phase: number;
}
