import { DestroyRef, Signal, effect, inject, signal, untracked } from '@angular/core';

import { VIZ_LOADER_MIN_DISPLAY_MS, loaderHideDelay } from './viz-loader.logic';

/**
 * Derives a "show the loader" flag from a raw loading source that stays true
 * for at least `minMs` once it goes true, so a fast load does not flash the
 * loader on and off. The timing rule itself lives in loaderHideDelay() (pure,
 * unit-tested); this is the reactive wrapper around it.
 *
 * Must be called in an injection context (e.g. a component field initializer).
 * Pass the source as a thunk so it stays reactive and tolerates declaration
 * order: `minDisplayFlag(() => this.data.isLoading())`.
 */
export function minDisplayFlag(
  source: () => boolean,
  minMs: number = VIZ_LOADER_MIN_DISPLAY_MS
): Signal<boolean> {
  const visible = signal(untracked(source));
  let shownAt: number | null = visible() ? performance.now() : null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const hide = (): void => {
    clear();
    shownAt = null;
    visible.set(false);
  };

  effect(() => {
    const loading = source();
    untracked(() => {
      if (loading) {
        clear();
        if (!visible()) {
          shownAt = performance.now();
          visible.set(true);
        }
        return;
      }
      if (!visible()) return;
      const delay = loaderHideDelay(shownAt, performance.now(), minMs);
      if (delay <= 0) {
        hide();
        return;
      }
      clear();
      timer = setTimeout(hide, delay);
    });
  });

  inject(DestroyRef).onDestroy(clear);
  return visible.asReadonly();
}
