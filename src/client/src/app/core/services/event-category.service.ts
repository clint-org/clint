import { inject, Injectable } from '@angular/core';

import { EventCategory } from '../models/event.model';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

const REFERENCE_TTL = { fresh: 30 * 60 * 1000, stale: Infinity };

@Injectable({ providedIn: 'root' })
export class EventCategoryService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async list(spaceId?: string): Promise<EventCategory[]> {
    return this.cache.get(
      'event_categories',
      { spaceId },
      {
        ttl: REFERENCE_TTL,
        tags: ['markers:types'],
        fetch: async () => {
          let query = this.supabase.client
            .from('event_categories')
            .select('*')
            .order('display_order');

          if (spaceId) {
            query = query.or(`is_system.eq.true,space_id.eq.${spaceId}`);
          }

          const { data } = await query.throwOnError();
          return data as EventCategory[];
        },
      }
    );
  }
}
