import { inject, Injectable } from '@angular/core';

import { DashboardData, DashboardFilters } from '../models/dashboard.model';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const HEAVY_TTL = { fresh: 30 * 1000, stale: 5 * 60 * 1000 };

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async getDashboardData(spaceId: string, filters: DashboardFilters): Promise<DashboardData> {
    return this.cache.get('get_dashboard_data', { spaceId, filters }, {
      ttl: HEAVY_TTL,
      tags: [`space:${spaceId}:dashboard`],
      fetch: async () => {
        const { data, error } = await this.supabase.client.rpc('get_dashboard_data', {
          p_space_id: spaceId,
          p_company_ids: filters.companyIds,
          p_asset_ids: filters.assetIds,
          p_indication_ids: filters.indicationIds,
          p_start_year: filters.startYear,
          p_end_year: filters.endYear,
          p_recruitment_statuses: filters.recruitmentStatuses,
          p_study_types: filters.studyTypes,
          p_phases: filters.phases,
          p_mechanism_of_action_ids: filters.mechanismOfActionIds,
          p_route_of_administration_ids: filters.routeOfAdministrationIds,
        });

        if (error) throw error;

        const companies = (data ?? []).map((c: any) => ({
          ...c,
          assets: (c.assets ?? c.products ?? []).map((p: any) => {
            const indicationTrials = (p.indications ?? []).flatMap((ind: any) =>
              (ind.trials ?? []).map((t: any) => ({ ...t, _indication: ind }))
            );
            const allTrials = indicationTrials.length > 0 ? indicationTrials : (p.trials ?? []);
            return {
              ...p,
              indications: p.indications ?? [],
              trials: allTrials.map((t: any) => ({
                ...t,
                identifier: t.identifier ?? null,
                phase_type: t.phase_data?.phase_type ?? null,
                phase_start_date: t.phase_data?.phase_start_date ?? null,
                phase_end_date: t.phase_data?.phase_end_date ?? null,
                markers: (t.markers ?? []).map((m: any) => ({
                  ...m,
                  marker_types: m.marker_type
                    ? {
                        ...m.marker_type,
                        category_id: m.marker_type.category_id ?? null,
                        marker_categories: m.marker_type.category_name
                          ? { id: m.marker_type.category_id, name: m.marker_type.category_name }
                          : null,
                      }
                    : null,
                })),
                trial_notes: t.trial_notes ?? [],
              })),
            };
          }),
        }));

        return { companies } as DashboardData;
      },
    });
  }

  async seedDemoData(spaceId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('seed_demo_data', { p_space_id: spaceId });
    if (error) throw error;
    this.cache.invalidateTags([
      `space:${spaceId}:dashboard`,
      `space:${spaceId}:landing-stats`,
      `space:${spaceId}:companies`,
      `space:${spaceId}:products`,
      `space:${spaceId}:indications`,
      `space:${spaceId}:moa`,
      `space:${spaceId}:roa`,
    ]);
  }
}
