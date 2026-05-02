/**
 * Decodes the `sub` claim from a Supabase JWT WITHOUT verifying the
 * signature. Used only to derive a stable rate-limit key. The Supabase
 * RPC layer is the authority for access decisions.
 */

export function jwtSubject(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1];
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '==='.slice(0, (4 - (payload.length % 4)) % 4);
    const json = atob(padded);
    const claims = JSON.parse(json) as { sub?: unknown };
    return typeof claims.sub === 'string' && claims.sub.length > 0 ? claims.sub : null;
  } catch {
    return null;
  }
}
