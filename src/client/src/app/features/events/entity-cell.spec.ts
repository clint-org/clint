import { describe, expect, it } from 'vitest';
import { entityCellParts } from './entity-cell';

describe('entityCellParts', () => {
  it('a trial row shows the trial with company + asset as parents', () => {
    expect(
      entityCellParts({
        entity_level: 'trial',
        entity_name: 'REDEFINE-1',
        company_name: 'Novo Nordisk',
        asset_name: 'CagriSema',
      }),
    ).toEqual({ badge: 'Trial', value: 'REDEFINE-1', parents: ['Novo Nordisk', 'CagriSema'] });
  });

  it('an asset row (product level) shows the asset with only the company as parent', () => {
    expect(
      entityCellParts({
        entity_level: 'product',
        entity_name: 'CagriSema',
        company_name: 'Novo Nordisk',
        asset_name: 'CagriSema',
      }),
    ).toEqual({ badge: 'Asset', value: 'CagriSema', parents: ['Novo Nordisk'] });
  });

  it('a company row shows the company with no parents', () => {
    expect(
      entityCellParts({
        entity_level: 'company',
        entity_name: 'Novo Nordisk',
        company_name: 'Novo Nordisk',
        asset_name: null,
      }),
    ).toEqual({ badge: 'Company', value: 'Novo Nordisk', parents: [] });
  });

  it('a space row renders only the Industry badge (value suppressed)', () => {
    expect(
      entityCellParts({
        entity_level: 'space',
        entity_name: 'Industry',
        company_name: null,
        asset_name: null,
      }),
    ).toEqual({ badge: 'Industry', value: '', parents: [] });
  });

  it('omits missing parents on a trial row', () => {
    expect(
      entityCellParts({
        entity_level: 'trial',
        entity_name: 'Lone Trial',
        company_name: null,
        asset_name: null,
      }),
    ).toEqual({ badge: 'Trial', value: 'Lone Trial', parents: [] });
  });
});
