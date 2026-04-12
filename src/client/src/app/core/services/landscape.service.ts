import { inject, Injectable } from '@angular/core';

import { BullseyeData, BullseyeDimension, CountUnit, LandscapeFilters, LandscapeIndexEntry, PositioningData, PositioningGrouping } from '../models/landscape.model';
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

  async getPositioningData(
    spaceId: string,
    grouping: PositioningGrouping,
    countUnit: CountUnit,
    filters: LandscapeFilters,
  ): Promise<PositioningData> {
    const { data, error } = await this.supabase.client.rpc('get_positioning_data', {
      p_space_id: spaceId,
      p_grouping: grouping,
      p_count_unit: countUnit,
      p_company_ids: filters.companyIds.length ? filters.companyIds : null,
      p_product_ids: filters.productIds.length ? filters.productIds : null,
      p_therapeutic_area_ids: filters.therapeuticAreaIds.length ? filters.therapeuticAreaIds : null,
      p_mechanism_of_action_ids: filters.mechanismOfActionIds.length ? filters.mechanismOfActionIds : null,
      p_route_of_administration_ids: filters.routeOfAdministrationIds.length ? filters.routeOfAdministrationIds : null,
      p_phases: filters.phases.length ? filters.phases : null,
      p_recruitment_statuses: filters.recruitmentStatuses.length ? filters.recruitmentStatuses : null,
      p_study_types: filters.studyTypes.length ? filters.studyTypes : null,
    });
    if (error) throw error;
    return data as PositioningData;
  }
}
