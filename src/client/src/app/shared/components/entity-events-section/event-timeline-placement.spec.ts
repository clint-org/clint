import { describe, it, expect } from 'vitest';

import type { Marker } from '../../../core/models/marker.model';
import { timelinePlacement, timelinePlacementLabel } from './event-timeline-placement';

function marker(overrides: Partial<Marker>): Marker {
  return { id: 'm1', ...overrides } as Marker;
}

describe('timelinePlacement', () => {
  it('pinned visibility forces on-timeline regardless of significance', () => {
    expect(timelinePlacement(marker({ visibility: 'pinned', significance: 'low' }))).toBe('timeline');
  });

  it('hidden visibility forces feed-only regardless of significance', () => {
    expect(timelinePlacement(marker({ visibility: 'hidden', significance: 'high' }))).toBe('feed');
  });

  it('high effective significance is on-timeline; low/null is feed-only', () => {
    expect(timelinePlacement(marker({ significance: 'high' }))).toBe('timeline');
    expect(timelinePlacement(marker({ significance: 'low' }))).toBe('feed');
    expect(timelinePlacement(marker({ significance: null }))).toBe('feed');
  });

  it('falls back to the event type default significance when the event has none', () => {
    expect(
      timelinePlacement(marker({ significance: null, marker_types: { default_significance: 'high' } as never })),
    ).toBe('timeline');
    expect(
      timelinePlacement(marker({ significance: null, marker_types: { default_significance: 'low' } as never })),
    ).toBe('feed');
  });
});

describe('timelinePlacementLabel', () => {
  it('maps placement to the user-facing label', () => {
    expect(timelinePlacementLabel(marker({ significance: 'high' }))).toBe('On timeline');
    expect(timelinePlacementLabel(marker({ significance: 'low' }))).toBe('Feed only');
  });
});
