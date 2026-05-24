import { describe, expect, it } from 'vitest';

import { LandscapeStateService } from './landscape-state.service';
import type { Company } from '../../core/models/company.model';
import type { Asset } from '../../core/models/asset.model';
import type { Trial } from '../../core/models/trial.model';
import { EMPTY_LANDSCAPE_FILTERS, type LandscapeFilters } from '../../core/models/landscape.model';

import { filterDashboardData } from './landscape-state.service';

function makeFixture(): Company[] {
  return [
    {
      id: 'c1',
      name: 'Co1',
      assets: [
        {
          id: 'p1',
          name: 'Prod1',
          company_id: 'c1',
          mechanisms_of_action: [],
          routes_of_administration: [],
          trials: [
            { id: 't1', name: 'Trial1', asset_id: 'p1', markers: [] } as Trial,
            { id: 't2', name: 'Trial2', asset_id: 'p1', markers: [] } as Trial,
          ],
        } as Asset,
      ],
    } as Company,
  ];
}

describe('filterDashboardData', () => {
  it('passes through every trial when filters are empty', () => {
    const result = filterDashboardData(makeFixture(), { ...EMPTY_LANDSCAPE_FILTERS });
    expect(result[0].assets![0].trials!.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('keeps only trials whose id is in trialIds', () => {
    const filters: LandscapeFilters = { ...EMPTY_LANDSCAPE_FILTERS, trialIds: ['t2'] };
    const result = filterDashboardData(makeFixture(), filters);
    expect(result[0].assets![0].trials!.map((t) => t.id)).toEqual(['t2']);
  });

  it('drops an asset when trialIds matches none of its trials', () => {
    const filters: LandscapeFilters = { ...EMPTY_LANDSCAPE_FILTERS, trialIds: ['nope'] };
    const result = filterDashboardData(makeFixture(), filters);
    expect(result).toEqual([]);
  });

  it('keeps multiple matching trials and preserves order', () => {
    const filters: LandscapeFilters = { ...EMPTY_LANDSCAPE_FILTERS, trialIds: ['t2', 't1'] };
    const result = filterDashboardData(makeFixture(), filters);
    expect(result[0].assets![0].trials!.map((t) => t.id)).toEqual(['t1', 't2']);
  });
});

describe('LandscapeStateService.init', () => {
  it('exposes an init method that accepts an optional opts arg', () => {
    expect(typeof LandscapeStateService.prototype.init).toBe('function');
    // init(spaceId, opts?) -- TypeScript optional params without a default
    // value expression still count toward function.length, so length is 2.
    expect(LandscapeStateService.prototype.init.length).toBe(2);
  });
});

