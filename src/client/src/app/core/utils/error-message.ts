/**
 * Convert any thrown value into a user-facing string.
 *
 * Handles Error, PostgrestError-shaped objects, Fetch Response, and
 * plain strings. Falls back to "Unknown error" for shapes we do not
 * recognize. Use this everywhere a Supabase RPC or fetch error needs
 * to be surfaced to the user.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e instanceof Response) return `${e.status} ${e.statusText}`;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.length > 0) return msg;
  }
  return 'Unknown error';
}
