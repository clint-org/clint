import { inject, Injectable } from '@angular/core';

import { EventType } from '../models/event-type.model';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

const REFERENCE_TTL = { fresh: 30 * 60 * 1000, stale: Infinity };

@Injectable({ providedIn: 'root' })
export class EventTypeService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async list(spaceId?: string): Promise<EventType[]> {
    return this.cache.get(
      'event_types',
      { spaceId },
      {
        ttl: REFERENCE_TTL,
        tags: ['events:types'],
        fetch: async () => {
          let query = this.supabase.client
            .from('event_types')
            .select('*')
            .order('display_order');
          if (spaceId) {
            query = query.or(`is_system.eq.true,space_id.eq.${spaceId}`);
          }
          const { data } = await query.throwOnError();
          return data as EventType[];
        },
      }
    );
  }
}
