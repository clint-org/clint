import { describe, expect, it } from 'vitest';
import type { FilterValue } from '../../shared/grids/filter-types';
import { buildServerQuery } from './server-query';

const PAGE = { first: 0, rows: 25 };
const SORT = { field: 'feed_ts', order: -1 as const };

describe('buildServerQuery', () => {
  it('maps an empty grid to a null filter set scoped to the space', () => {
    const q = buildServerQuery({}, SORT, PAGE, '', null, 'space-1');
    expect(q.spaceId).toBe('space-1');
    expect(q.limit).toBe(25);
    expect(q.offset).toBe(0);
    expect(q.filters).toEqual({
      dateFrom: null,
      dateTo: null,
      entityLevel: null,
      entityId: null,
      categoryNames: [],
      tags: [],
      priority: null,
      sourceType: null,
      search: null,
      sortField: 'feed_ts',
      sortDir: 'desc',
    });
  });

  it('reads source_type and priority from single selects', () => {
    const filters: Record<string, FilterValue> = {
      source_type: { kind: 'select', values: ['marker'] },
      priority: { kind: 'select', values: ['high'] },
    };
    const q = buildServerQuery(filters, SORT, PAGE, '', null, 's');
    expect(q.filters.sourceType).toBe('marker');
    expect(q.filters.priority).toBe('high');
  });

  it('reads category names from a multi-value select as strings', () => {
    const filters: Record<string, FilterValue> = {
      category_name: { kind: 'select', values: ['Regulatory', 'Catalyst lifecycle'] },
    };
    const q = buildServerQuery(filters, SORT, PAGE, '', null, 's');
    expect(q.filters.categoryNames).toEqual(['Regulatory', 'Catalyst lifecycle']);
  });

  it('reads the feed_ts date range', () => {
    const filters: Record<string, FilterValue> = {
      feed_ts: { kind: 'date', from: '2026-01-01', to: '2026-02-01' },
    };
    const q = buildServerQuery(filters, SORT, PAGE, '', null, 's');
    expect(q.filters.dateFrom).toBe('2026-01-01');
    expect(q.filters.dateTo).toBe('2026-02-01');
  });

  it('carries entity scope when present and omits it when absent', () => {
    const scoped = buildServerQuery(
      {},
      SORT,
      PAGE,
      '',
      { entityLevel: 'product', entityId: 'a1' },
      's'
    );
    expect(scoped.filters.entityLevel).toBe('product');
    expect(scoped.filters.entityId).toBe('a1');
    const unscoped = buildServerQuery({}, SORT, PAGE, '', null, 's');
    expect(unscoped.filters.entityLevel).toBeNull();
    expect(unscoped.filters.entityId).toBeNull();
  });

  it('collapses an empty/whitespace search to null and trims a real one', () => {
    expect(buildServerQuery({}, SORT, PAGE, '   ', null, 's').filters.search).toBeNull();
    expect(buildServerQuery({}, SORT, PAGE, '  cagri ', null, 's').filters.search).toBe('cagri');
  });

  it('maps sort order: -1 -> desc, 1 -> asc, null -> nulls', () => {
    expect(
      buildServerQuery({}, { field: 'title', order: 1 }, PAGE, '', null, 's').filters
    ).toMatchObject({
      sortField: 'title',
      sortDir: 'asc',
    });
    expect(
      buildServerQuery({}, { field: 'title', order: -1 }, PAGE, '', null, 's').filters
    ).toMatchObject({
      sortField: 'title',
      sortDir: 'desc',
    });
    expect(buildServerQuery({}, null, PAGE, '', null, 's').filters).toMatchObject({
      sortField: null,
      sortDir: null,
    });
  });

  it('maps page rows/first to limit/offset', () => {
    const q = buildServerQuery({}, SORT, { first: 50, rows: 10 }, '', null, 's');
    expect(q.limit).toBe(10);
    expect(q.offset).toBe(50);
  });
});
