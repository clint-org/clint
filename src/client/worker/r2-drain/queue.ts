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
 *   1. SELECT a bounded batch of pending rows (succeeded_at is null AND
 *      attempt_count < MAX_ATTEMPTS), ordered by queued_at ASC so the
 *      oldest queued objects clear first.
 *   2. For each row: call R2 DELETE on the file_path.
 *      - Success: UPDATE succeeded_at = now(), attempted_at = now().
 *      - Failure: UPDATE attempted_at = now(), attempt_count += 1,
 *        last_error = message. The row stays eligible until
 *        attempt_count hits MAX_ATTEMPTS, at which point it stops being
 *        selected and surfaces for ops review.
 *   3. Return a summary {drained, succeeded, failed, max_attempts_hit}.
 *
 * Idempotency: succeeded rows are filtered out by the WHERE clause, so
 * re-running the drain on the same queue does not re-delete anything.
 * R2 DELETE of a key that no longer exists is also a no-op at the R2
 * side, so a duplicate retry that races to completion is safe.
 *
 * Postgres access uses PostgREST direct-table access with the service-
 * role apikey. The queue table has `revoke all ... from authenticated`
 * for write paths; only the service role can update / delete rows. The
 * existing `callRpc` helper assumes RPC endpoints; the direct-table
 * helpers below mirror the same fetch shape (apikey + Authorization
 * forwarded as a service-role bearer) so the request looks consistent
 * with the rest of the worker.
 *
 * R2 access uses an injected client object so the production path can
 * wire to the AWS S3 SDK (DeleteObjectCommand) while tests pass an
 * in-memory fake. See `index.ts` for the production wiring.
 */

export interface R2DrainEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  R2_BUCKET: string;
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

  const pending = await fetchPending(env, batchSize, maxAttempts);

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
      // selected by fetchPending. Surface a count so the scheduler log
      // can flag a stuck queue without a second SELECT.
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
 * Selects up to `limit` rows from r2_pending_deletes that are not yet
 * succeeded and have not exhausted their attempts. Oldest queued first
 * so a backlog clears in arrival order. PostgREST direct-table query;
 * the queue table's grants only allow this with the service-role key.
 */
async function fetchPending(
  env: R2DrainEnv,
  limit: number,
  maxAttempts: number
): Promise<PendingDeleteRow[]> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/r2_pending_deletes`);
  url.searchParams.set('select', 'id,file_path,attempt_count');
  url.searchParams.set('succeeded_at', 'is.null');
  url.searchParams.set('attempt_count', `lt.${maxAttempts}`);
  url.searchParams.set('order', 'queued_at.asc');
  url.searchParams.set('limit', String(limit));

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: serviceRoleHeaders(env),
  });
  if (!res.ok) {
    const body = await safeReadText(res);
    throw new Error(`r2_pending_deletes select failed: ${res.status} ${body}`);
  }
  return (await res.json()) as PendingDeleteRow[];
}

async function markSucceeded(env: R2DrainEnv, id: string): Promise<void> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/r2_pending_deletes`);
  url.searchParams.set('id', `eq.${id}`);

  const now = new Date().toISOString();
  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: {
      ...serviceRoleHeaders(env),
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      succeeded_at: now,
      attempted_at: now,
      last_error: null,
    }),
  });
  if (!res.ok) {
    const body = await safeReadText(res);
    throw new Error(`r2_pending_deletes mark-succeeded failed: ${res.status} ${body}`);
  }
}

async function markFailed(
  env: R2DrainEnv,
  id: string,
  attemptCount: number,
  lastError: string
): Promise<void> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/r2_pending_deletes`);
  url.searchParams.set('id', `eq.${id}`);

  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: {
      ...serviceRoleHeaders(env),
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      attempted_at: new Date().toISOString(),
      attempt_count: attemptCount,
      last_error: truncateError(lastError),
    }),
  });
  if (!res.ok) {
    const body = await safeReadText(res);
    throw new Error(`r2_pending_deletes mark-failed failed: ${res.status} ${body}`);
  }
}

function serviceRoleHeaders(env: R2DrainEnv): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
}

// Postgres `text` columns are unbounded, but a runaway provider message
// (stack trace, dumped payload) bloats the queue table and the audit
// log. Cap to a generous-but-finite size that still keeps the diagnostic
// signal.
function truncateError(message: string): string {
  const MAX = 2000;
  return message.length > MAX ? message.slice(0, MAX) : message;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
