/**
 * Resolve capture params from a (process.env-like) record; throw on missing
 * required vars. Returns { path, out, seed } where seed is undefined if unset.
 */
export function captureParamsFromEnv(env) {
  const path = env['CAPTURE_PATH'];
  const out = env['CAPTURE_OUT'];
  if (!path) throw new Error('CAPTURE_PATH is required');
  if (!out) throw new Error('CAPTURE_OUT is required');
  return { path, out, seed: env['CAPTURE_SEED'] };
}
