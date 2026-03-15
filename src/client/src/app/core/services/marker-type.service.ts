import { inject, Injectable } from '@angular/core';

import { MarkerType } from '../models/marker.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class MarkerTypeService {
  private supabase = inject(SupabaseService);

  async list(): Promise<MarkerType[]> {
    const { data, error } = await this.supabase.client
      .from('marker_types')
      .select('*')
      .order('display_order');

    if (error) throw error;
    return data as MarkerType[];
  }

  async create(markerType: Partial<MarkerType>): Promise<MarkerType> {
    const { data, error } = await this.supabase.client
      .from('marker_types')
      .insert(markerType)
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
    const { error } = await this.supabase.client
      .from('marker_types')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
}
