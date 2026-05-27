import { inject, Injectable } from '@angular/core';

import { Marker } from '../models/marker.model';
import { Trial } from '../models/trial.model';
import { DeleteCountBreakdown } from '../../shared/utils/confirm-delete';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

const TRIAL_SELECT = `
  *,
  assets(id, name, companies(id, name)),
  marker_assignments(
    id,
    marker_id,
    trial_id,
    created_at,
    markers(
      *,
      marker_types(*, marker_categories(*))
    )
  ),
  trial_notes(*)
`;

const HEAVY_TTL = { fresh: 30 * 1000, stale: 5 * 60 * 1000 };

/** Flatten marker_assignments[].markers into trial.markers[] */
function normalizeTrial(raw: Record<string, unknown>): Trial {
  const assignments = (raw['marker_assignments'] as { markers: Marker }[] | null) ?? [];
  const markers: Marker[] = assignments.map((a) => a.markers).filter((m): m is Marker => !!m);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { marker_assignments: _unused, ...rest } = raw;
  return { ...rest, markers } as unknown as Trial;
}

@Injectable({ providedIn: 'root' })
export class TrialService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

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
          return (data as Record<string, unknown>[]).map(normalizeTrial);
        },
      }
    );
  }

  async listBySpace(spaceId: string): Promise<Trial[]> {
    return this.cache.get(
      'trials_by_space',
      { spaceId },
      {
        ttl: HEAVY_TTL,
        tags: [`space:${spaceId}:trials`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .from('trials')
            .select(TRIAL_SELECT)
            .eq('space_id', spaceId)
            .order('display_order')
            .throwOnError();
          return (data as Record<string, unknown>[]).map(normalizeTrial);
        },
      }
    );
  }

  async getById(id: string): Promise<Trial> {
    const { data } = await this.supabase.client
      .from('trials')
      .select(TRIAL_SELECT)
      .eq('id', id)
      .single()
      .throwOnError();
    return normalizeTrial(data as Record<string, unknown>);
  }

  async create(spaceId: string, trial: Partial<Trial>): Promise<Trial> {
    const { data: newId } = await this.supabase.client
      .rpc('create_trial', {
        p_space_id: spaceId,
        p_asset_id: trial.asset_id!,
        p_name: trial.name!,
        p_identifier: trial.identifier ?? null,
        p_status: trial.status ?? null,
        p_phase_type: trial.phase_type ?? null,
        p_phase_start_date: trial.phase_start_date ?? null,
        p_phase_end_date: trial.phase_end_date ?? null,
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
    // When the caller supplies a phase field without an explicit source,
    // tag it as analyst-written. The migration's BEFORE UPDATE trigger
    // also enforces this server-side.
    if ('phase_type' in changes && !('phase_type_source' in changes)) {
      payload.phase_type_source = 'analyst';
    }
    if ('phase_start_date' in changes && !('phase_start_date_source' in changes)) {
      payload.phase_start_date_source = 'analyst';
    }
    if ('phase_end_date' in changes && !('phase_end_date_source' in changes)) {
      payload.phase_end_date_source = 'analyst';
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

  /**
   * Read-only preview of the cascade footprint of deleting this trial.
   * Returns a jsonb count breakdown matching what the FK cascade + T3 / T4
   * triggers will remove (trial_notes, events, material_links, PI, PIL,
   * marker_assignments, markers_removed_entirely, markers_unlinked_only).
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
