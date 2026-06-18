import { inject, Injectable } from '@angular/core';

import {
  BullseyeAsset,
  BullseyeData,
  BullseyeDimension,
  CountUnit,
  HeatmapData,
  HeatmapGrouping,
  LandscapeFilters,
  LandscapeIndexEntry,
} from '../models/landscape.model';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

const HEAVY_TTL = { fresh: 30 * 1000, stale: 5 * 60 * 1000 };

@Injectable({ providedIn: 'root' })
export class LandscapeService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async getLandscapeIndex(
    spaceId: string,
    dimension: BullseyeDimension
  ): Promise<LandscapeIndexEntry[]> {
    const rpcMap: Record<BullseyeDimension, string> = {
      indication: 'get_landscape_index',
      company: 'get_landscape_index_by_company',
      moa: 'get_landscape_index_by_moa',
      roa: 'get_landscape_index_by_roa',
    };
    const rpcName = rpcMap[dimension];
    return this.cache.get(
      rpcName,
      { spaceId, dimension },
      {
        ttl: HEAVY_TTL,
        tags: [`space:${spaceId}:landscape:${dimension}`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .rpc(rpcName, {
              p_space_id: spaceId,
            })
            .throwOnError();
          return (data ?? []) as LandscapeIndexEntry[];
        },
      }
    );
  }

  async getBullseyeData(
    spaceId: string,
    dimension: BullseyeDimension,
    entityId: string
  ): Promise<BullseyeData> {
    const rpcMap: Record<BullseyeDimension, { name: string; paramKey: string }> = {
      indication: { name: 'get_bullseye_data', paramKey: 'p_indication_id' },
      company: { name: 'get_bullseye_by_company', paramKey: 'p_company_id' },
      moa: { name: 'get_bullseye_by_moa', paramKey: 'p_moa_id' },
      roa: { name: 'get_bullseye_by_roa', paramKey: 'p_roa_id' },
    };
    const { name, paramKey } = rpcMap[dimension];
    return this.cache.get(
      name,
      { spaceId, dimension, entityId },
      {
        ttl: HEAVY_TTL,
        tags: [`space:${spaceId}:bullseye:${dimension}:${entityId}`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .rpc(name, {
              p_space_id: spaceId,
              [paramKey]: entityId,
            })
            .throwOnError();
          return data as BullseyeData;
        },
      }
    );
  }

  async getBullseyeAssets(spaceId: string, filters: LandscapeFilters): Promise<BullseyeAsset[]> {
    return this.cache.get(
      'get_bullseye_assets',
      { spaceId, filters },
      {
        ttl: HEAVY_TTL,
        tags: [`space:${spaceId}:bullseye:assets`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .rpc('get_bullseye_assets', {
              p_space_id: spaceId,
              p_indication_ids: filters.indicationIds.length ? filters.indicationIds : null,
              p_company_ids: filters.companyIds.length ? filters.companyIds : null,
              p_moa_ids: filters.mechanismOfActionIds.length ? filters.mechanismOfActionIds : null,
              p_roa_ids: filters.routeOfAdministrationIds.length
                ? filters.routeOfAdministrationIds
                : null,
              p_phases: filters.phases.length ? filters.phases : null,
              p_asset_ids: filters.assetIds.length ? filters.assetIds : null,
              p_trial_ids: filters.trialIds.length ? filters.trialIds : null,
            })
            .throwOnError();
          const result = data as { assets: BullseyeAsset[] };
          return result.assets;
        },
      }
    );
  }

  async getHeatmapData(
    spaceId: string,
    grouping: HeatmapGrouping,
    countUnit: CountUnit,
    filters: LandscapeFilters
  ): Promise<HeatmapData> {
    const wireCountUnit = countUnit === 'assets' ? 'products' : countUnit;
    return this.cache.get(
      'get_positioning_data',
      { spaceId, grouping, countUnit, filters },
      {
        ttl: HEAVY_TTL,
        tags: [`space:${spaceId}:heatmap`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .rpc('get_positioning_data', {
              p_space_id: spaceId,
              p_grouping: grouping,
              p_count_unit: wireCountUnit,
              p_company_ids: filters.companyIds.length ? filters.companyIds : null,
              p_asset_ids: filters.assetIds.length ? filters.assetIds : null,
              p_indication_ids: filters.indicationIds.length ? filters.indicationIds : null,
              p_mechanism_of_action_ids: filters.mechanismOfActionIds.length
                ? filters.mechanismOfActionIds
                : null,
              p_route_of_administration_ids: filters.routeOfAdministrationIds.length
                ? filters.routeOfAdministrationIds
                : null,
              p_phases: filters.phases.length ? filters.phases : null,
              p_recruitment_statuses: filters.recruitmentStatuses.length
                ? filters.recruitmentStatuses
                : null,
              p_study_types: filters.studyTypes.length ? filters.studyTypes : null,
            })
            .throwOnError();
          const raw = data as Omit<HeatmapData, 'count_unit'> & { count_unit: string };
          return {
            ...raw,
            count_unit: (raw.count_unit === 'products' ? 'assets' : raw.count_unit) as CountUnit,
          };
        },
      }
    );
  }
}
