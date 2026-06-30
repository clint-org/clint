import { describe, it, expect } from 'vitest';

import { VIZ_LOADER_MIN_DISPLAY_MS, loaderHideDelay } from './viz-loader.logic';

describe('loaderHideDelay', () => {
  it('returns 0 when the loader was never shown', () => {
    expect(loaderHideDelay(null, 1000)).toBe(0);
  });

  it('defers hide to the remainder of the window on a fast load', () => {
    // Shown at 1000, load finished 100ms later: keep it up for the other 300ms.
    expect(loaderHideDelay(1000, 1100)).toBe(VIZ_LOADER_MIN_DISPLAY_MS - 100);
  });

  it('hides immediately once the minimum window has fully elapsed', () => {
    expect(loaderHideDelay(1000, 1000 + VIZ_LOADER_MIN_DISPLAY_MS)).toBe(0);
  });

  it('hides immediately when the load took longer than the window', () => {
    expect(loaderHideDelay(1000, 5000)).toBe(0);
  });

  it('honors a custom minimum window', () => {
    expect(loaderHideDelay(1000, 1200, 1000)).toBe(800);
  });
});
