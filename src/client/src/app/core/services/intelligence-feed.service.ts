import { inject, Injectable } from '@angular/core';

import { FeedResult } from '../models/intelligence-feed-item.model';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

const HEAVY_TTL = { fresh: 30 * 1000, stale: 5 * 60 * 1000 };

/**
 * The unified Intelligence feed: published briefs + all events, interleaved by
 * recency (the /intelligence stream). Thin wrapper over list_intelligence_feed,
 * mirroring the Promise-based shape of PrimaryIntelligenceService. Cached under
 * both the space's intelligence and events tags so a brief publish or an event
 * write invalidates the feed.
 */
@Injectable({ providedIn: 'root' })
export class IntelligenceFeedService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async list(opts: {
    spaceId: string;
    kinds?: ('brief' | 'event')[] | null;
    categories?: string[] | null;
    since?: string | null;
    query?: string | null;
    limit?: number;
    offset?: number;
  }): Promise<FeedResult> {
    return this.cache.get('list_intelligence_feed', opts, {
      ttl: HEAVY_TTL,
      tags: [`space:${opts.spaceId}:primary-intelligence`, `space:${opts.spaceId}:events`],
      fetch: async () => {
        const { data } = await this.supabase.client
          .rpc('list_intelligence_feed', {
            p_space_id: opts.spaceId,
            p_kinds: opts.kinds ?? null,
            p_categories: opts.categories ?? null,
            p_since: opts.since ?? null,
            p_query: opts.query ?? null,
            p_limit: opts.limit ?? 25,
            p_offset: opts.offset ?? 0,
          })
          .throwOnError();
        return (data as FeedResult) ?? { rows: [], total: 0, limit: 25, offset: 0 };
      },
    });
  }
}
