import { inject, Injectable } from '@angular/core';

import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';
import {
  AssetIntelligenceNote,
  IntelligenceDetailBundle,
  IntelligenceEntityType,
  IntelligenceFeedResult,
  IntelligenceFeedRow,
  IntelligenceHistoryPayload,
  UpsertIntelligenceInput,
} from '../models/primary-intelligence.model';

const HEAVY_TTL = { fresh: 30 * 1000, stale: 5 * 60 * 1000 };

/**
 * Thin wrapper around the primary intelligence RPCs. Components use
 * signals locally; this service stays plain Promise-based to mirror the
 * other entity services (trial.service.ts, marker.service.ts, etc.).
 */
@Injectable({ providedIn: 'root' })
export class PrimaryIntelligenceService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async getTrialDetail(trialId: string): Promise<IntelligenceDetailBundle | null> {
    return this.cache.get(
      'get_trial_detail_with_intelligence',
      { trialId },
      {
        ttl: HEAVY_TTL,
        tags: [`trial:${trialId}:detail`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .rpc('get_trial_detail_with_intelligence', { p_trial_id: trialId })
            .throwOnError();
          return (data as IntelligenceDetailBundle | null) ?? null;
        },
      }
    );
  }

  async getMarkerDetail(markerId: string): Promise<IntelligenceDetailBundle | null> {
    return this.cache.get(
      'get_marker_detail_with_intelligence',
      { markerId },
      {
        ttl: HEAVY_TTL,
        tags: [`marker:${markerId}:detail`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .rpc('get_marker_detail_with_intelligence', { p_marker_id: markerId })
            .throwOnError();
          return (data as IntelligenceDetailBundle | null) ?? null;
        },
      }
    );
  }

  async getCompanyDetail(companyId: string): Promise<IntelligenceDetailBundle | null> {
    return this.cache.get(
      'get_company_detail_with_intelligence',
      { companyId },
      {
        ttl: HEAVY_TTL,
        tags: [`company:${companyId}:detail`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .rpc('get_company_detail_with_intelligence', { p_company_id: companyId })
            .throwOnError();
          return (data as IntelligenceDetailBundle | null) ?? null;
        },
      }
    );
  }

  async getAssetDetail(assetId: string): Promise<IntelligenceDetailBundle | null> {
    return this.cache.get(
      'get_asset_detail_with_intelligence',
      { assetId },
      {
        ttl: HEAVY_TTL,
        tags: [`asset:${assetId}:detail`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .rpc('get_asset_detail_with_intelligence', { p_asset_id: assetId })
            .throwOnError();
          return (data as IntelligenceDetailBundle | null) ?? null;
        },
      }
    );
  }

  async getSpaceIntelligence(spaceId: string): Promise<IntelligenceDetailBundle | null> {
    return this.cache.get(
      'get_space_intelligence',
      { spaceId },
      {
        ttl: HEAVY_TTL,
        tags: [`space:${spaceId}:primary-intelligence`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .rpc('get_space_intelligence', {
              p_space_id: spaceId,
            })
            .throwOnError();
          return (data as IntelligenceDetailBundle | null) ?? null;
        },
      }
    );
  }

  async listDraftsForSpace(spaceId: string, limit = 3): Promise<IntelligenceFeedRow[]> {
    return this.cache.get(
      'list_draft_intelligence_for_space',
      { spaceId, limit },
      {
        ttl: HEAVY_TTL,
        tags: [`space:${spaceId}:drafts`, `space:${spaceId}:primary-intelligence`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .rpc('list_draft_intelligence_for_space', { p_space_id: spaceId, p_limit: limit })
            .throwOnError();
          return (data as IntelligenceFeedRow[]) ?? [];
        },
      }
    );
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
    return this.cache.get('list_primary_intelligence', opts, {
      ttl: HEAVY_TTL,
      tags: [`space:${opts.spaceId}:primary-intelligence`],
      fetch: async () => {
        const { data } = await this.supabase.client
          .rpc('list_primary_intelligence', {
            p_space_id: opts.spaceId,
            p_entity_types: opts.entityTypes ?? null,
            p_author_id: opts.authorId ?? null,
            p_since: opts.since ?? null,
            p_query: opts.query ?? null,
            p_referencing_entity_type: opts.referencingEntityType ?? null,
            p_referencing_entity_id: opts.referencingEntityId ?? null,
            p_limit: opts.limit ?? 50,
            p_offset: opts.offset ?? 0,
          })
          .throwOnError();
        return (data as IntelligenceFeedResult) ?? { rows: [], total: 0, limit: 50, offset: 0 };
      },
    });
  }

  async getIntelligenceNotesForAsset(
    spaceId: string,
    assetId: string
  ): Promise<AssetIntelligenceNote[]> {
    return this.cache.get(
      'get_intelligence_notes_for_asset',
      { spaceId, assetId },
      {
        ttl: HEAVY_TTL,
        tags: [`space:${spaceId}:primary-intelligence`, `asset:${assetId}:detail`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .rpc('get_intelligence_notes_for_asset', { p_space_id: spaceId, p_asset_id: assetId })
            .throwOnError();
          return (data as AssetIntelligenceNote[]) ?? [];
        },
      }
    );
  }

  async loadHistory(
    spaceId: string,
    entityType: IntelligenceEntityType,
    entityId: string
  ): Promise<IntelligenceHistoryPayload> {
    return this.cache.get(
      'get_primary_intelligence_history',
      { spaceId, entityType, entityId },
      {
        ttl: HEAVY_TTL,
        tags: [`${entityType}:${entityId}:history-intelligence`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .rpc('get_primary_intelligence_history', {
              p_space_id: spaceId,
              p_entity_type: entityType,
              p_entity_id: entityId,
            })
            .throwOnError();
          return (
            (data as IntelligenceHistoryPayload) ?? {
              current: null,
              draft: null,
              versions: [],
              events: [],
            }
          );
        },
      }
    );
  }

  async upsert(input: UpsertIntelligenceInput): Promise<string> {
    const { data } = await this.supabase.client
      .rpc('upsert_primary_intelligence', {
        p_id: input.id,
        p_space_id: input.space_id,
        p_entity_type: input.entity_type,
        p_entity_id: input.entity_id,
        p_headline: input.headline,
        p_summary_md: input.summary_md,
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
      })
      .throwOnError();
    this.cache.invalidateTags([
      `space:${input.space_id}:primary-intelligence`,
      `space:${input.space_id}:drafts`,
      `space:${input.space_id}:activity`,
      `space:${input.space_id}:landing-stats`,
      `space:${input.space_id}:dashboard`,
      `${input.entity_type}:${input.entity_id}:detail`,
      `${input.entity_type}:${input.entity_id}:history-intelligence`,
    ]);
    return data as string;
  }

  async delete(id: string): Promise<void> {
    const { data: existing } = await this.supabase.client
      .from('primary_intelligence')
      .select('space_id, entity_type, entity_id')
      .eq('id', id)
      .single();
    await this.supabase.client
      .rpc('delete_primary_intelligence', {
        p_id: id,
      })
      .throwOnError();
    if (existing?.space_id) {
      this.cache.invalidateTags([
        `space:${existing.space_id}:primary-intelligence`,
        `space:${existing.space_id}:drafts`,
        `space:${existing.space_id}:activity`,
        `space:${existing.space_id}:landing-stats`,
        `space:${existing.space_id}:dashboard`,
        `${existing.entity_type}:${existing.entity_id}:detail`,
        `${existing.entity_type}:${existing.entity_id}:history-intelligence`,
      ]);
    }
  }

  async withdraw(id: string, changeNote: string): Promise<void> {
    const { data: existing } = await this.supabase.client
      .from('primary_intelligence')
      .select('space_id, entity_type, entity_id')
      .eq('id', id)
      .single();
    await this.supabase.client
      .rpc('withdraw_primary_intelligence', {
        p_id: id,
        p_change_note: changeNote,
      })
      .throwOnError();
    if (existing?.space_id) {
      this.cache.invalidateTags([
        `space:${existing.space_id}:primary-intelligence`,
        `space:${existing.space_id}:drafts`,
        `space:${existing.space_id}:activity`,
        `space:${existing.space_id}:landing-stats`,
        `space:${existing.space_id}:dashboard`,
        `${existing.entity_type}:${existing.entity_id}:detail`,
        `${existing.entity_type}:${existing.entity_id}:history-intelligence`,
      ]);
    }
  }

  async purge(id: string, confirmation: string, purgeAnchor = false): Promise<void> {
    const { data: existing } = await this.supabase.client
      .from('primary_intelligence')
      .select('space_id, entity_type, entity_id')
      .eq('id', id)
      .single();
    await this.supabase.client
      .rpc('purge_primary_intelligence', {
        p_id: id,
        p_confirmation: confirmation,
        p_purge_anchor: purgeAnchor,
      })
      .throwOnError();
    if (existing?.space_id) {
      this.cache.invalidateTags([
        `space:${existing.space_id}:primary-intelligence`,
        `space:${existing.space_id}:drafts`,
        `space:${existing.space_id}:activity`,
        `space:${existing.space_id}:landing-stats`,
        `space:${existing.space_id}:dashboard`,
        `${existing.entity_type}:${existing.entity_id}:detail`,
        `${existing.entity_type}:${existing.entity_id}:history-intelligence`,
      ]);
    }
  }
}
