import { describe, expect, it } from 'vitest';
import type { HeatmapBubble } from '../../core/models/landscape.model';
import { buildHeatmapSheets } from './heatmap-export.util';

const bubbles = [
  {
    label: 'PD-1',
    competitor_count: 4,
    unit_count: 4,
    highest_phase: 'P3',
    phase_counts: { P2: 1, P3: 3 },
    products: [
      {
        id: 'a1',
        name: 'Keytruda',
        generic_name: 'pembrolizumab',
        company_name: 'Merck',
        logo_url: null,
        highest_phase: 'P3',
        highest_phase_rank: 3,
        trial_count: 5,
      },
    ],
  },
] as unknown as HeatmapBubble[];

describe('buildHeatmapSheets', () => {
  it('produces Matrix (label + companies + phase columns + total) and Cells sheets', () => {
    const specs = buildHeatmapSheets(bubbles, 'unit_count');
    const matrix = specs.find((s) => s.name === 'Matrix')!;
    expect(matrix.columns.map((c) => c.header)).toContain('Companies');
    expect(matrix.rows[0]).toMatchObject({ label: 'PD-1', companies: 4, P2: 1, P3: 3, total: 4 });

    const cells = specs.find((s) => s.name === 'Cells')!;
    expect(cells.rows).toEqual([
      { label: 'PD-1', phase: 'P2', count: 1 },
      { label: 'PD-1', phase: 'P3', count: 3 },
    ]);
  });

  it('mirrors the detail panel asset list on an Assets sheet', () => {
    const specs = buildHeatmapSheets(bubbles, 'unit_count');
    const assets = specs.find((s) => s.name === 'Assets')!;
    expect(assets.columns.map((c) => c.header)).toEqual([
      'Group',
      'Asset',
      'Generic',
      'Company',
      'Highest phase',
      'Trials',
    ]);
    expect(assets.rows[0]).toEqual({
      c0: 'PD-1',
      c1: 'Keytruda',
      c2: 'pembrolizumab',
      c3: 'Merck',
      c4: 'PH 3',
      c5: 5,
    });
  });
});
