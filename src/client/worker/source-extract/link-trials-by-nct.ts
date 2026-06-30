import { normalizeNctId } from './nct-id';
import type { ExtractionResult, InventorySnapshot } from './types';

export interface NctLink {
  index: number;
  trialId: string;
  nctId: string;
}

// An NCT registry id is a unique key for a study, so a new-trial proposal whose
// nct_id equals an existing inventory trial's identifier is the SAME trial. We
// rewrite its match to that existing record so commit links instead of creating
// a duplicate (the CORE / CORE2 class of bug). Name-fuzzy dedup can't see this;
// only the identifier can. Mutates proposals.trials in place and returns the
// links it made (for logging / resolved-name surfacing).
export function linkTrialsByNct(
  proposals: ExtractionResult,
  inventory: InventorySnapshot
): NctLink[] {
  const byNct = new Map<string, string>();
  for (const t of inventory.trials) {
    const nct = normalizeNctId(t.identifier);
    if (nct && !byNct.has(nct)) byNct.set(nct, t.id);
  }
  if (byNct.size === 0) return [];

  const links: NctLink[] = [];
  proposals.trials.forEach((trial, index) => {
    if (trial.match.kind !== 'new') return;
    const nct = normalizeNctId(trial.nct_id);
    if (!nct) return;
    const trialId = byNct.get(nct);
    if (!trialId) return;
    (trial as Record<string, unknown>)['match'] = { kind: 'existing', id: trialId };
    links.push({ index, trialId, nctId: nct });
  });
  return links;
}
