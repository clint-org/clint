import { describe, expect, it } from 'vitest';
import { computeLeftColumns } from './pptx-export.util';

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
