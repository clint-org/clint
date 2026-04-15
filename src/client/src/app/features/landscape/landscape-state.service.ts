import { effect, Injectable, signal } from '@angular/core';

import {
  CountUnit,
  EMPTY_LANDSCAPE_FILTERS,
  LandscapeFilters,
  PositioningGrouping,
  SpokeMode,
} from '../../core/models/landscape.model';
import { ZoomLevel } from '../../core/models/dashboard.model';

interface PersistedLandscapeState {
  filters: LandscapeFilters;
  zoomLevel: ZoomLevel;
  spokeMode: SpokeMode;
  positioningGrouping: PositioningGrouping;
  countUnit: CountUnit;
}

const STORAGE_PREFIX = 'landscape-state:';

/**
 * Shared state for the unified Landscape module.
 * Provided by LandscapeShellComponent so all child views share one instance.
 * State is persisted to sessionStorage so it survives page refreshes.
 */
@Injectable()
export class LandscapeStateService {
  private storageKey = '';

  /** Shared data filters (persist across view switches). */
  readonly filters = signal<LandscapeFilters>({ ...EMPTY_LANDSCAPE_FILTERS });

  /** Timeline-specific: zoom granularity. */
  readonly zoomLevel = signal<ZoomLevel>('yearly');

  /** Bullseye-specific: spoke grouping mode. */
  readonly spokeMode = signal<SpokeMode>('grouped');

  /** Positioning-specific: bubble grouping dimension. */
  readonly positioningGrouping = signal<PositioningGrouping>('moa+therapeutic-area');

  /** Positioning-specific: counting unit (products/trials/companies). */
  readonly countUnit = signal<CountUnit>('products');

  /** Auto-save to sessionStorage whenever any state signal changes. */
  private readonly persistEffect = effect(() => {
    const state: PersistedLandscapeState = {
      filters: this.filters(),
      zoomLevel: this.zoomLevel(),
      spokeMode: this.spokeMode(),
      positioningGrouping: this.positioningGrouping(),
      countUnit: this.countUnit(),
    };
    if (!this.storageKey) return;
    try {
      sessionStorage.setItem(this.storageKey, JSON.stringify(state));
    } catch {
      // Storage full or unavailable -- silently ignore.
    }
  });

  /**
   * Bind this service instance to a space and restore any previously
   * persisted state from sessionStorage.
   */
  init(spaceId: string): void {
    this.storageKey = STORAGE_PREFIX + spaceId;
    try {
      const raw = sessionStorage.getItem(this.storageKey);
      if (!raw) return;
      const saved: PersistedLandscapeState = JSON.parse(raw);
      if (saved.filters) this.filters.set(saved.filters);
      if (saved.zoomLevel) this.zoomLevel.set(saved.zoomLevel);
      if (saved.spokeMode) this.spokeMode.set(saved.spokeMode);
      if (saved.positioningGrouping) this.positioningGrouping.set(saved.positioningGrouping);
      if (saved.countUnit) this.countUnit.set(saved.countUnit);
    } catch {
      // Corrupt data -- ignore and start fresh.
    }
  }
}
