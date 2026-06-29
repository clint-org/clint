import { inject, Injectable } from '@angular/core';

import { MarkerCategory } from '../models/marker.model';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

const REFERENCE_TTL = { fresh: 30 * 60 * 1000, stale: Infinity };

export class MarkerCategoryInUseError extends Error {
  constructor() {
    super('This category is still used by marker types. Reassign them before deleting it.');
    this.name = 'MarkerCategoryInUseError';
  }
}

@Injectable({ providedIn: 'root' })
export class MarkerCategoryService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async list(spaceId?: string): Promise<MarkerCategory[]> {
    return this.cache.get(
      'marker_categories',
      { spaceId },
      {
        ttl: REFERENCE_TTL,
        tags: ['markers:types'],
        fetch: async () => {
          let query = this.supabase.client
            .from('event_type_categories')
            .select('*')
            .order('display_order');

          if (spaceId) {
            query = query.or(`is_system.eq.true,space_id.eq.${spaceId}`);
          }

          const { data } = await query.throwOnError();
          return data as MarkerCategory[];
        },
      }
    );
  }

  async create(spaceId: string, name: string): Promise<MarkerCategory> {
    // Place new custom categories after the highest existing order (system + this space)
    // so they sort below the system categories in the legend.
    const { data: maxRows } = await this.supabase.client
      .from('event_type_categories')
      .select('display_order')
      .or(`is_system.eq.true,space_id.eq.${spaceId}`)
      .order('display_order', { ascending: false })
      .limit(1)
      .throwOnError();
    const nextOrder =
      (((maxRows as { display_order: number }[] | null)?.[0]?.display_order ?? 0) as number) + 1;

    const { data } = await this.supabase.client
      .from('event_type_categories')
      .insert({ name, space_id: spaceId, is_system: false, display_order: nextOrder })
      .select()
      .single()
      .throwOnError();
    this.cache.invalidateTags(['markers:types']);
    return data as MarkerCategory;
  }

  async update(
    id: string,
    changes: { name?: string; display_order?: number }
  ): Promise<MarkerCategory> {
    const { data } = await this.supabase.client
      .from('event_type_categories')
      .update(changes)
      .eq('id', id)
      .select()
      .single()
      .throwOnError();
    this.cache.invalidateTags(['markers:types']);
    return data as MarkerCategory;
  }

  async delete(id: string): Promise<void> {
    try {
      await this.supabase.client.from('event_type_categories').delete().eq('id', id).throwOnError();
    } catch (e) {
      if (e && typeof e === 'object' && 'code' in e && e.code === '23503') {
        throw new MarkerCategoryInUseError();
      }
      throw e;
    }
    this.cache.invalidateTags(['markers:types']);
  }
}
