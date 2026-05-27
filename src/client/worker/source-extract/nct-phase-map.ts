export const CTGOV_TO_APP_PHASE: Record<string, string> = {
  'EARLY_PHASE1': 'P1',
  'PHASE1': 'P1',
  'PHASE2': 'P2',
  'PHASE3': 'P3',
  'PHASE4': 'P4',
  'NA': 'OBS',
};

export function mapCtgovPhase(phases: string[] | undefined | null): string | null {
  if (!phases || phases.length === 0) return null;
  if (phases.length === 2) {
    const sorted = [...phases].sort();
    if (sorted[0] === 'PHASE1' && sorted[1] === 'PHASE2') return 'P1_2';
    if (sorted[0] === 'PHASE2' && sorted[1] === 'PHASE3') return 'P2_3';
  }
  return CTGOV_TO_APP_PHASE[phases[0]] ?? null;
}
