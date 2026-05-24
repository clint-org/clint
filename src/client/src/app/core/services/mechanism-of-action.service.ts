import { inject, Injectable } from '@angular/core';

import { MechanismOfAction } from '../models/mechanism-of-action.model';
import { SupabaseService } from './supabase.service';
import { RpcCache } from './rpc-cache.service';

const REFERENCE_TTL = { fresh: 30 * 60 * 1000, stale: Infinity };

@Injectable({ providedIn: 'root' })
export class MechanismOfActionService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async list(spaceId: string): Promise<MechanismOfAction[]> {
    return this.cache.get('list_mechanisms_of_action', { spaceId }, {
      ttl: REFERENCE_TTL,
      tags: [`space:${spaceId}:moa`],
      fetch: async () => {
        const { data, error } = await this.supabase.client
          .from('mechanisms_of_action')
          .select('*')
          .eq('space_id', spaceId)
          .order('display_order')
          .order('name');
        if (error) throw error;
        return (data ?? []) as MechanismOfAction[];
      },
    });
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
    const { data, error } = await this.supabase.client
      .from('mechanisms_of_action')
      .insert({ ...moa, space_id: spaceId })
      .select()
      .single();
    if (error) throw error;
    this.cache.invalidateTags([
      `space:${spaceId}:moa`,
      `space:${spaceId}:products`,
      `space:${spaceId}:dashboard`,
    ]);
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
    const spaceId = (data as MechanismOfAction).space_id;
    this.cache.invalidateTags([
      `space:${spaceId}:moa`,
      `space:${spaceId}:products`,
      `space:${spaceId}:dashboard`,
    ]);
    return data as MechanismOfAction;
  }

  async delete(id: string): Promise<void> {
    const { data: existing } = await this.supabase.client
      .from('mechanisms_of_action')
      .select('space_id')
      .eq('id', id)
      .single();
    const { error } = await this.supabase.client.from('mechanisms_of_action').delete().eq('id', id);
    if (error) throw error;
    if (existing?.space_id) {
      this.cache.invalidateTags([
        `space:${existing.space_id}:moa`,
        `space:${existing.space_id}:products`,
        `space:${existing.space_id}:dashboard`,
      ]);
    }
  }

  async countAssignedAssets(id: string): Promise<number> {
    const { count, error } = await this.supabase.client
      .from('asset_mechanisms_of_action')
      .select('*', { count: 'exact', head: true })
      .eq('moa_id', id);
    if (error) throw error;
    return count ?? 0;
  }
}
