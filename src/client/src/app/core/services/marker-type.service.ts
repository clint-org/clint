import { inject, Injectable } from '@angular/core';

import { MarkerType } from '../models/marker.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class MarkerTypeService {
  private supabase = inject(SupabaseService);

  async list(spaceId?: string): Promise<MarkerType[]> {
    let query = this.supabase.client
      .from('marker_types')
      .select('*, marker_categories(*)')
      .order('display_order');

    if (spaceId) {
      query = query.or(`is_system.eq.true,space_id.eq.${spaceId}`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data as MarkerType[];
  }

  async listByCategory(categoryId: string, spaceId?: string): Promise<MarkerType[]> {
    let query = this.supabase.client
      .from('marker_types')
      .select('*, marker_categories(*)')
      .eq('category_id', categoryId)
      .order('display_order');

    if (spaceId) {
      query = query.or(`is_system.eq.true,space_id.eq.${spaceId}`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data as MarkerType[];
  }

  async create(spaceId: string, markerType: Partial<MarkerType>): Promise<MarkerType> {
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { data, error } = await this.supabase.client
      .from('marker_types')
      .insert({ ...markerType, space_id: spaceId, created_by: userId, is_system: false })
      .select()
      .single();
    if (error) throw error;
    return data as MarkerType;
  }

  async update(id: string, changes: Partial<MarkerType>): Promise<MarkerType> {
    const { data, error } = await this.supabase.client
      .from('marker_types')
      .update(changes)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as MarkerType;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('marker_types').delete().eq('id', id);
    if (error) throw error;
  }
}
