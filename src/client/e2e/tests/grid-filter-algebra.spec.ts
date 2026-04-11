import { test, expect } from '@playwright/test';
import {
  applyGlobalSearch,
  applyColumnFilters,
  applySort,
  applyPage,
  applyAll,
} from '../../src/app/shared/grids/filter-algebra';
import type { ColumnDef, FilterState } from '../../src/app/shared/grids/filter-types';

interface Row {
  id: string;
  name: string;
  companyId: string;
  trialCount: number;
}

const rows: Row[] = [
  { id: '1', name: 'Empagliflozin', companyId: 'c1', trialCount: 12 },
  { id: '2', name: 'Dapagliflozin', companyId: 'c1', trialCount: 8 },
  { id: '3', name: 'Canagliflozin', companyId: 'c2', trialCount: 5 },
  { id: '4', name: 'Ertugliflozin', companyId: 'c3', trialCount: 2 },
  { id: '5', name: 'Sotagliflozin', companyId: 'c2', trialCount: 0 },
];

const columns: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', filter: { kind: 'text' } },
  { field: 'companyId', header: 'Company', filter: { kind: 'select', options: () => [] } },
  { field: 'trialCount', header: 'Trials', filter: { kind: 'numeric' } },
];

const searchFields = ['name'];
const defaultPage = { first: 0, rows: 25 };

function makeState(partial: Partial<FilterState> = {}): FilterState {
  return {
    globalSearch: '',
    filters: {},
    sort: null,
    page: defaultPage,
    ...partial,
  };
}

test.describe('filter-algebra', () => {
  test('global search matches case-insensitively across searchFields', () => {
    const result = applyGlobalSearch(rows, 'EMP', searchFields);
    expect(result.map((r) => r.name)).toEqual(['Empagliflozin']);
  });

  test('global search with empty string is a no-op', () => {
    expect(applyGlobalSearch(rows, '', searchFields)).toEqual(rows);
  });

  test('text column filter does contains match', () => {
    const result = applyColumnFilters(rows, { name: { kind: 'text', contains: 'gli' } }, columns);
    expect(result).toHaveLength(5);
  });

  test('text column filter is case-insensitive', () => {
    const result = applyColumnFilters(rows, { name: { kind: 'text', contains: 'EMP' } }, columns);
    expect(result.map((r) => r.name)).toEqual(['Empagliflozin']);
  });

  test('select filter matches any value in the set', () => {
    const result = applyColumnFilters(
      rows,
      { companyId: { kind: 'select', values: ['c1', 'c2'] } },
      columns
    );
    expect(result.map((r) => r.id).sort()).toEqual(['1', '2', '3', '5']);
  });

  test('numeric eq filter', () => {
    const result = applyColumnFilters(
      rows,
      { trialCount: { kind: 'numeric', op: 'eq', value: 5 } },
      columns
    );
    expect(result.map((r) => r.id)).toEqual(['3']);
  });

  test('numeric gte filter', () => {
    const result = applyColumnFilters(
      rows,
      { trialCount: { kind: 'numeric', op: 'gte', value: 5 } },
      columns
    );
    expect(result.map((r) => r.id).sort()).toEqual(['1', '2', '3']);
  });

  test('numeric lt filter', () => {
    const result = applyColumnFilters(
      rows,
      { trialCount: { kind: 'numeric', op: 'lt', value: 5 } },
      columns
    );
    expect(result.map((r) => r.id).sort()).toEqual(['4', '5']);
  });

  test('sort ascending by string uses natural collation', () => {
    const result = applySort(rows, { field: 'name', order: 1 });
    expect(result.map((r) => r.name)).toEqual([
      'Canagliflozin',
      'Dapagliflozin',
      'Empagliflozin',
      'Ertugliflozin',
      'Sotagliflozin',
    ]);
  });

  test('sort descending by numeric', () => {
    const result = applySort(rows, { field: 'trialCount', order: -1 });
    expect(result.map((r) => r.trialCount)).toEqual([12, 8, 5, 2, 0]);
  });

  test('sort is stable for equal keys', () => {
    const tied: Row[] = [
      { id: 'A', name: 'X', companyId: 'c1', trialCount: 5 },
      { id: 'B', name: 'X', companyId: 'c2', trialCount: 5 },
      { id: 'C', name: 'X', companyId: 'c3', trialCount: 5 },
    ];
    const result = applySort(tied, { field: 'name', order: 1 });
    expect(result.map((r) => r.id)).toEqual(['A', 'B', 'C']);
  });

  test('paginate slices first page', () => {
    const result = applyPage(rows, { first: 0, rows: 2 });
    expect(result.map((r) => r.id)).toEqual(['1', '2']);
  });

  test('paginate slices second page', () => {
    const result = applyPage(rows, { first: 2, rows: 2 });
    expect(result.map((r) => r.id)).toEqual(['3', '4']);
  });

  test('applyAll composes global search + filter + sort + page', () => {
    const state = makeState({
      globalSearch: 'gli',
      filters: { companyId: { kind: 'select', values: ['c1', 'c2'] } },
      sort: { field: 'trialCount', order: -1 },
      page: { first: 0, rows: 2 },
    });
    const { rows: visible, total } = applyAll(rows, state, columns, searchFields);
    expect(total).toBe(4); // c1 and c2 rows after global search (all match 'gli')
    expect(visible.map((r) => r.id)).toEqual(['1', '2']); // trialCount desc: 12, 8, 5, 0 → first two
  });

  test('applyAll returns total as post-filter, pre-paginate count', () => {
    const state = makeState({
      filters: { trialCount: { kind: 'numeric', op: 'gte', value: 5 } },
      page: { first: 0, rows: 2 },
    });
    const { rows: visible, total } = applyAll(rows, state, columns, searchFields);
    expect(total).toBe(3);
    expect(visible).toHaveLength(2);
  });
});
