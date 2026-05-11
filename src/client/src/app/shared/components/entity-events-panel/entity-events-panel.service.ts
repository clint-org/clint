import { inject, Injectable } from '@angular/core';

import { SupabaseService } from '../../../core/services/supabase.service';

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

  async fetch(params: FetchEntityEventsParams): Promise<EntityEventRow[]> {
    const { data, error } = await this.supabase.client.rpc('get_events_page_data', {
      p_space_id: params.spaceId,
      p_entity_level: params.entityLevel,
      p_entity_id: params.entityId,
      p_source_type: 'event',
      p_limit: params.limit ?? 20,
      p_offset: 0,
    });
    if (error) throw new Error(error.message);
    return (data as EntityEventRow[]) ?? [];
  }
}
