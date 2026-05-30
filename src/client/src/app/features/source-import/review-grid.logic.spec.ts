import { describe, it, expect } from 'vitest';
import { entityState, deriveTrialFlags, deriveAssetFlags, duplicateTrialIndexes, deriveCtgovFlag, deriveFuzzyFlag, readableSummary, blockingReason } from './review-grid.logic';

describe('entityState', () => {
  it('is existing when the entity has a match', () => {
    expect(entityState({ match: 'abc' })).toBe('existing');
  });
  it('is existing when the entity has an existing_id', () => {
    expect(entityState({ existing_id: 'id-1' })).toBe('existing');
  });
  it('is new when neither match nor existing_id is present', () => {
    expect(entityState({ name: 'Foo' })).toBe('new');
  });
});

describe('deriveTrialFlags', () => {
  it('flags a trial with no asset link as blocking', () => {
    const flags = deriveTrialFlags({ name: 'NCT1' });
    expect(flags).toContainEqual({ id: 'no-asset', tier: 'blocking', label: 'No asset' });
  });
  it('does not flag a trial that has asset_ref', () => {
    const flags = deriveTrialFlags({ name: 'NCT1', asset_ref: 0 });
    expect(flags.some((f) => f.id === 'no-asset')).toBe(false);
  });
  it('flags missing indication as attention', () => {
    const flags = deriveTrialFlags({ name: 'NCT1', asset_ref: 0 });
    expect(flags).toContainEqual({ id: 'no-indication', tier: 'attention', label: 'No indication' });
  });
  it('does not flag missing indication when indication is present', () => {
    const flags = deriveTrialFlags({ name: 'NCT1', asset_ref: 0, indication: 'Obesity' });
    expect(flags.some((f) => f.id === 'no-indication')).toBe(false);
  });
  it('flags observational study_type as attention', () => {
    const flags = deriveTrialFlags({ name: 'NCT1', asset_ref: 0, indication: 'X', study_type: 'Observational' });
    expect(flags).toContainEqual({ id: 'observational', tier: 'attention', label: 'Observational' });
  });
  it('flags missing phase or status as attention', () => {
    const flags = deriveTrialFlags({ name: 'NCT1', asset_ref: 0, indication: 'X', phase: '' });
    expect(flags.some((f) => f.id === 'missing-phase-status')).toBe(true);
  });
});

describe('deriveAssetFlags', () => {
  it('flags an asset with no moa and no roa as attention', () => {
    const flags = deriveAssetFlags({ name: 'Foo' });
    expect(flags).toContainEqual({ id: 'no-moa-roa', tier: 'attention', label: 'No MOA/ROA' });
  });
  it('does not flag when moa is present', () => {
    const flags = deriveAssetFlags({ name: 'Foo', moa: 'GLP-1' });
    expect(flags.some((f) => f.id === 'no-moa-roa')).toBe(false);
  });
});

describe('duplicateTrialIndexes', () => {
  it('returns indexes of trials sharing the same identifier', () => {
    const trials = [
      { identifier: 'NCT1' }, { identifier: 'NCT2' }, { identifier: 'NCT1' },
    ];
    expect(duplicateTrialIndexes(trials)).toEqual(new Set([0, 2]));
  });
  it('ignores blank identifiers', () => {
    const trials = [{ identifier: '' }, { identifier: '' }];
    expect(duplicateTrialIndexes(trials)).toEqual(new Set());
  });
  it('returns empty when all identifiers are unique', () => {
    const trials = [{ identifier: 'NCT1' }, { identifier: 'NCT2' }];
    expect(duplicateTrialIndexes(trials)).toEqual(new Set());
  });
});

describe('deriveCtgovFlag', () => {
  it('flags when more than one ctgov candidate needs a pick', () => {
    expect(deriveCtgovFlag(2)).toEqual({ id: 'ctgov-pick', tier: 'attention', label: 'CT.gov: pick match' });
  });
  it('returns null for one or zero candidates', () => {
    expect(deriveCtgovFlag(1)).toBeNull();
    expect(deriveCtgovFlag(0)).toBeNull();
  });
});

describe('deriveFuzzyFlag', () => {
  it('flags when fuzzy alternates exist', () => {
    expect(deriveFuzzyFlag(3)).toEqual({ id: 'fuzzy', tier: 'attention', label: 'Uncertain match' });
  });
  it('returns null when no alternates', () => {
    expect(deriveFuzzyFlag(0)).toBeNull();
  });
});

describe('readableSummary', () => {
  it('formats selected counts in domain words, omitting zero buckets', () => {
    expect(readableSummary({ companies: 3, assets: 6, trials: 6, markers: 0, events: 0 }))
      .toBe('3 companies, 6 assets, 6 trials');
  });
  it('singularises counts of one', () => {
    expect(readableSummary({ companies: 1, assets: 1, trials: 0, markers: 0, events: 0 }))
      .toBe('1 company, 1 asset');
  });
  it('returns "nothing selected" when all zero', () => {
    expect(readableSummary({ companies: 0, assets: 0, trials: 0, markers: 0, events: 0 }))
      .toBe('nothing selected');
  });
});

describe('blockingReason', () => {
  it('reports the count of trials missing an asset', () => {
    expect(blockingReason({ noAsset: 2, duplicates: 0 })).toBe('2 trials need an asset');
  });
  it('reports duplicates', () => {
    expect(blockingReason({ noAsset: 0, duplicates: 3 })).toBe('3 duplicate trials in this batch');
  });
  it('returns null when nothing blocks', () => {
    expect(blockingReason({ noAsset: 0, duplicates: 0 })).toBeNull();
  });
});
