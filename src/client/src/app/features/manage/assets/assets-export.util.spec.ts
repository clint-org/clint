import { describe, expect, it } from 'vitest';
import type { Asset } from '../../../core/models/asset.model';
import { ASSET_EXPORT_COLUMNS, type AssetExportRow } from './assets-export.util';
import { buildExportSheet } from '../../../shared/export/grid-sheet.util';

function fixture(overrides: Partial<Asset> = {}): AssetExportRow {
  return {
    asset: {
      id: 'a1',
      space_id: 's1',
      created_by: 'u1',
      company_id: 'co1',
      name: 'Farxiga',
      generic_name: 'dapagliflozin',
      logo_url: null,
      display_order: 1,
      created_at: '',
      updated_at: '',
      updated_by: null,
      ...overrides,
    } as Asset,
    companyName: 'AstraZeneca',
    trialCount: 3,
    moaNames: 'SGLT2 inhibitor',
    roaNames: 'Oral',
  };
}

describe('ASSET_EXPORT_COLUMNS', () => {
  it('exports the visible columns with domain headers', () => {
    const spec = buildExportSheet('Assets', ASSET_EXPORT_COLUMNS, [fixture()]);
    expect(spec.columns.map((c) => c.header)).toEqual([
      'Asset',
      'Generic',
      'Company',
      'MOA',
      'ROA',
      'Trials',
      'Order',
    ]);
    expect(spec.rows[0]).toEqual({
      c0: 'Farxiga',
      c1: 'dapagliflozin',
      c2: 'AstraZeneca',
      c3: 'SGLT2 inhibitor',
      c4: 'Oral',
      c5: 3,
      c6: 1,
    });
  });

  it('collapses a missing generic name to an empty cell', () => {
    const spec = buildExportSheet('Assets', ASSET_EXPORT_COLUMNS, [
      fixture({ generic_name: null }),
    ]);
    expect(spec.rows[0]['c1']).toBe('');
  });
});
