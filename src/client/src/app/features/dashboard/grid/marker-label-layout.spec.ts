import { describe, expect, it } from 'vitest';

import { visibleLabelMarkerIds } from './marker-label-layout';

const GAP = 38;

describe('visibleLabelMarkerIds', () => {
  it('keeps every label when markers are spread apart', () => {
    const kept = visibleLabelMarkerIds(
      [
        { id: 'a', x: 0 },
        { id: 'b', x: 100 },
        { id: 'c', x: 200 },
      ],
      GAP
    );
    expect(kept).toEqual(new Set(['a', 'b', 'c']));
  });

  it('suppresses the right neighbor of a colliding pair', () => {
    const kept = visibleLabelMarkerIds(
      [
        { id: 'a', x: 0 },
        { id: 'b', x: 20 },
      ],
      GAP
    );
    expect(kept).toEqual(new Set(['a']));
  });

  it('keeps the first of a same-x stack only', () => {
    const kept = visibleLabelMarkerIds(
      [
        { id: 'a', x: 50 },
        { id: 'b', x: 50 },
        { id: 'c', x: 50 },
      ],
      GAP
    );
    expect(kept.size).toBe(1);
  });

  it('re-admits a label once the gap clears, regardless of input order', () => {
    const kept = visibleLabelMarkerIds(
      [
        { id: 'c', x: 76 },
        { id: 'a', x: 0 },
        { id: 'b', x: 20 },
      ],
      GAP
    );
    // a kept, b too close to a, c is 76px from a: kept.
    expect(kept).toEqual(new Set(['a', 'c']));
  });

  it('dense cluster keeps roughly every minGap-th label', () => {
    const points = Array.from({ length: 10 }, (_, i) => ({ id: String(i), x: i * 10 }));
    const kept = visibleLabelMarkerIds(points, GAP);
    expect(kept).toEqual(new Set(['0', '4', '8']));
  });

  it('empty input yields an empty set', () => {
    expect(visibleLabelMarkerIds([], GAP).size).toBe(0);
  });
});
