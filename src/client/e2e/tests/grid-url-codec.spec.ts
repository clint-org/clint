import { test, expect } from '@playwright/test';
import {
  encodeFilterState,
  decodeFilterState,
  buildFilterQueryParams,
} from '../../src/app/shared/grids/url-codec';
import type { ColumnDef, FilterState } from '../../src/app/shared/grids/filter-types';

// Shared fixture columns used across codec tests.
interface Row {
  name: string;
  companyId: string;
  trialCount: number;
  created: string;
}

const columns: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', filter: { kind: 'text' } },
  { field: 'companyId', header: 'Company', filter: { kind: 'select', options: () => [] } },
  { field: 'trialCount', header: 'Trials', filter: { kind: 'numeric' } },
  { field: 'created', header: 'Created', filter: { kind: 'date' } },
];

const defaultPage = { first: 0, rows: 25 };

test.describe('url-codec', () => {
  test('encodes empty state to empty params', () => {
    const state: FilterState = { globalSearch: '', filters: {}, sort: null, page: defaultPage };
    const params = encodeFilterState(state, { defaultPage });
    expect(params).toEqual({});
  });

  test('encodes global search', () => {
    const state: FilterState = {
      globalSearch: 'empagliflozin',
      filters: {},
      sort: null,
      page: defaultPage,
    };
    expect(encodeFilterState(state, { defaultPage })).toEqual({ q: 'empagliflozin' });
  });

  test('encodes text filter', () => {
    const state: FilterState = {
      globalSearch: '',
      filters: { name: { kind: 'text', contains: 'emp' } },
      sort: null,
      page: defaultPage,
    };
    expect(encodeFilterState(state, { defaultPage })).toEqual({ 'filter.name': 'emp' });
  });

  test('encodes single-value select filter', () => {
    const state: FilterState = {
      globalSearch: '',
      filters: { companyId: { kind: 'select', values: ['abc123'] } },
      sort: null,
      page: defaultPage,
    };
    expect(encodeFilterState(state, { defaultPage })).toEqual({ 'filter.companyId': 'abc123' });
  });

  test('encodes multi-value select filter as comma-separated', () => {
    const state: FilterState = {
      globalSearch: '',
      filters: { companyId: { kind: 'select', values: ['a', 'b', 'c'] } },
      sort: null,
      page: defaultPage,
    };
    expect(encodeFilterState(state, { defaultPage })).toEqual({ 'filter.companyId': 'a,b,c' });
  });

  test('encodes numeric filter with eq as bare value', () => {
    const state: FilterState = {
      globalSearch: '',
      filters: { trialCount: { kind: 'numeric', op: 'eq', value: 5 } },
      sort: null,
      page: defaultPage,
    };
    expect(encodeFilterState(state, { defaultPage })).toEqual({ 'filter.trialCount': '5' });
  });

  test('encodes numeric filter with gte as prefixed value', () => {
    const state: FilterState = {
      globalSearch: '',
      filters: { trialCount: { kind: 'numeric', op: 'gte', value: 5 } },
      sort: null,
      page: defaultPage,
    };
    expect(encodeFilterState(state, { defaultPage })).toEqual({ 'filter.trialCount': 'gte:5' });
  });

  test('encodes date range filter', () => {
    const state: FilterState = {
      globalSearch: '',
      filters: { created: { kind: 'date', from: '2025-01-01', to: '2025-12-31' } },
      sort: null,
      page: defaultPage,
    };
    expect(encodeFilterState(state, { defaultPage })).toEqual({
      'filter.created': '2025-01-01..2025-12-31',
    });
  });

  test('encodes ascending sort as bare field name', () => {
    const state: FilterState = {
      globalSearch: '',
      filters: {},
      sort: { field: 'name', order: 1 },
      page: defaultPage,
    };
    expect(encodeFilterState(state, { defaultPage })).toEqual({ sort: 'name' });
  });

  test('encodes descending sort with minus prefix', () => {
    const state: FilterState = {
      globalSearch: '',
      filters: {},
      sort: { field: 'trialCount', order: -1 },
      page: defaultPage,
    };
    expect(encodeFilterState(state, { defaultPage })).toEqual({ sort: '-trialCount' });
  });

  test('omits default page and page size', () => {
    const state: FilterState = {
      globalSearch: '',
      filters: {},
      sort: null,
      page: { first: 0, rows: 25 },
    };
    expect(encodeFilterState(state, { defaultPage: { first: 0, rows: 25 } })).toEqual({});
  });

  test('encodes non-default page (1-indexed in URL)', () => {
    const state: FilterState = {
      globalSearch: '',
      filters: {},
      sort: null,
      page: { first: 25, rows: 25 },
    };
    expect(encodeFilterState(state, { defaultPage: { first: 0, rows: 25 } })).toEqual({
      page: '2',
    });
  });

  test('encodes non-default page size', () => {
    const state: FilterState = {
      globalSearch: '',
      filters: {},
      sort: null,
      page: { first: 0, rows: 50 },
    };
    expect(encodeFilterState(state, { defaultPage: { first: 0, rows: 25 } })).toEqual({
      pageSize: '50',
    });
  });

  test('round trips empty state', () => {
    const empty: FilterState = { globalSearch: '', filters: {}, sort: null, page: defaultPage };
    const params = encodeFilterState(empty, { defaultPage });
    const decoded = decodeFilterState(new Map(Object.entries(params)), columns, { defaultPage });
    expect(decoded).toEqual(empty);
  });

  test('round trips a rich state', () => {
    const rich: FilterState = {
      globalSearch: 'emp',
      filters: {
        name: { kind: 'text', contains: 'emp' },
        companyId: { kind: 'select', values: ['a', 'b'] },
        trialCount: { kind: 'numeric', op: 'gte', value: 3 },
      },
      sort: { field: 'trialCount', order: -1 },
      page: { first: 50, rows: 25 },
    };
    const params = encodeFilterState(rich, { defaultPage });
    const decoded = decodeFilterState(new Map(Object.entries(params)), columns, { defaultPage });
    expect(decoded).toEqual(rich);
  });

  test('drops unknown filter field with a warning', () => {
    const params = new Map(Object.entries({ 'filter.unknownField': 'x' }));
    const decoded = decodeFilterState(params, columns, { defaultPage });
    expect(decoded.filters).toEqual({});
  });

  test('drops malformed numeric filter value', () => {
    const params = new Map(Object.entries({ 'filter.trialCount': 'banana' }));
    const decoded = decodeFilterState(params, columns, { defaultPage });
    expect(decoded.filters).toEqual({});
  });

  test('handles repeated-param form for select filters', () => {
    // Simulating URLSearchParams.getAll would return ['a', 'b']; we accept a Map<string, string | string[]>
    const params = new Map<string, string | string[]>([['filter.companyId', ['a', 'b']]]);
    const decoded = decodeFilterState(params, columns, { defaultPage });
    expect(decoded.filters['companyId']).toEqual({ kind: 'select', values: ['a', 'b'] });
  });
});

test.describe('buildFilterQueryParams', () => {
  test('produces query params for a single select filter', () => {
    const params = buildFilterQueryParams({
      'product.company_id': { kind: 'select', values: ['abc123'] },
    });
    expect(params).toEqual({ 'filter.product.company_id': 'abc123' });
  });

  test('produces query params for a text filter', () => {
    const params = buildFilterQueryParams({
      name: { kind: 'text', contains: 'emp' },
    });
    expect(params).toEqual({ 'filter.name': 'emp' });
  });

  test('returns empty object for empty filter map', () => {
    expect(buildFilterQueryParams({})).toEqual({});
  });
});
