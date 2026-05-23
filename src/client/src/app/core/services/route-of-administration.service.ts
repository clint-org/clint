import { inject, Injectable } from '@angular/core';

import { RouteOfAdministration } from '../models/route-of-administration.model';
import { SupabaseService } from './supabase.service';
import { RpcCache } from './rpc-cache.service';

const REFERENCE_TTL = { fresh: 30 * 60 * 1000, stale: Infinity };

@Injectable({ providedIn: 'root' })
export class RouteOfAdministrationService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async list(spaceId: string): Promise<RouteOfAdministration[]> {
    return this.cache.get('list_routes_of_administration', { spaceId }, {
      ttl: REFERENCE_TTL,
      tags: [`space:${spaceId}:roa`],
      fetch: async () => {
        const { data, error } = await this.supabase.client
          .from('routes_of_administration')
          .select('*')
          .eq('space_id', spaceId)
          .order('display_order')
          .order('name');
        if (error) throw error;
        return (data ?? []) as RouteOfAdministration[];
      },
    });
  }

  async getById(id: string): Promise<RouteOfAdministration> {
    const { data, error } = await this.supabase.client
      .from('routes_of_administration')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data as RouteOfAdministration;
  }

  async create(
    spaceId: string,
    roa: Partial<RouteOfAdministration>
  ): Promise<RouteOfAdministration> {
    const { data, error } = await this.supabase.client
      .from('routes_of_administration')
      .insert({ ...roa, space_id: spaceId })
      .select()
      .single();
    if (error) throw error;
    this.cache.invalidateTags([
      `space:${spaceId}:roa`,
      `space:${spaceId}:products`,
      `space:${spaceId}:dashboard`,
    ]);
    return data as RouteOfAdministration;
  }

  async update(
    id: string,
    changes: Partial<RouteOfAdministration>
  ): Promise<RouteOfAdministration> {
    const { data, error } = await this.supabase.client
      .from('routes_of_administration')
      .update(changes)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    const spaceId = (data as RouteOfAdministration).space_id;
    this.cache.invalidateTags([
      `space:${spaceId}:roa`,
      `space:${spaceId}:products`,
      `space:${spaceId}:dashboard`,
    ]);
    return data as RouteOfAdministration;
  }

  async delete(id: string): Promise<void> {
    const { data: existing } = await this.supabase.client
      .from('routes_of_administration')
      .select('space_id')
      .eq('id', id)
      .single();
    const { error } = await this.supabase.client
      .from('routes_of_administration')
      .delete()
      .eq('id', id);
    if (error) throw error;
    if (existing?.space_id) {
      this.cache.invalidateTags([
        `space:${existing.space_id}:roa`,
        `space:${existing.space_id}:products`,
        `space:${existing.space_id}:dashboard`,
      ]);
    }
  }

  async countAssignedAssets(id: string): Promise<number> {
    const { count, error } = await this.supabase.client
      .from('product_routes_of_administration')
      .select('*', { count: 'exact', head: true })
      .eq('roa_id', id);
    if (error) throw error;
    return count ?? 0;
  }
}
