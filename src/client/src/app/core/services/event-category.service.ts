import { inject, Injectable } from '@angular/core';

import { EventCategory } from '../models/event.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class EventCategoryService {
  private supabase = inject(SupabaseService);

  async list(spaceId?: string): Promise<EventCategory[]> {
    let query = this.supabase.client
      .from('event_categories')
      .select('*')
      .order('display_order');

    if (spaceId) {
      query = query.or(`is_system.eq.true,space_id.eq.${spaceId}`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data as EventCategory[];
  }
}
