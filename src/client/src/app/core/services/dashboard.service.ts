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
    return this.cache.get(
      'get_dashboard_data',
      { spaceId, filters },
      {
        ttl: HEAVY_TTL,
        tags: [`space:${spaceId}:dashboard`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .rpc('get_dashboard_data', {
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
            })
            .throwOnError();

          return { companies: mapDashboardCompanies(data) } as DashboardData;
        },
      }
    );
  }

  async seedDemoData(spaceId: string): Promise<void> {
    await this.supabase.client.rpc('seed_demo_data', { p_space_id: spaceId }).throwOnError();
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

/**
 * Maps the raw get_dashboard_data RPC payload into the client DashboardData
 * company > asset > trial shape. Trials nested under an indication get an
 * `_indication` augmentation so the client-side indication filter can match
 * on the indication entity id. Exported as a pure function so the mapping can
 * be unit-tested without mocking Supabase (mirrors filterDashboardData).
 */
export function mapDashboardCompanies(data: any[]): any[] {
  return (data ?? []).map((c: any) => ({
    ...c,
    assets: (c.assets ?? []).map((p: any) => {
      const indicationTrials = (p.indications ?? []).flatMap((ind: any) =>
        (ind.trials ?? []).map((t: any) => ({
          ...t,
          // The RPC emits the indication entity id as `id` and its name as
          // `name`. The indication filter matches on `_indication.indication_id`,
          // so surface the entity id under that key (and the name) here.
          _indication: { id: ind.id, indication_id: ind.id, indication_name: ind.name },
        }))
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
}
