import { describe, expect, it } from 'vitest';
import type { BullseyeData } from '../../core/models/landscape.model';
import { buildBullseyeRows } from './bullseye-export.util';

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
