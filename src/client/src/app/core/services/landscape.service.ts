import { inject, Injectable } from '@angular/core';

import { BullseyeData, LandscapeIndexEntry } from '../models/landscape.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class LandscapeService {
  private supabase = inject(SupabaseService);

  async getLandscapeIndex(spaceId: string): Promise<LandscapeIndexEntry[]> {
    const { data, error } = await this.supabase.client.rpc('get_landscape_index', {
      p_space_id: spaceId,
    });
    if (error) throw error;
    return (data ?? []) as LandscapeIndexEntry[];
  }

  async getBullseyeData(spaceId: string, therapeuticAreaId: string): Promise<BullseyeData> {
    const { data, error } = await this.supabase.client.rpc('get_bullseye_data', {
      p_space_id: spaceId,
      p_therapeutic_area_id: therapeuticAreaId,
    });
    if (error) throw error;
    return data as BullseyeData;
  }
}
