import { inject, Injectable } from '@angular/core';

import {
  ActivityFeedCursor,
  ActivityFeedFilters,
  ActivityFeedPage,
  ChangeEvent,
  MarkerChangeRow,
} from '../models/change-event.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class ChangeEventService {
  private supabase = inject(SupabaseService);

  async getActivityFeed(
    spaceId: string,
    filters: ActivityFeedFilters,
    cursor: ActivityFeedCursor | null,
    limit = 50
  ): Promise<ActivityFeedPage> {
    const { data, error } = await this.supabase.client.rpc('get_activity_feed', {
      p_space_id: spaceId,
      p_filters: filters,
      p_cursor_observed_at: cursor?.observed_at ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_limit: limit,
    });
    if (error) throw error;
    const rows = (data as ChangeEvent[]) ?? [];
    if (rows.length > limit) {
      const last = rows[limit - 1];
      return {
        events: rows.slice(0, limit),
        next_cursor: { observed_at: last.observed_at, id: last.id },
      };
    }
    return { events: rows, next_cursor: null };
  }

  async getTrialActivity(trialId: string, limit = 25): Promise<ChangeEvent[]> {
    const { data, error } = await this.supabase.client.rpc('get_trial_activity', {
      p_trial_id: trialId,
      p_limit: limit,
    });
    if (error) throw error;
    return (data as ChangeEvent[]) ?? [];
  }

  async getMarkerHistory(markerId: string): Promise<MarkerChangeRow[]> {
    const { data, error } = await this.supabase.client.rpc('get_marker_history', {
      p_marker_id: markerId,
    });
    if (error) throw error;
    return (data as MarkerChangeRow[]) ?? [];
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
   */
  async triggerSingleTrialSync(
    trialId: string
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
    return (await res.json()) as { ok: boolean; nct_id?: string; reason?: string };
  }
}
