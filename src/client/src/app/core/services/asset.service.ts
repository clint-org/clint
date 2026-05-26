import { inject, Injectable } from '@angular/core';

import { Asset } from '../models/asset.model';
import { DeleteCountBreakdown } from '../../shared/utils/confirm-delete';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

/**
 * Shape returned by the nested asset fetch. The Supabase join expands
 * `asset_mechanisms_of_action.moa` and `asset_routes_of_administration.roa`
 * as nested arrays; we flatten them into the Asset interface shape.
 */
interface RawAssetRow extends Asset {
  asset_mechanisms_of_action?: { moa: { id: string; name: string } | null }[];
  asset_routes_of_administration?: {
    roa: { id: string; name: string; abbreviation: string | null } | null;
  }[];
}

const ASSET_WITH_MOA_ROA_SELECT = `
  *,
  companies ( id, name, logo_url ),
  asset_mechanisms_of_action (
    moa:mechanisms_of_action ( id, name )
  ),
  asset_routes_of_administration (
    roa:routes_of_administration ( id, name, abbreviation )
  )
`;

const REFERENCE_TTL = { fresh: 30 * 60 * 1000, stale: Infinity };

function flattenAsset(row: RawAssetRow): Asset {
  const mechanisms_of_action = (row.asset_mechanisms_of_action ?? [])
    .map((j) => j.moa)
    .filter((m): m is { id: string; name: string } => m !== null);
  const routes_of_administration = (row.asset_routes_of_administration ?? [])
    .map((j) => j.roa)
    .filter((r): r is { id: string; name: string; abbreviation: string | null } => r !== null);
  const { asset_mechanisms_of_action: _amoa, asset_routes_of_administration: _aroa, ...rest } = row;
  void _amoa;
  void _aroa;
  return {
    ...rest,
    mechanisms_of_action,
    routes_of_administration,
  };
}

@Injectable({ providedIn: 'root' })
export class AssetService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async list(spaceId: string): Promise<Asset[]> {
    return this.cache.get(
      'list_products',
      { spaceId },
      {
        ttl: REFERENCE_TTL,
        tags: [`space:${spaceId}:products`],
        fetch: async () => {
          const { data, error } = await this.supabase.client
            .from('assets')
            .select(ASSET_WITH_MOA_ROA_SELECT)
            .eq('space_id', spaceId)
            .order('display_order');
          if (error) throw error;
          return (data ?? []).map((row) => flattenAsset(row as unknown as RawAssetRow));
        },
      }
    );
  }

  async getById(id: string): Promise<Asset> {
    const { data, error } = await this.supabase.client
      .from('assets')
      .select(ASSET_WITH_MOA_ROA_SELECT)
      .eq('id', id)
      .single();
    if (error) throw error;
    return flattenAsset(data as unknown as RawAssetRow);
  }

  async create(spaceId: string, asset: Partial<Asset>): Promise<Asset> {
    const moaNames = (asset.mechanisms_of_action ?? []).map((m) => m.name);
    const roaNames = (asset.routes_of_administration ?? []).map((r) => r.name);
    const { data: newId, error } = await this.supabase.client.rpc('create_asset', {
      p_space_id: spaceId,
      p_company_id: asset.company_id!,
      p_name: asset.name!,
      p_generic_name: asset.generic_name ?? null,
      p_moa_names: moaNames.length > 0 ? moaNames : null,
      p_roa_names: roaNames.length > 0 ? roaNames : null,
    });
    if (error) throw error;
    this.cache.invalidateTags([
      `space:${spaceId}:products`,
      `space:${spaceId}:companies`,
      `space:${spaceId}:dashboard`,
      `space:${spaceId}:landing-stats`,
    ]);
    return this.getById(newId as string);
  }

  async update(id: string, changes: Partial<Asset>): Promise<Asset> {
    const { mechanisms_of_action: _m, routes_of_administration: _r, ...updatable } = changes;
    void _m;
    void _r;
    const { data, error } = await this.supabase.client
      .from('assets')
      .update(updatable)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    const spaceId = (data as Asset).space_id;
    this.cache.invalidateTags([
      `space:${spaceId}:products`,
      `space:${spaceId}:companies`,
      `space:${spaceId}:dashboard`,
      `space:${spaceId}:landing-stats`,
    ]);
    return data as Asset;
  }

  async previewDelete(id: string): Promise<DeleteCountBreakdown> {
    const { data, error } = await this.supabase.client.rpc('preview_asset_delete', {
      p_asset_id: id,
    });
    if (error) throw error;
    return (data ?? {}) as DeleteCountBreakdown;
  }

  async delete(id: string): Promise<void> {
    const { data: existing } = await this.supabase.client
      .from('assets')
      .select('space_id')
      .eq('id', id)
      .single();
    const { error } = await this.supabase.client.from('assets').delete().eq('id', id);
    if (error) throw error;
    if (existing?.space_id) {
      this.cache.invalidateTags([
        `space:${existing.space_id}:products`,
        `space:${existing.space_id}:companies`,
        `space:${existing.space_id}:dashboard`,
        `space:${existing.space_id}:landing-stats`,
      ]);
    }
  }

  /**
   * Replace all MOA assignments for an asset with the given set.
   * Two-call pattern: delete all existing join rows, then insert the new set.
   */
  async setMechanisms(assetId: string, moaIds: string[]): Promise<void> {
    const { data: assetRow } = await this.supabase.client
      .from('assets')
      .select('space_id')
      .eq('id', assetId)
      .single();

    const { error: deleteError } = await this.supabase.client
      .from('asset_mechanisms_of_action')
      .delete()
      .eq('asset_id', assetId);
    if (deleteError) throw deleteError;

    if (moaIds.length > 0) {
      const rows = moaIds.map((moa_id) => ({ asset_id: assetId, moa_id }));
      const { error: insertError } = await this.supabase.client
        .from('asset_mechanisms_of_action')
        .insert(rows);
      if (insertError) throw insertError;
    }

    if (assetRow?.space_id) {
      this.cache.invalidateTags([
        `space:${assetRow.space_id}:products`,
        `space:${assetRow.space_id}:dashboard`,
      ]);
    }
  }

  /**
   * Replace all ROA assignments for an asset with the given set.
   * Two-call pattern: delete all existing join rows, then insert the new set.
   */
  async setRoutes(assetId: string, roaIds: string[]): Promise<void> {
    const { data: assetRow } = await this.supabase.client
      .from('assets')
      .select('space_id')
      .eq('id', assetId)
      .single();

    const { error: deleteError } = await this.supabase.client
      .from('asset_routes_of_administration')
      .delete()
      .eq('asset_id', assetId);
    if (deleteError) throw deleteError;

    if (roaIds.length > 0) {
      const rows = roaIds.map((roa_id) => ({ asset_id: assetId, roa_id }));
      const { error: insertError } = await this.supabase.client
        .from('asset_routes_of_administration')
        .insert(rows);
      if (insertError) throw insertError;
    }

    if (assetRow?.space_id) {
      this.cache.invalidateTags([
        `space:${assetRow.space_id}:products`,
        `space:${assetRow.space_id}:dashboard`,
      ]);
    }
  }
}
