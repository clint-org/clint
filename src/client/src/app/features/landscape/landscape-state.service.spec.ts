import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LandscapeStateService } from './landscape-state.service';
import type { Company } from '../../core/models/company.model';
import type { Asset } from '../../core/models/asset.model';
import type { Trial } from '../../core/models/trial.model';
import { EMPTY_LANDSCAPE_FILTERS, type LandscapeFilters } from '../../core/models/landscape.model';
import { TRIAL_START_MARKER_TYPE_ID, TRIAL_END_MARKER_TYPE_ID } from '../../core/models/trial-phase-span';

import { filterDashboardData } from './landscape-state.service';

// LandscapeStateService creates a persistence effect() in a field initializer,
// which needs the zoneless ChangeDetectionScheduler -- not available in this
// plain-node runner. So, mirroring the rest of this spec, we assert the
// marker-references wiring by source contract rather than instantiating. The
// getMarkerReferences mapping itself is unit-tested in
// primary-intelligence.service.spec.ts.
const stateSrc = readFileSync(join(__dirname, 'landscape-state.service.ts'), 'utf8');

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

describe('LandscapeStateService marker references', () => {
  it('exposes a selectedMarkerReferences signal', () => {
    expect(stateSrc).toContain('selectedMarkerReferences = signal<PiReference[]>([])');
  });

  it('loads incoming references for the selected marker via getMarkerReferences', () => {
    expect(stateSrc).toContain('.getMarkerReferences(spaceId, markerId)');
    // Applied under the race guard so a stale fetch cannot clobber a newer selection.
    expect(stateSrc).toContain(
      'if (this.selectedMarkerId() === markerId) this.selectedMarkerReferences.set(refs)'
    );
  });

  it('clears references when the selection is cleared', () => {
    // clearSelection resets the references signal alongside marker + detail.
    const clearBody = stateSrc.slice(stateSrc.indexOf('clearSelection(): void'));
    expect(clearBody).toContain('this.selectedMarkerReferences.set([])');
  });
});

/**
 * Detail-level depth selector for the timeline grid. The grid redesign replaced
 * the old independent Company/Asset/Trials row toggles + Compare preset with a
 * single `detailLevel` ('companies' | 'assets' | 'trials'); the grid computes
 * row visibility from it. Mirroring the rest of this spec, these are asserted by
 * source contract: the service builds a persistence effect() in a field
 * initializer, which needs the zoneless ChangeDetectionScheduler not available
 * in this plain-node runner, so the service cannot be instantiated here.
 */
describe('LandscapeStateService detail-level depth', () => {
  it('defaults detailLevel to trials', () => {
    expect(stateSrc).toContain("readonly detailLevel = signal<DetailLevel>('trials')");
  });

  it('declares detailLevel on PersistedLandscapeState', () => {
    const ifaceStart = stateSrc.indexOf('interface PersistedLandscapeState');
    const ifaceBody = stateSrc.slice(ifaceStart, stateSrc.indexOf('}', ifaceStart));
    expect(ifaceBody).toContain('detailLevel: DetailLevel;');
  });

  it('serializes detailLevel in the persistence effect', () => {
    expect(stateSrc).toContain('detailLevel: this.detailLevel()');
  });

  it('restores detailLevel from persisted state, guarding on the allowed values', () => {
    const restoreStart = stateSrc.indexOf('private restorePersistedState');
    const restoreBody = stateSrc.slice(restoreStart, stateSrc.indexOf('// ─── Pure', restoreStart));
    expect(restoreBody).toContain("saved.detailLevel === 'companies'");
    expect(restoreBody).toContain("saved.detailLevel === 'assets'");
    expect(restoreBody).toContain("saved.detailLevel === 'trials'");
    expect(restoreBody).toContain('this.detailLevel.set(saved.detailLevel)');
  });

  it('no longer exposes the removed independent toggles or Compare preset', () => {
    expect(stateSrc).not.toContain('showCompanyEvents');
    expect(stateSrc).not.toContain('applyComparePreset');
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
 * Time period filtering. Trials pass when their derived phase span (from Trial
 * Start / Trial End markers) overlaps the window. Trials with no span (no
 * Trial Start or Trial End markers) pass only if at least one of their markers
 * survived the window pruning. Markers outside the window are pruned before the
 * span is derived.
 */
function trialStartMarker(id: string, date: string): object {
  return { id, marker_type_id: TRIAL_START_MARKER_TYPE_ID, event_date: date, date_precision: 'exact', end_date: null };
}
function trialEndMarker(id: string, date: string): object {
  return { id, marker_type_id: TRIAL_END_MARKER_TYPE_ID, event_date: date, date_precision: 'exact', end_date: null };
}

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
            // Fully inside 2025-2026: Trial Start 2025-03-01, Trial End 2026-03-01.
            {
              id: 't-inside',
              name: 'Inside',
              asset_id: 'p1',
              markers: [
                trialStartMarker('ms-inside', '2025-03-01'),
                trialEndMarker('me-inside', '2026-03-01'),
                { id: 'm-in', event_date: '2025-06-01', end_date: null },
                { id: 'm-out', event_date: '2028-06-01', end_date: null },
              ],
            } as unknown as Trial,
            // Straddles the window start: Trial Start 2023-01-01, Trial End 2025-01-01.
            {
              id: 't-straddle',
              name: 'Straddle',
              asset_id: 'p1',
              markers: [
                trialStartMarker('ms-straddle', '2023-01-01'),
                trialEndMarker('me-straddle', '2025-01-01'),
              ],
            } as unknown as Trial,
            // Fully before the window: Trial Start 2020-01-01, Trial End 2022-01-01.
            {
              id: 't-before',
              name: 'Before',
              asset_id: 'p1',
              markers: [
                trialStartMarker('ms-before', '2020-01-01'),
                trialEndMarker('me-before', '2022-01-01'),
                { id: 'm-old', event_date: '2021-06-01', end_date: null },
              ],
            } as unknown as Trial,
            // No Trial Start, ends inside the window (Trial End 2025-06-01).
            {
              id: 't-open-start',
              name: 'OpenStart',
              asset_id: 'p1',
              markers: [
                trialEndMarker('me-open', '2025-06-01'),
              ],
            } as unknown as Trial,
            // No span markers, one generic marker inside the window.
            {
              id: 't-undated-hit',
              name: 'UndatedHit',
              asset_id: 'p1',
              markers: [{ id: 'm-hit', event_date: '2026-02-01', end_date: null }],
            } as unknown as Trial,
            // No span markers, marker outside the window.
            {
              id: 't-undated-miss',
              name: 'UndatedMiss',
              asset_id: 'p1',
              markers: [{ id: 'm-miss', event_date: '2020-02-01', end_date: null }],
            } as unknown as Trial,
            // No span markers, no markers at all.
            {
              id: 't-undated-bare',
              name: 'UndatedBare',
              asset_id: 'p1',
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
    // Trial Start (2025-03-01) and Trial End (2026-03-01) are within the window,
    // so they remain alongside m-in; m-out (2028-06-01) is pruned.
    expect(inside.markers!.map((m) => m.id)).toEqual(['ms-inside', 'me-inside', 'm-in']);
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
    // t-open-start has no Trial Start marker (open-ended toward the past)
    // and a Trial End marker at 2025-06-01, so it must not match 2040+.
    const result = filterDashboardData(makeTimePeriodFixture(), farFuture);
    expect(result).toEqual([]);
  });

  // Regression: the phase span must come from the trial's ORIGINAL markers, not
  // the markers left after the marker-category filter runs. The system Trial
  // Start / Trial End marker types carry no marker category, so an active
  // category filter strips them. If the span were derived after that filter it
  // would degrade to all-null and the trial (now with zero surviving markers)
  // would be wrongly dropped from the time window.
  it('keeps a trial in the time window even when an active marker-category filter strips its category-less Trial Start/End markers', () => {
    const fixture: Company[] = [
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
                id: 't-span-only',
                name: 'SpanOnly',
                asset_id: 'p1',
                // Only category-less system span markers; both inside the window.
                markers: [
                  trialStartMarker('ms-span', '2025-04-01'),
                  trialEndMarker('me-span', '2026-01-01'),
                ],
              } as unknown as Trial,
            ],
          } as Asset,
        ],
      } as Company,
    ];
    const filters: LandscapeFilters = {
      ...EMPTY_LANDSCAPE_FILTERS,
      timePeriod: { startYear: 2025, startQuarter: null, endYear: 2026, endQuarter: null },
      // A category filter that matches none of the trial's markers; the
      // Trial Start/End markers have no category and are stripped entirely.
      markerCategoryIds: ['cat-clinical'],
    };
    const result = filterDashboardData(fixture, filters);
    // The trial survives because its phase span (2025-04-01 .. 2026-01-01),
    // snapshotted before the category filter, overlaps the window.
    expect(result[0].assets![0].trials!.map((t) => t.id)).toEqual(['t-span-only']);
  });
});
