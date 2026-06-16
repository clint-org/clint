import { describe, expect, it } from 'vitest';

import { phaseFadeStops } from './phase-bar-fade';

describe('phaseFadeStops', () => {
  it('returns null when neither edge is open (solid bar, no mask)', () => {
    expect(phaseFadeStops(100, false, false)).toBeNull();
    expect(phaseFadeStops(0, true, true)).toBeNull();
  });

  it('fades only the left edge when openLeft', () => {
    const stops = phaseFadeStops(140, true, false, 14)!;
    expect(stops[0]).toEqual({ offset: 0, opacity: 0 });
    expect(stops[stops.length - 1]).toEqual({ offset: 1, opacity: 1 });
    // a solid stop appears one fade-fraction in (14/140 = 0.1)
    expect(stops.some((s) => s.offset === 0.1 && s.opacity === 1)).toBe(true);
  });

  it('fades only the right edge when openRight', () => {
    const stops = phaseFadeStops(140, false, true, 14)!;
    expect(stops[0]).toEqual({ offset: 0, opacity: 1 });
    expect(stops[stops.length - 1]).toEqual({ offset: 1, opacity: 0 });
    expect(stops.some((s) => s.offset === 0.9 && s.opacity === 1)).toBe(true);
  });

  it('fades both edges, keeping a solid core', () => {
    const stops = phaseFadeStops(140, true, true, 14)!;
    expect(stops[0].opacity).toBe(0);
    expect(stops[stops.length - 1].opacity).toBe(0);
    expect(stops.filter((s) => s.opacity === 1).length).toBe(2); // solid core edges
  });

  it('caps the fade fraction so a narrow bar keeps a core', () => {
    // width 20, fade 14 -> raw frac 0.7, capped to 0.45
    const stops = phaseFadeStops(20, true, false, 14)!;
    expect(stops.some((s) => s.offset === 0.45)).toBe(true);
  });
});
