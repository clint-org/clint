import { inject, Injectable } from '@angular/core';

import { TrialPhase } from '../models/trial.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class TrialPhaseService {
  private supabase = inject(SupabaseService);

  async create(spaceId: string, phase: Partial<TrialPhase>): Promise<TrialPhase> {
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { data, error } = await this.supabase.client
      .from('trial_phases')
      .insert({ ...phase, space_id: spaceId, created_by: userId })
      .select()
      .single();
    if (error) throw error;
    return data as TrialPhase;
  }

  async update(id: string, changes: Partial<TrialPhase>): Promise<TrialPhase> {
    const { data, error } = await this.supabase.client
      .from('trial_phases')
      .update(changes)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as TrialPhase;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('trial_phases').delete().eq('id', id);
    if (error) throw error;
  }
}
