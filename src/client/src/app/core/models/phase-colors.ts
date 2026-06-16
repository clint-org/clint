// Canonical phase-color map. Used by phase-bar.component (data viz) and the
// help/phases page (live-render reference). When phase semantics change, edit
// this file and the help page reflects the change automatically.
//
// PHASE_DESCRIPTORS covers clinical trial phases only (PRECLIN through OBS).
// APPROVED and LAUNCHED are development statuses that live on asset_indications,
// not on trials. Use DEVELOPMENT_STATUS_COLORS for badge rendering that spans
// both trial phases and commercial milestones.

export interface PhaseDescriptor {
  key: string;
  /** Full descriptive label (used in help pages and verbose contexts). */
  label: string;
  /** Compact display form rendered on data viz (rings, axes, phase bars, chips). */
  shortLabel: string;
  color: string;
  description: string;
}

/**
 * Trial phase descriptors. These describe the actual clinical phase of a trial.
 * APPROVED and LAUNCHED are not trial phases -- they are development statuses
 * that live on asset_indications (the "program" level).
 */
export const PHASE_DESCRIPTORS: PhaseDescriptor[] = [
  {
    key: 'PRECLIN',
    label: 'Preclinical',
    shortLabel: 'PRECLIN',
    color: '#cbd5e1',
    description:
      'Before first-in-human dosing. Lab and animal work. Rendered dimmer than PH 1 to recede behind active trial phases.',
  },
  {
    key: 'P1',
    label: 'Phase 1',
    shortLabel: 'PH 1',
    color: '#94a3b8',
    description:
      'Early/exploratory clinical work. Safety, tolerability, PK in small populations. Muted slate keeps the eye on later phases.',
  },
  {
    key: 'P2',
    label: 'Phase 2',
    shortLabel: 'PH 2',
    color: '#67e8f9',
    description:
      'Building evidence. Dose-finding and signal-of-efficacy studies. Cyan pulls forward from PH 1 without competing with PH 3.',
  },
  {
    key: 'P3',
    label: 'Phase 3',
    shortLabel: 'PH 3',
    color: '#2dd4bf',
    description:
      'Pivotal trials -- the hero color. Where investment, partnership, and approval narratives are decided.',
  },
  {
    key: 'P4',
    label: 'Phase 4',
    shortLabel: 'PH 4',
    color: '#a78bfa',
    description:
      'Post-approval / post-marketing. Real-world evidence and label expansion. Violet shifts off the trial palette to mark the regulatory transition.',
  },
  {
    key: 'OBS',
    label: 'Observational',
    shortLabel: 'OBS',
    color: '#fbbf24',
    description:
      'Observational / non-interventional studies. Amber sits caution-adjacent so analysts can spot OBS arms separate from interventional progression.',
  },
];

// Map form for fast lookup by phase key (used by phase-bar.component).
// Covers trial phases only (PRECLIN, P1-P4, OBS).
export const PHASE_COLORS: Record<string, string> = Object.fromEntries(
  PHASE_DESCRIPTORS.map((d) => [d.key, d.color])
);

export const PHASE_SHORT_LABELS: Record<string, string> = Object.fromEntries(
  PHASE_DESCRIPTORS.map((d) => [d.key, d.shortLabel])
);

export function phaseShortLabel(key: string): string {
  return PHASE_SHORT_LABELS[key] ?? key;
}

const PHASE_ORDER: Record<string, number> = Object.fromEntries(
  PHASE_DESCRIPTORS.map((d, i) => [d.key, i])
);

/**
 * Numeric rank for sorting trials by clinical-phase progression
 * (PRECLIN < P1 < P2 < P3 < P4 < OBS). Unknown or unset phases sort last so a
 * "Phase" column groups classified trials ahead of the unclassified ones.
 */
export function phaseOrder(key: string | null | undefined): number {
  if (!key) return Number.MAX_SAFE_INTEGER;
  return PHASE_ORDER[key] ?? Number.MAX_SAFE_INTEGER;
}

export const PHASE_FALLBACK_COLOR = '#64748b';

// ---------------------------------------------------------------------------
// Development status colors (used for asset_indication badges, activity feed,
// and any UI that renders the full PRECLIN-through-LAUNCHED spectrum).
// ---------------------------------------------------------------------------

export type DevelopmentStatus = 'PRECLIN' | 'P1' | 'P2' | 'P3' | 'P4' | 'APPROVED' | 'LAUNCHED';

/**
 * Color palette for development status badges. Covers all 7 values that
 * asset_indications.development_status can hold. Trial phases (PRECLIN-P4)
 * reuse the same colors as PHASE_COLORS; APPROVED and LAUNCHED get their
 * own distinct colors for badge rendering.
 */
export const DEVELOPMENT_STATUS_COLORS: Record<DevelopmentStatus, string> = {
  PRECLIN: '#cbd5e1',
  P1: '#94a3b8',
  P2: '#67e8f9',
  P3: '#2dd4bf',
  P4: '#a78bfa',
  APPROVED: '#8b5cf6',
  LAUNCHED: '#0d9488',
};

export const DEVELOPMENT_STATUS_LABELS: Record<DevelopmentStatus, string> = {
  PRECLIN: 'Preclinical',
  P1: 'Phase 1',
  P2: 'Phase 2',
  P3: 'Phase 3',
  P4: 'Phase 4',
  APPROVED: 'Approved',
  LAUNCHED: 'Launched',
};

/**
 * Options for the development status dropdown in the asset-indication edit UI.
 * Ordered by clinical progression.
 */
export const DEVELOPMENT_STATUS_OPTIONS: { label: string; value: DevelopmentStatus }[] = [
  { label: 'Preclinical', value: 'PRECLIN' },
  { label: 'Phase 1', value: 'P1' },
  { label: 'Phase 2', value: 'P2' },
  { label: 'Phase 3', value: 'P3' },
  { label: 'Phase 4', value: 'P4' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Launched', value: 'LAUNCHED' },
];

// ---------------------------------------------------------------------------
// Per-space preclinical visibility.
//
// Preclinical is hard to track and hidden by default; a space owner opts in via
// spaces.show_preclinical (see SpaceSettingsService). These helpers are the
// single source of truth for narrowing phase lists in the UI when the flag is
// off, so the filter bar, legends, phase bars, and data-entry dropdowns all hide
// PRECLIN consistently. The DB enforces exclusion regardless; this is purely
// about not showing a control for a phase that will never return data.
// ---------------------------------------------------------------------------

/** Phase descriptors visible for a space, dropping PRECLIN when not tracked. */
export function visiblePhaseDescriptors(showPreclinical: boolean): PhaseDescriptor[] {
  return showPreclinical
    ? PHASE_DESCRIPTORS
    : PHASE_DESCRIPTORS.filter((d) => d.key !== 'PRECLIN');
}

/** Development-status dropdown options, dropping PRECLIN when not tracked. */
export function visibleDevelopmentStatusOptions(
  showPreclinical: boolean
): { label: string; value: DevelopmentStatus }[] {
  return showPreclinical
    ? DEVELOPMENT_STATUS_OPTIONS
    : DEVELOPMENT_STATUS_OPTIONS.filter((o) => o.value !== 'PRECLIN');
}
