import { describe, expect, it } from 'vitest';

import { INNER_RADIUS, OUTER_RADIUS, RINGS, ringRadius } from './bullseye-geometry';

// devRank convention: 0 = PRECLIN ... 6 = LAUNCHED. LAUNCHED is always the
// innermost ring; the earliest *tracked* phase is the outer rim.

describe('ringRadius default (7 rings, preclinical tracked)', () => {
  it('places LAUNCHED at the inner radius and PRECLIN at the outer rim', () => {
    expect(ringRadius(6)).toBeCloseTo(INNER_RADIUS);
    expect(ringRadius(0)).toBeCloseTo(OUTER_RADIUS);
  });

  it('spaces the seven rings evenly', () => {
    const radii = [0, 1, 2, 3, 4, 5, 6].map((d) => ringRadius(d));
    const step = (OUTER_RADIUS - INNER_RADIUS) / (RINGS - 1);
    for (let i = 1; i < radii.length; i += 1) {
      // radii descend from PRECLIN(outer) to LAUNCHED(inner) by a constant step
      expect(radii[i - 1] - radii[i]).toBeCloseTo(step);
    }
  });

  it('passing ringCount = RINGS matches the default', () => {
    for (let d = 0; d <= 6; d += 1) {
      expect(ringRadius(d, RINGS)).toBeCloseTo(ringRadius(d));
    }
  });
});

describe('ringRadius rescaled to 6 rings (preclinical hidden)', () => {
  it('places P1 (the new outermost) at the outer rim with no empty gap', () => {
    expect(ringRadius(1, 6)).toBeCloseTo(OUTER_RADIUS);
  });

  it('keeps LAUNCHED at the inner radius', () => {
    expect(ringRadius(6, 6)).toBeCloseTo(INNER_RADIUS);
  });

  it('spaces the six tracked rings (P1..LAUNCHED) evenly', () => {
    const radii = [1, 2, 3, 4, 5, 6].map((d) => ringRadius(d, 6));
    const step = (OUTER_RADIUS - INNER_RADIUS) / (6 - 1);
    for (let i = 1; i < radii.length; i += 1) {
      expect(radii[i - 1] - radii[i]).toBeCloseTo(step);
    }
    // outermost tracked ring reaches the rim; innermost sits at the center
    expect(radii[0]).toBeCloseTo(OUTER_RADIUS);
    expect(radii[radii.length - 1]).toBeCloseTo(INNER_RADIUS);
  });
});
