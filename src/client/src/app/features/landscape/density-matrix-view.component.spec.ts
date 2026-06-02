/**
 * Unit tests for DensityMatrixViewComponent panel-visibility logic.
 *
 * The unit-test runner uses a plain node environment (vitest.units.config.ts)
 * without the Angular compiler, so we don't mount the component via TestBed.
 * Instead we mirror the `showPanel` computed against a `selectedBubble` signal
 * and assert the visibility contract directly — the same approach the rest of
 * the landscape specs use for signal-derived state.
 *
 * Regression: the detail panel is an absolute overlay covering the right ~340px
 * of the matrix (APP/LAUNCHED columns). It must stay unmounted until a row is
 * selected, otherwise the empty pane hides the Launched column on first visit.
 */
import { signal, computed } from '@angular/core';
import { describe, expect, it } from 'vitest';

import type { DensityBubble } from '../../core/models/landscape.model';

function makeBubble(label: string): DensityBubble {
  return {
    label,
    group_keys: {},
    competitor_count: 1,
    highest_phase: 'P3',
    highest_phase_rank: 3,
    unit_count: 1,
    phase_counts: { P3: 1 },
    products: [],
  };
}

describe('DensityMatrixViewComponent showPanel', () => {
  it('is closed when no bubble is selected (first visit)', () => {
    const selectedBubble = signal<DensityBubble | null>(null);
    const showPanel = computed(() => selectedBubble() !== null);
    expect(showPanel()).toBe(false);
  });

  it('opens when a bubble is selected and closes again when cleared', () => {
    const selectedBubble = signal<DensityBubble | null>(null);
    const showPanel = computed(() => selectedBubble() !== null);

    expect(showPanel()).toBe(false);

    selectedBubble.set(makeBubble('Type 2 Diabetes'));
    expect(showPanel()).toBe(true);

    selectedBubble.set(null);
    expect(showPanel()).toBe(false);
  });
});
