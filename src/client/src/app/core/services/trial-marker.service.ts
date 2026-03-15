import { inject, Injectable } from '@angular/core';

import { TrialMarker } from '../models/marker.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class TrialMarkerService {
  private supabase = inject(SupabaseService);

  async create(marker: Partial<TrialMarker>): Promise<TrialMarker> {
    const { data, error } = await this.supabase.client
      .from('trial_markers')
      .insert(marker)
      .select()
      .single();

    if (error) throw error;
    return data as TrialMarker;
  }

  async update(id: string, changes: Partial<TrialMarker>): Promise<TrialMarker> {
    const { data, error } = await this.supabase.client
      .from('trial_markers')
      .update(changes)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as TrialMarker;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('trial_markers')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
}
