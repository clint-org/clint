export type KindFilter = 'all' | 'intel' | 'event';

export interface FeedQueryState {
  spaceId: string;
  kind: KindFilter;
  categories: string[];
  since: Date | null;
  query: string;
  limit: number;
  offset: number;
}

export interface FeedQueryArgs {
  spaceId: string;
  kinds: ('brief' | 'event')[] | null;
  categories: string[] | null;
  since: string | null;
  query: string | null;
  limit: number;
  offset: number;
}

/**
 * Maps the toolbar filter state to list_intelligence_feed args. The Kind toggle
 * selects which legs run (null = both); category chips filter the event leg only
 * and so are passed through verbatim (the RPC ignores them for briefs). Empty
 * collections and blank strings normalize to null so the RPC treats them as
 * "no filter".
 */
export function buildFeedQuery(state: FeedQueryState): FeedQueryArgs {
  return {
    spaceId: state.spaceId,
    kinds: state.kind === 'all' ? null : state.kind === 'intel' ? ['brief'] : ['event'],
    categories: state.categories.length ? state.categories : null,
    since: state.since ? state.since.toISOString() : null,
    query: state.query.trim() || null,
    limit: state.limit,
    offset: state.offset,
  };
}
