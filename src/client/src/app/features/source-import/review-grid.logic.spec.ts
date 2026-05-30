import { describe, it, expect } from 'vitest';
import { entityState, deriveTrialFlags, deriveAssetFlags } from './review-grid.logic';

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
