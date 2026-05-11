import { inject, Injectable } from '@angular/core';

import { Asset } from '../models/asset.model';
import { SupabaseService } from './supabase.service';

/**
 * Shape returned by the nested asset fetch. The Supabase join expands
 * `product_mechanisms_of_action.moa` and `product_routes_of_administration.roa`
 * as nested arrays; we flatten them into the Asset interface shape.
 * Note: DB table names retain the `product_*` prefix. Only the frontend
 * vocabulary has moved to "asset".
 */
interface RawAssetRow extends Asset {
  product_mechanisms_of_action?: { moa: { id: string; name: string } | null }[];
  product_routes_of_administration?: {
    roa: { id: string; name: string; abbreviation: string | null } | null;
  }[];
}

const ASSET_WITH_MOA_ROA_SELECT = `
  *,
  companies ( id, name, logo_url ),
  product_mechanisms_of_action (
    moa:mechanisms_of_action ( id, name )
  ),
  product_routes_of_administration (
    roa:routes_of_administration ( id, name, abbreviation )
  )
`;

function flattenAsset(row: RawAssetRow): Asset {
  const mechanisms_of_action = (row.product_mechanisms_of_action ?? [])
    .map((j) => j.moa)
    .filter((m): m is { id: string; name: string } => m !== null);
  const routes_of_administration = (row.product_routes_of_administration ?? [])
    .map((j) => j.roa)
    .filter(
      (r): r is { id: string; name: string; abbreviation: string | null } => r !== null,
    );
  const {
    product_mechanisms_of_action: _pmoa,
    product_routes_of_administration: _proa,
    ...rest
  } = row;
  void _pmoa;
  void _proa;
  return {
    ...rest,
    mechanisms_of_action,
    routes_of_administration,
  };
}

@Injectable({ providedIn: 'root' })
export class AssetService {
  private supabase = inject(SupabaseService);

  async list(spaceId: string): Promise<Asset[]> {
    const { data, error } = await this.supabase.client
      .from('products')
      .select(ASSET_WITH_MOA_ROA_SELECT)
      .eq('space_id', spaceId)
      .order('display_order');
    if (error) throw error;
    return (data ?? []).map((row) => flattenAsset(row as unknown as RawAssetRow));
  }

  async getById(id: string): Promise<Asset> {
    const { data, error } = await this.supabase.client
      .from('products')
      .select(ASSET_WITH_MOA_ROA_SELECT)
      .eq('id', id)
      .single();
    if (error) throw error;
    return flattenAsset(data as unknown as RawAssetRow);
  }

  async create(spaceId: string, asset: Partial<Asset>): Promise<Asset> {
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    // Strip virtual join fields before insert
    const { mechanisms_of_action: _m, routes_of_administration: _r, ...insertable } = asset;
    void _m;
    void _r;
    const { data, error } = await this.supabase.client
      .from('products')
      .insert({ ...insertable, space_id: spaceId, created_by: userId })
      .select()
      .single();
    if (error) throw error;
    return data as Asset;
  }

  async update(id: string, changes: Partial<Asset>): Promise<Asset> {
    const { mechanisms_of_action: _m, routes_of_administration: _r, ...updatable } = changes;
    void _m;
    void _r;
    const { data, error } = await this.supabase.client
      .from('products')
      .update(updatable)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as Asset;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('products').delete().eq('id', id);
    if (error) throw error;
  }

  /**
   * Replace all MOA assignments for an asset with the given set.
   * Two-call pattern: delete all existing join rows, then insert the new set.
   */
  async setMechanisms(assetId: string, moaIds: string[]): Promise<void> {
    const { error: deleteError } = await this.supabase.client
      .from('product_mechanisms_of_action')
      .delete()
      .eq('product_id', assetId);
    if (deleteError) throw deleteError;

    if (moaIds.length === 0) return;

    const rows = moaIds.map((moa_id) => ({ product_id: assetId, moa_id }));
    const { error: insertError } = await this.supabase.client
      .from('product_mechanisms_of_action')
      .insert(rows);
    if (insertError) throw insertError;
  }

  /**
   * Replace all ROA assignments for an asset with the given set.
   * Two-call pattern: delete all existing join rows, then insert the new set.
   */
  async setRoutes(assetId: string, roaIds: string[]): Promise<void> {
    const { error: deleteError } = await this.supabase.client
      .from('product_routes_of_administration')
      .delete()
      .eq('product_id', assetId);
    if (deleteError) throw deleteError;

    if (roaIds.length === 0) return;

    const rows = roaIds.map((roa_id) => ({ product_id: assetId, roa_id }));
    const { error: insertError } = await this.supabase.client
      .from('product_routes_of_administration')
      .insert(rows);
    if (insertError) throw insertError;
  }
}
