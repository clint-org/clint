import { inject, Injectable } from '@angular/core';

import { EventThread } from '../models/event.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class EventThreadService {
  private supabase = inject(SupabaseService);

  async listBySpace(spaceId: string): Promise<EventThread[]> {
    const { data, error } = await this.supabase.client
      .from('event_threads')
      .select('*')
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data as EventThread[];
  }

  async create(spaceId: string, title: string): Promise<EventThread> {
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { data, error } = await this.supabase.client
      .from('event_threads')
      .insert({ space_id: spaceId, title, created_by: userId })
      .select()
      .single();
    if (error) throw error;
    return data as EventThread;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('event_threads')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }
}
