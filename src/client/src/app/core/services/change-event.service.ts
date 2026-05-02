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
    limit = 50,
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
   * Validates owner|editor access via the RPC, then forwards the NCT id to
   * the Worker's admin/ctgov-backfill endpoint with the user's JWT. Returns
   * the RPC result so callers can surface no_nct_id reasons.
   */
  async triggerSingleTrialSync(
    trialId: string,
  ): Promise<{ ok: boolean; nct_id?: string; reason?: string }> {
    const { data, error } = await this.supabase.client.rpc('trigger_single_trial_sync', {
      p_trial_id: trialId,
    });
    if (error) throw error;
    const result = data as { ok: boolean; nct_id?: string; reason?: string };
    if (!result.ok || !result.nct_id) return result;

    const session = (await this.supabase.client.auth.getSession()).data.session;
    const apiBase =
      (window as Window & { __WORKER_API_BASE?: string }).__WORKER_API_BASE ?? '';
    await fetch(`${apiBase}/admin/ctgov-backfill`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ nct_ids: [result.nct_id] }),
    });
    return result;
  }
}
