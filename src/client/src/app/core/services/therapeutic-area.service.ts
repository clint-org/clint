import { inject, Injectable } from '@angular/core';

import { TherapeuticArea } from '../models/trial.model';
import { SupabaseService } from './supabase.service';
import { RpcCache } from './rpc-cache.service';

const REFERENCE_TTL = { fresh: 30 * 60 * 1000, stale: Infinity };

@Injectable({ providedIn: 'root' })
export class TherapeuticAreaService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async list(spaceId: string): Promise<TherapeuticArea[]> {
    return this.cache.get('list_therapeutic_areas', { spaceId }, {
      ttl: REFERENCE_TTL,
      tags: [`space:${spaceId}:therapeutic-areas`],
      fetch: async () => {
        const { data, error } = await this.supabase.client
          .from('therapeutic_areas')
          .select('*')
          .eq('space_id', spaceId)
          .order('name');
        if (error) throw error;
        return (data ?? []) as TherapeuticArea[];
      },
    });
  }

  async create(spaceId: string, area: Partial<TherapeuticArea>): Promise<TherapeuticArea> {
    const { data, error } = await this.supabase.client
      .from('therapeutic_areas')
      .insert({ ...area, space_id: spaceId })
      .select()
      .single();
    if (error) throw error;
    this.cache.invalidateTags([
      `space:${spaceId}:therapeutic-areas`,
      `space:${spaceId}:dashboard`,
      `space:${spaceId}:landing-stats`,
    ]);
    return data as TherapeuticArea;
  }

  async update(id: string, changes: Partial<TherapeuticArea>): Promise<TherapeuticArea> {
    const { data, error } = await this.supabase.client
      .from('therapeutic_areas')
      .update(changes)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    const spaceId = (data as TherapeuticArea).space_id;
    this.cache.invalidateTags([
      `space:${spaceId}:therapeutic-areas`,
      `space:${spaceId}:dashboard`,
      `space:${spaceId}:landing-stats`,
    ]);
    return data as TherapeuticArea;
  }

  async delete(id: string): Promise<void> {
    const { data: existing } = await this.supabase.client
      .from('therapeutic_areas')
      .select('space_id')
      .eq('id', id)
      .single();
    const { error } = await this.supabase.client.from('therapeutic_areas').delete().eq('id', id);
    if (error) throw error;
    if (existing?.space_id) {
      this.cache.invalidateTags([
        `space:${existing.space_id}:therapeutic-areas`,
        `space:${existing.space_id}:dashboard`,
        `space:${existing.space_id}:landing-stats`,
      ]);
    }
  }
}
