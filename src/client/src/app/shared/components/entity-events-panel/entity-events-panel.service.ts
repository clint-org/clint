import { inject, Injectable } from '@angular/core';

import { RpcCache } from '../../../core/services/rpc-cache.service';
import { SupabaseService } from '../../../core/services/supabase.service';

const HEAVY_TTL = { fresh: 30 * 1000, stale: 5 * 60 * 1000 };

export interface EntityEventRow {
  id: string;
  title: string;
  event_date: string;
  category_name: string;
  category_id: string;
  priority: string | null;
  entity_level: 'trial' | 'product' | 'company' | 'space';
  entity_name: string;
  entity_id: string | null;
  company_name: string | null;
  tags: string[];
  has_thread: boolean;
  thread_id: string | null;
  description: string | null;
}

export interface FetchEntityEventsParams {
  spaceId: string;
  entityLevel: 'trial' | 'product' | 'company';
  entityId: string;
  limit?: number;
}

@Injectable({ providedIn: 'root' })
export class EntityEventsPanelService {
  private readonly supabase = inject(SupabaseService);
  private readonly cache = inject(RpcCache);

  async fetch(params: FetchEntityEventsParams): Promise<EntityEventRow[]> {
    return this.cache.get('get_events_page_data', params, {
      ttl: HEAVY_TTL,
      tags: [`space:${params.spaceId}:events`],
      fetch: async () => {
        const { data, error } = await this.supabase.client.rpc('get_events_page_data', {
          p_space_id: params.spaceId,
          p_entity_level: params.entityLevel,
          p_entity_id: params.entityId,
          p_source_type: 'event',
          p_limit: params.limit ?? 20,
          p_offset: 0,
        });
        if (error) throw new Error(error.message);
        const result = data as { items: EntityEventRow[]; total: number } | null;
        return result?.items ?? [];
      },
    });
  }
}
