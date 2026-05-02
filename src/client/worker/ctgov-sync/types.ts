/**
 * Shared TypeScript types for the CT.gov sync pipeline.
 *
 * This file is the typed boundary between Postgres RPC results,
 * CT.gov API responses, and the Cloudflare Worker poller. See the
 * spec section "Cloudflare Worker poller / File layout" in
 * docs/superpowers/plans/2026-05-02-trial-change-feed.md for context.
 */

// PollingTrialRow: shape returned by get_trials_for_polling.
export interface PollingTrialRow {
  trial_id: string;
  space_id: string;
  nct_id: string;
  last_update_posted_date: string | null;
}

// CtgovStudySummary: result of /api/v2/studies?fields=NCTId,LastUpdatePostDate batch.
export interface CtgovStudySummary {
  nctId: string;
  lastUpdatePostDate: string;
}

// CtgovHistoryEntry: opportunistic /api/int/studies/{nct}/history result.
export interface CtgovHistoryEntry {
  version: number;
  date: string;
  moduleLabels?: string[];
}

// IngestArgs: typed args for the ingest_ctgov_snapshot RPC.
export interface IngestArgs {
  trial_id: string;
  space_id: string;
  nct_id: string;
  version: number;
  post_date: string; // YYYY-MM-DD
  payload: unknown;
  fetched_via: 'v2_poll' | 'int_backfill' | 'manual_sync';
  module_hints: string[] | null;
}

// IngestResult: shape returned by ingest_ctgov_snapshot.
export interface IngestResult {
  snapshot_id: string;
  inserted: boolean;
  events_emitted: number;
  changes_recorded: number;
}

// SyncRunSummary: payload to record_sync_run.
export interface SyncRunSummary {
  started_at: string;
  ended_at: string;
  trials_checked: number;
  ncts_with_changes: number;
  snapshots_written: number;
  events_emitted: number;
  errors_count: number;
  error_summary: Record<string, unknown> | null;
  status: 'success' | 'partial' | 'failed';
}

// CtgovSyncEnv: subset of the worker Env used by the ctgov-sync pipeline.
export interface CtgovSyncEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  CTGOV_BASE_URL: string;
  CTGOV_BATCH_SIZE: string;
  CTGOV_PARALLEL_FETCHES: string;
  CTGOV_WORKER_SECRET: string;
}
