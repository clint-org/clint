import { inject, Injectable } from '@angular/core';

import { Trial } from '../models/trial.model';
import { SupabaseService } from './supabase.service';

const TRIAL_SELECT = `
  *,
  therapeutic_areas(*),
  trial_phases(*),
  trial_markers(*, marker_types(*)),
  trial_notes(*)
`;

@Injectable({ providedIn: 'root' })
export class TrialService {
  private supabase = inject(SupabaseService);

  async listByProduct(productId: string): Promise<Trial[]> {
    const { data, error } = await this.supabase.client
      .from('trials')
      .select(TRIAL_SELECT)
      .eq('product_id', productId)
      .order('display_order');
    if (error) throw error;
    return data as Trial[];
  }

  async listBySpace(spaceId: string): Promise<Trial[]> {
    const { data, error } = await this.supabase.client
      .from('trials')
      .select(TRIAL_SELECT)
      .eq('space_id', spaceId)
      .order('display_order');
    if (error) throw error;
    return data as Trial[];
  }

  async getById(id: string): Promise<Trial> {
    const { data, error } = await this.supabase.client
      .from('trials')
      .select(TRIAL_SELECT)
      .eq('id', id)
      .single();
    if (error) throw error;
    return data as Trial;
  }

  async create(spaceId: string, trial: Partial<Trial>): Promise<Trial> {
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { data, error } = await this.supabase.client
      .from('trials')
      .insert({ ...trial, space_id: spaceId, created_by: userId })
      .select()
      .single();
    if (error) throw error;
    return data as Trial;
  }

  async update(id: string, changes: Partial<Trial>): Promise<Trial> {
    const { data, error } = await this.supabase.client
      .from('trials')
      .update(changes)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as Trial;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('trials').delete().eq('id', id);
    if (error) throw error;
  }
}
