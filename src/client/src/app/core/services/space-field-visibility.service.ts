import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class SpaceFieldVisibilityService {
  private supabase = inject(SupabaseService);

  /** Returns the per-surface visibility config, or {} if unset. */
  async get(spaceId: string): Promise<Record<string, string[]>> {
    const { data, error } = await this.supabase.client
      .from('spaces')
      .select('ctgov_field_visibility')
      .eq('id', spaceId)
      .single();
    if (error) throw error;
    return (data?.ctgov_field_visibility as Record<string, string[]>) ?? {};
  }

  /** Owner-only. Replaces the entire visibility object for the space. */
  async update(spaceId: string, visibility: Record<string, string[]>): Promise<void> {
    const { error } = await this.supabase.client.rpc('update_space_field_visibility', {
      p_space_id: spaceId,
      p_visibility: visibility,
    });
    if (error) throw error;
  }
}
