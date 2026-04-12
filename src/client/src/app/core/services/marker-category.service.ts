import { inject, Injectable } from '@angular/core';

import { MarkerCategory } from '../models/marker.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class MarkerCategoryService {
  private supabase = inject(SupabaseService);

  async list(spaceId?: string): Promise<MarkerCategory[]> {
    let query = this.supabase.client
      .from('marker_categories')
      .select('*')
      .order('display_order');

    if (spaceId) {
      query = query.or(`is_system.eq.true,space_id.eq.${spaceId}`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data as MarkerCategory[];
  }
}
