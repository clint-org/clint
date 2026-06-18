import { describe, expect, it } from 'vitest';

import { isGridParamKey, mergeForeignParams } from './foreign-params';

describe('isGridParamKey', () => {
  it('claims the grid-owned namespace', () => {
    for (const key of ['q', 'sort', 'page', 'pageSize', 'filter.title', 'filter.source_type']) {
      expect(isGridParamKey(key)).toBe(true);
    }
  });

  it('treats foreign params as not grid-owned', () => {
    for (const key of ['eventId', 'detectedId', 'entityLevel', 'entityId', 'marker', 'source']) {
      expect(isGridParamKey(key)).toBe(false);
    }
  });
});

describe('mergeForeignParams', () => {
  it('preserves a deep-link param the grid does not own', () => {
    const encoded = { sort: '-feed_ts' };
    const current = new Map<string, string | string[]>([
      ['eventId', 'abc-123'],
      ['sort', '-feed_ts'],
    ]);
    expect(mergeForeignParams(encoded, current)).toEqual({
      sort: '-feed_ts',
      eventId: 'abc-123',
    });
  });

  it('does not let foreign params clobber the grid namespace', () => {
    // A stale `sort` in the URL is grid-owned and must be replaced by `encoded`,
    // never carried forward as a foreign param.
    const encoded = { sort: '-feed_ts', q: 'lilly' };
    const current = new Map<string, string | string[]>([
      ['sort', 'title'],
      ['q', 'old'],
      ['detectedId', 'ce-9'],
    ]);
    expect(mergeForeignParams(encoded, current)).toEqual({
      sort: '-feed_ts',
      q: 'lilly',
      detectedId: 'ce-9',
    });
  });

  it('joins repeated (array) foreign params into a comma string', () => {
    const current = new Map<string, string | string[]>([['entityId', ['a', 'b']]]);
    expect(mergeForeignParams({}, current)).toEqual({ entityId: 'a,b' });
  });

  it('returns only the grid params when there are no foreign params', () => {
    const encoded = { sort: '-feed_ts' };
    const current = new Map<string, string | string[]>([['sort', 'title']]);
    expect(mergeForeignParams(encoded, current)).toEqual({ sort: '-feed_ts' });
  });
});
