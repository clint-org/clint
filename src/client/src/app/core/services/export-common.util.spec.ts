import { describe, expect, it } from 'vitest';
import { computeLeftColumns, buildLegendGroups } from './export-common.util';
import type { MarkerType } from '../models/marker.model';
import {
  buildMarkerTableRows,
  buildTrialExportRows,
  flattenTrials,
  paginate,
  formatDateShort,
  formatMarkerDate,
} from './export-common.util';
import type { Company } from '../models/company.model';
import { TRIAL_START_MARKER_TYPE_ID, TRIAL_END_MARKER_TYPE_ID } from '../models/trial-phase-span';

describe('computeLeftColumns', () => {
  it('includes only company/asset/trial when all toggles off', () => {
    const layout = computeLeftColumns({
      showMoa: false,
      showRoa: false,
      showIndication: false,
      showNotes: false,
    });
    expect(layout.columns.map((c) => c.key)).toEqual(['company', 'asset', 'trial']);
    expect(layout.labelColW).toBeCloseTo(2.9, 5);
  });

  it('includes all columns in order when all toggles on', () => {
    const layout = computeLeftColumns({
      showMoa: true,
      showRoa: true,
      showIndication: true,
      showNotes: true,
    });
    expect(layout.columns.map((c) => c.key)).toEqual([
      'company', 'asset', 'moa', 'roa', 'indication', 'trial', 'notes',
    ]);
    expect(layout.labelColW).toBeCloseTo(5.4, 5);
  });

  it('places indication immediately before trial when only it is on', () => {
    const layout = computeLeftColumns({
      showMoa: false,
      showRoa: false,
      showIndication: true,
      showNotes: false,
    });
    expect(layout.columns.map((c) => c.key)).toEqual(['company', 'asset', 'indication', 'trial']);
  });

  it('lays out x positions cumulatively and matches labelColW', () => {
    const layout = computeLeftColumns({
      showMoa: true,
      showRoa: false,
      showIndication: false,
      showNotes: false,
    });
    expect(layout.columns.map((c) => c.key)).toEqual(['company', 'asset', 'moa', 'trial']);
    const company = layout.columns[0];
    const asset = layout.columns[1];
    const moa = layout.columns[2];
    const trial = layout.columns[3];
    expect(company.x).toBeCloseTo(0, 5);
    expect(asset.x).toBeCloseTo(1.0, 5);
    expect(moa.x).toBeCloseTo(1.85, 5);
    expect(trial.x).toBeCloseTo(2.65, 5);
    const last = layout.columns[layout.columns.length - 1];
    expect(last.x + last.width).toBeCloseTo(layout.labelColW, 5);
  });
});

function fullType(id: string, typeOrder: number, catName: string, catOrder: number): MarkerType {
  return {
    id,
    space_id: null,
    created_by: null,
    category_id: 'cat-' + catName,
    name: id,
    shape: 'circle',
    fill_style: 'filled',
    color: '#000000',
    inner_mark: 'none',
    is_system: true,
    display_order: typeOrder,
    created_at: '2026-01-01',
    marker_categories: {
      id: 'cat-' + catName,
      space_id: null,
      name: catName,
      display_order: catOrder,
      is_system: true,
      created_by: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    },
  };
}

describe('buildLegendGroups', () => {
  // ordered by display_order globally, as MarkerTypeService.list returns them
  const allTypes: MarkerType[] = [
    fullType('Trial Start', 1, 'Clinical Trial', 1),
    fullType('Full Data', 1, 'Data', 2),
    fullType('Regulatory Filing', 1, 'Regulatory', 3),
    fullType('Submission', 2, 'Regulatory', 3),
    fullType('Approval', 1, 'Approval', 4),
    fullType('LOE Date', 1, 'Loss of Exclusivity', 5),
  ];

  it('groups by category, ordered by category display_order', () => {
    const groups = buildLegendGroups(allTypes);
    expect(groups.map((g) => g.label)).toEqual([
      'Clinical Trial', 'Data', 'Regulatory', 'Approval', 'Loss of Exclusivity',
    ]);
  });

  it('keeps items within a group in input (display_order) order', () => {
    const reg = buildLegendGroups(allTypes).find((g) => g.label === 'Regulatory');
    expect(reg?.items.map((i) => i.name)).toEqual(['Regulatory Filing', 'Submission']);
  });

  it('carries shape, fill_style, inner_mark, and color through', () => {
    const groups = buildLegendGroups([fullType('Approval', 1, 'Approval', 4)]);
    expect(groups[0].items[0]).toMatchObject({
      name: 'Approval', color: '#000000', shape: 'circle', fill_style: 'filled', inner_mark: 'none',
    });
  });

  it('excludes types with display_order <= 0', () => {
    const groups = buildLegendGroups([
      fullType('Hidden', 0, 'Data', 2),
      fullType('Full Data', 1, 'Data', 2),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.name)).toEqual(['Full Data']);
  });
});

function companyWithMarkers(): Company[] {
  return [
    {
      id: 'c1', space_id: 's1', created_by: 'u', name: 'Eli Lilly', logo_url: null,
      display_order: 0, created_at: '2026-01-01', updated_at: '2026-01-01', updated_by: null,
      assets: [
        {
          id: 'a1', space_id: 's1', created_by: 'u', company_id: 'c1', name: 'Mounjaro',
          generic_name: null, logo_url: null, display_order: 0,
          created_at: '2026-01-01', updated_at: '2026-01-01', updated_by: null,
          trials: [
            {
              id: 't1', space_id: 's1', created_by: 'u', asset_id: 'a1', name: 'SURPASS-2',
              acronym: 'SURPASS-2', identifier: 'NCT01', status: null, notes: null,
              display_order: 0, created_at: '2026-01-01', updated_at: '2026-01-01',
              updated_by: null, phase_type: null,
              markers: [
                {
                  id: 'm2', space_id: 's1', created_by: 'u', marker_type_id: 'mt1',
                  title: 'Approved by FDA', projection: 'actual', event_date: '2022-05-13',
                  end_date: null, description: null, source_url: null, metadata: null,
                  is_projected: false, no_longer_expected: false,
                  created_at: '2026-01-01', updated_at: '2026-01-01', updated_by: null,
                  marker_types: { id: 'mt1', name: 'Approval' } as never,
                },
                {
                  id: 'm1', space_id: 's1', created_by: 'u', marker_type_id: 'mt2',
                  title: 'Topline expected', projection: 'company', event_date: '2021-10-01',
                  end_date: null, description: null, source_url: null, metadata: null,
                  is_projected: true, no_longer_expected: false,
                  created_at: '2026-01-01', updated_at: '2026-01-01', updated_by: null,
                  marker_types: { id: 'mt2', name: 'Topline Data' } as never,
                },
              ],
            },
          ],
        },
      ],
    } as never,
  ];
}

describe('buildMarkerTableRows', () => {
  it('flattens, sorts markers within a trial by date, and derives status', () => {
    const rows = buildMarkerTableRows(companyWithMarkers());
    expect(rows).toHaveLength(2);
    expect(rows[0].marker).toBe('Topline Data');
    expect(rows[0].status).toBe('Projected');
    expect(rows[0].company).toBe('Eli Lilly');
    expect(rows[0].asset).toBe('Mounjaro');
    expect(rows[0].trial).toBe('SURPASS-2');
    expect(rows[1].marker).toBe('Approval');
    expect(rows[1].status).toBe('Actual');
    // detail carries the marker's title (the catalyst label), not a trial note
    expect(rows[0].detail).toBe('Topline expected');
    expect(rows[1].detail).toBe('Approved by FDA');
  });

  it('marks no_longer_expected markers as NLE', () => {
    const companies = companyWithMarkers();
    companies[0].assets![0].trials![0].markers![0].no_longer_expected = true;
    const rows = buildMarkerTableRows(companies);
    const approval = rows.find((r) => r.marker === 'Approval');
    expect(approval?.status).toBe('NLE');
  });

  it('detailFull carries the full untruncated title while detail is truncated with ellipsis for long titles', () => {
    const longTitle = 'X'.repeat(100);
    const companies: Company[] = [
      {
        id: 'c1', space_id: 's1', created_by: 'u', name: 'Pharma Co', logo_url: null,
        display_order: 0, created_at: '2026-01-01', updated_at: '2026-01-01', updated_by: null,
        assets: [
          {
            id: 'a1', space_id: 's1', created_by: 'u', company_id: 'c1', name: 'Drug-A',
            generic_name: null, logo_url: null, display_order: 0,
            created_at: '2026-01-01', updated_at: '2026-01-01', updated_by: null,
            trials: [
              {
                id: 't1', space_id: 's1', created_by: 'u', asset_id: 'a1', name: 'TRIAL-1',
                acronym: 'TRIAL-1', identifier: null, status: null, notes: null,
                display_order: 0, created_at: '2026-01-01', updated_at: '2026-01-01',
                updated_by: null, phase_type: null,
                markers: [
                  {
                    id: 'm1', space_id: 's1', created_by: 'u', marker_type_id: 'mt1',
                    title: longTitle, projection: 'actual', event_date: '2024-01-01',
                    end_date: null, description: null, source_url: null, metadata: null,
                    is_projected: false, no_longer_expected: false,
                    created_at: '2026-01-01', updated_at: '2026-01-01', updated_by: null,
                    marker_types: { id: 'mt1', name: 'Data readout' } as never,
                  },
                ],
              },
            ],
          },
        ],
      } as never,
    ];
    const rows = buildMarkerTableRows(companies);
    expect(rows).toHaveLength(1);
    expect(rows[0].detailFull).toBe(longTitle);
    expect(rows[0].detailFull.length).toBe(100);
    expect(rows[0].detail.length).toBeLessThanOrEqual(80);
    expect(rows[0].detail.endsWith('…')).toBe(true);
  });
});

describe('paginate', () => {
  it('chunks rows into pages of the given size', () => {
    expect(paginate([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it('returns an empty array for no rows', () => {
    expect(paginate([], 20)).toEqual([]);
  });
});

describe('date formatting', () => {
  it("formats a single date as Mon ‘99", () => {
    expect(formatDateShort('2021-10-01')).toBe("Oct ‘21");
  });
  it('formats a bounded range with an en-dash', () => {
    expect(formatMarkerDate('2021-10-01', '2021-12-01')).toBe("Oct ‘21 – Dec ‘21");
  });
  it('formats a single event when end_date is null', () => {
    expect(formatMarkerDate('2021-10-01', null)).toBe("Oct ‘21");
  });
  it('formats a fuzzy point and an onwards marker honestly', () => {
    expect(formatMarkerDate('2026-11-15', null, 'quarter')).toBe("Q4 '26");
    expect(formatMarkerDate('2024-08-15', null, 'quarter', 'exact', true)).toBe("Q3 '24 onwards");
  });
});

const fixtureCompanies = [
  {
    id: 'c1',
    name: 'Acme Pharma',
    space_id: 's1',
    assets: [
      {
        id: 'a1',
        name: 'ACM-101',
        mechanisms_of_action: [{ name: 'GLP-1 agonist' }],
        routes_of_administration: [{ name: 'Subcutaneous', abbreviation: 'SC' }],
        trials: [
          {
            id: 't1',
            name: 'Acme Trial One',
            acronym: 'ACME-1',
            identifier: 'NCT00000001',
            notes: 'Pivotal readout expected H2.',
            trial_notes: [],
            _indications: [
              { id: 'i1', indication_id: 'i1', indication_name: 'Obesity' },
              { id: 'i2', indication_id: 'i2', indication_name: 'Overweight' },
            ],
            phase_type: 'P3',
            markers: [
              {
                id: 'ms1',
                marker_type_id: TRIAL_START_MARKER_TYPE_ID,
                event_date: '2020-01-01',
                date_precision: 'exact',
                end_date: null,
              },
              {
                id: 'me1',
                marker_type_id: TRIAL_END_MARKER_TYPE_ID,
                event_date: '2022-06-30',
                date_precision: 'exact',
                end_date: null,
              },
              {
                id: 'm1',
                event_date: '2021-06-15',
                end_date: null,
                projection: 'actual',
                is_projected: false,
                no_longer_expected: false,
                title: 'Topline readout',
                description: null,
                marker_types: {
                  name: 'Data readout',
                  color: '#16a34a',
                  shape: 'circle',
                  fill_style: 'filled',
                  inner_mark: 'none',
                },
              },
            ],
          },
        ],
      },
    ],
  },
] as unknown as Parameters<typeof flattenTrials>[0];

describe('flattenTrials', () => {
  it('flattens companies into one row per trial with first-in-group flags', () => {
    const rows = flattenTrials(fixtureCompanies);
    expect(rows).toHaveLength(1);
    expect(rows[0].companyName).toBe('Acme Pharma');
    expect(rows[0].trialName).toBe('ACME-1');
    expect(rows[0].nctId).toBe('NCT00000001');
    expect(rows[0].moa).toBe('GLP-1 agonist');
    expect(rows[0].roa).toBe('SC');
    expect(rows[0].indications).toBe('Obesity, Overweight');
    expect(rows[0].isFirstInCompany).toBe(true);
    expect(rows[0].isFirstInAsset).toBe(true);
  });

  it('resets isFirstInCompany and isFirstInAsset correctly across two assets', () => {
    const twoAssetFixture = [
      {
        id: 'c1',
        name: 'BioCo',
        space_id: 's1',
        assets: [
          {
            id: 'a1',
            name: 'Drug-A',
            mechanisms_of_action: [],
            routes_of_administration: [],
            trials: [
              { id: 't1', name: 'Trial One', acronym: null, identifier: null, notes: null, trial_notes: [], phase_type: null, markers: [] },
              { id: 't2', name: 'Trial Two', acronym: null, identifier: null, notes: null, trial_notes: [], phase_type: null, markers: [] },
            ],
          },
          {
            id: 'a2',
            name: 'Drug-B',
            mechanisms_of_action: [],
            routes_of_administration: [],
            trials: [
              { id: 't3', name: 'Trial Three', acronym: null, identifier: null, notes: null, trial_notes: [], phase_type: null, markers: [] },
            ],
          },
        ],
      },
    ] as unknown as Parameters<typeof flattenTrials>[0];

    const rows = flattenTrials(twoAssetFixture);
    expect(rows).toHaveLength(3);
    // row0: first trial of first asset
    expect(rows[0].isFirstInCompany).toBe(true);
    expect(rows[0].isFirstInAsset).toBe(true);
    // row1: second trial of same asset
    expect(rows[1].isFirstInCompany).toBe(false);
    expect(rows[1].isFirstInAsset).toBe(false);
    // row2: first trial of second asset (still same company)
    expect(rows[2].isFirstInCompany).toBe(false);
    expect(rows[2].isFirstInAsset).toBe(true);
  });
});

describe('buildTrialExportRows', () => {
  it('produces flat trial rows with short phase label and raw ISO dates', () => {
    const rows = buildTrialExportRows(fixtureCompanies);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      company: 'Acme Pharma',
      asset: 'ACM-101',
      moa: 'GLP-1 agonist',
      roa: 'SC',
      indication: 'Obesity, Overweight',
      trial: 'ACME-1',
      nctId: 'NCT00000001',
      phase: 'PH 3',
      phaseStart: '2020-01-01',
      phaseEnd: '2022-06-30',
      notes: 'Pivotal readout expected H2.',
    });
  });
});

describe('buildMarkerTableRows raw dates', () => {
  it('carries raw ISO event and end dates alongside the formatted date', () => {
    const rows = buildMarkerTableRows(fixtureCompanies);
    expect(rows[0].eventDate).toBe('2021-06-15');
    expect(rows[0].endDate).toBeNull();
  });
});
