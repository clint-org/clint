import { describe, expect, it } from 'vitest';

import { clampExportScale, MAX_CANVAS_SIDE } from './export-scale.util';

describe('clampExportScale', () => {
  it('returns the target scale when 2x fits comfortably', () => {
    expect(clampExportScale(3000, 2000)).toBe(2);
  });

  it('clamps by width when 2x would exceed the side cap', () => {
    const scale = clampExportScale(12000, 1000);
    expect(scale).toBeCloseTo(MAX_CANVAS_SIDE / 12000, 5);
    expect(12000 * scale).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
  });

  it('clamps by height when the grid is very tall', () => {
    const scale = clampExportScale(1000, 12000);
    expect(scale).toBeCloseTo(MAX_CANVAS_SIDE / 12000, 5);
  });

  it('respects a custom target scale', () => {
    expect(clampExportScale(800, 600, 3)).toBe(3);
  });

  it('falls back to the target on degenerate dimensions', () => {
    expect(clampExportScale(0, 0)).toBe(2);
    expect(clampExportScale(-5, 100)).toBe(2);
  });
});
