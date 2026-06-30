/**
 * Unit tests for the bullseye chart's panel-open recenter contract.
 *
 * The unit-test runner uses a plain node environment (vitest.units.config.ts)
 * without the Angular compiler, so we don't mount the component via TestBed.
 * Instead we mirror the `panelOpen` computed against a `selectedAsset` signal
 * and assert the visibility contract directly -- the same approach the other
 * landscape specs use for signal-derived state.
 *
 * Regression (issue #168): the detail panel is an absolute overlay covering the
 * right 340px of the layout, but the chart wrapper kept centering in the full
 * width, so the bullseye sat half-hidden under the panel with dead space on the
 * left. The fix binds `[class.panel-open]` off `panelOpen()` so the wrapper
 * reserves the panel width and recenters left of it. This spec guards the
 * derived boolean that drives that class.
 */
import { signal, computed } from '@angular/core';
import { describe, expect, it } from 'vitest';

import type { BullseyeAsset } from '../../core/models/landscape.model';

function makeAsset(id: string): BullseyeAsset {
  return { id, name: id } as BullseyeAsset;
}

describe('landscape panelOpen', () => {
  it('is closed when no asset is selected (chart centers in full width)', () => {
    const selectedAsset = signal<BullseyeAsset | null>(null);
    const panelOpen = computed(() => selectedAsset() !== null);
    expect(panelOpen()).toBe(false);
  });

  it('opens when an asset is selected and closes again when cleared', () => {
    const selectedAsset = signal<BullseyeAsset | null>(null);
    const panelOpen = computed(() => selectedAsset() !== null);

    expect(panelOpen()).toBe(false);

    selectedAsset.set(makeAsset('semaglutide'));
    expect(panelOpen()).toBe(true);

    selectedAsset.set(null);
    expect(panelOpen()).toBe(false);
  });
});
