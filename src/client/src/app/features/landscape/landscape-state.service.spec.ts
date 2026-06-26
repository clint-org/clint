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
 * Trials carry their indication groupings in `_indications` (attached by
 * DashboardService). The filter holds indication entity ids, which live on
 * `_indications[].indication_id` -- NOT the asset_indication join-row id. A
 * trial spanning several indications appears as ONE row carrying all of them.
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
              // Spans two indications -- a single row that either Oncology or Derm matches.
              _indications: [
                { id: 'ind-onc', indication_id: 'ind-onc', indication_name: 'Oncology' },
                { id: 'ind-derm', indication_id: 'ind-derm', indication_name: 'Derm' },
              ],
            } as Trial,
            {
              id: 't2',
              name: 'Trial2',
              asset_id: 'p1',
              markers: [],
              _indications: [
                { id: 'ind-derm', indication_id: 'ind-derm', indication_name: 'Derm' },
              ],
            } as Trial,
            // No _indications (asset had no indication grouping) -- excluded by any indication filter.
            { id: 't3', name: 'Trial3', asset_id: 'p1', markers: [] } as Trial,
          ],
        } as Asset,
      ],
    } as Company,
  ];
}

describe('filterDashboardData indicationIds', () => {
  it('keeps trials with a matching indication, once, even when they span several', () => {
    const filters: LandscapeFilters = { ...EMPTY_LANDSCAPE_FILTERS, indicationIds: ['ind-onc'] };
    const result = filterDashboardData(makeIndicationFixture(), filters);
    expect(result[0].assets![0].trials!.map((t) => t.id)).toEqual(['t1']);
  });

  it('matches the indication entity id, not the asset_indication join-row id', () => {
    // 'ai1' is a join-row id; selecting it must NOT match (regression guard).
    const filters: LandscapeFilters = { ...EMPTY_LANDSCAPE_FILTERS, indicationIds: ['ai1'] };
    const result = filterDashboardData(makeIndicationFixture(), filters);
    expect(result).toEqual([]);
  });

  it('drops trials without any _indications when an indication filter is set', () => {
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

/**
 * Time period filtering. Trials pass when their [phase_start_date,
 * phase_end_date] span overlaps the window (single null end = open-ended).
 * Trials with both phase dates null pass only if a marker passes. Markers
 * outside the window are pruned even on passing trials.
 */
function makeTimePeriodFixture(): Company[] {
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
            // Fully inside 2025-2026.
            {
              id: 't-inside',
              name: 'Inside',
              asset_id: 'p1',
              phase_start_date: '2025-03-01',
              phase_end_date: '2026-03-01',
              markers: [
                { id: 'm-in', event_date: '2025-06-01', end_date: null },
                { id: 'm-out', event_date: '2028-06-01', end_date: null },
              ],
            } as unknown as Trial,
            // Straddles the window start.
            {
              id: 't-straddle',
              name: 'Straddle',
              asset_id: 'p1',
              phase_start_date: '2023-01-01',
              phase_end_date: '2025-01-01',
              markers: [],
            } as unknown as Trial,
            // Fully before the window.
            {
              id: 't-before',
              name: 'Before',
              asset_id: 'p1',
              phase_start_date: '2020-01-01',
              phase_end_date: '2022-01-01',
              markers: [{ id: 'm-old', event_date: '2021-06-01', end_date: null }],
            } as unknown as Trial,
            // Open-ended start, ends inside the window.
            {
              id: 't-open-start',
              name: 'OpenStart',
              asset_id: 'p1',
              phase_start_date: null,
              phase_end_date: '2025-06-01',
              markers: [],
            } as unknown as Trial,
            // Undated, with one marker inside the window.
            {
              id: 't-undated-hit',
              name: 'UndatedHit',
              asset_id: 'p1',
              phase_start_date: null,
              phase_end_date: null,
              markers: [{ id: 'm-hit', event_date: '2026-02-01', end_date: null }],
            } as unknown as Trial,
            // Undated, marker outside the window.
            {
              id: 't-undated-miss',
              name: 'UndatedMiss',
              asset_id: 'p1',
              phase_start_date: null,
              phase_end_date: null,
              markers: [{ id: 'm-miss', event_date: '2020-02-01', end_date: null }],
            } as unknown as Trial,
            // Undated, no markers at all.
            {
              id: 't-undated-bare',
              name: 'UndatedBare',
              asset_id: 'p1',
              phase_start_date: null,
              phase_end_date: null,
              markers: [],
            } as unknown as Trial,
          ],
        } as Asset,
      ],
    } as Company,
  ];
}

describe('filterDashboardData timePeriod', () => {
  const window2025to2026: LandscapeFilters = {
    ...EMPTY_LANDSCAPE_FILTERS,
    timePeriod: { startYear: 2025, startQuarter: null, endYear: 2026, endQuarter: null },
  };

  it('is a no-op when timePeriod is null', () => {
    const result = filterDashboardData(makeTimePeriodFixture(), { ...EMPTY_LANDSCAPE_FILTERS });
    expect(result[0].assets![0].trials!).toHaveLength(7);
  });

  it('keeps trials overlapping the window and drops the rest', () => {
    const result = filterDashboardData(makeTimePeriodFixture(), window2025to2026);
    expect(result[0].assets![0].trials!.map((t) => t.id)).toEqual([
      't-inside',
      't-straddle',
      't-open-start',
      't-undated-hit',
    ]);
  });

  it('prunes markers outside the window on passing trials', () => {
    const result = filterDashboardData(makeTimePeriodFixture(), window2025to2026);
    const inside = result[0].assets![0].trials!.find((t) => t.id === 't-inside')!;
    expect(inside.markers!.map((m) => m.id)).toEqual(['m-in']);
  });

  it('respects quarter bounds', () => {
    const q1Only: LandscapeFilters = {
      ...EMPTY_LANDSCAPE_FILTERS,
      timePeriod: { startYear: 2026, startQuarter: 1, endYear: 2026, endQuarter: 1 },
    };
    const result = filterDashboardData(makeTimePeriodFixture(), q1Only);
    // t-inside (ends 2026-03-01), t-undated-hit (marker 2026-02-01) overlap Q1 2026.
    // t-straddle ends 2025-01-01, t-open-start ends 2025-06-01: both before Q1 2026.
    expect(result[0].assets![0].trials!.map((t) => t.id)).toEqual(['t-inside', 't-undated-hit']);
  });

  it('treats a duration marker as a span for the overlap test', () => {
    const fixture = makeTimePeriodFixture();
    fixture[0].assets![0].trials![6].markers = [
      { id: 'm-span', event_date: '2024-06-01', end_date: '2025-02-01' } as never,
    ];
    const result = filterDashboardData(fixture, window2025to2026);
    const bare = result[0].assets![0].trials!.find((t) => t.id === 't-undated-bare');
    expect(bare).toBeDefined();
    expect(bare!.markers!.map((m) => m.id)).toEqual(['m-span']);
  });

  it('drops the whole company when nothing overlaps', () => {
    const farFuture: LandscapeFilters = {
      ...EMPTY_LANDSCAPE_FILTERS,
      timePeriod: { startYear: 2040, startQuarter: null, endYear: null, endQuarter: null },
    };
    // t-open-start has a null phase_start_date (open-ended toward the past,
    // not the future) and ends 2025-06-01, so it must not match 2040+.
    const result = filterDashboardData(makeTimePeriodFixture(), farFuture);
    expect(result).toEqual([]);
  });
});
