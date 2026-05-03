/**
 * Poller orchestration for the CT.gov sync pipeline.
 *
 * Two public entry points:
 *   - runScheduledSync: cron entry. Pulls the queue, batches watermark
 *     checks, full-pulls only NCTs whose post date moved, fans out to
 *     ingest_ctgov_snapshot per (trial_id, space_id), and records one
 *     sync_run row.
 *   - runManualBackfill: admin entry. Skips the watermark check and
 *     unconditionally re-ingests every requested NCT. Reuses
 *     get_trials_for_polling and filters client-side to the requested
 *     NCTs; an operator that asks for an NCT not in the queue (no trial
 *     row) gets a row-count of zero recorded as a no-op rather than an
 *     error. This shared-codepath choice is documented here so the next
 *     reviewer doesn't reach for a separate "lookup by NCT" RPC.
 *
 * Error model:
 *   - CT.gov 5xx during summaries batch -> entire chunk fails. Trials
 *     are NOT marked polled (they retry next run). One error per NCT in
 *     the chunk is logged.
 *   - CT.gov 404 during full pull -> trial is treated as withdrawn:
 *     no ingest, but the trial IS marked polled so it doesn't retry
 *     tomorrow. One soft error is logged. (The `trial_withdrawn` event
 *     emission lives in ingest; a 404-only path is a v2 enhancement.)
 *   - ingest_ctgov_snapshot RPC error on one trial -> log + continue.
 *     That trial is NOT marked polled.
 *
 * Status calculation:
 *   - 'success' if errors_count === 0
 *   - 'failed'  if every NCT we attempted failed (no successful summary
 *      batch and no successful ingest)
 *   - 'partial' otherwise
 */

import { callRpc } from '../supabase';
import { createCtgovClient, type CtgovClient } from './ctgov-client';
import { chunkBy, groupByNct } from './batch';
import { needsFullPull } from './watermark';
import type { CtgovSyncEnv, IngestResult, PollingTrialRow, SyncRunSummary } from './types';

interface ErrorEntry {
  nct_id?: string;
  trial_id?: string;
  status?: number;
  message?: string;
  // kind discriminates non-CT.gov errors so future UIs can render them
  // distinctly (e.g. an unknown-NCT request vs a transient bulk-update
  // failure). Absent on the common per-NCT or per-trial CT.gov errors.
  kind?: 'bulk_update_last_polled' | 'unknown_nct';
}

interface SupabaseCfg {
  url: string;
  anonKey: string;
}

function cfgFrom(env: CtgovSyncEnv): SupabaseCfg {
  return { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY };
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// minOrNull returns the lexicographically smallest non-null date string.
// If ANY input is null, returns null (so we definitely pull).
function minOrNull(dates: Array<string | null>): string | null {
  if (dates.length === 0) return null;
  let min: string | null = null;
  for (const d of dates) {
    if (d === null) return null;
    if (min === null || d < min) min = d;
  }
  return min;
}

// pMap runs `worker` over `items` with bounded `concurrency`. Errors are
// surfaced via the worker function's own settle-and-return discipline; we
// do not throw out of pMap.
async function pMap<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const cap = Math.max(1, Math.min(concurrency, items.length));
  const runners: Promise<void>[] = [];
  for (let i = 0; i < cap; i++) {
    runners.push(
      (async () => {
        while (true) {
          const idx = next++;
          if (idx >= items.length) return;
          results[idx] = await worker(items[idx], idx);
        }
      })()
    );
  }
  await Promise.all(runners);
  return results;
}

// fetchAndIngestNct does the full-pull + per-assignment ingest fan-out for
// a single NCT. Returns counters for the run summary plus any per-trial
// errors that should accumulate into error_summary.errors[].
async function fetchAndIngestNct(
  env: CtgovSyncEnv,
  client: CtgovClient,
  nctId: string,
  assignments: PollingTrialRow[],
  fetchedVia: 'v2_poll' | 'manual_sync'
): Promise<{
  snapshotsWritten: number;
  eventsEmitted: number;
  polledTrialIds: string[];
  errors: ErrorEntry[];
}> {
  const errors: ErrorEntry[] = [];
  let study: unknown;
  try {
    study = await client.fetchStudy(nctId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push({ nct_id: nctId, message: msg });
    return { snapshotsWritten: 0, eventsEmitted: 0, polledTrialIds: [], errors };
  }
  if (study === null) {
    // 404: treat as soft error. Mark assignments polled so we don't retry
    // tomorrow. Withdrawn-event emission is a future enhancement.
    errors.push({ nct_id: nctId, status: 404 });
    return {
      snapshotsWritten: 0,
      eventsEmitted: 0,
      polledTrialIds: assignments.map((a) => a.trial_id),
      errors,
    };
  }

  // History is still fetched because `versionForAssignment` below uses
  // `history.length` to derive a stable per-trial version counter when CT.gov
  // assigns ascending versions of its own.
  //
  // Module hints are deliberately NOT forwarded: CT.gov returns
  // `moduleLabels` as human display strings ("Study Status", "Eligibility",
  // "Contacts/Locations") while the SQL `_path_in_hinted_modules` filter
  // expects path segments ("statusModule", "eligibilityModule"). The two
  // never match, so any non-null `p_module_hints` causes
  // `_compute_field_diffs` to drop every diff. Passing null preserves
  // correctness; the optimization can return once a label->module-key
  // mapping exists on either the worker or SQL side.
  const history = await client.fetchHistory(nctId);
  const hints = null;

  // Extract post_date from the full payload. CT.gov v2 study shape:
  // protocolSection.identificationModule.nctId,
  // protocolSection.statusModule.lastUpdatePostDateStruct.date.
  // Version is computed PER ASSIGNMENT below (assignments for the same NCT
  // can diverge in latest_ctgov_version when the same NCT is shared across
  // spaces, so we cannot share a single version across the loop).
  const studyShape = study as {
    protocolSection?: {
      statusModule?: {
        lastUpdatePostDateStruct?: { date?: string };
      };
    };
  };
  const postDate = studyShape.protocolSection?.statusModule?.lastUpdatePostDateStruct?.date ?? null;

  if (!postDate) {
    errors.push({ nct_id: nctId, message: 'no last_update_post_date in payload' });
    return {
      snapshotsWritten: 0,
      eventsEmitted: 0,
      polledTrialIds: assignments.map((a) => a.trial_id),
      errors,
    };
  }

  let snapshotsWritten = 0;
  let eventsEmitted = 0;
  const polledTrialIds: string[] = [];

  for (const assignment of assignments) {
    // Per assignment: prefer CT.gov's authoritative version when /api/int/
    // history is up. Fall back to our own per-trial counter + 1 when history
    // is unavailable, otherwise we'd collide on the
    // (trial_id, ctgov_version) unique constraint forever at version=1 and
    // last_update_posted_date would never advance.
    const versionForAssignment =
      history && history.length > 0 ? history.length : (assignment.latest_ctgov_version ?? 0) + 1;

    try {
      const result = await callRpc<IngestResult>(cfgFrom(env), null, 'ingest_ctgov_snapshot', {
        p_secret: env.CTGOV_WORKER_SECRET,
        p_trial_id: assignment.trial_id,
        p_space_id: assignment.space_id,
        p_nct_id: nctId,
        p_version: versionForAssignment,
        p_post_date: postDate,
        p_payload: study,
        p_fetched_via: fetchedVia,
        p_module_hints: hints,
      });
      if (result.inserted) snapshotsWritten += 1;
      eventsEmitted += result.events_emitted;
      polledTrialIds.push(assignment.trial_id);
    } catch (e) {
      const err = e as { message?: string; httpStatus?: number };
      errors.push({
        nct_id: nctId,
        trial_id: assignment.trial_id,
        status: err.httpStatus,
        message: err.message,
      });
    }
  }

  return { snapshotsWritten, eventsEmitted, polledTrialIds, errors };
}

async function recordRun(env: CtgovSyncEnv, summary: SyncRunSummary): Promise<void> {
  await callRpc<string>(cfgFrom(env), null, 'record_sync_run', {
    p_secret: env.CTGOV_WORKER_SECRET,
    p_started_at: summary.started_at,
    p_ended_at: summary.ended_at,
    p_trials_checked: summary.trials_checked,
    p_ncts_with_changes: summary.ncts_with_changes,
    p_snapshots_written: summary.snapshots_written,
    p_events_emitted: summary.events_emitted,
    p_errors_count: summary.errors_count,
    p_error_summary: summary.error_summary,
    p_status: summary.status,
  });
}

function buildSummary(args: {
  startedAt: string;
  endedAt: string;
  trialsChecked: number;
  nctsWithChanges: number;
  snapshotsWritten: number;
  eventsEmitted: number;
  errors: ErrorEntry[];
  totalNctsAttempted: number;
  successfulNcts: number;
}): SyncRunSummary {
  const errorsCount = args.errors.length;
  let status: 'success' | 'partial' | 'failed';
  if (errorsCount === 0) {
    status = 'success';
  } else if (args.successfulNcts === 0 && args.totalNctsAttempted > 0) {
    status = 'failed';
  } else {
    status = 'partial';
  }
  return {
    started_at: args.startedAt,
    ended_at: args.endedAt,
    trials_checked: args.trialsChecked,
    ncts_with_changes: args.nctsWithChanges,
    snapshots_written: args.snapshotsWritten,
    events_emitted: args.eventsEmitted,
    errors_count: errorsCount,
    error_summary: errorsCount > 0 ? { errors: args.errors } : null,
    status,
  };
}

export async function runScheduledSync(env: CtgovSyncEnv): Promise<SyncRunSummary> {
  const startedAt = new Date().toISOString();
  const batchSize = parseIntEnv(env.CTGOV_BATCH_SIZE, 100);
  const parallel = parseIntEnv(env.CTGOV_PARALLEL_FETCHES, 10);
  const limit = batchSize * parallel;

  const client = createCtgovClient({ baseUrl: env.CTGOV_BASE_URL });

  const queue = await callRpc<PollingTrialRow[]>(cfgFrom(env), null, 'get_trials_for_polling', {
    p_secret: env.CTGOV_WORKER_SECRET,
    p_limit: limit,
  });

  const nctMap = groupByNct(queue);
  const allNcts = [...nctMap.keys()];
  const trialsChecked = queue.length;

  const errors: ErrorEntry[] = [];
  const polledTrialIds = new Set<string>();
  let snapshotsWritten = 0;
  let eventsEmitted = 0;
  let nctsWithChanges = 0;
  let successfulNcts = 0;

  // The set of NCTs that actually need a full pull (built across all chunks
  // before we kick off the parallel fetcher pool).
  const nctsToPull: string[] = [];

  for (const chunk of chunkBy(allNcts, batchSize)) {
    let summaries;
    try {
      summaries = await client.fetchSummariesBatch(chunk);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Status code is embedded in the message via ctgov-client ('failed: 503').
      const m = /failed: (\d{3})/.exec(msg);
      const status = m ? Number.parseInt(m[1], 10) : undefined;
      for (const nct of chunk) {
        errors.push({ nct_id: nct, status, message: msg });
      }
      // Do not mark these polled. Skip the rest of this chunk.
      continue;
    }

    // CT.gov may return fewer studies than we asked about (e.g. retired NCTs).
    // For NCTs missing from the response, fall through to a full pull so the
    // 404 path can run.
    const summaryByNct = new Map<string, string>();
    for (const s of summaries) {
      summaryByNct.set(s.nctId, s.lastUpdatePostDate);
    }

    for (const nct of chunk) {
      const assignments = nctMap.get(nct);
      if (!assignments) continue;
      const ourLastPost = minOrNull(assignments.map((a) => a.last_update_posted_date));
      const ctgovPost = summaryByNct.get(nct);
      if (ctgovPost === undefined) {
        // Missing from CT.gov response. Try the full pull; the 404 path will
        // mark polled if the trial was retired.
        nctsToPull.push(nct);
        continue;
      }
      if (needsFullPull(ctgovPost, ourLastPost)) {
        nctsToPull.push(nct);
      } else {
        // No change. Mark every assignment polled.
        for (const a of assignments) polledTrialIds.add(a.trial_id);
        successfulNcts += 1;
      }
    }
  }

  nctsWithChanges = nctsToPull.length;

  // Bounded parallel full-pulls + ingest.
  const perNctResults = await pMap(nctsToPull, parallel, async (nct) => {
    const assignments = nctMap.get(nct) ?? [];
    return await fetchAndIngestNct(env, client, nct, assignments, 'v2_poll');
  });

  for (const r of perNctResults) {
    snapshotsWritten += r.snapshotsWritten;
    eventsEmitted += r.eventsEmitted;
    for (const id of r.polledTrialIds) polledTrialIds.add(id);
    errors.push(...r.errors);
    // An NCT counts as "successful" if at least one assignment ingested
    // without error, OR if it short-circuited as 404 (we still made forward
    // progress and won't retry tomorrow).
    if (r.errors.length === 0 || r.errors.some((e) => e.status === 404)) {
      successfulNcts += 1;
    }
  }

  const polledList = [...polledTrialIds];
  if (polledList.length > 0) {
    try {
      await callRpc<number>(cfgFrom(env), null, 'bulk_update_last_polled', {
        p_secret: env.CTGOV_WORKER_SECRET,
        p_trial_ids: polledList,
      });
    } catch (e) {
      const err = e as { message?: string; httpStatus?: number };
      errors.push({
        kind: 'bulk_update_last_polled',
        status: err.httpStatus,
        message: err.message,
      });
    }
  }

  const summary = buildSummary({
    startedAt,
    endedAt: new Date().toISOString(),
    trialsChecked,
    nctsWithChanges,
    snapshotsWritten,
    eventsEmitted,
    errors,
    totalNctsAttempted: allNcts.length,
    successfulNcts,
  });

  await recordRun(env, summary);
  return summary;
}

export async function runManualBackfill(
  env: CtgovSyncEnv,
  nctIds: string[]
): Promise<SyncRunSummary> {
  const startedAt = new Date().toISOString();
  const parallel = parseIntEnv(env.CTGOV_PARALLEL_FETCHES, 10);
  const batchSize = parseIntEnv(env.CTGOV_BATCH_SIZE, 100);
  const client = createCtgovClient({ baseUrl: env.CTGOV_BASE_URL });

  // Reuse get_trials_for_polling and filter client-side. See file header
  // for why this is the v1 design choice.
  const queue = await callRpc<PollingTrialRow[]>(cfgFrom(env), null, 'get_trials_for_polling', {
    p_secret: env.CTGOV_WORKER_SECRET,
    p_limit: batchSize * parallel,
  });

  const requested = new Set(nctIds);
  const filtered = queue.filter((row) => requested.has(row.nct_id));
  const nctMap = groupByNct(filtered);
  const targetNcts = [...nctMap.keys()];
  const trialsChecked = filtered.length;

  const errors: ErrorEntry[] = [];
  const polledTrialIds = new Set<string>();
  let snapshotsWritten = 0;
  let eventsEmitted = 0;
  let successfulNcts = 0;

  // Surface NCTs the operator asked for that don't map to any trial row.
  // Without this, runManualBackfill silently no-ops on unknown NCTs and the
  // operator sees status=success with zero work done. Each unknown NCT is
  // logged as a per-NCT error so errors_count reflects it and status drops
  // to partial (or failed if every requested NCT was unknown).
  const knownNcts = new Set(targetNcts);
  for (const requestedNct of requested) {
    if (!knownNcts.has(requestedNct)) {
      errors.push({
        kind: 'unknown_nct',
        nct_id: requestedNct,
        message: 'unknown NCT (no trial row)',
      });
    }
  }

  const perNctResults = await pMap(targetNcts, parallel, async (nct) => {
    const assignments = nctMap.get(nct) ?? [];
    return await fetchAndIngestNct(env, client, nct, assignments, 'manual_sync');
  });

  for (const r of perNctResults) {
    snapshotsWritten += r.snapshotsWritten;
    eventsEmitted += r.eventsEmitted;
    for (const id of r.polledTrialIds) polledTrialIds.add(id);
    errors.push(...r.errors);
    if (r.errors.length === 0 || r.errors.some((e) => e.status === 404)) {
      successfulNcts += 1;
    }
  }

  const polledList = [...polledTrialIds];
  if (polledList.length > 0) {
    try {
      await callRpc<number>(cfgFrom(env), null, 'bulk_update_last_polled', {
        p_secret: env.CTGOV_WORKER_SECRET,
        p_trial_ids: polledList,
      });
    } catch (e) {
      const err = e as { message?: string; httpStatus?: number };
      errors.push({
        kind: 'bulk_update_last_polled',
        status: err.httpStatus,
        message: err.message,
      });
    }
  }

  // totalNctsAttempted counts known NCTs we actually pulled PLUS unknown
  // NCTs the operator asked for, so a request of all-unknowns yields
  // status=failed (successfulNcts=0, totalNctsAttempted>0). A mixed
  // known/unknown request lands at partial as long as at least one known
  // NCT ingested.
  const totalNctsAttempted = targetNcts.length + (requested.size - knownNcts.size);

  const summary = buildSummary({
    startedAt,
    endedAt: new Date().toISOString(),
    trialsChecked,
    nctsWithChanges: targetNcts.length,
    snapshotsWritten,
    eventsEmitted,
    errors,
    totalNctsAttempted,
    successfulNcts,
  });

  await recordRun(env, summary);
  return summary;
}
