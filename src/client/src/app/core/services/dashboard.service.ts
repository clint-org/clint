import { inject, Injectable } from '@angular/core';

import { DashboardData, DashboardFilters } from '../models/dashboard.model';
import { SupabaseService } from './supabase.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

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

    const companies = (data ?? []).map((c: any) => ({
      ...c,
      products: (c.products ?? []).map((p: any) => ({
        ...p,
        trials: (p.trials ?? []).map((t: any) => ({
          ...t,
          therapeutic_areas: t.therapeutic_area ?? null,
          trial_phases: t.phases ?? [],
          trial_markers: (t.markers ?? []).map((m: any) => ({
            ...m,
            marker_types: m.marker_type ?? null,
          })),
          trial_notes: t.trial_notes ?? [],
        })),
      })),
    }));

    return { companies } as DashboardData;
  }
}
