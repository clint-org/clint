import { describe, expect, it } from 'vitest';

import { contrastOnWhite, textColorOnWhite } from './color-contrast';

describe('contrastOnWhite', () => {
  it('white on white is 1, black on white is 21', () => {
    expect(contrastOnWhite('#ffffff')).toBeCloseTo(1, 2);
    expect(contrastOnWhite('#000000')).toBeCloseTo(21, 0);
  });

  it('slate-400 fails AA normal text on white', () => {
    expect(contrastOnWhite('#94a3b8')).toBeLessThan(4.5);
  });

  it('slate-600 passes AA normal text on white', () => {
    expect(contrastOnWhite('#475569')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('textColorOnWhite', () => {
  const markerPalette = [
    '#16a34a', // green (data)
    '#64748b', // slate (trial milestones)
    '#f97316', // orange (regulatory)
    '#3b82f6', // blue (approval)
    '#8b5cf6', // violet (launch)
    '#f59e0b', // amber (LOE)
  ];

  it('every marker palette color resolves to an AA-passing text color', () => {
    for (const color of markerPalette) {
      expect(contrastOnWhite(textColorOnWhite(color))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('returns passing colors unchanged', () => {
    expect(textColorOnWhite('#475569')).toBe('#475569');
  });

  it('keeps the hue family while darkening', () => {
    const darkened = textColorOnWhite('#f97316');
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(darkened.slice(i, i + 2), 16));
    // Still recognizably orange: red dominates green dominates blue.
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('falls back to slate-600 for invalid input', () => {
    expect(textColorOnWhite('not-a-color')).toBe('#475569');
  });

  it('handles arbitrary user-defined marker colors', () => {
    for (const color of ['#ffff00', '#00ffff', '#ff00ff', '#cccccc']) {
      expect(contrastOnWhite(textColorOnWhite(color))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
