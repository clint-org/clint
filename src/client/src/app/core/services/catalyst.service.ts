import { inject, Injectable } from '@angular/core';

import {
  Catalyst,
  CatalystDetail,
  CatalystFilters,
} from '../models/catalyst.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class CatalystService {
  private supabase = inject(SupabaseService);

  async getKeyCatalysts(
    spaceId: string,
    filters: CatalystFilters = {},
  ): Promise<Catalyst[]> {
    const { data, error } = await this.supabase.client.rpc('get_key_catalysts', {
      p_space_id: spaceId,
      p_category_ids:
        filters.category_ids && filters.category_ids.length > 0
          ? filters.category_ids
          : null,
      p_company_id: filters.company_id ?? null,
      p_product_id: filters.product_id ?? null,
    });
    if (error) throw error;
    return (data ?? []) as Catalyst[];
  }

  async getCatalystDetail(markerId: string): Promise<CatalystDetail> {
    const { data, error } = await this.supabase.client.rpc('get_catalyst_detail', {
      p_marker_id: markerId,
    });
    if (error) throw error;
    return data as CatalystDetail;
  }
}
