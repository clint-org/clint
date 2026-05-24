import { inject, Injectable } from '@angular/core';

import { Indication } from '../models/indication.model';
import { SupabaseService } from './supabase.service';
import { RpcCache } from './rpc-cache.service';

const REFERENCE_TTL = { fresh: 30 * 60 * 1000, stale: Infinity };

@Injectable({ providedIn: 'root' })
export class IndicationService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async list(spaceId: string): Promise<Indication[]> {
    return this.cache.get('list_indications', { spaceId }, {
      ttl: REFERENCE_TTL,
      tags: [`space:${spaceId}:indications`],
      fetch: async () => {
        const { data, error } = await this.supabase.client
          .from('indications')
          .select('*')
          .eq('space_id', spaceId)
          .order('name');
        if (error) throw error;
        return (data ?? []) as Indication[];
      },
    });
  }

  async create(spaceId: string, indication: Partial<Indication>): Promise<Indication> {
    const { data, error } = await this.supabase.client
      .from('indications')
      .insert({ ...indication, space_id: spaceId })
      .select()
      .single();
    if (error) throw error;
    this.cache.invalidateTags([
      `space:${spaceId}:indications`,
      `space:${spaceId}:dashboard`,
      `space:${spaceId}:landing-stats`,
    ]);
    return data as Indication;
  }

  async update(id: string, changes: Partial<Indication>): Promise<Indication> {
    const { data, error } = await this.supabase.client
      .from('indications')
      .update(changes)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    const spaceId = (data as Indication).space_id;
    this.cache.invalidateTags([
      `space:${spaceId}:indications`,
      `space:${spaceId}:dashboard`,
      `space:${spaceId}:landing-stats`,
    ]);
    return data as Indication;
  }

  async delete(id: string): Promise<void> {
    const { data: existing } = await this.supabase.client
      .from('indications')
      .select('space_id')
      .eq('id', id)
      .single();
    const { error } = await this.supabase.client.from('indications').delete().eq('id', id);
    if (error) throw error;
    if (existing?.space_id) {
      this.cache.invalidateTags([
        `space:${existing.space_id}:indications`,
        `space:${existing.space_id}:dashboard`,
        `space:${existing.space_id}:landing-stats`,
      ]);
    }
  }
}
