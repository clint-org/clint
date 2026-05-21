import { inject, Injectable } from '@angular/core';

import { Company } from '../models/company.model';
import { DeleteCountBreakdown } from '../../shared/utils/confirm-delete';
import { SupabaseService } from './supabase.service';
import { RpcCache } from './rpc-cache.service';

const REFERENCE_TTL = { fresh: 30 * 60 * 1000, stale: Infinity };

@Injectable({ providedIn: 'root' })
export class CompanyService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async list(spaceId: string): Promise<Company[]> {
    return this.cache.get('list_companies', { spaceId }, {
      ttl: REFERENCE_TTL,
      tags: [`space:${spaceId}:companies`],
      fetch: async () => {
        const { data, error } = await this.supabase.client
          .from('companies')
          .select('*, products(*)')
          .eq('space_id', spaceId)
          .order('display_order');
        if (error) throw error;
        return (data ?? []) as Company[];
      },
    });
  }

  async getById(id: string): Promise<Company> {
    const { data, error } = await this.supabase.client
      .from('companies')
      .select('*, products(*)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data as Company;
  }

  async create(spaceId: string, company: Partial<Company>): Promise<Company> {
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { data, error } = await this.supabase.client
      .from('companies')
      .insert({ ...company, space_id: spaceId, created_by: userId })
      .select()
      .single();
    if (error) throw error;
    this.cache.invalidateTags([
      `space:${spaceId}:companies`,
      `space:${spaceId}:dashboard`,
      `space:${spaceId}:landing-stats`,
    ]);
    return data as Company;
  }

  async update(id: string, changes: Partial<Company>): Promise<Company> {
    const { data, error } = await this.supabase.client
      .from('companies')
      .update(changes)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    const spaceId = (data as Company).space_id;
    this.cache.invalidateTags([
      `space:${spaceId}:companies`,
      `space:${spaceId}:dashboard`,
      `space:${spaceId}:landing-stats`,
    ]);
    return data as Company;
  }

  /**
   * Read-only preview of the cascade footprint of deleting this company.
   * Returns a jsonb count breakdown (products, trials, trial_notes, events,
   * material_links, primary_intelligence, primary_intelligence_links,
   * marker_assignments, markers_removed_entirely, markers_unlinked_only)
   * matching what the FK cascade + T3 / T4 triggers will actually remove.
   * Backed by public.preview_company_delete (cascade-safety T7).
   */
  async previewDelete(id: string): Promise<DeleteCountBreakdown> {
    const { data, error } = await this.supabase.client.rpc('preview_company_delete', {
      p_company_id: id,
    });
    if (error) throw error;
    return (data ?? {}) as DeleteCountBreakdown;
  }

  async delete(id: string): Promise<void> {
    const { data: existing } = await this.supabase.client
      .from('companies')
      .select('space_id')
      .eq('id', id)
      .single();
    const { error } = await this.supabase.client.from('companies').delete().eq('id', id);
    if (error) throw error;
    if (existing?.space_id) {
      this.cache.invalidateTags([
        `space:${existing.space_id}:companies`,
        `space:${existing.space_id}:dashboard`,
        `space:${existing.space_id}:landing-stats`,
      ]);
    }
  }
}
