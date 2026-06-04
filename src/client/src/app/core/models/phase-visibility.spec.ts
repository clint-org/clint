import { describe, expect, it } from 'vitest';

import {
  DEVELOPMENT_STATUS_OPTIONS,
  PHASE_DESCRIPTORS,
  visibleDevelopmentStatusOptions,
  visiblePhaseDescriptors,
} from './phase-colors';
import { RING_ORDER, visibleRingOrder } from './landscape.model';

describe('visiblePhaseDescriptors', () => {
  it('includes preclinical when the space tracks it', () => {
    const keys = visiblePhaseDescriptors(true).map((d) => d.key);
    expect(keys).toEqual(PHASE_DESCRIPTORS.map((d) => d.key));
    expect(keys).toContain('PRECLIN');
  });

  it('drops preclinical when the space does not track it', () => {
    const keys = visiblePhaseDescriptors(false).map((d) => d.key);
    expect(keys).not.toContain('PRECLIN');
    // every other phase is retained, order preserved
    expect(keys).toEqual(PHASE_DESCRIPTORS.filter((d) => d.key !== 'PRECLIN').map((d) => d.key));
  });

  it('returns the canonical array reference when tracking (no needless copy)', () => {
    expect(visiblePhaseDescriptors(true)).toBe(PHASE_DESCRIPTORS);
  });
});

describe('visibleDevelopmentStatusOptions', () => {
  it('includes preclinical when tracked', () => {
    expect(visibleDevelopmentStatusOptions(true).map((o) => o.value)).toContain('PRECLIN');
  });

  it('drops only preclinical when not tracked, keeping APPROVED/LAUNCHED', () => {
    const values = visibleDevelopmentStatusOptions(false).map((o) => o.value);
    expect(values).not.toContain('PRECLIN');
    expect(values).toContain('APPROVED');
    expect(values).toContain('LAUNCHED');
    expect(values).toEqual(
      DEVELOPMENT_STATUS_OPTIONS.filter((o) => o.value !== 'PRECLIN').map((o) => o.value)
    );
  });
});

describe('visibleRingOrder', () => {
  it('is the full ring order when preclinical is tracked', () => {
    expect(visibleRingOrder(true)).toEqual(RING_ORDER);
  });

  it('omits PRECLIN as the outer ring when not tracked', () => {
    const order = visibleRingOrder(false);
    expect(order).not.toContain('PRECLIN');
    expect(order[0]).toBe('P1');
    expect(order).toEqual(['P1', 'P2', 'P3', 'P4', 'APPROVED', 'LAUNCHED']);
  });
});
