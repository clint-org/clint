import { describe, expect, it } from 'vitest';
import type { Company } from '../../../core/models/company.model';
import { COMPANY_EXPORT_COLUMNS } from './companies-export.util';
import { buildExportSheet } from '../../../shared/export/grid-sheet.util';

function fixture(overrides: Partial<Company> = {}): Company {
  return {
    id: 'co1',
    space_id: 's1',
    created_by: 'u1',
    name: 'AstraZeneca',
    logo_url: null,
    display_order: 2,
    created_at: '',
    updated_at: '',
    updated_by: null,
    assets: [{ id: 'a1' }, { id: 'a2' }] as Company['assets'],
    ...overrides,
  } as Company;
}

describe('COMPANY_EXPORT_COLUMNS', () => {
  it('exports company, asset count, and order with domain headers', () => {
    const spec = buildExportSheet('Companies', COMPANY_EXPORT_COLUMNS, [fixture()]);
    expect(spec.columns.map((c) => c.header)).toEqual(['Company', 'Assets', 'Order']);
    expect(spec.rows[0]).toEqual({ c0: 'AstraZeneca', c1: 2, c2: 2 });
  });

  it('counts zero when assets are not loaded', () => {
    const spec = buildExportSheet('Companies', COMPANY_EXPORT_COLUMNS, [
      fixture({ assets: undefined }),
    ]);
    expect(spec.rows[0]['c1']).toBe(0);
  });
});
