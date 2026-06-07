import { describe, expect, it } from 'vitest';

import { buildFilterQueryParams, decodeFilterState, encodeFilterState } from './url-codec';
import type { ColumnDef } from './filter-types';

/**
 * These cover the cross-entity deep-link contract used by the "View assets" /
 * "View trials" actions. Those navigations encode a text "contains" filter on
 * the reference column's *name* field (companyName / assetName), matching the
 * column idiom on the destination grid. If the encoding key or shape drifts,
 * the destination grid silently drops the filter, so lock it here.
 */
describe('reference-column deep links', () => {
  const defaultPage = { first: 0, rows: 25 };

  // Mirrors the assets grid columns relevant to company deep-linking.
  const assetColumns: ColumnDef<unknown>[] = [
    { field: 'companyName', header: 'Company', filter: { kind: 'text' } },
  ];
  // Mirrors the trials grid columns relevant to asset deep-linking.
  const trialColumns: ColumnDef<unknown>[] = [
    { field: 'assetName', header: 'Asset', filter: { kind: 'text' } },
  ];

  it('encodes a company name as a text-contains filter param', () => {
    const params = buildFilterQueryParams({
      companyName: { kind: 'text', contains: 'Novo Nordisk' },
    });
    expect(params).toEqual({ 'filter.companyName': 'Novo Nordisk' });
  });

  it('encodes an asset name as a text-contains filter param', () => {
    const params = buildFilterQueryParams({
      assetName: { kind: 'text', contains: 'CagriSema' },
    });
    expect(params).toEqual({ 'filter.assetName': 'CagriSema' });
  });

  it('round-trips the company deep link back to a text filter the grid applies', () => {
    const params = buildFilterQueryParams({
      companyName: { kind: 'text', contains: 'BridgeBio' },
    });
    const decoded = decodeFilterState(new Map(Object.entries(params)), assetColumns, {
      defaultPage,
    });
    expect(decoded.filters).toEqual({
      companyName: { kind: 'text', contains: 'BridgeBio' },
    });
  });

  it('round-trips the asset deep link back to a text filter the grid applies', () => {
    const params = buildFilterQueryParams({
      assetName: { kind: 'text', contains: 'Attruby' },
    });
    const decoded = decodeFilterState(new Map(Object.entries(params)), trialColumns, {
      defaultPage,
    });
    expect(decoded.filters).toEqual({
      assetName: { kind: 'text', contains: 'Attruby' },
    });
  });

  it('preserves multi-word names through a full encode/decode cycle', () => {
    const encoded = encodeFilterState(
      {
        globalSearch: '',
        filters: { companyName: { kind: 'text', contains: 'Eli Lilly and Company' } },
        sort: null,
        page: defaultPage,
      },
      { defaultPage }
    );
    const decoded = decodeFilterState(new Map(Object.entries(encoded)), assetColumns, {
      defaultPage,
    });
    expect(decoded.filters['companyName']).toEqual({
      kind: 'text',
      contains: 'Eli Lilly and Company',
    });
  });
});
