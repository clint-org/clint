// Canonical phase-color map. Used by phase-bar.component (data viz) and the
// help/phases page (live-render reference). When phase semantics change, edit
// this file and the help page reflects the change automatically.
//
// Order matches the clinical progression analysts expect to scan:
// preclinical → trial phases → approval → launch → observational.

export interface PhaseDescriptor {
  key: string;
  /** Full descriptive label (used in help pages and verbose contexts). */
  label: string;
  /** Compact display form rendered on data viz (rings, axes, phase bars, chips). */
  shortLabel: string;
  color: string;
  description: string;
}

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
    key: 'APPROVED',
    label: 'Approved',
    shortLabel: 'APPROVED',
    color: '#8b5cf6',
    description:
      'Regulatory clearance achieved. Darker violet differentiates from PH 4 while staying in the same family.',
  },
  {
    key: 'LAUNCHED',
    label: 'Launched',
    shortLabel: 'LAUNCHED',
    color: '#0d9488',
    description:
      'On the market. Hero teal -- the strongest commercial state and the most prominent phase color.',
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
export const PHASE_COLORS: Record<string, string> = Object.fromEntries(
  PHASE_DESCRIPTORS.map((d) => [d.key, d.color])
);

export const PHASE_SHORT_LABELS: Record<string, string> = Object.fromEntries(
  PHASE_DESCRIPTORS.map((d) => [d.key, d.shortLabel])
);

export function phaseShortLabel(key: string): string {
  return PHASE_SHORT_LABELS[key] ?? key;
}

export const PHASE_FALLBACK_COLOR = '#64748b';
