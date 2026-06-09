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

/**
 * Trials carry their indication grouping in `_indication` (attached by
 * DashboardService). The filter holds indication entity ids, which live on
 * `_indication.indication_id` -- NOT the asset_indication join-row id.
 */
function makeIndicationFixture(): Company[] {
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
            {
              id: 't1',
              name: 'Trial1',
              asset_id: 'p1',
              markers: [],
              _indication: { id: 'ai1', indication_id: 'ind-onc', indication_name: 'Oncology' },
            } as Trial,
            {
              id: 't2',
              name: 'Trial2',
              asset_id: 'p1',
              markers: [],
              _indication: { id: 'ai2', indication_id: 'ind-derm', indication_name: 'Derm' },
            } as Trial,
            // No _indication (asset had no indication grouping) -- excluded by any indication filter.
            { id: 't3', name: 'Trial3', asset_id: 'p1', markers: [] } as Trial,
          ],
        } as Asset,
      ],
    } as Company,
  ];
}

describe('filterDashboardData indicationIds', () => {
  it('keeps only trials whose _indication.indication_id is selected', () => {
    const filters: LandscapeFilters = { ...EMPTY_LANDSCAPE_FILTERS, indicationIds: ['ind-onc'] };
    const result = filterDashboardData(makeIndicationFixture(), filters);
    expect(result[0].assets![0].trials!.map((t) => t.id)).toEqual(['t1']);
  });

  it('matches the indication entity id, not the asset_indication join-row id', () => {
    // 'ai1' is the join-row id; selecting it must NOT match (regression guard).
    const filters: LandscapeFilters = { ...EMPTY_LANDSCAPE_FILTERS, indicationIds: ['ai1'] };
    const result = filterDashboardData(makeIndicationFixture(), filters);
    expect(result).toEqual([]);
  });

  it('drops trials without an _indication when an indication filter is set', () => {
    const filters: LandscapeFilters = {
      ...EMPTY_LANDSCAPE_FILTERS,
      indicationIds: ['ind-onc', 'ind-derm'],
    };
    const result = filterDashboardData(makeIndicationFixture(), filters);
    expect(result[0].assets![0].trials!.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('drops the asset and company when no trial matches the indication', () => {
    const filters: LandscapeFilters = { ...EMPTY_LANDSCAPE_FILTERS, indicationIds: ['ind-none'] };
    const result = filterDashboardData(makeIndicationFixture(), filters);
    expect(result).toEqual([]);
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
