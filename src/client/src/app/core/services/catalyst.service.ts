import { inject, Injectable } from '@angular/core';

import { CatalystDetail } from '../models/catalyst.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class CatalystService {
  private supabase = inject(SupabaseService);

  async getCatalystDetail(markerId: string): Promise<CatalystDetail> {
    const { data, error } = await this.supabase.client.rpc('get_catalyst_detail', {
      p_marker_id: markerId,
    });
    if (error) throw error;
    return data as CatalystDetail;
  }
}
