import { describe, expect, it } from 'vitest';

import {
  CLINT_MARK_POINTS,
  CLINT_MARK_VIEWBOX,
  clintMarkStrokes,
  clintMarkSvgDataUri,
} from './clint-mark';

describe('clintMarkStrokes', () => {
  it('returns the documented tier for each size band', () => {
    expect(clintMarkStrokes(14)).toEqual({ outer: 7, middle: 9, inner: 11 });
    expect(clintMarkStrokes(16)).toEqual({ outer: 7, middle: 9, inner: 11 });
    expect(clintMarkStrokes(20)).toEqual({ outer: 5, middle: 7, inner: 9 });
    expect(clintMarkStrokes(28)).toEqual({ outer: 4, middle: 5.5, inner: 7.5 });
    expect(clintMarkStrokes(36)).toEqual({ outer: 2.5, middle: 3.5, inner: 5 });
    expect(clintMarkStrokes(96)).toEqual({ outer: 1.5, middle: 2.2, inner: 3 });
  });
});

describe('clintMarkSvgDataUri', () => {
  it('emits a standalone SVG with all three polylines and the given colors', () => {
    const uri = clintMarkSvgDataUri(64, { outer: '#cbd5e1', middle: '#94a3b8', inner: '#0d9488' });
    expect(uri.startsWith('data:image/svg+xml;utf8,')).toBe(true);
    const svg = decodeURIComponent(uri.slice('data:image/svg+xml;utf8,'.length));
    expect(svg).toContain(`viewBox="${CLINT_MARK_VIEWBOX}"`);
    expect(svg).toContain(CLINT_MARK_POINTS.outer);
    expect(svg).toContain(CLINT_MARK_POINTS.middle);
    expect(svg).toContain(CLINT_MARK_POINTS.inner);
    expect(svg).toContain('#0d9488');
    expect(svg).toContain('stroke-linecap="round"');
  });
});
