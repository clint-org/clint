import { describe, expect, it } from 'vitest';
import type { BullseyeData } from '../../core/models/landscape.model';
import {
  buildBullseyeRows,
  buildBullseyeSheets,
  buildBullseyeTrialRows,
} from './bullseye-export.util';

const data = {
  dimension: 'company',
  scope: { id: 'scope', name: 'Filtered' },
  ring_order: ['P3'],
  spoke_label: 'Company',
  spokes: [
    {
      id: 's1',
      name: 'Pfizer',
      display_order: 0,
      highest_phase_rank: 3,
      products: [
        {
          id: 'a1',
          name: 'Drug A',
          generic_name: 'genA',
          company_name: 'Pfizer',
          highest_phase: 'P3',
          moas: [{ id: 'm1', name: 'PD-1' }],
          roas: [{ id: 'r1', name: 'IV', abbreviation: 'IV' }],
          indications: [{ id: 'i1', name: 'NSCLC', abbreviation: null }],
        },
      ],
    },
  ],
} as unknown as BullseyeData;

describe('buildBullseyeRows', () => {
  it('flattens spokes → assets with grouping, phase, moa/roa/indication joined', () => {
    const rows = buildBullseyeRows(data);
    expect(rows).toEqual([
      {
        spoke: 'Pfizer',
        company: 'Pfizer',
        asset: 'Drug A',
        generic: 'genA',
        phase: 'PH 3',
        moa: 'PD-1',
        roa: 'IV',
        indication: 'NSCLC',
        trialCount: 0,
        recentChanges: 0,
      },
    ]);
  });

  it('joins multiple moa/roa/indication values with ", "', () => {
    const multi = {
      ...data,
      spokes: [
        {
          id: 's1',
          name: 'AZ',
          display_order: 0,
          highest_phase_rank: 2,
          products: [
            {
              id: 'a2',
              name: 'Drug B',
              generic_name: null,
              company_name: 'AZ',
              highest_phase: 'P2',
              moas: [
                { id: 'm1', name: 'PD-1' },
                { id: 'm2', name: 'CTLA-4' },
              ],
              roas: [
                { id: 'r1', name: 'Intravenous', abbreviation: 'IV' },
                { id: 'r2', name: 'Oral', abbreviation: null },
              ],
              indications: [
                { id: 'i1', name: 'NSCLC', abbreviation: 'NSCLC' },
                { id: 'i2', name: 'SCLC', abbreviation: null },
              ],
            },
          ],
        },
      ],
    } as unknown as BullseyeData;

    const rows = buildBullseyeRows(multi);
    expect(rows).toHaveLength(1);
    expect(rows[0].moa).toBe('PD-1, CTLA-4');
    expect(rows[0].roa).toBe('IV, Oral');
    expect(rows[0].indication).toBe('NSCLC, SCLC');
    expect(rows[0].generic).toBe('');
    expect(rows[0].phase).toBe('PH 2');
  });

  it('emits one row per spoke when an asset appears on multiple spokes', () => {
    const multiSpoke = {
      ...data,
      spokes: [
        {
          id: 's1',
          name: 'NSCLC',
          display_order: 0,
          highest_phase_rank: 3,
          products: [
            {
              id: 'a1',
              name: 'Drug A',
              generic_name: null,
              company_name: 'Pfizer',
              highest_phase: 'P3',
              moas: [],
              roas: [],
              indications: [],
            },
          ],
        },
        {
          id: 's2',
          name: 'SCLC',
          display_order: 1,
          highest_phase_rank: 3,
          products: [
            {
              id: 'a1',
              name: 'Drug A',
              generic_name: null,
              company_name: 'Pfizer',
              highest_phase: 'P3',
              moas: [],
              roas: [],
              indications: [],
            },
          ],
        },
      ],
    } as unknown as BullseyeData;

    const rows = buildBullseyeRows(multiSpoke);
    expect(rows).toHaveLength(2);
    expect(rows[0].spoke).toBe('NSCLC');
    expect(rows[1].spoke).toBe('SCLC');
  });
});

describe('buildBullseyeTrialRows / buildBullseyeSheets', () => {
  const withTrials = {
    ...data,
    spokes: [
      {
        ...data.spokes[0],
        products: [
          {
            ...data.spokes[0].products[0],
            recent_changes_count: 2,
            trials: [
              {
                id: 't1',
                name: 'CHECKMATE-9',
                acronym: 'CM-9',
                identifier: 'NCT01234567',
                status: 'Active',
                recruitment_status: 'RECRUITING',
                study_type: 'INTERVENTIONAL',
                phase: 'P3',
              },
            ],
          },
        ],
      },
    ],
  } as unknown as BullseyeData;

  it('emits one row per detail-panel trial with NCT, status, recruitment, type', () => {
    const rows = buildBullseyeTrialRows(withTrials);
    expect(rows).toEqual([
      {
        spoke: 'Pfizer',
        company: 'Pfizer',
        asset: 'Drug A',
        trial: 'CHECKMATE-9',
        acronym: 'CM-9',
        nctId: 'NCT01234567',
        status: 'Active',
        recruitmentStatus: 'RECRUITING',
        studyType: 'INTERVENTIONAL',
        phase: 'P3',
      },
    ]);
  });

  it('carries trial and recent-change counts onto the asset row', () => {
    const rows = buildBullseyeRows(withTrials);
    expect(rows[0].trialCount).toBe(1);
    expect(rows[0].recentChanges).toBe(2);
  });

  it('builds an Assets + Trials workbook', () => {
    const sheets = buildBullseyeSheets(withTrials);
    expect(sheets.map((s) => s.name)).toEqual(['Assets', 'Trials']);
    expect(sheets[0].columns.map((c) => c.header)).toContain('Recent changes');
    expect(sheets[1].columns.map((c) => c.header)).toContain('NCT ID');
    expect(sheets[1].rows).toHaveLength(1);
  });
});
