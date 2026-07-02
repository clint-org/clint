import { inject, Injectable } from '@angular/core';

import {
  ActivityFeedCursor,
  ActivityFeedFilters,
  ActivityFeedPage,
  ChangeEvent,
  MarkerChangeRow,
} from '../models/change-event.model';
import { landscapeAllTag } from './cache-tags';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

const HEAVY_TTL = { fresh: 30 * 1000, stale: 5 * 60 * 1000 };

@Injectable({ providedIn: 'root' })
export class ChangeEventService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async getActivityFeed(
    spaceId: string,
    filters: ActivityFeedFilters,
    cursor: ActivityFeedCursor | null,
    limit = 50
  ): Promise<ActivityFeedPage> {
    return this.cache.get(
      'get_activity_feed',
      { spaceId, filters, cursor, limit },
      {
        ttl: HEAVY_TTL,
        tags: [`space:${spaceId}:activity`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .rpc('get_activity_feed', {
              p_space_id: spaceId,
              p_filters: filters,
              p_cursor_observed_at: cursor?.observed_at ?? null,
              p_cursor_id: cursor?.id ?? null,
              p_limit: limit,
            })
            .throwOnError();
          const rows = (data as ChangeEvent[]) ?? [];
          if (rows.length > limit) {
            const last = rows[limit - 1];
            return {
              events: rows.slice(0, limit),
              next_cursor: { observed_at: last.observed_at, id: last.id },
            };
          }
          return { events: rows, next_cursor: null };
        },
      }
    );
  }

  async getTrialActivity(trialId: string, limit = 25): Promise<ChangeEvent[]> {
    return this.cache.get(
      'get_trial_activity',
      { trialId, limit },
      {
        ttl: HEAVY_TTL,
        tags: [`trial:${trialId}:activity`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .rpc('get_trial_activity', {
              p_trial_id: trialId,
              p_limit: limit,
            })
            .throwOnError();
          return (data as ChangeEvent[]) ?? [];
        },
      }
    );
  }

  async getMarkerHistory(markerId: string): Promise<MarkerChangeRow[]> {
    return this.cache.get(
      'get_marker_history',
      { markerId },
      {
        ttl: HEAVY_TTL,
        tags: [`marker:${markerId}:history`],
        fetch: async () => {
          const { data } = await this.supabase.client
            .rpc('get_marker_history', {
              p_marker_id: markerId,
            })
            .throwOnError();
          return (data as MarkerChangeRow[]) ?? [];
        },
      }
    );
  }

  /**
   * Posts to the Worker's /api/ctgov/sync-trial endpoint with the user's
   * JWT. The Worker calls trigger_single_trial_sync (gated on space
   * owner|editor) to validate access and resolve the NCT, then runs the
   * manual backfill under the worker secret. Single round-trip from the
   * client.
   *
   * Returns the {ok, nct_id, reason} shape so callers can surface
   * `no_nct_id` (the RPC's response when the trial has no identifier set)
   * and other soft errors via toast text.
   *
   * Pass `spaceId` when the caller knows it (import commit, trial create/detail):
   * the sync seeds trial-date markers (Trial Start/End and, critically, the
   * primary-completion-date marker) that live in the space's dashboard/landscape
   * reads. Without invalidating those space tags, a timeline fetched between the
   * commit and the async sync's completion keeps serving the pre-sync snapshot
   * (bars, no PCD glyph) until a hard refresh. See issue #175/#177.
   */
  async triggerSingleTrialSync(
    trialId: string,
    spaceId?: string
  ): Promise<{ ok: boolean; nct_id?: string; reason?: string }> {
    const session = (await this.supabase.client.auth.getSession()).data.session;
    const apiBase = (window as Window & { __WORKER_API_BASE?: string }).__WORKER_API_BASE ?? '';
    const res = await fetch(`${apiBase}/api/ctgov/sync-trial`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ trial_id: trialId }),
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errBody.error ?? `sync failed (${res.status})`);
    }
    const result = (await res.json()) as { ok: boolean; nct_id?: string; reason?: string };
    if (result.ok) {
      const tags = [`trial:${trialId}:detail`, `trial:${trialId}:activity`];
      if (spaceId) {
        // The sync just wrote/updated the space's trial-date markers; drop the
        // timeline (dashboard) and bullseye/heatmap/landscape reads so a mounted
        // or subsequent view refetches with the new markers (e.g. the PCD glyph).
        tags.push(`space:${spaceId}:dashboard`, landscapeAllTag(spaceId));
      }
      this.cache.invalidateTags(tags);
    }
    return result;
  }
}
