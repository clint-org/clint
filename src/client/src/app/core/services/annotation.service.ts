import { inject, Injectable } from '@angular/core';

import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

export interface Annotation {
  id: string;
  body: string;
  change_event_id: string;
  created_at: string;
  updated_at: string;
}

@Injectable({ providedIn: 'root' })
export class AnnotationService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async upsert(changeEventId: string, body: string): Promise<Annotation> {
    const { data } = await this.supabase.client
      .rpc('upsert_change_event_annotation', {
        p_change_event_id: changeEventId,
        p_body: body,
      })
      .throwOnError();
    this.cache.invalidateTags([`change_event:${changeEventId}:annotation`]);
    return data as Annotation;
  }

  async delete(changeEventId: string): Promise<void> {
    await this.supabase.client
      .rpc('delete_change_event_annotation', {
        p_change_event_id: changeEventId,
      })
      .throwOnError();
    this.cache.invalidateTags([`change_event:${changeEventId}:annotation`]);
  }
}
