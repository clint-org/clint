import { describe, it, expect } from 'vitest';
import { computeInitialScrollLeft, hasScrolledAwayFromAnchor } from './initial-scroll';

// Viewport of 900px over a 5000px-wide timeline unless stated otherwise.
const VW = 900;
const CONTENT = 5000;

describe('computeInitialScrollLeft', () => {
  it('anchors today about a third from the left when data straddles today', () => {
    // today at 1000px, latest activity well to the right of today
    const target = computeInitialScrollLeft({
      todayX: 1000,
      lastEventX: 2000,
      viewportWidth: VW,
      contentWidth: CONTENT,
    });
    // today should sit ~1/3 (300px) from the left edge
    expect(1000 - target).toBeCloseTo(VW / 3, 0);
  });

  it('keeps the latest event near the right edge when all activity predates today', () => {
    // past-heavy: latest event at 2000px, today far to the right at 4800px
    const target = computeInitialScrollLeft({
      todayX: 4800,
      lastEventX: 2000,
      viewportWidth: VW,
      contentWidth: CONTENT,
    });
    // last event should be visible near the right (~90% across), not off-screen left,
    // and we must not have scrolled into the empty space to the right of it
    const lastEventOnScreen = 2000 - target;
    expect(lastEventOnScreen).toBeGreaterThan(0);
    expect(lastEventOnScreen).toBeLessThanOrEqual(VW);
    expect(lastEventOnScreen).toBeCloseTo(VW * 0.9, 0);
  });

  it('lands near the start when today is near the beginning (future-heavy data)', () => {
    const target = computeInitialScrollLeft({
      todayX: 300,
      lastEventX: 4000,
      viewportWidth: VW,
      contentWidth: CONTENT,
    });
    expect(target).toBe(0);
  });

  it('never scrolls past the end of the content', () => {
    const target = computeInitialScrollLeft({
      todayX: 4950,
      lastEventX: 4950,
      viewportWidth: VW,
      contentWidth: CONTENT,
    });
    expect(target).toBeLessThanOrEqual(CONTENT - VW);
    expect(target).toBeGreaterThanOrEqual(0);
  });

  it('returns 0 when the whole timeline fits in the viewport', () => {
    const target = computeInitialScrollLeft({
      todayX: 300,
      lastEventX: 400,
      viewportWidth: 900,
      contentWidth: 500,
    });
    expect(target).toBe(0);
  });
});

describe('hasScrolledAwayFromAnchor', () => {
  it('stays expanded exactly at the load anchor', () => {
    expect(hasScrolledAwayFromAnchor(5000, 5000)).toBe(false);
  });

  it('stays expanded within a small nudge of the anchor in either direction', () => {
    expect(hasScrolledAwayFromAnchor(5100, 5000)).toBe(false);
    expect(hasScrolledAwayFromAnchor(4900, 5000)).toBe(false);
  });

  it('collapses once scrolled past the threshold to the right', () => {
    expect(hasScrolledAwayFromAnchor(5200, 5000)).toBe(true);
  });

  it('collapses once scrolled past the threshold to the left', () => {
    expect(hasScrolledAwayFromAnchor(4800, 5000)).toBe(true);
  });

  it('honors a custom threshold', () => {
    expect(hasScrolledAwayFromAnchor(5100, 5000, 200)).toBe(false);
    expect(hasScrolledAwayFromAnchor(5300, 5000, 200)).toBe(true);
  });
});
