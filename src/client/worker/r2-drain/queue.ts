/**
 * R2 delete-queue drain.
 *
 * The `public.r2_pending_deletes` table is populated by an AFTER DELETE
 * trigger on `public.materials` (see migration
 * `20260521120000_r2_pending_deletes_queue.sql`). Every materials row
 * removal -- whether through `delete_material()`, a space cascade, or a
 * tenant cascade -- enqueues one row with the file_path that needs to be
 * removed from R2.
 *
 * This module drains that queue. The drain loop is intentionally simple:
 *
 *   1. Call claim_pending_r2_deletes(secret, batch_size, max_attempts).
 *      The RPC atomically selects up to batch_size rows with FOR UPDATE
 *      SKIP LOCKED, stamps attempted_at, and returns id/file_path/
 *      attempt_count for each row.
 *   2. For each row: call R2 DELETE on the file_path.
 *      - Success: call mark_r2_delete_succeeded(secret, id).
 *      - Failure: call mark_r2_delete_failed(secret, id, next_attempt,
 *        message). Once attempt_count hits MAX_ATTEMPTS the row stops
 *        being claimed and surfaces for ops review.
 *   3. Return {drained, succeeded, failed, max_attempts_hit}.
 *
 * Authorization: all three RPCs are SECURITY DEFINER and gated by a
 * worker-secret stored in Supabase Vault under `r2_drain_worker_secret`.
 * The worker carries the corresponding R2_WORKER_SECRET env var and
 * passes it as the first argument to each call. The worker does NOT
 * hold a service_role key -- writes to r2_pending_deletes are revoked
 * from service_role; the RPCs are the only write path.
 *
 * Idempotency: succeeded rows are filtered out by claim_pending_r2_deletes
 * so re-running the drain on the same queue does not re-delete anything.
 * R2 DELETE of a key that no longer exists is also a no-op at the R2
 * side, so a duplicate retry that races to completion is safe.
 *
 * R2 access uses an injected client object so the production path can
 * wire to the native R2 binding while tests use a Miniflare-emulated
 * binding or an in-memory fake. See `index.ts` for the production wiring.
 */

import { callRpc } from '../supabase';
import type { SupabaseRpcError } from '../errors';

export interface R2DrainEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  R2_WORKER_SECRET: string;
  MAX_ATTEMPTS?: number;
  BATCH_SIZE?: number;
}

export interface R2DeleteClient {
  // Deletes the given key from R2. Must throw on failure so the drain
  // loop can increment attempt_count + capture last_error. A successful
  // delete (object missing or removed) returns void.
  delete(key: string): Promise<void>;
}

export interface PendingDeleteRow {
  id: string;
  file_path: string;
  attempt_count: number;
}

export interface DrainSummary {
  drained: number;
  succeeded: number;
  failed: number;
  max_attempts_hit: number;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BATCH_SIZE = 50;

export async function drainR2DeleteQueue(
  env: R2DrainEnv,
  r2: R2DeleteClient
): Promise<DrainSummary> {
  const maxAttempts = env.MAX_ATTEMPTS ?? DEFAULT_MAX_ATTEMPTS;
  const batchSize = env.BATCH_SIZE ?? DEFAULT_BATCH_SIZE;

  const pending = await claimPending(env, batchSize, maxAttempts);

  let succeeded = 0;
  let failed = 0;
  let maxAttemptsHit = 0;

  for (const row of pending) {
    try {
      await r2.delete(row.file_path);
      await markSucceeded(env, row.id);
      succeeded += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const nextAttempt = row.attempt_count + 1;
      await markFailed(env, row.id, nextAttempt, message);
      failed += 1;
      // Once attempt_count reaches MAX_ATTEMPTS the row stops being
      // claimed by claim_pending_r2_deletes. Surface a count so the
      // scheduler log can flag a stuck queue without a second SELECT.
      if (nextAttempt >= maxAttempts) {
        maxAttemptsHit += 1;
      }
    }
  }

  return {
    drained: pending.length,
    succeeded,
    failed,
    max_attempts_hit: maxAttemptsHit,
  };
}

/**
 * claim_pending_r2_deletes: atomically claims up to `limit` rows with
 * FOR UPDATE SKIP LOCKED, stamps attempted_at, returns id/file_path/
 * attempt_count for each.
 */
async function claimPending(
  env: R2DrainEnv,
  limit: number,
  maxAttempts: number
): Promise<PendingDeleteRow[]> {
  try {
    return await callRpc<PendingDeleteRow[]>(
      { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY },
      null,
      'claim_pending_r2_deletes',
      {
        p_secret: env.R2_WORKER_SECRET,
        p_batch_size: limit,
        p_max_attempts: maxAttempts,
      }
    );
  } catch (e) {
    throw new Error(`claim_pending_r2_deletes failed: ${describeRpcError(e)}`);
  }
}

async function markSucceeded(env: R2DrainEnv, id: string): Promise<void> {
  try {
    await callRpc<null>(
      { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY },
      null,
      'mark_r2_delete_succeeded',
      {
        p_secret: env.R2_WORKER_SECRET,
        p_id: id,
      }
    );
  } catch (e) {
    throw new Error(`mark_r2_delete_succeeded failed: ${describeRpcError(e)}`);
  }
}

async function markFailed(
  env: R2DrainEnv,
  id: string,
  attemptCount: number,
  lastError: string
): Promise<void> {
  try {
    await callRpc<null>(
      { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY },
      null,
      'mark_r2_delete_failed',
      {
        p_secret: env.R2_WORKER_SECRET,
        p_id: id,
        p_attempt_count: attemptCount,
        p_error: truncateError(lastError),
      }
    );
  } catch (e) {
    throw new Error(`mark_r2_delete_failed failed: ${describeRpcError(e)}`);
  }
}

// Postgres `text` columns are unbounded, but a runaway provider message
// (stack trace, dumped payload) bloats the queue table and the audit
// log. Cap to a generous-but-finite size that still keeps the diagnostic
// signal.
function truncateError(message: string): string {
  const MAX = 2000;
  return message.length > MAX ? message.slice(0, MAX) : message;
}

function describeRpcError(e: unknown): string {
  const err = e as Partial<SupabaseRpcError>;
  if (err && typeof err === 'object' && (err.code || err.message)) {
    return `${err.code ?? 'unknown'}: ${err.message ?? ''} (http ${err.httpStatus ?? '?'})`;
  }
  return e instanceof Error ? e.message : String(e);
}
