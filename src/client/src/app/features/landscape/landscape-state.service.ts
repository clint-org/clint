import { Injectable, signal } from '@angular/core';

import {
  CountUnit,
  EMPTY_LANDSCAPE_FILTERS,
  LandscapeFilters,
  PositioningGrouping,
  SpokeMode,
} from '../../core/models/landscape.model';
import { ZoomLevel } from '../../core/models/dashboard.model';

/**
 * Shared state for the unified Landscape module.
 * Provided by LandscapeShellComponent so all child views share one instance.
 */
@Injectable()
export class LandscapeStateService {
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
}
