import { describe, it, expect } from 'vitest';
import { linkTrialsByNct } from './link-trials-by-nct';
import type { ExtractionResult, InventorySnapshot } from './types';

const EXISTING_TRIAL_ID = '00000000-0000-4000-8000-000000000001';

function inventory(trials: { id: string; name: string; identifier?: string }[]): InventorySnapshot {
  return {
    companies: [],
    assets: [],
    trials: trials.map((t) => ({ ...t, asset_id: 'a' })),
    indications: [],
    event_types: [],
    event_type_categories: [],
    mechanisms_of_action: [],
    routes_of_administration: [],
    hash: 'h',
  };
}

function proposals(
  trials: { match: unknown; name: string; nct_id?: string | null }[]
): ExtractionResult {
  return {
    source_summary: 's',
    source_title: null,
    source_date: null,
    companies: [],
    assets: [],
    trials: trials as unknown as ExtractionResult['trials'],
    events: [],
  } as unknown as ExtractionResult;
}

describe('linkTrialsByNct', () => {
  it('relinks a new trial to an existing inventory trial sharing its NCT', () => {
    const p = proposals([{ match: { kind: 'new', name: 'CORE2' }, name: 'CORE2', nct_id: 'NCT01234567' }]);
    const links = linkTrialsByNct(p, inventory([{ id: EXISTING_TRIAL_ID, name: 'CORE', identifier: 'NCT01234567' }]));
    expect(links).toEqual([{ index: 0, trialId: EXISTING_TRIAL_ID, nctId: 'NCT01234567' }]);
    expect(p.trials[0].match).toEqual({ kind: 'existing', id: EXISTING_TRIAL_ID });
  });

  it('matches case-insensitively against the inventory identifier', () => {
    const p = proposals([{ match: { kind: 'new', name: 'X' }, name: 'X', nct_id: 'NCT01234567' }]);
    const links = linkTrialsByNct(p, inventory([{ id: EXISTING_TRIAL_ID, name: 'X', identifier: 'nct01234567' }]));
    expect(links).toHaveLength(1);
    expect(p.trials[0].match).toEqual({ kind: 'existing', id: EXISTING_TRIAL_ID });
  });

  it('leaves a trial new when no inventory NCT matches', () => {
    const p = proposals([{ match: { kind: 'new', name: 'X' }, name: 'X', nct_id: 'NCT09999999' }]);
    const links = linkTrialsByNct(p, inventory([{ id: EXISTING_TRIAL_ID, name: 'Y', identifier: 'NCT01234567' }]));
    expect(links).toHaveLength(0);
    expect(p.trials[0].match).toEqual({ kind: 'new', name: 'X' });
  });

  it('ignores trials with no NCT', () => {
    const p = proposals([{ match: { kind: 'new', name: 'X' }, name: 'X', nct_id: null }]);
    const links = linkTrialsByNct(p, inventory([{ id: EXISTING_TRIAL_ID, name: 'X', identifier: 'NCT01234567' }]));
    expect(links).toHaveLength(0);
    expect(p.trials[0].match).toEqual({ kind: 'new', name: 'X' });
  });

  it('does not touch trials already matched to an existing record', () => {
    const p = proposals([{ match: { kind: 'existing', id: 'other' }, name: 'X', nct_id: 'NCT01234567' }]);
    const links = linkTrialsByNct(p, inventory([{ id: EXISTING_TRIAL_ID, name: 'X', identifier: 'NCT01234567' }]));
    expect(links).toHaveLength(0);
    expect(p.trials[0].match).toEqual({ kind: 'existing', id: 'other' });
  });
});
