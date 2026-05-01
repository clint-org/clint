import { inject, Injectable } from '@angular/core';

import { SupabaseService } from './supabase.service';
import {
  IntelligenceDetailBundle,
  IntelligenceEntityType,
  IntelligenceFeedResult,
  UpsertIntelligenceInput,
} from '../models/primary-intelligence.model';

/**
 * Thin wrapper around the primary intelligence RPCs. Components use
 * signals locally; this service stays plain Promise-based to mirror the
 * other entity services (trial.service.ts, marker.service.ts, etc.).
 */
@Injectable({ providedIn: 'root' })
export class PrimaryIntelligenceService {
  private supabase = inject(SupabaseService);

  async getTrialDetail(trialId: string): Promise<IntelligenceDetailBundle | null> {
    const { data, error } = await this.supabase.client.rpc('get_trial_detail_with_intelligence', {
      p_trial_id: trialId,
    });
    if (error) throw error;
    return (data as IntelligenceDetailBundle | null) ?? null;
  }

  async getMarkerDetail(markerId: string): Promise<IntelligenceDetailBundle | null> {
    const { data, error } = await this.supabase.client.rpc('get_marker_detail_with_intelligence', {
      p_marker_id: markerId,
    });
    if (error) throw error;
    return (data as IntelligenceDetailBundle | null) ?? null;
  }

  async getCompanyDetail(companyId: string): Promise<IntelligenceDetailBundle | null> {
    const { data, error } = await this.supabase.client.rpc(
      'get_company_detail_with_intelligence',
      { p_company_id: companyId }
    );
    if (error) throw error;
    return (data as IntelligenceDetailBundle | null) ?? null;
  }

  async getProductDetail(productId: string): Promise<IntelligenceDetailBundle | null> {
    const { data, error } = await this.supabase.client.rpc(
      'get_product_detail_with_intelligence',
      { p_product_id: productId }
    );
    if (error) throw error;
    return (data as IntelligenceDetailBundle | null) ?? null;
  }

  async getSpaceIntelligence(spaceId: string): Promise<IntelligenceDetailBundle | null> {
    const { data, error } = await this.supabase.client.rpc('get_space_intelligence', {
      p_space_id: spaceId,
    });
    if (error) throw error;
    return (data as IntelligenceDetailBundle | null) ?? null;
  }

  async list(opts: {
    spaceId: string;
    entityTypes?: IntelligenceEntityType[] | null;
    authorId?: string | null;
    since?: string | null;
    query?: string | null;
    referencingEntityType?: IntelligenceEntityType | null;
    referencingEntityId?: string | null;
    limit?: number;
    offset?: number;
  }): Promise<IntelligenceFeedResult> {
    const { data, error } = await this.supabase.client.rpc('list_primary_intelligence', {
      p_space_id: opts.spaceId,
      p_entity_types: opts.entityTypes ?? null,
      p_author_id: opts.authorId ?? null,
      p_since: opts.since ?? null,
      p_query: opts.query ?? null,
      p_referencing_entity_type: opts.referencingEntityType ?? null,
      p_referencing_entity_id: opts.referencingEntityId ?? null,
      p_limit: opts.limit ?? 50,
      p_offset: opts.offset ?? 0,
    });
    if (error) throw error;
    return (data as IntelligenceFeedResult) ?? { rows: [], total: 0, limit: 50, offset: 0 };
  }

  async upsert(input: UpsertIntelligenceInput): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('upsert_primary_intelligence', {
      p_id: input.id,
      p_space_id: input.space_id,
      p_entity_type: input.entity_type,
      p_entity_id: input.entity_id,
      p_headline: input.headline,
      p_thesis_md: input.thesis_md,
      p_watch_md: input.watch_md,
      p_implications_md: input.implications_md,
      p_state: input.state,
      p_change_note: input.change_note,
      p_links: input.links.map((l, i) => ({
        entity_type: l.entity_type,
        entity_id: l.entity_id,
        relationship_type: l.relationship_type,
        gloss: l.gloss ?? null,
        display_order: l.display_order ?? i,
      })),
    });
    if (error) throw error;
    return data as string;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('delete_primary_intelligence', {
      p_id: id,
    });
    if (error) throw error;
  }
}
