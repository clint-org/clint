import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';

/**
 * Per-space display/scope settings that are not part of the core space record.
 * Currently exposes the "track preclinical phase" flag. Reads the typed
 * spaces.show_preclinical column; writes go through the owner-gated
 * update_space_show_preclinical RPC. Mirrors SpaceFieldVisibilityService.
 *
 * The server enforces preclinical exclusion in every analytic RPC regardless of
 * this flag's UI use; this service drives what controls/segments the UI shows.
 */
@Injectable({ providedIn: 'root' })
export class SpaceSettingsService {
  private supabase = inject(SupabaseService);

  /** Whether the space tracks the preclinical phase. Defaults false server-side. */
  async getShowPreclinical(spaceId: string): Promise<boolean> {
    const { data } = await this.supabase.client
      .from('spaces')
      .select('show_preclinical')
      .eq('id', spaceId)
      .single()
      .throwOnError();
    return !!data?.show_preclinical;
  }

  /** Owner-only. Toggles whether the space tracks the preclinical phase. */
  async setShowPreclinical(spaceId: string, show: boolean): Promise<void> {
    await this.supabase.client
      .rpc('update_space_show_preclinical', {
        p_space_id: spaceId,
        p_show: show,
      })
      .throwOnError();
  }
}
