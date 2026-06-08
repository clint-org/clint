import { describe, expect, it } from 'vitest';
import { computeLeftColumns } from './pptx-export.util';
import { orderLegendItems, type PresentMarkerType } from './pptx-export.util';
import type { MarkerType } from '../models/marker.model';

describe('computeLeftColumns', () => {
  it('includes only company/asset/trial when all toggles off', () => {
    const layout = computeLeftColumns({ showMoa: false, showRoa: false, showNotes: false });
    expect(layout.columns.map((c) => c.key)).toEqual(['company', 'asset', 'trial']);
    expect(layout.labelColW).toBeCloseTo(2.9, 5);
  });

  it('includes all columns in order when all toggles on', () => {
    const layout = computeLeftColumns({ showMoa: true, showRoa: true, showNotes: true });
    expect(layout.columns.map((c) => c.key)).toEqual([
      'company', 'asset', 'moa', 'roa', 'trial', 'notes',
    ]);
    expect(layout.labelColW).toBeCloseTo(4.37, 5);
  });

  it('lays out x positions cumulatively and matches labelColW', () => {
    const layout = computeLeftColumns({ showMoa: true, showRoa: false, showNotes: false });
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

function present(id: string, order: number): PresentMarkerType {
  return { id, name: id, color: '#000000', shape: 'circle', fill_style: 'filled', display_order: order };
}

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

describe('orderLegendItems', () => {
  const allTypes: MarkerType[] = [
    fullType('Submission', 1, 'Regulatory', 3),
    fullType('Approval', 1, 'Approval', 4),
    fullType('Trial Start', 1, 'Clinical Trial', 1),
    fullType('Full Data', 1, 'Data', 2),
    fullType('Regulatory Filing', 2, 'Regulatory', 3),
    fullType('LOE Date', 1, 'Loss of Exclusivity', 5),
  ];

  it('orders present items by category then type order', () => {
    const result = orderLegendItems(
      [present('Submission', 1), present('Approval', 1), present('Trial Start', 1),
       present('Full Data', 1), present('Regulatory Filing', 2), present('LOE Date', 1)],
      allTypes
    );
    expect(result.items.map((i) => i.name)).toEqual([
      'Trial Start', 'Full Data', 'Submission', 'Regulatory Filing', 'Approval', 'LOE Date',
    ]);
  });

  it('sets breakIndex to the first item after the Regulatory group', () => {
    const result = orderLegendItems(
      [present('Submission', 1), present('Approval', 1), present('Trial Start', 1),
       present('Regulatory Filing', 2), present('LOE Date', 1)],
      allTypes
    );
    // ordered: Trial Start, Submission, Regulatory Filing, Approval, LOE Date
    expect(result.breakIndex).toBe(3);
  });

  it('returns breakIndex -1 when no Regulatory item is present', () => {
    const result = orderLegendItems(
      [present('Trial Start', 1), present('Approval', 1)],
      allTypes
    );
    expect(result.breakIndex).toBe(-1);
  });

  it('falls back to display_order with no break when allTypes is empty', () => {
    const result = orderLegendItems(
      [present('B', 2), present('A', 1)],
      []
    );
    expect(result.items.map((i) => i.name)).toEqual(['A', 'B']);
    expect(result.breakIndex).toBe(-1);
  });
});
