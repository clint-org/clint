import { inject, Injectable } from '@angular/core';

import { EVENTS_SELECT, mapEventToMarker } from '../models/event-to-marker';
import { Trial } from '../models/trial.model';
import { DeleteCountBreakdown } from '../../shared/utils/confirm-delete';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

// Re-exported so existing importers (and the service's own spec) keep a stable
// path; the canonical definitions live in core/models/event-to-marker.
export { EVENTS_SELECT, mapEventToMarker } from '../models/event-to-marker';

export const TRIAL_SELECT = `
  *,
  assets!trials_asset_id_fkey(id, name, companies(id, name, logo_url))
`;

const HEAVY_TTL = { fresh: 30 * 1000, stale: 5 * 60 * 1000 };

/** Attach a pre-fetched events array to a trial row as trial.markers[]. */
function normalizeTrial(raw: Record<string, unknown>, events: Record<string, unknown>[]): Trial {
  const markers = events.map(mapEventToMarker);
  return { ...raw, markers } as unknown as Trial;
}

@Injectable({ providedIn: 'root' })
export class TrialService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  /**
   * Fetch all events anchored to the given trial ids and group them by
   * anchor_id. Returns an empty Map when the id list is empty (avoids a
   * pointless round trip).
   */
  private async fetchEventsByTrialIds(
    trialIds: string[],
  ): Promise<Map<string, Record<string, unknown>[]>> {
    if (trialIds.length === 0) return new Map();
    const { data } = await this.supabase.client
      .from('events')
      .select(EVENTS_SELECT)
      .eq('anchor_type', 'trial')
      .in('anchor_id', trialIds)
      .throwOnError();
    const rows = (data as Record<string, unknown>[] | null) ?? [];
    const map = new Map<string, Record<string, unknown>[]>();
    for (const event of rows) {
      const anchorId = event['anchor_id'] as string;
      const existing = map.get(anchorId) ?? [];
      existing.push(event);
      map.set(anchorId, existing);
    }
    return map;
  }

  async listByAsset(assetId: string): Promise<Trial[]> {
    return this.cache.get(
      'trials_by_asset',
      { assetId },
      {
        ttl: HEAVY_TTL,
        tags: [`asset:${assetId}:trials`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .from('trials')
            .select(TRIAL_SELECT)
            .eq('asset_id', assetId)
            .order('display_order')
            .throwOnError();
          const trialRows = (data as Record<string, unknown>[]);
          const trialIds = trialRows.map((r) => r['id'] as string);
          const eventsByTrial = await this.fetchEventsByTrialIds(trialIds);
          return trialRows.map((t) =>
            normalizeTrial(t, eventsByTrial.get(t['id'] as string) ?? []),
          );
        },
      }
    );
  }

  /**
   * Lists a space's trials. When the space does not track preclinical
   * (showPreclinical = false), preclinical trials are filtered out in Postgres
   * via `.or(phase_type.is.null, phase_type.neq.PRECLIN)` so a preclinical trial
   * never appears in the management list. Null-phase trials are retained. The
   * flag is part of the cache key so the two states cache independently.
   */
  async listBySpace(spaceId: string, showPreclinical = true): Promise<Trial[]> {
    return this.cache.get(
      'trials_by_space',
      { spaceId, showPreclinical },
      {
        ttl: HEAVY_TTL,
        tags: [`space:${spaceId}:trials`],
        fetch: async () => {
          let query = this.supabase.client
            .from('trials')
            .select(TRIAL_SELECT)
            .eq('space_id', spaceId);
          if (!showPreclinical) {
            query = query.or('phase_type.is.null,phase_type.neq.PRECLIN');
          }
          const { data } = await query.order('display_order').throwOnError();
          const trialRows = (data as Record<string, unknown>[]);
          const trialIds = trialRows.map((r) => r['id'] as string);
          const eventsByTrial = await this.fetchEventsByTrialIds(trialIds);
          return trialRows.map((t) =>
            normalizeTrial(t, eventsByTrial.get(t['id'] as string) ?? []),
          );
        },
      }
    );
  }

  async getById(id: string): Promise<Trial> {
    const { data: trialData } = await this.supabase.client
      .from('trials')
      .select(TRIAL_SELECT)
      .eq('id', id)
      .single()
      .throwOnError();
    const { data: eventsData } = await this.supabase.client
      .from('events')
      .select(EVENTS_SELECT)
      .eq('anchor_type', 'trial')
      .eq('anchor_id', id)
      .throwOnError();
    const events = (eventsData as Record<string, unknown>[] | null) ?? [];
    return normalizeTrial(trialData as Record<string, unknown>, events);
  }

  /**
   * Creates a trial. Phase start/end dates are passed explicitly (they no
   * longer live on the Trial model -- they are Trial Start / Trial End
   * markers). `create_trial` still accepts them and creates the analyst-owned
   * date markers server-side, so the values flow straight through as
   * `p_phase_start_date` / `p_phase_end_date`.
   */
  async create(
    spaceId: string,
    trial: Partial<Trial>,
    phaseStartDate: string | null = null,
    phaseEndDate: string | null = null
  ): Promise<Trial> {
    const { data: newId } = await this.supabase.client
      .rpc('create_trial', {
        p_space_id: spaceId,
        p_asset_id: trial.asset_id!,
        p_name: trial.name!,
        p_identifier: trial.identifier ?? null,
        p_status: trial.status ?? null,
        p_phase_type: trial.phase_type ?? null,
        p_phase_start_date: phaseStartDate ?? null,
        p_phase_end_date: phaseEndDate ?? null,
      })
      .throwOnError();
    const tags: string[] = [
      `space:${spaceId}:trials`,
      `space:${spaceId}:dashboard`,
      `space:${spaceId}:activity`,
      `space:${spaceId}:landing-stats`,
    ];
    if (trial.asset_id) tags.push(`asset:${trial.asset_id}:trials`);
    this.cache.invalidateTags(tags);
    return this.getById(newId as string);
  }

  async getLatestSnapshot(
    trialId: string
  ): Promise<{ payload: unknown; fetched_at: string } | null> {
    const { data } = await this.supabase.client
      .from('trial_ctgov_snapshots')
      .select('payload, fetched_at')
      .eq('trial_id', trialId)
      .order('ctgov_version', { ascending: false })
      .limit(1)
      .maybeSingle()
      .throwOnError();
    return data;
  }

  /**
   * Returns a Map of trial_id -> latest snapshot payload for every trial in
   * a space, in a single round trip. Used by the trial-list dynamic columns
   * surface; lazy per-row fetches are reserved for panels that show one
   * trial at a time.
   */
  async getLatestSnapshotsForSpace(spaceId: string): Promise<Map<string, unknown>> {
    return this.cache.get(
      'list_latest_snapshots_for_space',
      { spaceId },
      {
        ttl: HEAVY_TTL,
        tags: [`space:${spaceId}:trials`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .rpc('list_latest_snapshots_for_space', {
              p_space_id: spaceId,
            })
            .throwOnError();
          const out = new Map<string, unknown>();
          for (const row of (data ?? []) as { trial_id: string; payload: unknown }[]) {
            out.set(row.trial_id, row.payload);
          }
          return out;
        },
      }
    );
  }

  async update(id: string, changes: Partial<Trial>): Promise<Trial> {
    const payload: Partial<Trial> = { ...changes };
    // When the caller supplies phase_type without an explicit source, tag it
    // as analyst-written. The migration's BEFORE UPDATE trigger also enforces
    // this server-side. Trial dates are no longer columns -- they are Trial
    // Start / Trial End markers, edited through MarkerService, not here.
    if ('phase_type' in changes && !('phase_type_source' in changes)) {
      payload.phase_type_source = 'analyst';
    }
    const { data } = await this.supabase.client
      .from('trials')
      .update(payload)
      .eq('id', id)
      .select()
      .single()
      .throwOnError();
    const trial = data as Trial;
    const tags: string[] = [
      `space:${trial.space_id}:trials`,
      `space:${trial.space_id}:dashboard`,
      `space:${trial.space_id}:activity`,
      `space:${trial.space_id}:landing-stats`,
      `trial:${id}:detail`,
      `trial:${id}:activity`,
    ];
    if (trial.asset_id) tags.push(`asset:${trial.asset_id}:trials`);
    this.cache.invalidateTags(tags);
    return trial;
  }

  /** All asset memberships for a trial (asset_id + whether it is the primary). */
  async listAssets(trialId: string): Promise<{ asset_id: string; is_primary: boolean }[]> {
    const { data } = await this.supabase.client
      .from('trial_assets')
      .select('asset_id, is_primary')
      .eq('trial_id', trialId)
      .throwOnError();
    return (data ?? []) as { asset_id: string; is_primary: boolean }[];
  }

  /**
   * Atomically set a trial's full asset membership and primary via the
   * set_trial_assets RPC (the sync trigger updates trials.asset_id). Invalidates
   * the space and every affected asset's caches.
   */
  async setAssets(
    trialId: string,
    assetIds: string[],
    primaryAssetId: string,
    spaceId: string
  ): Promise<void> {
    await this.supabase.client
      .rpc('set_trial_assets', {
        p_trial_id: trialId,
        p_asset_ids: assetIds,
        p_primary_asset_id: primaryAssetId,
      })
      .throwOnError();
    this.cache.invalidateTags([
      `space:${spaceId}:trials`,
      `space:${spaceId}:dashboard`,
      `space:${spaceId}:activity`,
      `space:${spaceId}:landing-stats`,
      `trial:${trialId}:detail`,
      ...assetIds.map((a) => `asset:${a}:trials`),
    ]);
  }

  /**
   * Atomically replace a trial's full indication membership via the
   * set_trial_indications RPC. Invalidates the space, indication, and
   * trial-detail caches.
   */
  async setIndications(trialId: string, indicationIds: string[], spaceId: string): Promise<void> {
    await this.supabase.client
      .rpc('set_trial_indications', {
        p_trial_id: trialId,
        p_indication_ids: indicationIds,
      })
      .throwOnError();
    this.cache.invalidateTags([
      `space:${spaceId}:trials`,
      `space:${spaceId}:dashboard`,
      `space:${spaceId}:activity`,
      `space:${spaceId}:landing-stats`,
      `space:${spaceId}:indications`,
      `trial:${trialId}:detail`,
    ]);
  }

  /** Returns the indications currently assigned to a trial. */
  async listIndications(trialId: string): Promise<{ id: string; name: string }[]> {
    const { data } = await this.supabase.client
      .rpc('get_trial_indications', { p_trial_id: trialId })
      .throwOnError();
    return ((data ?? []) as { indication_id: string; indication_name: string }[]).map((row) => ({
      id: row.indication_id,
      name: row.indication_name,
    }));
  }

  /**
   * Read-only preview of the cascade footprint of deleting this trial.
   * Returns a jsonb count breakdown matching what the FK cascade and triggers
   * will remove: trial_notes, events, material_links, primary_intelligence,
   * primary_intelligence_links, trials.
   * Backed by public.preview_trial_delete (cascade-safety T7).
   */
  async previewDelete(id: string): Promise<DeleteCountBreakdown> {
    const { data } = await this.supabase.client
      .rpc('preview_trial_delete', {
        p_trial_id: id,
      })
      .throwOnError();
    return (data ?? {}) as DeleteCountBreakdown;
  }

  async delete(id: string): Promise<void> {
    const { data: existing } = await this.supabase.client
      .from('trials')
      .select('space_id, asset_id')
      .eq('id', id)
      .single();
    await this.supabase.client.from('trials').delete().eq('id', id).throwOnError();
    if (existing?.space_id) {
      const tags: string[] = [
        `space:${existing.space_id}:trials`,
        `space:${existing.space_id}:dashboard`,
        `space:${existing.space_id}:activity`,
        `space:${existing.space_id}:landing-stats`,
        `trial:${id}:detail`,
        `trial:${id}:activity`,
      ];
      if (existing.asset_id) tags.push(`asset:${existing.asset_id}:trials`);
      this.cache.invalidateTags(tags);
    }
  }
}
