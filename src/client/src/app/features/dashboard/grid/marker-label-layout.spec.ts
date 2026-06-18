import { describe, expect, it } from 'vitest';

import {
  CAPTION_CHAR_PX,
  CaptionInterval,
  estimateCaptionWidthPx,
  placeOptionalCaptions,
  visibleLabelMarkerIds,
} from './marker-label-layout';

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

describe('estimateCaptionWidthPx', () => {
  it('scales with label length at the measured mono advance', () => {
    expect(estimateCaptionWidthPx("Mar '26")).toBeCloseTo(7 * CAPTION_CHAR_PX);
    // A wider range end-cap is materially wider than a short year caption.
    expect(estimateCaptionWidthPx("~Q1 '27")).toBeGreaterThan(estimateCaptionWidthPx('2026'));
  });
});

describe('placeOptionalCaptions', () => {
  const iv = (key: string, left: number, right: number): CaptionInterval => ({ key, left, right });

  it('keeps an end-cap that clears every occupied start interval', () => {
    const occupied = [iv('a', 0, 30)];
    const kept = placeOptionalCaptions(occupied, [iv('b:end', 60, 90)], 3);
    expect(kept).toEqual(new Set(['b:end']));
  });

  it('suppresses an end-cap that overlaps a kept start caption', () => {
    // The end-cap [25,55] lands on the start caption [0,30] -> garble; drop it.
    const occupied = [iv('a', 0, 30)];
    const kept = placeOptionalCaptions(occupied, [iv('a:end', 25, 55)], 3);
    expect(kept.size).toBe(0);
  });

  it('suppresses an end-cap that violates only the pad gap', () => {
    // Touches the start caption's right edge within the 3px clearance.
    const occupied = [iv('a', 0, 30)];
    const kept = placeOptionalCaptions(occupied, [iv('b:end', 32, 60)], 3);
    expect(kept.size).toBe(0);
  });

  it('keeps the left end-cap and drops a colliding right one', () => {
    const kept = placeOptionalCaptions(
      [],
      [iv('a:end', 0, 30), iv('b:end', 20, 50)],
      3
    );
    expect(kept).toEqual(new Set(['a:end']));
  });

  it('places end-caps regardless of input order', () => {
    const kept = placeOptionalCaptions(
      [],
      [iv('c:end', 100, 130), iv('a:end', 0, 30), iv('b:end', 20, 50)],
      3
    );
    // a kept, b overlaps a, c clears -> kept.
    expect(kept).toEqual(new Set(['a:end', 'c:end']));
  });

  it('no occupied and no optional yields an empty set', () => {
    expect(placeOptionalCaptions([], [], 3).size).toBe(0);
  });
});
