import { describe, expect, it } from 'vitest';

import { phaseOutlinePath } from './phase-bar-outline';

describe('phaseOutlinePath', () => {
  const args = (oL: boolean, oR: boolean) => phaseOutlinePath(10, 100, 8, 14, 3, oL, oR);

  it('returns empty for a zero/negative width', () => {
    expect(phaseOutlinePath(0, 0, 8, 14, 3, false, false)).toBe('');
    expect(phaseOutlinePath(0, -5, 8, 14, 3, true, true)).toBe('');
  });

  it('closes the path (Z) when both edges are closed', () => {
    expect(args(false, false)).toMatch(/Z$/);
  });

  it('does not cap the left edge when openLeft (no Z, starts at the left edge x)', () => {
    const d = args(true, false);
    expect(d).not.toMatch(/Z$/);
    expect(d.startsWith('M 10,8')).toBe(true); // begins flush at the clipped left edge
  });

  it('does not cap the right edge when openRight', () => {
    const d = args(false, true);
    expect(d).not.toMatch(/Z$/);
    expect(d.startsWith('M 110,8')).toBe(true); // begins at the right edge, traces back
  });

  it('strokes only the top and bottom rails when both edges are open', () => {
    const d = args(true, true);
    expect(d).toBe('M 10,8 L 110,8 M 10,22 L 110,22');
  });

  it('clamps the corner radius to half the width on a very narrow bar', () => {
    // width 4 -> r clamps to 2; the closed path should use r=2 corners.
    const d = phaseOutlinePath(0, 4, 8, 14, 3, false, false);
    expect(d).toContain('M 2,8'); // x + r where r = 2
  });
});
