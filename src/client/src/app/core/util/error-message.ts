/**
 * Extract a user-facing message from an unknown error value.
 *
 * Supabase RPC errors come back as PostgrestError -- a plain object with a
 * `message` field, NOT a `JS Error` instance. Code that does
 * `e instanceof Error ? e.message : 'fallback'` silently swallows the real
 * reason and shows the generic fallback. This helper handles both shapes.
 */
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.length > 0) return msg;
  }
  return fallback;
}
