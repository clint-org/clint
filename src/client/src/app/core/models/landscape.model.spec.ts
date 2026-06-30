import { describe, expect, it } from 'vitest';

import {
  EMPTY_LANDSCAPE_FILTERS,
  clampTimePeriod,
  formatTimePeriod,
  groupAssetsIntoSpokes,
  hasActiveLandscapeFilters,
  placementPhase,
  placementRank,
  spanOverlapsRange,
  spokeGroupingNoun,
  timePeriodToRange,
  type BullseyeAsset,
  type LandscapeFilters,
  type TimePeriodFilter,
} from './landscape.model';

function tp(partial: Partial<TimePeriodFilter>): TimePeriodFilter {
  return { startYear: null, startQuarter: null, endYear: null, endQuarter: null, ...partial };
}

describe('timePeriodToRange', () => {
  it('returns fully open bounds for null', () => {
    expect(timePeriodToRange(null)).toEqual({ start: null, end: null });
  });

  it('maps a year-only window to Jan 1 through Dec 31', () => {
    expect(timePeriodToRange(tp({ startYear: 2025, endYear: 2027 }))).toEqual({
      start: '2025-01-01',
      end: '2027-12-31',
    });
  });

  it('maps quarters to their first and last days', () => {
    expect(
      timePeriodToRange(tp({ startYear: 2025, startQuarter: 2, endYear: 2026, endQuarter: 4 }))
    ).toEqual({ start: '2025-04-01', end: '2026-12-31' });
    expect(
      timePeriodToRange(tp({ startYear: 2025, startQuarter: 4, endYear: 2026, endQuarter: 1 }))
    ).toEqual({ start: '2025-10-01', end: '2026-03-31' });
    expect(
      timePeriodToRange(tp({ startYear: 2025, startQuarter: 3, endYear: 2025, endQuarter: 3 }))
    ).toEqual({ start: '2025-07-01', end: '2025-09-30' });
  });

  it('leaves an unset side open', () => {
    expect(timePeriodToRange(tp({ startYear: 2025, startQuarter: 2 }))).toEqual({
      start: '2025-04-01',
      end: null,
    });
    expect(timePeriodToRange(tp({ endYear: 2027 }))).toEqual({
      start: null,
      end: '2027-12-31',
    });
  });
});

describe('spanOverlapsRange', () => {
  const range = { start: '2025-01-01', end: '2026-12-31' };

  it('passes a span fully inside the range', () => {
    expect(spanOverlapsRange('2025-06-01', '2025-09-01', range)).toBe(true);
  });

  it('passes spans straddling either edge', () => {
    expect(spanOverlapsRange('2024-01-01', '2025-01-01', range)).toBe(true); // touches start, inclusive
    expect(spanOverlapsRange('2026-12-31', '2028-01-01', range)).toBe(true); // touches end, inclusive
  });

  it('rejects spans fully outside the range', () => {
    expect(spanOverlapsRange('2023-01-01', '2024-12-31', range)).toBe(false);
    expect(spanOverlapsRange('2027-01-01', '2027-06-01', range)).toBe(false);
  });

  it('treats a null span bound as open-ended', () => {
    expect(spanOverlapsRange(null, '2024-06-01', range)).toBe(false); // ends before window
    expect(spanOverlapsRange(null, '2025-06-01', range)).toBe(true);
    expect(spanOverlapsRange('2027-06-01', null, range)).toBe(false); // starts after window
    expect(spanOverlapsRange('2026-06-01', null, range)).toBe(true);
  });

  it('treats a null range bound as open-ended', () => {
    expect(spanOverlapsRange('2010-01-01', '2010-12-31', { start: null, end: '2026-12-31' })).toBe(
      true
    );
    expect(spanOverlapsRange('2030-01-01', '2030-12-31', { start: '2025-01-01', end: null })).toBe(
      true
    );
  });
});

describe('clampTimePeriod', () => {
  it('returns the period unchanged when From is not after To', () => {
    const p = tp({ startYear: 2025, endYear: 2026 });
    expect(clampTimePeriod(p)).toEqual(p);
  });

  it('clamps To up to From when From is after To', () => {
    expect(clampTimePeriod(tp({ startYear: 2027, endYear: 2025 }))).toEqual(
      tp({ startYear: 2027, endYear: 2027 })
    );
  });

  it('clamps on quarter granularity within the same year', () => {
    expect(
      clampTimePeriod(tp({ startYear: 2026, startQuarter: 3, endYear: 2026, endQuarter: 1 }))
    ).toEqual(tp({ startYear: 2026, startQuarter: 3, endYear: 2026, endQuarter: 3 }));
  });

  it('does not clamp a year-quarter From against a full-year To in the same year', () => {
    // From Q3 2026, To 2026 (= through Q4 2026): valid, no clamp.
    const p = tp({ startYear: 2026, startQuarter: 3, endYear: 2026 });
    expect(clampTimePeriod(p)).toEqual(p);
  });

  it('leaves open-ended periods alone', () => {
    const p = tp({ startYear: 2027 });
    expect(clampTimePeriod(p)).toEqual(p);
  });
});

describe('formatTimePeriod', () => {
  it('formats a closed year window', () => {
    expect(formatTimePeriod(tp({ startYear: 2025, endYear: 2027 }))).toBe('2025 - 2027');
  });

  it('formats quarters when set', () => {
    expect(
      formatTimePeriod(tp({ startYear: 2025, startQuarter: 2, endYear: 2026, endQuarter: 4 }))
    ).toBe('Q2 2025 - Q4 2026');
    expect(formatTimePeriod(tp({ startYear: 2025, endYear: 2026, endQuarter: 2 }))).toBe(
      '2025 - Q2 2026'
    );
  });

  it('formats open-ended windows', () => {
    expect(formatTimePeriod(tp({ startYear: 2025, startQuarter: 2 }))).toBe('From Q2 2025');
    expect(formatTimePeriod(tp({ endYear: 2027 }))).toBe('Through 2027');
  });
});

describe('degenerate inputs', () => {
  it('treats an all-null period as fully open', () => {
    expect(timePeriodToRange(tp({}))).toEqual({ start: null, end: null });
  });

  it('passes a fully dateless span against any range', () => {
    expect(spanOverlapsRange(null, null, { start: '2025-01-01', end: '2026-12-31' })).toBe(true);
  });

  it('formats an all-null period as empty string', () => {
    expect(formatTimePeriod(tp({}))).toBe('');
  });
});

describe('hasActiveLandscapeFilters', () => {
  function f(partial: Partial<LandscapeFilters>): LandscapeFilters {
    return { ...EMPTY_LANDSCAPE_FILTERS, ...partial };
  }

  it('is false for the empty filter set', () => {
    expect(hasActiveLandscapeFilters({ ...EMPTY_LANDSCAPE_FILTERS })).toBe(false);
  });

  it('is true when any id list is non-empty', () => {
    expect(hasActiveLandscapeFilters(f({ companyIds: ['c1'] }))).toBe(true);
    expect(hasActiveLandscapeFilters(f({ assetIds: ['a1'] }))).toBe(true);
    expect(hasActiveLandscapeFilters(f({ phases: ['P3'] }))).toBe(true);
    expect(hasActiveLandscapeFilters(f({ markerCategoryIds: ['m1'] }))).toBe(true);
  });

  it('is true when a time period is set', () => {
    expect(
      hasActiveLandscapeFilters(
        f({ timePeriod: { startYear: 2025, startQuarter: null, endYear: null, endQuarter: null } })
      )
    ).toBe(true);
  });

  it('is false when timePeriod is explicitly null', () => {
    expect(hasActiveLandscapeFilters(f({ timePeriod: null }))).toBe(false);
  });

  it('ignores a set timePeriod when ignoreTimePeriod is passed', () => {
    const period = f({
      timePeriod: { startYear: 2025, startQuarter: null, endYear: null, endQuarter: null },
    });
    expect(hasActiveLandscapeFilters(period)).toBe(true);
    expect(hasActiveLandscapeFilters(period, { ignoreTimePeriod: true })).toBe(false);
  });

  it('still reports active when a non-period filter is set under ignoreTimePeriod', () => {
    const both = f({
      companyIds: ['c1'],
      timePeriod: { startYear: 2025, startQuarter: null, endYear: null, endQuarter: null },
    });
    expect(hasActiveLandscapeFilters(both, { ignoreTimePeriod: true })).toBe(true);
  });
});

describe('spokeGroupingNoun', () => {
  it('returns the plural noun for each grouping', () => {
    expect(spokeGroupingNoun('company', 12)).toBe('companies');
    expect(spokeGroupingNoun('indication', 5)).toBe('indications');
    expect(spokeGroupingNoun('moa', 3)).toBe('mechanisms');
    expect(spokeGroupingNoun('roa', 4)).toBe('routes');
    expect(spokeGroupingNoun('asset', 22)).toBe('assets');
  });

  it('returns the singular noun when count is exactly 1', () => {
    expect(spokeGroupingNoun('company', 1)).toBe('company');
    expect(spokeGroupingNoun('moa', 1)).toBe('mechanism');
    expect(spokeGroupingNoun('roa', 1)).toBe('route');
  });

  it('uses plural for zero', () => {
    expect(spokeGroupingNoun('company', 0)).toBe('companies');
  });
});

// A multi-indication asset whose approval lifted ONE indication (issue #171):
// Severe Hypertriglyceridemia is APPROVED (rank 5) while Familial Chylomicronemia
// Syndrome is still P3 (rank 3). highest_phase is the asset max (APPROVED).
function olezarsenLike(): BullseyeAsset {
  return {
    id: 'asset-olz',
    name: 'Olezarsen',
    generic_name: 'olezarsen',
    logo_url: null,
    company_id: 'co-ionis',
    company_name: 'Ionis',
    company_logo_url: null,
    highest_phase: 'APPROVED',
    highest_phase_rank: 5,
    trials: [],
    recent_markers: [],
    moas: [{ id: 'moa-aso', name: 'ASO' }],
    roas: [{ id: 'roa-sc', name: 'Subcutaneous', abbreviation: 'SC' }],
    indications: [
      { id: 'ind-fcs', name: 'Familial Chylomicronemia Syndrome', abbreviation: 'FCS', development_status: 'P3' },
      { id: 'ind-shtg', name: 'Severe Hypertriglyceridemia', abbreviation: 'SHTG', development_status: 'APPROVED' },
    ],
    intelligence_count: 0,
    has_recent_activity: false,
    recent_changes_count: 0,
    most_recent_change_type: null,
    most_recent_change_event_id: null,
  };
}

describe('placementRank (issue #171: per-indication bullseye placement)', () => {
  const asset = olezarsenLike();

  it('uses the spoke indication status, not the asset max, under indication grouping', () => {
    expect(placementRank(asset, 'indication', 'ind-fcs')).toBe(3); // P3, not APPROVED
    expect(placementRank(asset, 'indication', 'ind-shtg')).toBe(5); // APPROVED
  });

  it('uses the asset max for non-indication groupings', () => {
    expect(placementRank(asset, 'company', 'co-ionis')).toBe(5);
    expect(placementRank(asset, 'moa', 'moa-aso')).toBe(5);
    expect(placementRank(asset, 'asset', 'asset-olz')).toBe(5);
  });

  it('falls back to the asset max when per-indication status is absent', () => {
    const noStatus: BullseyeAsset = {
      ...asset,
      indications: [{ id: 'ind-fcs', name: 'FCS', abbreviation: null }],
    };
    expect(placementRank(noStatus, 'indication', 'ind-fcs')).toBe(5);
  });

  it('falls back to the asset max when the spoke indication is not on the asset', () => {
    expect(placementRank(asset, 'indication', 'ind-unknown')).toBe(5);
  });
});

describe('placementPhase (label counterpart used by the export)', () => {
  const asset = olezarsenLike();

  it('returns the spoke indication phase under indication grouping', () => {
    expect(placementPhase(asset, 'indication', 'ind-fcs')).toBe('P3');
    expect(placementPhase(asset, 'indication', 'ind-shtg')).toBe('APPROVED');
  });

  it('returns the asset max phase for non-indication groupings and fallbacks', () => {
    expect(placementPhase(asset, 'company', 'co-ionis')).toBe('APPROVED');
    expect(placementPhase(asset, 'indication', 'ind-unknown')).toBe('APPROVED');
  });
});

describe('groupAssetsIntoSpokes (issue #171)', () => {
  it('ranks each indication spoke by that indication status, not the asset max', () => {
    const { spokes } = groupAssetsIntoSpokes([olezarsenLike()], 'indication');
    const fcs = spokes.find((s) => s.id === 'ind-fcs');
    const shtg = spokes.find((s) => s.id === 'ind-shtg');
    expect(fcs?.highest_phase_rank).toBe(3);
    expect(shtg?.highest_phase_rank).toBe(5);
  });

  it('keeps the asset max for a non-indication grouping (company)', () => {
    const { spokes } = groupAssetsIntoSpokes([olezarsenLike()], 'company');
    expect(spokes).toHaveLength(1);
    expect(spokes[0].highest_phase_rank).toBe(5);
  });
});
