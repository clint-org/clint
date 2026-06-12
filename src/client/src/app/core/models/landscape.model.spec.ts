import { describe, expect, it } from 'vitest';

import {
  clampTimePeriod,
  formatTimePeriod,
  spanOverlapsRange,
  timePeriodToRange,
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
