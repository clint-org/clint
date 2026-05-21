import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { jwtSubject } from './auth';
import { isAllowedOrigin, corsHeaders, preflight } from './cors';
import { mapSupabaseError, errorResponse, type SupabaseRpcError } from './errors';
import { callRpc } from './supabase';
import { presignPut, presignGet } from './r2';
import { runScheduledSync, runManualBackfill } from './ctgov-sync/poller';
import { drainR2DeleteQueue, type R2DeleteClient } from './r2-drain/queue';

type RateLimit = { limit: (key: { key: string }) => Promise<{ success: boolean }> };

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  // Service-role key for direct-table access to public.r2_pending_deletes.
  // Provisioned via `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` and
  // NOT listed in wrangler.jsonc vars. Used only by the r2-drain
  // scheduled handler.
  SUPABASE_SERVICE_ROLE_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET: string;
  ALLOWED_APEXES: string; // comma-separated list, e.g. "clintapp.com"
  UPLOAD_LIMITER: RateLimit;
  DOWNLOAD_LIMITER: RateLimit;
  // CT.gov sync configuration. CTGOV_WORKER_SECRET is provisioned via
  // `wrangler secret put` and is NOT in wrangler.jsonc vars.
  CTGOV_BASE_URL: string;
  CTGOV_BATCH_SIZE: string;
  CTGOV_PARALLEL_FETCHES: string;
  CTGOV_WORKER_SECRET: string;
  ASSETS?: { fetch: (req: Request) => Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const apexes = env.ALLOWED_APEXES.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return preflight(request, apexes);
    }

    const cors = corsHeaders(origin, apexes);

    if (url.pathname === '/api/materials/sign-upload' && request.method === 'POST') {
      return handleSignUpload(request, env, cors);
    }
    if (url.pathname === '/api/materials/sign-download' && request.method === 'POST') {
      return handleSignDownload(request, env, cors);
    }
    if (url.pathname === '/admin/ctgov-backfill' && request.method === 'POST') {
      return handleManualBackfill(request, env, cors);
    }
    if (url.pathname === '/api/ctgov/sync-trial' && request.method === 'POST') {
      return handleSingleTrialSync(request, env, cors);
    }

    if (url.pathname.startsWith('/api/')) {
      return errorResponse(404, 'not_found', cors);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return errorResponse(404, 'not_found', cors);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // wrangler.jsonc declares two crons:
    //   "0 7 * * *"  -> daily CT.gov pull
    //   "* * * * *"  -> minute-cadence R2 delete-queue drain
    // event.cron disambiguates which one fired so we don't run the
    // heavyweight CT.gov sync on every minute tick. The R2 drain runs
    // on every fire (including the daily one) -- cheap when the queue
    // is empty, useful when the daily CT.gov work has just enqueued
    // anything indirectly through trial cascades.
    const cron = event.cron ?? '';
    if (cron === CTGOV_DAILY_CRON) {
      ctx.waitUntil(
        runScheduledSync(env).catch((err: unknown) => {
          log({ route: 'scheduled.ctgov', error: String(err) });
        })
      );
    }
    ctx.waitUntil(
      runR2Drain(env).catch((err: unknown) => {
        log({ route: 'scheduled.r2_drain', error: String(err) });
      })
    );
  },
};

const CTGOV_DAILY_CRON = '0 7 * * *';

/**
 * Drains the r2_pending_deletes queue using the AWS S3 SDK as the R2
 * client. Wired here (rather than inside r2-drain/queue.ts) so the
 * module stays trivially testable with an in-memory fake while
 * production still talks to R2 over S3-compatible HTTP.
 */
async function runR2Drain(env: Env): Promise<void> {
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const r2Client: R2DeleteClient = {
    async delete(key: string): Promise<void> {
      await s3.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
    },
  };
  const summary = await drainR2DeleteQueue(
    {
      SUPABASE_URL: env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
      R2_BUCKET: env.R2_BUCKET,
    },
    r2Client
  );
  log({
    route: 'scheduled.r2_drain',
    drained: summary.drained,
    succeeded: summary.succeeded,
    failed: summary.failed,
    max_attempts_hit: summary.max_attempts_hit,
  });
}

async function handleSignUpload(request: Request, env: Env, cors: Record<string, string>) {
  const start = Date.now();
  const auth = request.headers.get('Authorization');
  const key = jwtSubject(auth) ?? request.headers.get('CF-Connecting-IP') ?? 'anon';

  const rl = await env.UPLOAD_LIMITER.limit({ key: `upload:${key}` });
  if (!rl.success) {
    log({ route: 'sign-upload', status: 429, duration_ms: Date.now() - start });
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60', ...cors },
    });
  }

  let body: { material_id?: string };
  try {
    body = (await request.json()) as { material_id?: string };
  } catch {
    return errorResponse(400, 'invalid_json', cors);
  }
  if (!body.material_id) {
    return errorResponse(400, 'material_id_required', cors);
  }

  try {
    const meta = await callRpc<{
      space_id: string;
      material_id: string;
      file_name: string;
      mime_type: string;
    }>({ url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY }, auth, 'prepare_material_upload', {
      p_material_id: body.material_id,
    });

    const objectKey = `${meta.space_id}/${meta.material_id}/${meta.file_name}`;
    const url = await presignPut(
      {
        accountId: env.R2_ACCOUNT_ID,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        bucket: env.R2_BUCKET,
      },
      objectKey,
      meta.mime_type
    );

    log({
      route: 'sign-upload',
      material_id: body.material_id,
      status: 200,
      duration_ms: Date.now() - start,
    });
    return new Response(JSON.stringify({ url, key: objectKey }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  } catch (e) {
    return handleError(e, 'sign-upload', body.material_id, start, cors);
  }
}

async function handleSignDownload(request: Request, env: Env, cors: Record<string, string>) {
  const start = Date.now();
  const auth = request.headers.get('Authorization');
  const key = jwtSubject(auth) ?? request.headers.get('CF-Connecting-IP') ?? 'anon';

  const rl = await env.DOWNLOAD_LIMITER.limit({ key: `download:${key}` });
  if (!rl.success) {
    log({ route: 'sign-download', status: 429, duration_ms: Date.now() - start });
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60', ...cors },
    });
  }

  let body: { material_id?: string };
  try {
    body = (await request.json()) as { material_id?: string };
  } catch {
    return errorResponse(400, 'invalid_json', cors);
  }
  if (!body.material_id) {
    return errorResponse(400, 'material_id_required', cors);
  }

  try {
    const meta = await callRpc<{
      file_path: string;
      file_name: string;
      mime_type: string;
    }>({ url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY }, auth, 'download_material', {
      p_material_id: body.material_id,
    });

    const url = await presignGet(
      {
        accountId: env.R2_ACCOUNT_ID,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        bucket: env.R2_BUCKET,
      },
      meta.file_path,
      meta.file_name,
      meta.mime_type
    );

    log({
      route: 'sign-download',
      material_id: body.material_id,
      status: 200,
      duration_ms: Date.now() - start,
    });
    return new Response(
      JSON.stringify({ url, file_name: meta.file_name, mime_type: meta.mime_type }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...cors } }
    );
  } catch (e) {
    return handleError(e, 'sign-download', body.material_id, start, cors);
  }
}

async function handleManualBackfill(
  request: Request,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  const start = Date.now();
  const auth = request.headers.get('Authorization');
  if (!auth) {
    log({ route: 'admin-ctgov-backfill', status: 401, duration_ms: Date.now() - start });
    return errorResponse(401, 'unauthorized', cors);
  }

  // Gate via is_platform_admin(). The RPC reads auth.uid() from the
  // forwarded JWT, so a valid bearer is required for the call to return
  // anything truthy.
  let isAdmin: boolean;
  try {
    isAdmin = await callRpc<boolean>(
      { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY },
      auth,
      'is_platform_admin',
      {}
    );
  } catch {
    log({ route: 'admin-ctgov-backfill', status: 401, duration_ms: Date.now() - start });
    return errorResponse(401, 'unauthorized', cors);
  }
  if (!isAdmin) {
    log({ route: 'admin-ctgov-backfill', status: 403, duration_ms: Date.now() - start });
    return errorResponse(403, 'forbidden', cors);
  }

  let body: { nct_ids?: string[] };
  try {
    body = (await request.json()) as { nct_ids?: string[] };
  } catch {
    return errorResponse(400, 'invalid_json', cors);
  }
  if (!Array.isArray(body.nct_ids) || body.nct_ids.length === 0) {
    return errorResponse(400, 'nct_ids_required', cors);
  }

  try {
    const summary = await runManualBackfill(env, body.nct_ids);
    log({
      route: 'admin-ctgov-backfill',
      status: 200,
      duration_ms: Date.now() - start,
      count: body.nct_ids.length,
    });
    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  } catch (e) {
    log({
      route: 'admin-ctgov-backfill',
      status: 500,
      duration_ms: Date.now() - start,
      error: String(e),
    });
    return errorResponse(500, 'internal_error', cors);
  }
}

/**
 * Single-trial Sync from CT.gov. Fronts the trial-detail "Sync from CT.gov"
 * button. Unlike /admin/ctgov-backfill (platform-admin gate, intended for
 * ops bulk re-polls), this endpoint accepts any space owner|editor JWT --
 * the trigger_single_trial_sync RPC enforces that gate AND returns the NCT
 * to back-fill, so a single request handles both the access check and the
 * NCT lookup. The CT.gov fetch + ingest then runs under the worker secret.
 */
async function handleSingleTrialSync(
  request: Request,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  const start = Date.now();
  const auth = request.headers.get('Authorization');
  if (!auth) {
    log({ route: 'api-ctgov-sync-trial', status: 401, duration_ms: Date.now() - start });
    return errorResponse(401, 'unauthorized', cors);
  }

  let body: { trial_id?: string };
  try {
    body = (await request.json()) as { trial_id?: string };
  } catch {
    return errorResponse(400, 'invalid_json', cors);
  }
  if (!body.trial_id || typeof body.trial_id !== 'string') {
    return errorResponse(400, 'trial_id_required', cors);
  }

  // Validate space access + resolve NCT in one RPC call. The RPC is
  // SECURITY INVOKER and gated on has_space_access(..., ['owner','editor']);
  // a non-member's JWT raises errcode 42501 which surfaces as a 403 from
  // PostgREST. Treat any error from this call as a forbidden / not-found
  // signal rather than a 500 -- the user can always retry with the right
  // role.
  let triggerResult: { ok: boolean; nct_id?: string; reason?: string };
  try {
    triggerResult = await callRpc<{ ok: boolean; nct_id?: string; reason?: string }>(
      { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY },
      auth,
      'trigger_single_trial_sync',
      { p_trial_id: body.trial_id }
    );
  } catch (e) {
    const err = e as SupabaseRpcError;
    const status = err.status === 401 || err.status === 403 ? err.status : 403;
    log({
      route: 'api-ctgov-sync-trial',
      status,
      duration_ms: Date.now() - start,
      error: err.message ?? String(e),
    });
    return errorResponse(status, status === 401 ? 'unauthorized' : 'forbidden', cors);
  }

  if (!triggerResult.ok || !triggerResult.nct_id) {
    log({
      route: 'api-ctgov-sync-trial',
      status: 200,
      duration_ms: Date.now() - start,
      reason: triggerResult.reason ?? 'unknown',
    });
    return new Response(JSON.stringify(triggerResult), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  try {
    const summary = await runManualBackfill(env, [triggerResult.nct_id]);
    log({
      route: 'api-ctgov-sync-trial',
      status: 200,
      duration_ms: Date.now() - start,
      nct_id: triggerResult.nct_id,
    });
    return new Response(
      JSON.stringify({ ok: true, nct_id: triggerResult.nct_id, summary }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...cors } }
    );
  } catch (e) {
    log({
      route: 'api-ctgov-sync-trial',
      status: 500,
      duration_ms: Date.now() - start,
      error: String(e),
    });
    return errorResponse(500, 'internal_error', cors);
  }
}

function handleError(
  e: unknown,
  route: string,
  material_id: string | undefined,
  start: number,
  cors: Record<string, string>
): Response {
  const err = (e as SupabaseRpcError) ?? {};
  const mapped = mapSupabaseError(err);
  log({
    route,
    material_id,
    status: mapped.status,
    duration_ms: Date.now() - start,
    error: err.message,
  });
  return errorResponse(mapped.status, mapped.body.error, cors);
}

function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}
