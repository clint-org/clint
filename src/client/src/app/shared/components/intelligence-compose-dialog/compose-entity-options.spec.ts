import { describe, expect, it } from 'vitest';

import { buildComposeEntityOptions } from './compose-entity-options';

describe('buildComposeEntityOptions', () => {
  it('maps trials with identifier as sub-label and empty string when null', () => {
    const rows = buildComposeEntityOptions({
      trials: [
        { id: 't1', name: 'SUNRISE', identifier: 'NCT01' },
        { id: 't2', name: 'MOONSHOT', identifier: null },
      ],
      companies: [],
      assets: [],
    });

    expect(rows).toEqual([
      { entity_type: 'trial', entity_id: 't1', label: 'SUNRISE', sub_label: 'NCT01' },
      { entity_type: 'trial', entity_id: 't2', label: 'MOONSHOT', sub_label: '' },
    ]);
  });

  it('maps companies with the company entity type and no sub-label', () => {
    const rows = buildComposeEntityOptions({
      trials: [],
      companies: [{ id: 'c1', name: 'Acme Bio' }],
      assets: [],
    });

    expect(rows).toEqual([
      { entity_type: 'company', entity_id: 'c1', label: 'Acme Bio', sub_label: '' },
    ]);
  });

  it('maps assets to the product entity type and resolves the company sub-label from an object embed', () => {
    const rows = buildComposeEntityOptions({
      trials: [],
      companies: [],
      assets: [{ id: 'a1', name: 'ACME-123', companies: { name: 'Acme Bio' } }],
    });

    expect(rows).toEqual([
      { entity_type: 'product', entity_id: 'a1', label: 'ACME-123', sub_label: 'Acme Bio' },
    ]);
  });

  it('resolves the company sub-label when the embed arrives as a single-element array', () => {
    const rows = buildComposeEntityOptions({
      trials: [],
      companies: [],
      assets: [{ id: 'a1', name: 'ACME-123', companies: [{ name: 'Acme Bio' }] }],
    });

    expect(rows[0].sub_label).toBe('Acme Bio');
  });

  it('falls back to an empty sub-label when an asset has no linked company', () => {
    const rows = buildComposeEntityOptions({
      trials: [],
      companies: [],
      assets: [{ id: 'a1', name: 'Orphan asset', companies: null }],
    });

    expect(rows[0].sub_label).toBe('');
  });

  it('preserves trial then company then asset ordering across all three sources', () => {
    const rows = buildComposeEntityOptions({
      trials: [{ id: 't1', name: 'Trial', identifier: null }],
      companies: [{ id: 'c1', name: 'Company' }],
      assets: [{ id: 'a1', name: 'Asset', companies: null }],
    });

    expect(rows.map((r) => r.entity_type)).toEqual(['trial', 'company', 'product']);
  });
});
