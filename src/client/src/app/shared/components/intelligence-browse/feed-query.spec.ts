import { describe, expect, it } from 'vitest';

import { buildFeedQuery, type FeedQueryState } from './feed-query';

function state(overrides: Partial<FeedQueryState> = {}): FeedQueryState {
  return {
    spaceId: 's1',
    kind: 'all',
    categories: [],
    since: null,
    query: '',
    limit: 25,
    offset: 0,
    ...overrides,
  };
}

describe('buildFeedQuery', () => {
  it('maps kind=all to kinds=null (both legs)', () => {
    expect(buildFeedQuery(state()).kinds).toBeNull();
  });

  it('maps kind=intel to kinds=[brief] and kind=event to kinds=[event]', () => {
    expect(buildFeedQuery(state({ kind: 'intel' })).kinds).toEqual(['brief']);
    expect(buildFeedQuery(state({ kind: 'event' })).kinds).toEqual(['event']);
  });

  it('passes selected category chips through and nulls an empty selection', () => {
    expect(buildFeedQuery(state({ categories: ['Clinical', 'Commercial'] })).categories).toEqual([
      'Clinical',
      'Commercial',
    ]);
    expect(buildFeedQuery(state()).categories).toBeNull();
  });

  it('serializes the Since date and nulls a blank query', () => {
    const since = new Date('2026-03-01T00:00:00Z');
    const args = buildFeedQuery(state({ since, query: '  ' }));
    expect(args.since).toBe(since.toISOString());
    expect(args.query).toBeNull();
  });

  it('trims a non-blank query and carries paging through', () => {
    const args = buildFeedQuery(state({ query: '  topline  ', limit: 10, offset: 20 }));
    expect(args.query).toBe('topline');
    expect(args.limit).toBe(10);
    expect(args.offset).toBe(20);
  });
});
