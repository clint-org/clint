import { inject, Injectable } from '@angular/core';

import { MechanismOfAction } from '../models/mechanism-of-action.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class MechanismOfActionService {
  private supabase = inject(SupabaseService);

  async list(spaceId: string): Promise<MechanismOfAction[]> {
    const { data, error } = await this.supabase.client
      .from('mechanisms_of_action')
      .select('*')
      .eq('space_id', spaceId)
      .order('display_order')
      .order('name');
    if (error) throw error;
    return data as MechanismOfAction[];
  }

  async getById(id: string): Promise<MechanismOfAction> {
    const { data, error } = await this.supabase.client
      .from('mechanisms_of_action')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data as MechanismOfAction;
  }

  async create(spaceId: string, moa: Partial<MechanismOfAction>): Promise<MechanismOfAction> {
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { data, error } = await this.supabase.client
      .from('mechanisms_of_action')
      .insert({ ...moa, space_id: spaceId, created_by: userId })
      .select()
      .single();
    if (error) throw error;
    return data as MechanismOfAction;
  }

  async update(id: string, changes: Partial<MechanismOfAction>): Promise<MechanismOfAction> {
    const { data, error } = await this.supabase.client
      .from('mechanisms_of_action')
      .update(changes)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as MechanismOfAction;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('mechanisms_of_action').delete().eq('id', id);
    if (error) throw error;
  }

  async countAssignedAssets(id: string): Promise<number> {
    const { count, error } = await this.supabase.client
      .from('product_mechanisms_of_action')
      .select('*', { count: 'exact', head: true })
      .eq('moa_id', id);
    if (error) throw error;
    return count ?? 0;
  }
}
