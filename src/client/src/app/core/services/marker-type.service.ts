import { inject, Injectable } from '@angular/core';

import { MarkerType } from '../models/marker.model';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

const REFERENCE_TTL = { fresh: 30 * 60 * 1000, stale: Infinity };

@Injectable({ providedIn: 'root' })
export class MarkerTypeService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async list(spaceId?: string): Promise<MarkerType[]> {
    return this.cache.get(
      'marker_types',
      { spaceId },
      {
        ttl: REFERENCE_TTL,
        tags: ['markers:types'],
        fetch: async () => {
          let query = this.supabase.client
            .from('event_types')
            .select('*, event_type_categories(*)')
            .order('display_order');

          if (spaceId) {
            query = query.or(`is_system.eq.true,space_id.eq.${spaceId}`);
          }

          const { data } = await query.throwOnError();
          return this.mapRows(data as Record<string, unknown>[]);
        },
      }
    );
  }

  async listByCategory(categoryId: string, spaceId?: string): Promise<MarkerType[]> {
    return this.cache.get(
      'marker_types_by_category',
      { categoryId, spaceId },
      {
        ttl: REFERENCE_TTL,
        tags: ['markers:types'],
        fetch: async () => {
          let query = this.supabase.client
            .from('event_types')
            .select('*, event_type_categories(*)')
            .eq('category_id', categoryId)
            .order('display_order');

          if (spaceId) {
            query = query.or(`is_system.eq.true,space_id.eq.${spaceId}`);
          }

          const { data } = await query.throwOnError();
          return this.mapRows(data as Record<string, unknown>[]);
        },
      }
    );
  }

  async create(spaceId: string, markerType: Partial<MarkerType>): Promise<MarkerType> {
    const { data } = await this.supabase.client
      .from('event_types')
      .insert({ ...markerType, space_id: spaceId, is_system: false })
      .select()
      .single()
      .throwOnError();
    this.cache.invalidateTags(['markers:types']);
    return data as MarkerType;
  }

  async update(id: string, changes: Partial<MarkerType>): Promise<MarkerType> {
    const { data } = await this.supabase.client
      .from('event_types')
      .update(changes)
      .eq('id', id)
      .select()
      .single()
      .throwOnError();
    this.cache.invalidateTags(['markers:types']);
    return data as MarkerType;
  }

  async delete(id: string): Promise<void> {
    await this.supabase.client.from('event_types').delete().eq('id', id).throwOnError();
    this.cache.invalidateTags(['markers:types']);
  }

  /**
   * Renames the `event_type_categories` embed key to `marker_categories` so all
   * consumers of MarkerType continue to see the expected shape.
   */
  private mapRows(rows: Record<string, unknown>[]): MarkerType[] {
    return rows.map((row) => {
      const { event_type_categories, ...rest } = row;
      return { ...rest, marker_categories: event_type_categories ?? null } as MarkerType;
    });
  }
}
