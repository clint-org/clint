import { describe, expect, it } from 'vitest';
import { catalystContextLine } from './group-events';

type ContextArg = Parameters<typeof catalystContextLine>[0];

function row(overrides: Partial<ContextArg> = {}): ContextArg {
  return {
    title: 'Trial End',
    marker_type_name: 'Trial End',
    trial_acronym: 'DELIVER',
    trial_name: 'DELIVER Trial',
    asset_name: 'Farxiga',
    ...overrides,
  };
}

describe('catalystContextLine', () => {
  it('surfaces the trial acronym when the title is the bare marker-type name', () => {
    expect(catalystContextLine(row())).toBe('DELIVER');
  });

  it('matches the marker-type name case-insensitively and trims', () => {
    expect(catalystContextLine(row({ title: '  trial end ' }))).toBe('DELIVER');
  });

  it('falls back to the full trial name when there is no acronym', () => {
    expect(catalystContextLine(row({ trial_acronym: null }))).toBe('DELIVER Trial');
  });

  it('falls back to the asset name when there is no trial', () => {
    expect(
      catalystContextLine(row({ trial_acronym: null, trial_name: null })),
    ).toBe('Farxiga');
  });

  it('returns null when the title already carries its own context', () => {
    expect(catalystContextLine(row({ title: 'DELIVER topline readout' }))).toBeNull();
  });

  it('returns null when a generic title has no trial or asset to anchor it', () => {
    expect(
      catalystContextLine(
        row({ trial_acronym: null, trial_name: null, asset_name: null }),
      ),
    ).toBeNull();
  });

  it('returns null for an empty title', () => {
    expect(catalystContextLine(row({ title: '', marker_type_name: '' }))).toBeNull();
  });
});
