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
    products: [],
  },
] as unknown as HeatmapBubble[];

describe('buildHeatmapSheets', () => {
  it('produces a Matrix sheet (row label + phase columns + total) and a Cells sheet', () => {
    const specs = buildHeatmapSheets(bubbles, 'unit_count');
    const matrix = specs.find((s) => s.name === 'Matrix')!;
    expect(matrix.rows[0]).toMatchObject({ label: 'PD-1', P2: 1, P3: 3, total: 4 });

    const cells = specs.find((s) => s.name === 'Cells')!;
    expect(cells.rows).toEqual([
      { label: 'PD-1', phase: 'P2', count: 1 },
      { label: 'PD-1', phase: 'P3', count: 3 },
    ]);
  });
});
