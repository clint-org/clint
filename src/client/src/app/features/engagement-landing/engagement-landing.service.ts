import { inject, Injectable } from '@angular/core';

import { FillStyle, InnerMark, MarkerShape } from '../../core/models/marker.model';
import { SupabaseService } from '../../core/services/supabase.service';
import { TenantService } from '../../core/services/tenant.service';

/**
 * Stats returned by `get_space_landing_stats` (see migration
 * 20260501152530_add_space_landing_stats.sql). `intelligence_total` is always
 * 0 in phase 1; the primary_intelligence table is not yet shipped.
 * The RPC returns `programs` on the wire; the service aliases it to `assets`
 * so the frontend uses the unified vocabulary.
 */
export interface SpaceLandingStats {
  active_trials: number;
  companies: number;
  assets: number;
  catalysts_90d: number;
  intelligence_total: number;
}

interface RawSpaceLandingStats {
  active_trials: number;
  companies: number;
  programs: number;
  catalysts_90d: number;
  intelligence_total: number;
}

/**
 * Lightweight upcoming catalyst row used by the side rail. Pulled from the
 * dashboard hierarchy returned by `get_dashboard_data`, filtered to markers
 * whose `event_date` is within the next 14 days.
 */
export interface UpcomingCatalyst {
  marker_id: string;
  title: string;
  event_date: string;
  is_projected: boolean;
  no_longer_expected: boolean;
  category_name: string;
  marker_type_color: string;
  marker_type_shape: MarkerShape;
  marker_type_fill_style: FillStyle;
  marker_type_inner_mark: InnerMark;
  company_name: string | null;
  product_name: string | null;
  trial_name: string | null;
}

@Injectable({ providedIn: 'root' })
export class EngagementLandingService {
  private readonly supabase = inject(SupabaseService);
  private readonly tenantService = inject(TenantService);

  async getStats(spaceId: string): Promise<SpaceLandingStats | null> {
    const { data, error } = await this.supabase.client.rpc('get_space_landing_stats', {
      p_space_id: spaceId,
    });
    if (error) throw error;
    const raw = data as RawSpaceLandingStats | null;
    if (!raw) return null;
    return {
      active_trials: raw.active_trials,
      companies: raw.companies,
      assets: raw.programs,
      catalysts_90d: raw.catalysts_90d,
      intelligence_total: raw.intelligence_total,
    };
  }

  /**
   * Returns true if the current user is an agency member of the agency that
   * parents the given tenant. Returns false if the tenant has no agency, the
   * user has no agency membership, or any RPC error is hit.
   */
  async isAgencyMemberOfTenant(tenantId: string): Promise<boolean> {
    try {
      const tenant = await this.tenantService.getTenant(tenantId);
      if (!tenant?.agency_id) return false;
      const { data, error } = await this.supabase.client.rpc('is_agency_member', {
        p_agency_id: tenant.agency_id,
      });
      if (error) return false;
      return data === true;
    } catch {
      return false;
    }
  }
}
