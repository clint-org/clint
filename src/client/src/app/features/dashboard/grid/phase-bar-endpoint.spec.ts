import { describe, expect, it } from 'vitest';

import { endpointTreatment } from './phase-bar-endpoint';

describe('endpointTreatment', () => {
  // Exact / null precision -> hard edge (no cap, no caption)
  it('returns hard for exact precision', () => {
    expect(endpointTreatment(false, 'exact')).toBe('hard');
  });

  it('returns hard for null precision (no precision data)', () => {
    expect(endpointTreatment(false, null)).toBe('hard');
  });

  // Approximate precisions -> hollow cap
  it('returns cap for month precision', () => {
    expect(endpointTreatment(false, 'month')).toBe('cap');
  });

  it('returns cap for year precision', () => {
    expect(endpointTreatment(false, 'year')).toBe('cap');
  });

  it('returns cap for quarter precision', () => {
    expect(endpointTreatment(false, 'quarter')).toBe('cap');
  });

  it('returns cap for half precision', () => {
    expect(endpointTreatment(false, 'half')).toBe('cap');
  });

  // Open (ongoing / window-clipped) -> feather regardless of precision
  it('returns feather when open even if precision is month (ongoing wins)', () => {
    expect(endpointTreatment(true, 'month')).toBe('feather');
  });

  it('returns feather when open even if precision is year', () => {
    expect(endpointTreatment(true, 'year')).toBe('feather');
  });

  it('returns feather when open and precision is null', () => {
    expect(endpointTreatment(true, null)).toBe('feather');
  });

  it('returns feather for clipped start even if precision is exact', () => {
    // openLeft (start before window) -> feather regardless
    expect(endpointTreatment(true, 'exact')).toBe('feather');
  });

  // B5 explicit assertion: approximate and ongoing must render differently
  it('approximate-end and ongoing-end yield different treatments (B5 no collision)', () => {
    const approxEnd = endpointTreatment(false, 'month'); // bounded approximate
    const ongoingEnd = endpointTreatment(true, 'month'); // open / ongoing
    expect(approxEnd).not.toBe(ongoingEnd);
    expect(approxEnd).toBe('cap');
    expect(ongoingEnd).toBe('feather');
  });
});
