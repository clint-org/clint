import { inject, Injectable } from '@angular/core';

import { DashboardData, DashboardFilters } from '../models/dashboard.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private supabase = inject(SupabaseService);

  async getDashboardData(filters: DashboardFilters): Promise<DashboardData> {
    const { data, error } = await this.supabase.client.rpc('get_dashboard_data', {
      p_company_ids: filters.companyIds,
      p_product_ids: filters.productIds,
      p_therapeutic_area_ids: filters.therapeuticAreaIds,
      p_start_year: filters.startYear,
      p_end_year: filters.endYear,
    });

    if (error) throw error;
    return data as DashboardData;
  }
}
