import { describe, it, expect } from 'vitest';
import { entityState, deriveTrialFlags, deriveAssetFlags, duplicateTrialIndexes, deriveCtgovFlag, deriveFuzzyFlag, readableSummary, blockingReason, trialMissingAsset, resolveTrialAssetIndex, resolveTrialAssetIndexes, resolveTrialPrimaryAssetIndex, orphanTrialIndexes } from './review-grid.logic';

describe('entityState', () => {
  it('is existing when match.kind is existing', () => {
    expect(entityState({ match: { kind: 'existing', id: 'id-1' } })).toBe('existing');
  });
  it('is existing when the entity has an existing_id', () => {
    expect(entityState({ existing_id: 'id-1' })).toBe('existing');
  });
  it('is new when match.kind is new (the match object is always present)', () => {
    expect(entityState({ match: { kind: 'new', name: 'Foo' } })).toBe('new');
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
  it('does not flag no-asset when the trial matched an existing record', () => {
    const flags = deriveTrialFlags({ name: 'NCT1', match: { kind: 'existing', id: 'x' } });
    expect(flags.some((f) => f.id === 'no-asset')).toBe(false);
  });
  it('flags no-asset when match.kind is new and there is no asset_ref', () => {
    const flags = deriveTrialFlags({ name: 'NCT1', match: { kind: 'new' } });
    expect(flags).toContainEqual({ id: 'no-asset', tier: 'blocking', label: 'No asset' });
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

describe('trialMissingAsset (exported, shared with the component gate)', () => {
  it('is missing when new and no asset_ref', () => {
    expect(trialMissingAsset({ match: { kind: 'new' } })).toBe(true);
  });
  it('is not missing when asset_ref is present (including 0)', () => {
    expect(trialMissingAsset({ asset_ref: 0 })).toBe(false);
  });
  it('is not missing when matched to an existing record', () => {
    expect(trialMissingAsset({ match: { kind: 'existing', id: 'x' } })).toBe(false);
  });
  it('is not missing when existing_id is set even without asset_ref', () => {
    expect(trialMissingAsset({ existing_id: 'id-1' })).toBe(false);
  });
});

describe('resolveTrialAssetIndex', () => {
  it('returns the asset_ref when it is a valid in-range index', () => {
    expect(resolveTrialAssetIndex({ asset_ref: 1 }, 2)).toBe(1);
    expect(resolveTrialAssetIndex({ asset_ref: 0 }, 2)).toBe(0);
  });
  it('returns null when asset_ref is missing', () => {
    expect(resolveTrialAssetIndex({ name: 'NCT1' }, 2)).toBeNull();
  });
  it('returns null when asset_ref is null', () => {
    expect(resolveTrialAssetIndex({ asset_ref: null }, 2)).toBeNull();
  });
  it('returns null when asset_ref is out of range', () => {
    expect(resolveTrialAssetIndex({ asset_ref: 5 }, 2)).toBeNull();
    expect(resolveTrialAssetIndex({ asset_ref: 2 }, 2)).toBeNull();
  });
  it('returns null when asset_ref is negative or non-integer', () => {
    expect(resolveTrialAssetIndex({ asset_ref: -1 }, 2)).toBeNull();
    expect(resolveTrialAssetIndex({ asset_ref: 1.5 }, 2)).toBeNull();
  });
});

describe('orphanTrialIndexes', () => {
  it('returns indices of trials that do not nest under any asset', () => {
    const trials = [
      { name: 'A', asset_ref: 0 }, // nests
      { name: 'B' }, // no ref -> orphan
      { name: 'C', asset_ref: 9 }, // out of range -> orphan
      { name: 'D', asset_ref: 1 }, // nests
    ];
    expect(orphanTrialIndexes(trials, 2)).toEqual([1, 2]);
  });
  it('returns an empty array when every trial nests', () => {
    expect(orphanTrialIndexes([{ asset_ref: 0 }, { asset_ref: 1 }], 2)).toEqual([]);
  });
  it('treats a master-protocol trial with no asset_ref as an orphan', () => {
    // The motivating case: an NCT master protocol testing two assets cannot
    // pick a single asset_ref, so it must remain visible rather than vanish.
    expect(orphanTrialIndexes([{ name: 'NCT07165028' }], 2)).toEqual([0]);
  });
  it('does not orphan a trial that lists multiple valid asset_refs', () => {
    expect(orphanTrialIndexes([{ asset_refs: [0, 1] }], 2)).toEqual([]);
  });
  it('orphans a trial whose asset_refs are all out of range', () => {
    expect(orphanTrialIndexes([{ asset_refs: [5, 9] }], 2)).toEqual([0]);
  });
});

describe('resolveTrialAssetIndexes (multi-asset nesting)', () => {
  it('returns every valid in-range index from asset_refs', () => {
    expect(resolveTrialAssetIndexes({ asset_refs: [0, 1] }, 2)).toEqual([0, 1]);
  });
  it('drops out-of-range and de-duplicates, preserving order', () => {
    expect(resolveTrialAssetIndexes({ asset_refs: [1, 5, 1, 0] }, 2)).toEqual([1, 0]);
  });
  it('falls back to the legacy scalar asset_ref', () => {
    expect(resolveTrialAssetIndexes({ asset_ref: 1 }, 2)).toEqual([1]);
  });
  it('returns empty for no refs or an empty array', () => {
    expect(resolveTrialAssetIndexes({ name: 'x' }, 2)).toEqual([]);
    expect(resolveTrialAssetIndexes({ asset_refs: [] }, 2)).toEqual([]);
  });
});

describe('resolveTrialPrimaryAssetIndex', () => {
  it('uses primary_asset_ref when valid and among the refs', () => {
    expect(resolveTrialPrimaryAssetIndex({ asset_refs: [0, 1], primary_asset_ref: 1 }, 2)).toBe(1);
  });
  it('falls back to the first ref when primary is missing or not a member', () => {
    expect(resolveTrialPrimaryAssetIndex({ asset_refs: [0, 1] }, 2)).toBe(0);
    expect(resolveTrialPrimaryAssetIndex({ asset_refs: [0, 1], primary_asset_ref: 5 }, 2)).toBe(0);
    expect(resolveTrialPrimaryAssetIndex({ asset_refs: [0, 1], primary_asset_ref: 1 }, 2)).toBe(1);
  });
  it('returns null when the trial has no valid refs', () => {
    expect(resolveTrialPrimaryAssetIndex({ asset_refs: [] }, 2)).toBeNull();
  });
  it('resolveTrialAssetIndex (singular) returns the primary', () => {
    expect(resolveTrialAssetIndex({ asset_refs: [0, 1], primary_asset_ref: 1 }, 2)).toBe(1);
  });
});

describe('trialMissingAsset with asset_refs', () => {
  it('is not missing when asset_refs has entries', () => {
    expect(trialMissingAsset({ asset_refs: [0] })).toBe(false);
  });
  it('is missing when new and asset_refs is empty', () => {
    expect(trialMissingAsset({ match: { kind: 'new' }, asset_refs: [] })).toBe(true);
  });
  it('is not missing for an existing match even with empty asset_refs', () => {
    expect(trialMissingAsset({ match: { kind: 'existing', id: 'x' }, asset_refs: [] })).toBe(false);
  });
});
