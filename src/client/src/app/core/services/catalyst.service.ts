import { inject, Injectable } from '@angular/core';

import { CatalystDetail } from '../models/catalyst.model';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

const HEAVY_TTL = { fresh: 30 * 1000, stale: 5 * 60 * 1000 };

@Injectable({ providedIn: 'root' })
export class CatalystService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async getCatalystDetail(markerId: string): Promise<CatalystDetail> {
    return this.cache.get(
      'get_catalyst_detail',
      { markerId },
      {
        ttl: HEAVY_TTL,
        tags: [`catalyst:${markerId}:detail`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .rpc('get_catalyst_detail', {
              p_marker_id: markerId,
            })
            .throwOnError();
          return data as CatalystDetail;
        },
      }
    );
  }
}
