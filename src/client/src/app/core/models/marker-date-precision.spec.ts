import { describe, expect, it } from 'vitest';

import {
  isApproximate,
  markerExtentLabel,
  markerPeriodFromDate,
  markerPeriodLabel,
  precisionMidpointISO,
} from './marker-date-precision';

describe('markerExtentLabel', () => {
  it('appends "onwards" for an open-ended marker', () => {
    expect(markerExtentLabel("Q3 '24", null, true)).toBe("Q3 '24 onwards");
    // ongoing wins even if an end label is somehow present
    expect(markerExtentLabel("H2 '26", "X", true)).toBe("H2 '26 onwards");
  });

  it('joins start and end for a bounded range', () => {
    expect(markerExtentLabel("Q4 '26", "Q1 '27", false)).toBe("Q4 '26 – Q1 '27");
  });

  it('returns just the start for a point marker', () => {
    expect(markerExtentLabel('March 5, 2026', null, false)).toBe('March 5, 2026');
  });
});

describe('isApproximate', () => {
  it('is false for exact / null, true for fuzzy precisions', () => {
    expect(isApproximate('exact')).toBe(false);
    expect(isApproximate(null)).toBe(false);
    expect(isApproximate(undefined)).toBe(false);
    expect(isApproximate('quarter')).toBe(true);
    expect(isApproximate('month')).toBe(true);
    expect(isApproximate('half')).toBe(true);
    expect(isApproximate('year')).toBe(true);
  });
});

describe('precisionMidpointISO', () => {
  it('places a quarter at the middle month (Q4 2026 -> Nov 15)', () => {
    expect(precisionMidpointISO('quarter', 2026, 1)).toBe('2026-02-15');
    expect(precisionMidpointISO('quarter', 2026, 2)).toBe('2026-05-15');
    expect(precisionMidpointISO('quarter', 2026, 3)).toBe('2026-08-15');
    expect(precisionMidpointISO('quarter', 2026, 4)).toBe('2026-11-15');
  });

  it('places a month at the 15th', () => {
    expect(precisionMidpointISO('month', 2026, 3)).toBe('2026-03-15');
    expect(precisionMidpointISO('month', 2026, 12)).toBe('2026-12-15');
  });

  it('places a half and a year at their midpoints', () => {
    expect(precisionMidpointISO('half', 2026, 1)).toBe('2026-04-01');
    expect(precisionMidpointISO('half', 2026, 2)).toBe('2026-10-01');
    expect(precisionMidpointISO('year', 2026, 1)).toBe('2026-07-01');
  });

  it('keeps the midpoint inside its own period (round-trips through the label)', () => {
    expect(markerPeriodLabel(precisionMidpointISO('quarter', 2026, 4), 'quarter')).toBe("Q4 '26");
    expect(markerPeriodLabel(precisionMidpointISO('half', 2026, 2), 'half')).toBe("H2 '26");
    expect(markerPeriodLabel(precisionMidpointISO('month', 2026, 11), 'month')).toBe("Nov '26");
  });
});

describe('markerPeriodLabel', () => {
  it('returns null for exact dates', () => {
    expect(markerPeriodLabel('2026-11-15', 'exact')).toBeNull();
    expect(markerPeriodLabel(null, 'quarter')).toBeNull();
  });

  it('formats each fuzzy precision', () => {
    expect(markerPeriodLabel('2026-11-15', 'quarter')).toBe("Q4 '26");
    expect(markerPeriodLabel('2026-03-15', 'month')).toBe("Mar '26");
    expect(markerPeriodLabel('2026-10-01', 'half')).toBe("H2 '26");
    expect(markerPeriodLabel('2026-01-10', 'half')).toBe("H1 '26");
    expect(markerPeriodLabel('2026-07-01', 'year')).toBe('2026');
  });
});

describe('markerPeriodFromDate', () => {
  it('recovers the period selectors from a stored midpoint', () => {
    expect(markerPeriodFromDate('2026-11-15', 'quarter')).toEqual({ year: 2026, sub: 4 });
    expect(markerPeriodFromDate('2026-03-15', 'month')).toEqual({ year: 2026, sub: 3 });
    expect(markerPeriodFromDate('2026-10-01', 'half')).toEqual({ year: 2026, sub: 2 });
    expect(markerPeriodFromDate('2026-07-01', 'year')).toEqual({ year: 2026, sub: 1 });
  });
});
