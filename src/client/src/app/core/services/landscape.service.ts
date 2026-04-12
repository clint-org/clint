import { inject, Injectable } from '@angular/core';

import { BullseyeData, BullseyeDimension, LandscapeIndexEntry } from '../models/landscape.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class LandscapeService {
  private supabase = inject(SupabaseService);

  async getLandscapeIndex(
    spaceId: string,
    dimension: BullseyeDimension
  ): Promise<LandscapeIndexEntry[]> {
    const rpcMap: Record<BullseyeDimension, string> = {
      'therapeutic-area': 'get_landscape_index',
      company: 'get_landscape_index_by_company',
      moa: 'get_landscape_index_by_moa',
      roa: 'get_landscape_index_by_roa',
    };
    const { data, error } = await this.supabase.client.rpc(rpcMap[dimension], {
      p_space_id: spaceId,
    });
    if (error) throw error;
    return (data ?? []) as LandscapeIndexEntry[];
  }

  async getBullseyeData(
    spaceId: string,
    dimension: BullseyeDimension,
    entityId: string
  ): Promise<BullseyeData> {
    const rpcMap: Record<BullseyeDimension, { name: string; paramKey: string }> = {
      'therapeutic-area': { name: 'get_bullseye_data', paramKey: 'p_therapeutic_area_id' },
      company: { name: 'get_bullseye_by_company', paramKey: 'p_company_id' },
      moa: { name: 'get_bullseye_by_moa', paramKey: 'p_moa_id' },
      roa: { name: 'get_bullseye_by_roa', paramKey: 'p_roa_id' },
    };
    const { name, paramKey } = rpcMap[dimension];
    const { data, error } = await this.supabase.client.rpc(name, {
      p_space_id: spaceId,
      [paramKey]: entityId,
    });
    if (error) throw error;
    return data as BullseyeData;
  }
}
