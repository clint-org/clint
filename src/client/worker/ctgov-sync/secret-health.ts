import { callRpc } from '../supabase';
import type { SupabaseRpcError } from '../errors';

/**
 * Minimal env surface needed to probe the CT.gov worker secret. The full
 * worker Env satisfies this.
 */
interface SecretHealthEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  CTGOV_WORKER_SECRET: string;
}

/**
 * Detects drift between the Worker runtime secret CTGOV_WORKER_SECRET and the
 * Supabase vault secret ctgov_worker_secret. The Worker is the only holder of
 * the runtime secret, so the only reliable probe is a round-trip through it:
 * call the secret-gated RPC ctgov_secret_health with the Worker's secret. If
 * the two agree the RPC returns; if they have drifted _verify_ctgov_worker_secret
 * raises 42501. A mismatch fails every CT.gov ingest, so a dedicated detector
 * names the drift instead of leaving it to be inferred from a mass-failed run.
 *
 * Always responds 200 with a JSON {ok} body so the GitHub Actions watcher can
 * distinguish drift (200 ok:false) from the Worker being unreachable (no 200).
 */
export async function handleCtgovSecretHealth(
  env: SecretHealthEnv,
  cors: Record<string, string>
): Promise<Response> {
  const checked_at = new Date().toISOString();
  const headers = { 'Content-Type': 'application/json', ...cors };

  try {
    await callRpc(
      { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY },
      null,
      'ctgov_secret_health',
      { p_secret: env.CTGOV_WORKER_SECRET }
    );
    return new Response(JSON.stringify({ ok: true, checked_at }), {
      status: 200,
      headers,
    });
  } catch (e) {
    const err = e as SupabaseRpcError;
    const mismatch = err?.code === '42501' || err?.httpStatus === 403;
    return new Response(
      JSON.stringify({
        ok: false,
        reason: mismatch ? 'secret_mismatch' : 'error',
        checked_at,
      }),
      { status: 200, headers }
    );
  }
}
