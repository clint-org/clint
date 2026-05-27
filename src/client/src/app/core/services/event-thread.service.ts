import { inject, Injectable } from '@angular/core';

import { EventThread } from '../models/event.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class EventThreadService {
  private supabase = inject(SupabaseService);

  async listBySpace(spaceId: string): Promise<EventThread[]> {
    const { data } = await this.supabase.client
      .from('event_threads')
      .select('*')
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false })
      .throwOnError();
    return data as EventThread[];
  }

  async create(spaceId: string, title: string): Promise<EventThread> {
    const { data } = await this.supabase.client
      .from('event_threads')
      .insert({ space_id: spaceId, title })
      .select()
      .single()
      .throwOnError();
    return data as EventThread;
  }

  async delete(id: string): Promise<void> {
    await this.supabase.client.from('event_threads').delete().eq('id', id).throwOnError();
  }
}
